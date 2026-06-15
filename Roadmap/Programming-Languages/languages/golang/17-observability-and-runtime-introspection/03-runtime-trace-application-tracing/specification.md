# `runtime/trace` & Application Tracing — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `runtime/trace` Is Specified](#where-runtimetrace-is-specified)
3. [Package Synopsis](#package-synopsis)
4. [Whole-Process Recording API](#whole-process-recording-api)
5. [User Annotation API: Tasks, Regions, Logs](#user-annotation-api-tasks-regions-logs)
6. [The Flight Recorder API](#the-flight-recorder-api)
7. [Capture Channels (`go test`, `net/http/pprof`)](#capture-channels-go-test-nethttppprof)
8. [The `go tool trace` Command](#the-go-tool-trace-command)
9. [What Is and Is Not Recorded](#what-is-and-is-not-recorded)
10. [Differences Across Go Versions](#differences-across-go-versions)
11. [References](#references)

---

## Introduction

This file is the reference sheet: the precise API surface, the capture channels, the viewer command, and the version-dependent behaviour. It is authoritative against the package documentation as of Go 1.25; where behaviour is version-specific it is called out explicitly. For prose explanation, see the other tiers; this file is for lookups.

---

## Where `runtime/trace` Is Specified

- **Package documentation:** [pkg.go.dev/runtime/trace](https://pkg.go.dev/runtime/trace) — the normative API.
- **Command documentation:** [pkg.go.dev/cmd/trace](https://pkg.go.dev/cmd/trace) — the `go tool trace` viewer.
- **HTTP capture:** [pkg.go.dev/net/http/pprof](https://pkg.go.dev/net/http/pprof) — the `/debug/pprof/trace` handler.
- **Diagnostics guide:** [go.dev/doc/diagnostics](https://go.dev/doc/diagnostics) — how tracing relates to profiling.
- **Release notes:** Go 1.21 (tracer rewrite), Go 1.25 (`FlightRecorder` in stdlib).

The trace *binary format* is an internal, versioned detail and is not part of the stable API; the stable contracts are the `runtime/trace` package and the trace reader.

---

## Package Synopsis

`runtime/trace` provides two facilities:

1. **Execution recording** — `Start`/`Stop` begin and end recording of the runtime's execution events to an `io.Writer`.
2. **User annotation** — `NewTask`, `WithRegion`/`StartRegion`, and `Log`/`Logf` attach application-level structure (tasks, regions, logs) to the trace.

As of Go 1.25 it also provides the **flight recorder** (`FlightRecorder`), a continuous bounded recorder snapshotted on demand.

---

## Whole-Process Recording API

```go
func Start(w io.Writer) error
func Stop()
func IsEnabled() bool
```

- **`Start(w)`** — begins recording; writes the trace to `w`. Returns a non-nil error if tracing is already enabled. At most one trace per process.
- **`Stop()`** — stops recording and flushes all buffered data to the writer. Must run for the trace to be complete; not run by `os.Exit`.
- **`IsEnabled()`** — reports whether a trace is currently running. Annotation calls are no-ops when it returns false.

---

## User Annotation API: Tasks, Regions, Logs

```go
// Tasks — logical operations, may span goroutines, propagated by context.
func NewTask(pctx context.Context, taskType string) (ctx context.Context, task *Task)
func (t *Task) End()

// Regions — a span of execution within ONE goroutine; LIFO-nested.
func WithRegion(ctx context.Context, regionType string, fn func())
func StartRegion(ctx context.Context, regionType string) *Region
func (r *Region) End()

// Logs — point-in-time keyed events.
func Log(ctx context.Context, category, message string)
func Logf(ctx context.Context, category, format string, args ...any)
```

Normative rules:

- **`NewTask`** returns a derived context. Regions and logs are attributed to a task only if created with a context descended from that task's context.
- **`task.End()`** ends the task. Idempotency is not guaranteed; call once.
- **A region** must begin and end on the same goroutine, and regions must be properly nested (LIFO). `WithRegion` enforces this via the closure; `StartRegion`/`End` require the caller to.
- **All annotation functions are no-ops** when tracing is disabled, and are safe to leave in production code.

---

## The Flight Recorder API

**Availability:** standard library in **Go 1.25** (`runtime/trace.FlightRecorder`); experimental in **`golang.org/x/exp/trace`** before 1.25.

```go
// Go 1.25 runtime/trace (shape; consult pkg.go.dev for exact fields).
type FlightRecorderConfig struct {
    MinAge   time.Duration // minimum recent history to retain
    MaxBytes uint64        // upper bound on the in-memory buffer
}

func NewFlightRecorder(cfg FlightRecorderConfig) *FlightRecorder
func (fr *FlightRecorder) Start() error
func (fr *FlightRecorder) Stop()
func (fr *FlightRecorder) Enabled() bool
func (fr *FlightRecorder) WriteTo(w io.Writer) (n int64, err error)
```

- **`Start`** begins continuous recording into a bounded in-memory ring buffer; errors if it cannot start (e.g., another tracer active).
- **`WriteTo`** serializes the currently retained window as a complete, valid trace. May be called multiple times.
- **The recorder and `trace.Start`** both drive the runtime tracer and cannot run in conflict; coordinate.

---

## Capture Channels (`go test`, `net/http/pprof`)

### `go test`

```
go test -trace=FILE [packages]
```

The test binary calls `Start`/`Stop` around the run. The traced code must not call `trace.Start` itself.

### `net/http/pprof`

Importing `net/http/pprof` for side effects registers:

```
GET /debug/pprof/trace?seconds=N
```

Returns an execution trace of the live process recorded over `N` seconds (default 1 if omitted). The handler calls `Start`/`Stop` internally. The endpoint must be access-controlled.

---

## The `go tool trace` Command

```
go tool trace [flags] trace.out
go tool trace [flags] pprof-binary trace.out   # legacy form
```

Behaviour:

- Parses the trace and serves an interactive web UI on a local port.
- Views: **View trace** (timeline by proc/thread), **Goroutine analysis**, **Scheduler latency profile**, **Network/Synchronization/Syscall blocking profiles**, **User-defined tasks**, **User-defined regions**.
- The viewing toolchain version should match the capturing version (the trace format is versioned).

Selected flags: `-http=addr` (bind address for the UI), `-pprof=TYPE` (emit a pprof profile derived from the trace to stdout, e.g. `net`, `sync`, `syscall`, `sched`).

---

## What Is and Is Not Recorded

**Recorded:**
- Goroutine lifecycle and scheduling transitions (create, start, stop, block with reason, unblock, end, preempt, yield).
- Proc (P) start/stop and stop-the-world windows.
- GC phases, mark-assist, sweep.
- Syscall enter/exit and syscall blocking.
- Network-poller and synchronization blocking.
- User tasks, regions, and logs.

**Not recorded:**
- Per-line CPU sampling (that is `runtime/pprof` CPU profiles).
- Heap allocation stacks (that is the heap profile).
- Any cross-process / cross-service information (that is distributed tracing — OpenTelemetry).
- Arbitrary application data unless explicitly emitted via `trace.Log`.

---

## Differences Across Go Versions

| Version | Behaviour |
|---------|-----------|
| ≤ 1.10 | User annotation API (`NewTask`, regions, logs) not yet present; tracing is scheduler-only. |
| 1.11 | `runtime/trace` annotation API (tasks, regions, logs) introduced. |
| ≤ 1.20 | Older ("v1") trace format; stop-the-world at `trace.Start`; global tracer lock; higher overhead. |
| 1.21 | Tracer rewrite: new partitioned/generational format, per-P buffers, no STW at start, lower overhead, streamable. |
| 1.22 | Continued tracer improvements and trace reader work. |
| pre-1.25 | Flight recorder available only experimentally as `golang.org/x/exp/trace.FlightRecorder`. |
| 1.25 | Flight recorder GA in the standard library as `runtime/trace.FlightRecorder`. |

Capture and analyze with the same toolchain version; the format is version-specific.

---

## References

- [`runtime/trace` package](https://pkg.go.dev/runtime/trace) — normative API.
- [`cmd/trace` (`go tool trace`)](https://pkg.go.dev/cmd/trace) — the viewer.
- [`net/http/pprof`](https://pkg.go.dev/net/http/pprof) — HTTP capture.
- [`golang.org/x/exp/trace`](https://pkg.go.dev/golang.org/x/exp/trace) — experimental reader and pre-1.25 flight recorder.
- [Go 1.21 release notes](https://go.dev/doc/go1.21) — tracer rewrite.
- [Go 1.25 release notes](https://go.dev/doc/go1.25) — `FlightRecorder` in stdlib.
- [Diagnostics](https://go.dev/doc/diagnostics) — tracing vs profiling.
