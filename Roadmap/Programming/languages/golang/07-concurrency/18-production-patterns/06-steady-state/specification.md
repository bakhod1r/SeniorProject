---
layout: default
title: Steady-State — Specification
parent: Steady-State
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/06-steady-state/specification/
---

# Steady-State — Specification

[← Back](../)

This page collects the formal contracts behind steady-state engineering in Go: the runtime knobs, the standard-library APIs, and the proposal documents that explain why they exist. Use this page as a quick reference when you are reading code, writing a runbook, or sitting in front of a production system at three in the morning.

## Table of Contents

1. [Scope](#scope)
2. [`runtime/debug.SetMemoryLimit` and `GOMEMLIMIT`](#runtimedebugsetmemorylimit-and-gomemlimit)
3. [`runtime/debug.SetGCPercent` and `GOGC`](#runtimedebugsetgcpercent-and-gogc)
4. [`runtime/metrics`](#runtimemetrics)
5. [`pprof` profiles](#pprof-profiles)
6. [Channels — capacity and select semantics](#channels--capacity-and-select-semantics)
7. [`database/sql` pool contract](#databasesql-pool-contract)
8. [`net/http.Transport` pool contract](#nethttptransport-pool-contract)
9. [gRPC `ClientConn` keepalive](#grpc-clientconn-keepalive)
10. [`golang.org/x/sync/semaphore`](#golangorgxsyncsemaphore)
11. [OS file descriptor limits](#os-file-descriptor-limits)
12. [cgroup v1 and v2 memory limits](#cgroup-v1-and-v2-memory-limits)
13. [Related proposals](#related-proposals)
14. [Invariants of steady-state](#invariants-of-steady-state)

---

## Scope

The specifications below are intentionally narrow. They describe what the Go runtime, the standard library, and the operating system guarantee about resource use. They do not describe what your application logic should do; that is the subject of the junior, middle, senior, and professional pages.

Three categories of contract appear on this page:

- **Runtime contracts** — what `runtime`, `runtime/debug`, and `runtime/metrics` guarantee.
- **Library contracts** — what `database/sql`, `net/http`, gRPC, and `golang.org/x/sync` guarantee about resource lifecycle.
- **OS contracts** — what Linux (and to a lesser extent macOS, BSDs) guarantee about file descriptors, memory accounting, and cgroups.

---

## `runtime/debug.SetMemoryLimit` and `GOMEMLIMIT`

Introduced in Go 1.19. Set via the environment variable `GOMEMLIMIT` or programmatically with `runtime/debug.SetMemoryLimit(n int64) int64`.

Signature:

```go
func SetMemoryLimit(limit int64) int64
```

Semantics, quoted from the Go runtime documentation:

> SetMemoryLimit provides the runtime with a soft memory limit. The runtime undertakes several processes to try to respect this memory limit, including adjustments to the frequency of garbage collections and returning memory to the underlying system more aggressively. The Go runtime will not strictly enforce this limit; it is a target, not a hard cap. If `runtime.MemStats.Sys` minus the unused portion of the heap (`HeapIdle - HeapReleased`) exceeds the limit, the runtime triggers a garbage collection. The limit may be exceeded if the Go runtime cannot reclaim enough memory to satisfy the limit.

Key points:

- It is a **soft** limit. Allocation requests that would push the heap past it are not blocked.
- It excludes memory that the runtime considers off-heap (e.g., the goroutine stacks above a threshold, mmap regions allocated by cgo libraries).
- A `GOMEMLIMIT` of `-1` disables the limit (the default).
- `SetMemoryLimit(-1)` returns the current limit without changing it.
- The runtime will GC more aggressively as you approach the limit, paying CPU in exchange for memory.

Recommended pattern: set `GOMEMLIMIT` to about ninety to ninety-five percent of your container's hard memory limit, leaving headroom for stack growth, cgo, and the runtime overhead.

Example:

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    prev := debug.SetMemoryLimit(2 << 30) // 2 GiB
    fmt.Println("previous limit:", prev)
}
```

---

## `runtime/debug.SetGCPercent` and `GOGC`

Available since Go 1. Set via `GOGC` or `runtime/debug.SetGCPercent(percent int) int`.

Signature:

```go
func SetGCPercent(percent int) int
```

Semantics:

> SetGCPercent sets the garbage collection target percentage: a collection is triggered when the ratio of freshly allocated data to live data remaining after the previous collection reaches this percentage. SetGCPercent returns the previous setting. The initial setting is the value of the `GOGC` environment variable at startup, or 100 if the variable is not set.

Key points:

- `GOGC=100` (default) means GC runs when the live set has roughly doubled since the last GC.
- `GOGC=50` runs GC twice as often: less memory, more CPU.
- `GOGC=200` runs GC half as often: more memory, less CPU.
- `GOGC=off` disables GC entirely. Useful only in narrow situations (batch jobs, benchmarks); never in long-running services.

Interaction with `GOMEMLIMIT`: when both are set, the runtime obeys whichever produces an earlier GC. In a memory-tight environment, `GOMEMLIMIT` typically wins.

---

## `runtime/metrics`

Introduced in Go 1.16, expanded substantially through Go 1.21+. Replaces the ad-hoc `runtime.MemStats` for production telemetry.

Key API:

```go
package metrics

func All() []Description
func Read(samples []Sample)

type Description struct {
    Name        string
    Description string
    Kind        ValueKind
    Cumulative  bool
}

type Sample struct {
    Name  string
    Value Value
}
```

Selected metrics that matter for steady-state:

| Metric | Meaning |
|--------|---------|
| `/memory/classes/heap/objects:bytes` | Live heap objects. |
| `/memory/classes/heap/free:bytes` | Heap memory held but unused. |
| `/memory/classes/heap/released:bytes` | Heap memory returned to OS. |
| `/memory/classes/total:bytes` | Sum of all memory classes. |
| `/gc/cycles/total:gc-cycles` | Total GC cycles since startup. |
| `/gc/heap/allocs:bytes` | Total bytes allocated. |
| `/gc/pauses:seconds` | Histogram of GC stop-the-world pauses. |
| `/sched/goroutines:goroutines` | Current goroutine count. |
| `/sched/latencies:seconds` | Histogram of goroutine scheduling latency. |
| `/sync/mutex/wait/total:seconds` | Total time spent waiting for mutexes. |

Recommended pattern: poll `runtime/metrics` once per fifteen seconds and export to your monitoring system. Histograms can be converted into bucketed counters for Prometheus, OpenTelemetry, or Datadog.

---

## `pprof` profiles

The `net/http/pprof` package exposes runtime profiles via HTTP. For steady-state diagnostics, the most relevant profiles are:

- `/debug/pprof/heap` — heap snapshot. Compare two snapshots taken thirty minutes apart to detect drift.
- `/debug/pprof/goroutine` — live goroutine stacks. Look for stacks that should not be there.
- `/debug/pprof/allocs` — cumulative allocation profile. Identifies allocation hotspots.
- `/debug/pprof/mutex` — contended mutex profile (requires `runtime.SetMutexProfileFraction`).
- `/debug/pprof/block` — goroutine blocking profile (requires `runtime.SetBlockProfileFraction`).

Always gate pprof endpoints behind localhost-only or admin-only authentication in production.

---

## Channels — capacity and select semantics

A channel created with `make(chan T, n)` has a buffer of exactly `n` elements.

- Sending on a full buffered channel blocks the sender.
- Receiving from an empty channel blocks the receiver.
- A `select` with a `default` case turns either operation into a non-blocking try.
- Sending on a `nil` channel blocks forever; receiving from a `nil` channel blocks forever.
- Closing a `nil` channel panics; closing a channel twice panics; sending on a closed channel panics.
- Receiving from a closed channel returns the zero value of the element type and `ok=false`.

For steady-state: every channel that can grow under load must have a bounded capacity and a `select` with a fallback.

```go
select {
case queue <- job:
    // accepted
default:
    // shed
}
```

---

## `database/sql` pool contract

The `sql.DB` type is a pool of connections, not a single connection. Configuration:

```go
func (db *DB) SetMaxOpenConns(n int)        // hard cap on connections
func (db *DB) SetMaxIdleConns(n int)        // pool of warm idle conns
func (db *DB) SetConnMaxLifetime(d time.Duration) // max age before recycle
func (db *DB) SetConnMaxIdleTime(d time.Duration) // max idle before close
```

Semantics:

- If `MaxOpenConns` is reached and a caller asks for a connection, the caller blocks until one is returned, the context is cancelled, or a connection is closed.
- `MaxIdleConns` should be less than or equal to `MaxOpenConns`. If it is greater, the pool silently lowers it.
- `ConnMaxLifetime` is the only defence against stale-connection drift across rolling restarts of the database side.
- The pool emits statistics via `db.Stats()`, which returns `sql.DBStats`. Export these.

Recommended baseline:

```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(25)
db.SetConnMaxLifetime(30 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
```

---

## `net/http.Transport` pool contract

The default `http.Transport` keeps an idle connection pool per host. Key fields:

```go
type Transport struct {
    MaxIdleConns          int
    MaxIdleConnsPerHost   int
    MaxConnsPerHost       int
    IdleConnTimeout       time.Duration
    ResponseHeaderTimeout time.Duration
    ExpectContinueTimeout time.Duration
    TLSHandshakeTimeout   time.Duration
}
```

Notes:

- `MaxIdleConnsPerHost` defaults to `DefaultMaxIdleConnsPerHost = 2`. This is far too low for production microservices.
- `MaxConnsPerHost = 0` means unlimited. Set this for steady-state behaviour.
- Always set `IdleConnTimeout`; otherwise idle conns accumulate.
- Always drain and close every `*http.Response.Body`. Failure to do so leaks both the body and the connection.

A working baseline:

```go
tr := &http.Transport{
    MaxIdleConns:        200,
    MaxIdleConnsPerHost: 50,
    MaxConnsPerHost:     100,
    IdleConnTimeout:     90 * time.Second,
}
```

---

## gRPC `ClientConn` keepalive

A long-lived gRPC client connection multiplexes streams over a single HTTP/2 connection. Keepalive prevents NAT timeouts and detects dead peers.

```go
keepalive.ClientParameters{
    Time:                10 * time.Second,
    Timeout:             3 * time.Second,
    PermitWithoutStream: true,
}
```

For steady-state:

- Set `Time` shorter than your shortest NAT idle timeout.
- Set `PermitWithoutStream` only when you actually need it; servers limit clients that ping without streams.
- The server has matching `keepalive.ServerParameters` and `keepalive.EnforcementPolicy`.

---

## `golang.org/x/sync/semaphore`

A weighted semaphore. The standard tool for goroutine budgets.

```go
type Weighted struct { ... }

func NewWeighted(n int64) *Weighted
func (s *Weighted) Acquire(ctx context.Context, n int64) error
func (s *Weighted) TryAcquire(n int64) bool
func (s *Weighted) Release(n int64)
```

Semantics:

- `Acquire` blocks until `n` units are free, or returns the context error.
- `TryAcquire` is the non-blocking variant; returns `false` immediately if there is not enough room.
- A weight of one is the most common case (one goroutine per slot). Larger weights model heterogeneous tasks.

---

## OS file descriptor limits

On Linux, the process is bound by the soft `RLIMIT_NOFILE`. Inspect via `getrlimit` or `/proc/$PID/limits`. Raise via `setrlimit`, the systemd `LimitNOFILE=` directive, or the container runtime.

Each FD consumed:

- Open file or socket.
- TCP connection in `LISTEN`, `ESTABLISHED`, or `TIME_WAIT`.
- Pipe.
- `inotify`, `epoll`, `eventfd` handles.

Steady-state targets:

- Plateau at no more than fifty percent of the limit during peak load.
- `TIME_WAIT` connections count too; tune `SO_REUSEADDR`, `SO_LINGER`, or the kernel's `tcp_tw_reuse`.

---

## cgroup v1 and v2 memory limits

On Linux containers, memory is bounded by the cgroup. Read paths:

- cgroup v1: `/sys/fs/cgroup/memory/memory.limit_in_bytes`.
- cgroup v2: `/sys/fs/cgroup/memory.max`.

The Go runtime does not automatically read these. A common pattern is to read the cgroup at startup and call `debug.SetMemoryLimit` to ninety percent of the value. The `KimMachineGun/automemlimit` library does this automatically and is widely deployed.

---

## Related proposals

- **golang/go#48409** — *runtime/debug: soft memory limit*. The proposal that became `GOMEMLIMIT` in Go 1.19. Lays out the rationale, semantics, and trade-offs.
- **golang/go#16930** — *runtime: provide a way to limit memory usage*. The earlier discussion that eventually led to #48409.
- **golang/go#42511** — *runtime: scalable mutex profiling*. Background for the mutex profile that informs steady-state lock contention.
- **golang/go#37112** — *runtime/metrics: stable runtime telemetry API*. The proposal that introduced `runtime/metrics`.

---

## Invariants of steady-state

A long-running Go service is in steady-state if, over an observation window of at least twenty-four hours under representative load:

1. **Heap invariant.** Average resident set after GC is bounded; the linear regression of post-GC heap size against time has a slope no greater than the leak budget (typically zero or a few hundred kilobytes per hour).
2. **Goroutine invariant.** Goroutine count returns to a baseline within thirty seconds of any traffic spike.
3. **Queue invariant.** Every in-process queue has a fixed capacity; the depth distribution is bounded.
4. **FD invariant.** File descriptor count plateaus at a value below fifty percent of `RLIMIT_NOFILE`.
5. **Latency invariant.** `p99` latency on day N is within plus or minus ten percent of `p99` on day one for equivalent traffic.
6. **GC invariant.** GC CPU fraction (`/gc/cpu/percent:%`) stays below five percent.
7. **Pool invariant.** Connection pools (sql, http, gRPC) reach a flat plateau within the warm-up window and stay there.

If any of these invariants drifts, the service is leaving steady-state and the relevant alert should fire. The next pages explain how to construct each invariant in code.

---

## `runtime.MemStats` — the older API

Before `runtime/metrics`, telemetry was extracted via `runtime.ReadMemStats`. Still useful for quick scripts:

```go
type MemStats struct {
    Alloc          uint64 // bytes allocated and still in use
    TotalAlloc     uint64 // cumulative bytes allocated
    Sys            uint64 // total bytes obtained from system
    Lookups        uint64
    Mallocs        uint64
    Frees          uint64
    HeapAlloc      uint64 // bytes allocated and still in use
    HeapSys        uint64 // bytes obtained from system for heap
    HeapIdle       uint64 // bytes in idle (unused) spans
    HeapInuse      uint64 // bytes in non-idle spans
    HeapReleased   uint64 // bytes released to the OS
    HeapObjects    uint64
    StackInuse     uint64 // bytes used by stack spans
    StackSys       uint64
    MSpanInuse     uint64
    MSpanSys       uint64
    MCacheInuse    uint64
    MCacheSys      uint64
    BuckHashSys    uint64
    GCSys          uint64
    OtherSys       uint64
    NextGC         uint64
    LastGC         uint64
    PauseTotalNs   uint64
    PauseNs        [256]uint64
    PauseEnd       [256]uint64
    NumGC          uint32
    NumForcedGC    uint32
    GCCPUFraction  float64
    EnableGC       bool
    DebugGC        bool
    BySize         [61]struct {
        Size    uint32
        Mallocs uint64
        Frees   uint64
    }
}
```

`ReadMemStats` is expensive (it stops the world briefly). Don't call it in a hot loop. For production, prefer `runtime/metrics`. For debugging, the older API is convenient because every field is documented and stable.

---

## `signal.NotifyContext`

The standard way to translate OS signals into context cancellation. Standard library since Go 1.16:

```go
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)
```

Usage:

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGTERM, syscall.SIGINT)
defer stop()
// run service; cancel on signal
```

The returned context is cancelled when any of the specified signals arrive. The `stop` function releases the signal handler when the function returns.

For steady-state: this is how you initiate the drain pattern. Receive SIGTERM, cancel the context, drain workers, exit cleanly. Without this, processes are killed abruptly and may leak resources.

---

## `net/http.Server` graceful shutdown

```go
func (srv *Server) Shutdown(ctx context.Context) error
```

Semantics:

> Shutdown gracefully shuts down the server without interrupting any active connections. Shutdown works by first closing all open listeners, then closing all idle connections, and then waiting indefinitely for connections to return to idle and then shut down. If the provided context expires before the shutdown is complete, Shutdown returns the context's error, otherwise it returns any error returned from closing the Server's underlying Listener(s).

Key behaviour:

- New connections are refused.
- Idle connections are closed.
- Active connections are allowed to finish (up to the context deadline).
- Returns when all connections are closed or the deadline expires.

This is the steady-state-friendly way to shut down. Always pair with `signal.NotifyContext` so SIGTERM triggers shutdown.

---

## Histogram quantile estimation

Many steady-state metrics are histograms. Computing quantiles in Go:

```go
// metrics.Float64Histogram has Buckets and Counts.
// Buckets[i] is the upper bound of bucket i (for i > 0);
// Buckets[0] is the lower bound (often -Inf).
// Counts[i] is the number of samples in bucket [Buckets[i], Buckets[i+1]).

func quantile(h *metrics.Float64Histogram, q float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    target := uint64(float64(total) * q)
    var seen uint64
    for i, c := range h.Counts {
        seen += c
        if seen >= target {
            // Return the upper bound of the bucket.
            return h.Buckets[i+1]
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}
```

This gives bucket-bounded quantiles. For higher precision, interpolate within the bucket.

---

## Go memory model in brief

The Go memory model defines what writes by one goroutine are visible to reads by another. Steady-state relevance: any shared state that is read across goroutines requires synchronisation, even if "it looks fine."

Specifically:

- Channel sends synchronise with the corresponding receive.
- A `sync.Mutex.Unlock` synchronises with the next `Lock` of the same mutex.
- A `sync.Once.Do` is happens-before its function call.
- `atomic` operations on the same address synchronise with each other.

Without synchronisation, the compiler and CPU are free to reorder reads and writes. Race detector catches obvious violations; the subtle ones can hide. For steady-state, the rule is: use channels, mutexes, or atomics for any state shared across goroutines.

---

## Cross-platform considerations

The specifications above assume Linux. Other platforms differ:

- **macOS:** no cgroups, FD limit via `ulimit -n`. The Go runtime works fine; the cgroup-reading code is no-op.
- **Windows:** different signal semantics (no SIGTERM in the traditional sense). Use `os.Interrupt` for similar effect. FD limits are managed differently.
- **FreeBSD, NetBSD:** similar to Linux for FD limits; no cgroups.

For Go programs that run only on Linux (most server workloads), use Linux-specific tools. For cross-platform binaries, gate Linux-only code with `//go:build linux`.

---

## Glossary of runtime tunables

| Variable | Default | Effect |
|---|---|---|
| `GOMEMLIMIT` | unlimited | Soft memory limit. |
| `GOGC` | 100 | GC trigger ratio. |
| `GOMAXPROCS` | runtime.NumCPU() | Max OS threads running Go code. |
| `GODEBUG=gctrace=1` | off | Print GC events to stderr. |
| `GODEBUG=schedtrace=1000` | off | Print scheduler state every N ms. |
| `GODEBUG=madvdontneed=1` | varies | Linux memory return policy. |
| `GODEBUG=invalidptr=1` | on (1.17+) | Panic on invalid pointer. |
| `GOTRACEBACK=all` | single | Stack traces include all goroutines on panic. |

Most of these are not for production use except `GOMEMLIMIT`, `GOGC`, and `GOMAXPROCS`. The `GODEBUG=*` family is for debugging; turning them on in production can have substantial performance implications.

---

## Conformance test ideas

To verify your service satisfies the steady-state invariants:

1. **Heap slope test.** Run for one hour; fit a line through post-GC heap; assert slope ≤ budget.
2. **Goroutine cap test.** Run for one hour; sample `NumGoroutine` every minute; assert max ≤ configured cap.
3. **FD plateau test.** Run for one hour; sample open FD count every minute; assert max ≤ 50% of `RLIMIT_NOFILE`.
4. **Latency invariant test.** Run for 24 hours; sample p99 every five minutes; assert the standard deviation of p99 is within tolerance.
5. **Pool plateau test.** Run for one hour; sample `db.Stats().InUse` every minute; assert it plateaus and does not grow.

Implement these as Go tests with `-timeout=2h` and run them nightly in CI.

---

## Standards and references

The semantic foundations of the steady-state work in Go come from several documents. A short reference list:

### Go runtime documentation

- The `runtime` package documentation — overview of GC, scheduler, memory model.
- The `runtime/debug` package — `SetMemoryLimit`, `SetGCPercent`, `FreeOSMemory`.
- The `runtime/metrics` package — stable runtime telemetry API.
- The `runtime/pprof` package — profile collection.
- The `net/http/pprof` package — HTTP-served profiles.

### Go language specification

- Section "Channels" — formal semantics of channel operations.
- Section "Select statements" — non-determinism, default branch.
- Section "Defer statements" — execution order, recovery.

### Memory model

- The Go Memory Model document (golang.org/ref/mem).
- Effective Go's concurrency section.

### Proposals

- golang/go#48409 — soft memory limit.
- golang/go#37112 — runtime/metrics.
- golang/go#16930 — earlier memory-limit discussion.
- golang/go#42511 — scalable mutex profiling.

### Standard library

- `database/sql` documentation, especially `DB.SetMaxOpenConns`.
- `net/http` documentation, especially `Transport` fields.
- `crypto/tls` for session caching behaviour.

### Linux

- `cgroup-v2` documentation under `/sys/kernel/cgroup`.
- `getrlimit(2)` for `RLIMIT_NOFILE`.
- `/proc/self/status` for process resource accounting.

### Third-party libraries with stable semantics

- `golang.org/x/sync/semaphore` — weighted semaphore.
- `golang.org/x/time/rate` — token-bucket rate limiter.
- `KimMachineGun/automemlimit` — cgroup-aware `GOMEMLIMIT`.
- `go.uber.org/automaxprocs` — cgroup-aware `GOMAXPROCS`.
- `hashicorp/golang-lru/v2` — bounded LRU cache.
- `sony/gobreaker` — circuit breaker.

Each of these has a stable API and a documented behaviour. Read the docs; the contracts are precise.
