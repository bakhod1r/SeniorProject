# Scheduler Tracing — Specification

[Back to index](index.md)

Reference for all scheduler-tracing knobs, environment variables, and Go APIs. Use this as a lookup; the explanations are in `junior.md` through `professional.md`.

## Table of Contents
1. [`GODEBUG` Switches](#godebug-switches)
2. [`runtime/trace` Package](#runtimetrace-package)
3. [`runtime/metrics` Package](#runtimemetrics-package)
4. [`net/http/pprof` Endpoints for Tracing](#nethttppprof-endpoints-for-tracing)
5. [`go tool trace` Flags](#go-tool-trace-flags)
6. [Trace Event Types](#trace-event-types)
7. [Goroutine Status Values](#goroutine-status-values)
8. [P Status Values](#p-status-values)
9. [Cross-References](#cross-references)

---

## `GODEBUG` Switches

`GODEBUG` is a comma-separated key=value list set as an environment variable. Switches are read once at program start (with a few exceptions).

| Key | Value | Effect |
|-----|-------|--------|
| `schedtrace` | int milliseconds | Emit one SCHED line per N ms. |
| `scheddetail` | `0` or `1` | When `schedtrace` is set, also dump per-G/M/P detail. |
| `gctrace` | `0`, `1`, `2` | `1` emits a line per GC cycle. `2` also forces additional info. |
| `gccheckmark` | `0` or `1` | Force a checkmark phase. |
| `gcpacertrace` | `0` or `1` | Emit GC pacer state lines. |
| `allocfreetrace` | `0` or `1` | Trace every allocation and free. Very expensive. |
| `inittrace` | `0` or `1` | One line per package init function with timing. |
| `madvdontneed` | `0` or `1` | Linux scavenger behaviour. |
| `tracebackancestors` | int | Include this many ancestor traces in panics. |

Example combinations:

```bash
# Standard scheduler observability:
GODEBUG=schedtrace=1000

# Plus per-G detail:
GODEBUG=schedtrace=1000,scheddetail=1

# Scheduler plus GC:
GODEBUG=schedtrace=1000,gctrace=1

# Everything for an incident:
GODEBUG=schedtrace=500,scheddetail=1,gctrace=1,gcpacertrace=1
```

Output goes to standard error. Redirect to a file:

```bash
GODEBUG=schedtrace=1000 ./prog 2>sched.log
```

---

## `runtime/trace` Package

```go
package trace
```

Captures execution traces. Events are written to an `io.Writer` until `Stop` is called.

### Functions

```go
func Start(w io.Writer) error
```
Begins tracing. Returns an error if a trace is already in progress.

```go
func Stop()
```
Stops the trace. Idempotent.

```go
func IsEnabled() bool
```
Reports whether tracing is currently active.

```go
func WithRegion(ctx context.Context, regionType string, fn func())
```
Wraps `fn` in a region with the given name. The region begins on the current G, runs `fn`, and ends. Must begin and end on the same G.

```go
func StartRegion(ctx context.Context, regionType string) *Region
```
Begins a region; you must call `End` later on the same G. Use `WithRegion` instead when possible.

```go
func (r *Region) End()
```
Ends a region.

```go
func NewTask(ctx context.Context, taskType string) (context.Context, *Task)
```
Starts a logical task; returns a derived context that carries the task identity. The task lives until `End` is called. Tasks can span goroutines via `ctx`.

```go
func (t *Task) End()
```
Ends a task.

```go
func Log(ctx context.Context, category, message string)
```
Emits a log event tagged with the given category, attached to any task active in `ctx`.

```go
func Logf(ctx context.Context, category, format string, args ...interface{})
```
Formatted version of `Log`.

### Cost

When tracing is disabled, each annotation is a single atomic load plus a branch. When tracing is enabled, each annotation costs ~150–300 ns.

---

## `runtime/metrics` Package

```go
package metrics
```

Programmatic access to runtime counters and histograms. Names are stable strings of the form `/category/sub:unit`.

### Functions

```go
func All() []Description
```
Returns all available metrics.

```go
func Read(samples []Sample)
```
Reads the named metrics into `samples`. Each sample's `Value` is filled.

### Scheduler metrics

| Name | Type | Meaning |
|------|------|---------|
| `/sched/goroutines:goroutines` | `Uint64` | Live goroutine count. |
| `/sched/latencies:seconds` | `Float64Histogram` | Time goroutines spent runnable before running. |
| `/sched/pauses-total/gc:seconds` | `Float64Histogram` | GC pause durations. |
| `/cpu/classes/gc/mark/assist:cpu-seconds` | `Float64` | CPU time spent in GC mark assists. |
| `/cpu/classes/gc/total:cpu-seconds` | `Float64` | All GC CPU. |
| `/cpu/classes/idle:cpu-seconds` | `Float64` | Idle CPU. |
| `/cpu/classes/user:cpu-seconds` | `Float64` | User CPU. |
| `/cpu/classes/scavenge/total:cpu-seconds` | `Float64` | Scavenger CPU. |
| `/sync/mutex/wait/total:seconds` | `Float64` | Total mutex wait time. |

### Value kinds

```go
type ValueKind int

const (
    KindBad ValueKind = iota
    KindUint64
    KindFloat64
    KindFloat64Histogram
)
```

Access with `Value.Uint64()`, `Value.Float64()`, `Value.Float64Histogram()`.

---

## `net/http/pprof` Endpoints for Tracing

When you `import _ "net/http/pprof"`, the default HTTP mux registers:

| Path | Method | Returns |
|------|--------|---------|
| `/debug/pprof/trace?seconds=N` | GET | A `runtime/trace` capture of N seconds. |
| `/debug/pprof/profile?seconds=N` | GET | A CPU profile of N seconds. |
| `/debug/pprof/goroutine` | GET | Goroutine profile. |
| `/debug/pprof/heap` | GET | Heap profile. |
| `/debug/pprof/allocs` | GET | Allocations profile. |
| `/debug/pprof/block` | GET | Block profile. |
| `/debug/pprof/mutex` | GET | Mutex profile. |
| `/debug/pprof/threadcreate` | GET | Thread creation profile. |

For tracing specifically:

```bash
curl -o trace.out http://127.0.0.1:6060/debug/pprof/trace?seconds=5
```

The default `seconds=` is 1. The maximum is no longer hardcoded but the server-side timeout in many setups is ~30s.

Security: bind to `127.0.0.1` only. Never expose pprof on a public address.

---

## `go tool trace` Flags

```bash
go tool trace [flags] trace.out
```

### Main flag

`-http=addr` — bind the UI to this address. Default `:0` (random port).

### Extraction flags

| Flag | Output |
|------|--------|
| `-pprof=net` | Network blocking profile. |
| `-pprof=sync` | Synchronization blocking profile. |
| `-pprof=syscall` | Syscall blocking profile. |
| `-pprof=sched` | Scheduler latency profile. |
| `-d` | Dump events as text. |

Example:

```bash
go tool trace -pprof=sched trace.out > sched.prof
go tool pprof -http=:8080 sched.prof
```

### Optional flags

| Flag | Effect |
|------|--------|
| `-debug` | Verbose logging. |
| `-help` | Show all flags. |

---

## Trace Event Types

The following event types appear in `runtime/trace` output.

### G lifecycle
- `GoCreate` — `go` statement created a G.
- `GoStart` — G began running on an M.
- `GoEnd` — G returned from its top function.
- `GoStop` — G stopped voluntarily (`Gosched`).
- `GoPreempt` — G preempted.
- `GoSched` — G yielded via `runtime.Gosched`.

### Blocking
- `GoBlock` — G blocked (generic).
- `GoBlockSend` — blocked on channel send.
- `GoBlockRecv` — blocked on channel recv.
- `GoBlockSelect` — blocked on select.
- `GoBlockSync` — blocked on `sync.Mutex` / `RWMutex`.
- `GoBlockCond` — blocked on `sync.Cond.Wait`.
- `GoBlockNet` — blocked on netpoll.
- `GoBlockGC` — blocked waiting for GC.

### Unblocking
- `GoUnblock` — `_Gwaiting` → `_Grunnable`.
- `GoSysCall` — entered syscall.
- `GoSysBlock` — syscall held P > 20µs; P donated.
- `GoSysExit` — left syscall.

### GC
- `GCStart` — GC cycle started.
- `GCDone` — GC cycle ended.
- `GCSTWStart` — STW phase started.
- `GCSTWDone` — STW phase ended.
- `GCMarkAssistStart`, `GCMarkAssistDone` — mark-assist phase boundaries.

### User
- `UserTaskCreate`, `UserTaskEnd` — `trace.NewTask`.
- `UserRegion` — `trace.WithRegion` begin or end.
- `UserLog` — `trace.Log`.

### P / M
- `ProcStart`, `ProcStop` — P activation.
- `ProcsChange` — `GOMAXPROCS` changed.
- `HeapAlloc`, `HeapGoal` — heap stats.

---

## Goroutine Status Values

From `src/runtime/runtime2.go`:

| Constant | Value | Meaning |
|----------|-------|---------|
| `_Gidle` | 0 | Just allocated. |
| `_Grunnable` | 1 | On a runqueue, ready to run. |
| `_Grunning` | 2 | Currently executing on an M. |
| `_Gsyscall` | 3 | Inside a system call. |
| `_Gwaiting` | 4 | Blocked. `waitreason` describes why. |
| `_Gmoribund_unused` | 5 | Unused. |
| `_Gdead` | 6 | Pool of free G structs. |
| `_Genqueue_unused` | 7 | Unused. |
| `_Gcopystack` | 8 | Stack being copied. |
| `_Gpreempted` | 9 | Preempted via signal. |

---

## P Status Values

| Constant | Value | Meaning |
|----------|-------|---------|
| `_Pidle` | 0 | On idle list. |
| `_Prunning` | 1 | Bound to an M, running. |
| `_Psyscall` | 2 | Donated to syscall. |
| `_Pgcstop` | 3 | Stopped for GC. |
| `_Pdead` | 4 | `GOMAXPROCS` shrunk. |

---

## Cross-References

- Schedtrace and scheddetail output: `junior.md`.
- `go tool trace` UI: `middle.md`.
- Custom regions, tasks, logs: `senior.md`.
- Trace format internals: `professional.md`.
- GC interactions: `02-gogc/`.
- Sysmon: `10-scheduler-deep-dive/03-sysmon/`.
- Netpoller: `10-scheduler-deep-dive/05-netpoller/`.
