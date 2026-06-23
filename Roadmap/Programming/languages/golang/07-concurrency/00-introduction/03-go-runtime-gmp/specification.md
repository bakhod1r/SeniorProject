# Go Runtime GMP — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Authoritative Sources](#authoritative-sources)
3. [Scheduler Behaviour Across Go Versions](#scheduler-behaviour-across-go-versions)
4. [`GODEBUG` Knobs Reference](#godebug-knobs-reference)
5. [Runtime Package APIs](#runtime-package-apis)
6. [Environment Variables](#environment-variables)
7. [References](#references)

---

## Introduction

This file collects authoritative documentation for the Go runtime scheduler — primary sources, version history, public APIs, and tunable knobs. Use as a reference when verifying claims or debugging version-specific behaviour.

---

## Authoritative Sources

### Design documents

- **Dmitry Vyukov, *Scalable Go Scheduler Design Doc*** (2012, for Go 1.1). The original design that introduced the M:N scheduler with per-P queues and work stealing. Available at <https://go.dev/s/go11sched>.
- **Dmitry Vyukov, *Go Preemptive Scheduler Design Doc*** (2013). Discusses cooperative preemption at function entry.
- **Austin Clements et al., *Proposal: Non-cooperative goroutine preemption*** (2019, for Go 1.14). Introduces async preemption via signals. <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- **Michael Knyszek, *Proposal: A Goroutine Tracebacks for Allocation Profiling*** (2020). Background for the tracing system.

### Source code

- `src/runtime/proc.go` — the scheduler core.
- `src/runtime/runtime2.go` — struct definitions.
- `src/runtime/preempt.go` — async preemption.

### Talks

- **Kavya Joshi, *The Scheduler Saga*** (GopherCon 2018): <https://www.youtube.com/watch?v=YHRO5WQGh0k>
- **Madhav Jivrajani, *Queues, Fairness, and the Go Scheduler*** (GopherCon 2021): <https://www.youtube.com/watch?v=YHRO5WQGh0k>
- **Andrei Tudor Călin, *A Brief Tour of the Go Runtime Scheduler*** (GopherCon EU 2019).

### Documentation

- Go runtime package: <https://pkg.go.dev/runtime>
- Diagnostics documentation: <https://go.dev/doc/diagnostics>
- `runtime/metrics` package: <https://pkg.go.dev/runtime/metrics>

---

## Scheduler Behaviour Across Go Versions

| Version | Year | Scheduler change |
|---|---|---|
| 1.0 | 2012 | Single global run queue; M:1 model. Slow at scale. |
| 1.1 | 2013 | Introduced GMP model with per-P run queues and work stealing (Vyukov design). |
| 1.2 | 2013 | Cooperative preemption at function entry. |
| 1.5 | 2015 | `GOMAXPROCS` defaults to `NumCPU` (was 1 before). |
| 1.7 | 2016 | Context package added. |
| 1.14 | 2020 | Async preemption via signals. Tight loops now preemptible. |
| 1.14 | 2020 | Timer heap moved per-P (was global). Reduces contention. |
| 1.15 | 2020 | `time.Ticker` improvements; better timer cancellation. |
| 1.16 | 2021 | I/O improvements; `embed` package. |
| 1.18 | 2022 | Generics; runtime metrics improvements. |
| 1.19 | 2022 | `GOMEMLIMIT` introduced. Soft memory cap to trigger GC earlier. |
| 1.21 | 2023 | Native cgroup CPU detection for `GOMAXPROCS` default. |
| 1.22 | 2024 | Loop variable scope change (each iteration gets fresh variable). |

The scheduler is one of the most-improved parts of Go. Each release brings refinements; sometimes (1.14, 1.21) they are significant.

---

## `GODEBUG` Knobs Reference

`GODEBUG` is an environment variable for runtime debugging. Comma-separated `key=value` pairs.

### Scheduler-related

| Key | Description |
|---|---|
| `schedtrace=N` | Every N ms, print a one-line scheduler summary. |
| `scheddetail=1` | With `schedtrace`, include per-G/M/P details. |
| `inittrace=1` | Print init function timings. |
| `cgocheck=N` | Cgo pointer-checking level (0 = off, 1 = some, 2 = paranoid). |
| `gctrace=1` | Print a line for each GC cycle. |
| `gcpacertrace=1` | More detailed GC pacing info. |
| `madvdontneed=0` | Use `MADV_FREE` instead of `MADV_DONTNEED` for unused memory. |
| `asyncpreemptoff=1` | Disable async preemption (revert to 1.13 behaviour). |
| `mvccmark=1` | Force MVCC marking in GC. Experimental. |
| `tracefpunwindoff=1` | Disable frame pointer unwinding in traces. |

### Example output

```
SCHED 1003ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=0 idlethreads=4 runqueue=2 [3 1 0 2 1 0 1 0]
```

Reading: 8 P's, none idle (all running G's), 12 OS threads exist, 0 currently spinning, 4 idle, global queue has 2 G's, per-P queues are 3, 1, 0, 2, 1, 0, 1, 0.

### Detailed format (`scheddetail=1`)

```
SCHED 2002ms: gomaxprocs=8 idleprocs=0 threads=12 spinningthreads=1 idlethreads=4 runqueue=0 gcwaiting=0 nmidlelocked=0 stopwait=0 sysmonwait=0
  P0: status=1 schedtick=14 syscalltick=2 m=3 runqsize=3 gfreecnt=0 timerslen=0
  P1: status=1 schedtick=15 syscalltick=1 m=4 runqsize=1 gfreecnt=0 timerslen=1
  ...
  M0: p=0 curg=23 mallocing=0 throwing=0 preemptoff=  locks=0 dying=0 spinning=false blocked=false lockedg=
  M1: p=1 curg=45 ...
  ...
  G1: status=4(timer goroutine (idle)) m=-1 lockedm=-1
  G2: status=4(force gc (idle)) m=-1 lockedm=-1
  G3: status=4(GC sweep wait) m=-1 lockedm=-1
  ...
```

Verbose but informative.

---

## Runtime Package APIs

From `https://pkg.go.dev/runtime`:

### `runtime.GOMAXPROCS`

```go
func GOMAXPROCS(n int) int
```

Sets and returns the maximum number of OS threads that can execute user-level Go code simultaneously. If `n < 1`, the current setting is returned without change.

Default since Go 1.5: `runtime.NumCPU()`. Since Go 1.21: also respects cgroup CPU quota on Linux.

### `runtime.NumCPU`

```go
func NumCPU() int
```

Returns the number of logical CPUs usable by the current process. Equivalent to `nproc`. Detected at startup.

### `runtime.NumGoroutine`

```go
func NumGoroutine() int
```

Returns the number of goroutines that currently exist, including the main and any runtime-internal goroutines.

### `runtime.Gosched`

```go
func Gosched()
```

Yields the processor, allowing other goroutines to run. The current goroutine resumes shortly after.

### `runtime.LockOSThread` / `runtime.UnlockOSThread`

```go
func LockOSThread()
func UnlockOSThread()
```

Wires the calling goroutine to its current OS thread. Subsequent goroutines spawned by this goroutine are not pinned (they run on whatever OS thread the scheduler picks).

Locks nest: N calls to `LockOSThread` require N calls to `UnlockOSThread`.

### `runtime.Goexit`

```go
func Goexit()
```

Terminates the goroutine that calls it. Other goroutines are unaffected. Runs deferred functions. If this is the last goroutine, the program exits.

### `runtime.NumGoroutine`

Already listed.

### `runtime.NumOSThread` — actually `runtime.NumCgoCall` and friends

Some functions to inspect OS-level state are available, mostly via `runtime/metrics`.

### `runtime.SetBlockProfileRate`

```go
func SetBlockProfileRate(rate int)
```

Controls the fraction of goroutine blocking events captured by the block profile. Rate of 1 captures all; 0 disables.

### `runtime.SetMutexProfileFraction`

```go
func SetMutexProfileFraction(rate int) int
```

Controls the fraction of mutex contention events captured by the mutex profile.

### `runtime.SetCPUProfileRate`

```go
func SetCPUProfileRate(hz int)
```

CPU profile sample rate in Hz. Default 100.

### `runtime/metrics` package

```go
import "runtime/metrics"
```

Stable API to read runtime metrics (goroutine count, GC pause time, memory usage, scheduler latencies, etc.). Replaces ad-hoc access via `runtime.ReadMemStats`.

Example metrics:

- `/sched/goroutines:goroutines`
- `/sched/latencies:seconds` (histogram)
- `/sched/total-events:events`
- `/gc/pauses:seconds` (histogram)
- `/cpu/classes/total:cpu-seconds`

---

## Environment Variables

| Variable | Description |
|---|---|
| `GOMAXPROCS` | Initial value of `runtime.GOMAXPROCS`. |
| `GOGC` | GC trigger as percentage of live heap. Default 100. `off` disables. |
| `GOMEMLIMIT` | Soft memory limit (Go 1.19+). e.g., `GOMEMLIMIT=1GiB`. |
| `GODEBUG` | Debug flags, comma-separated. See above. |
| `GOTRACEBACK` | Verbosity of crash tracebacks. `none`, `single` (default), `all`, `system`, `crash`. |
| `GOROOT` | Go installation directory. |

---

## References

- The Go runtime: <https://pkg.go.dev/runtime>
- `runtime/metrics`: <https://pkg.go.dev/runtime/metrics>
- Go source code: <https://github.com/golang/go/tree/master/src/runtime>
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc*: <https://go.dev/s/go11sched>
- Austin Clements, *Non-cooperative goroutine preemption*: <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- Kavya Joshi, *The Scheduler Saga*: <https://www.youtube.com/watch?v=YHRO5WQGh0k>
- Ardan Labs, *Scheduling in Go*: <https://www.ardanlabs.com/blog/2018/08/scheduling-in-go-part1.html>
- `automaxprocs`: <https://github.com/uber-go/automaxprocs>
- Go release notes (each version): <https://go.dev/doc/devel/release>
- Diagnostics doc: <https://go.dev/doc/diagnostics>
- Go memory model: <https://go.dev/ref/mem>
- *Concurrency in Go* by Katherine Cox-Buday (O'Reilly, 2017).
