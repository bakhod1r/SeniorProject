# go tool trace — Specification

> **Focus:** Precise reference for the `go tool trace` viewer and the `runtime/trace` API that feeds it — synopsis, sources, UI tabs, environment, guarantees, and non-goals.
>
> **Sources:**
> - `go doc cmd/trace`
> - `runtime/trace`: https://pkg.go.dev/runtime/trace
> - `net/http/pprof`: https://pkg.go.dev/net/http/pprof
> - Trace v2 proposal: https://github.com/golang/go/issues/60773

---

## 1. Synopsis

```
go tool trace [flags] [pkg.test] trace.out
```

`go tool trace` parses a binary trace file produced by the Go runtime and serves an interactive HTTP UI on a local ephemeral port. The browser opens automatically unless the environment forbids it (`BROWSER=none`, headless CI).

| Flag | Effect |
|------|--------|
| `-http addr` | Bind the local server to `addr` (e.g., `127.0.0.1:8081`); default is a random port. |
| `-pprof type` | Print a pprof profile to stdout instead of serving the UI; `type` is one of `net`, `sync`, `syscall`, `sched`. |
| `-d` | Dump the parsed event stream to stdout (debug). |

A `pkg.test` binary argument is optional and only used to resolve symbols when the trace was produced by a test binary not on `PATH`.

---

## 2. Web UI tabs

| Tab | What it shows |
|-----|---------------|
| **View trace** | Per-P / per-G timeline of events; the main visualization (Catapult/Perfetto-based) |
| **Goroutine analysis** | Per-goroutine totals: time running, runnable, blocked-on-X |
| **Network blocking profile** | Aggregated time goroutines spent in netpoller wait, grouped by call site |
| **Synchronization blocking profile** | Aggregated time blocked on channels/mutexes, grouped by call site |
| **Syscall blocking profile** | Aggregated time blocked inside syscalls, grouped by call site |
| **Scheduler latency profile** | Runnable-to-running delay, grouped by goroutine creation site |
| **User-defined tasks** | Tree of `trace.NewTask` invocations with regions and durations |
| **User-defined regions** | Aggregated time spent in each named `trace.WithRegion` |
| **Minimum mutator utilization (MMU)** | Plot of `1 - GC%` over varying window sizes |

Each blocking profile can also be exported as a pprof file via `-pprof <type>`.

---

## 3. Sources of trace files

| Source | How |
|--------|-----|
| Test binary | `go test -trace=trace.out ./...` |
| Application code | `runtime/trace.Start(io.Writer)` ... `runtime/trace.Stop()` |
| Live server | `GET /debug/pprof/trace?seconds=N` (requires `net/http/pprof` imported and a handler mux) |
| Flight recorder snapshot (Go 1.23+) | `(*trace.FlightRecorder).WriteTo(io.Writer)` |

All produce the same on-disk format (trace v2 from Go 1.21+).

---

## 4. `runtime/trace` API

| Function | Purpose |
|----------|---------|
| `Start(w io.Writer) error` | Begin emitting events to `w`. Errors if tracing already on. |
| `Stop()` | Stop emitting; flush buffers. |
| `IsEnabled() bool` | Whether tracing is currently active. |
| `NewTask(ctx, name) (context.Context, *Task)` | Create a logical task spanning goroutines. |
| `(*Task).End()` | End a task; required for correct UI accounting. |
| `WithRegion(ctx, name, fn func())` | Named span within the current goroutine. |
| `StartRegion(ctx, name) *Region` / `(*Region).End()` | Manual region pairing. |
| `Log(ctx, key, value)` | Attach a key/value annotation to the enclosing task. |
| `Logf(ctx, key, fmt, args...)` | Formatted version of `Log`. |

Conventions:
- Always `defer task.End()` immediately after `NewTask`; tasks without `End` leak in the UI.
- Pass the returned `ctx` from `NewTask` to downstream code so child regions/logs attach to the task.

---

## 5. Flight recorder API (Go 1.23+)

| Function | Purpose |
|----------|---------|
| `NewFlightRecorder() *FlightRecorder` | Create a recorder (not yet running). |
| `(*FlightRecorder).Start() error` | Begin recording into a rolling in-memory buffer. |
| `(*FlightRecorder).Stop() error` | Stop recording. |
| `(*FlightRecorder).WriteTo(w io.Writer) (n int64, err error)` | Snapshot the current buffer to `w` (a complete trace file). |
| `(*FlightRecorder).SetSize(d time.Duration, bytes int)` | Configure the rolling window's duration and byte cap. |

Snapshots are normal trace files openable by `go tool trace`. A program may have one active recorder; combining with `runtime/trace.Start` is not supported.

---

## 6. Environment variables

| Variable | Role |
|----------|------|
| `GODEBUG=traceadvanceperiod=N` | Override the period (nanoseconds) at which trace generations advance (advanced). |
| `GODEBUG=tracestackdepth=N` | Max frames recorded per event stack trace. |
| `BROWSER` | Used by `go tool trace` to decide which browser to open; `BROWSER=none` suppresses auto-open. |
| `GOTRACEBACK` | Unrelated to the tracer; controls panic traces. Mentioned here only because it is sometimes confused. |

---

## 7. Trace v2 format (one paragraph)

Since Go 1.21, traces are written in a streamable, per-P-batched format organized into self-describing **generations**. Within a generation, each P emits a sequence of timestamped events into its own buffer with no global lock; the parser merges generations across Ps to reconstruct a global timeline. The format is **not** backward-compatible with v1 (pre-1.21). Decoders live in `internal/trace/v2` (Go source tree) and `golang.org/x/exp/trace` (public mirror).

---

## 8. Behavioral guarantees

- **Single active tracer.** `runtime/trace.Start` errors if tracing is already enabled (including by the flight recorder).
- **Buffered.** Events are batched per P; `Stop` (or `WriteTo` for the flight recorder) is required to flush.
- **Self-contained files.** Each trace file is independently parseable by `go tool trace` of the same major Go series.
- **Local-only UI.** The viewer binds to localhost (or `-http addr`); it does not authenticate connections.
- **No correctness impact.** Enabling the tracer changes timing (per-event cost, buffer flushes) but does not change program semantics.

---

## 9. Non-goals / limitations

- Not a CPU profiler — for hot-function analysis use `pprof`.
- Not a heap profiler — for allocation analysis use `pprof` heap.
- Not designed for always-on continuous capture to disk in production; the flight recorder is the production-friendly alternative.
- The browser UI is single-threaded JavaScript (Catapult/Perfetto-derived) and does not scale to multi-GB traces; capture short windows.
- Not a structured-log or metrics replacement — `trace.Log` is for sparse labels, not high-cardinality telemetry.
- Trace files may contain sensitive data (stacks, HTTP paths, `trace.Log` values); treat them as PII-class.

---

## 10. Related references
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- `golang.org/x/exp/trace` (public parser): https://pkg.go.dev/golang.org/x/exp/trace
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
- "Diagnostics" guide: https://go.dev/doc/diagnostics
- Trace v2 proposal: https://github.com/golang/go/issues/60773
- Flight recorder proposal: https://github.com/golang/go/issues/63185
