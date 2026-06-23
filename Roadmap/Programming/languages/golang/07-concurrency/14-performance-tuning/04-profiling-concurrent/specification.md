# Profiling Concurrent Go Code — Specification

## Table of Contents
1. [Scope](#scope)
2. [Sampler APIs](#sampler-apis)
3. [Sampling Rate Semantics](#sampling-rate-semantics)
4. [Recorded Stack Attribution](#recorded-stack-attribution)
5. [Profile Output Format](#profile-output-format)
6. [Trace Event Stream](#trace-event-stream)
7. [Goroutine Label Propagation](#goroutine-label-propagation)
8. [Endpoint Contracts](#endpoint-contracts)
9. [Compatibility and Versioning](#compatibility-and-versioning)
10. [References](#references)

---

## Scope

This document specifies the observable behaviour of Go's concurrency profiling subsystem: the goroutine, mutex, block, and trace facilities exposed by `runtime`, `runtime/pprof`, `runtime/trace`, and `net/http/pprof`. The specification reflects Go 1.22+ and notes earlier divergences explicitly. Behaviour not documented here is implementation-defined; programs should not rely on it.

---

## Sampler APIs

The runtime exposes four functions controlling concurrent profiling state:

### `runtime.SetMutexProfileFraction(rate int) int`

Sets the fraction of contended `sync.Mutex` and `sync.RWMutex` events recorded.

- `rate == 0`: disabled. No mutex events are recorded.
- `rate == 1`: every contended event is recorded.
- `rate >= 2`: each contended event is recorded with probability `1/rate`, independently.

Returns the previous fraction.

### `runtime.SetBlockProfileRate(rate int)`

Sets the block profile sampling rate, in nanoseconds.

- `rate <= 0`: disabled. No block events are recorded.
- `rate == 1`: every blocking event is recorded.
- `rate > 1`: events shorter than `rate` ns are recorded with probability proportional to duration; events at least `rate` ns long are always recorded.

The semantic guarantee is that, in expectation, the recorded total time approximates the actual total time when integrated over a sufficiently long window.

### `runtime.SetCPUProfileRate(hz int)`

Sets the CPU profiling rate in Hz. Documented elsewhere; included here for completeness because concurrent programs frequently change it.

### `runtime/trace.Start(w io.Writer) error` and `Stop()`

Begin and end trace recording. While a trace is active, every event in the trace event protocol is recorded. Only one trace may be active at a time; `Start` returns an error otherwise.

---

## Sampling Rate Semantics

### Mutex profile fraction

For each contended lock release where any goroutine had to wait, the runtime evaluates `cheaprandn(rate) == 0`. If true, the event is recorded. The sampling is **independent across events** — no cluster discount.

**Counter accumulation**: when a contended event is sampled, two values are added to the relevant sample bucket:

- `contentions`: 1 (regardless of fraction).
- `delay`: total wait time across all waiters released, in nanoseconds.

To estimate the true total, multiply observed `contentions` by `rate`. Tools like `go tool pprof` may or may not perform this multiplication; check `sample_type`.

### Block profile rate

The check at each potential blocking event is:

```
record if: cycles >= rate  OR  cheaprand64()%rate < cycles
```

where `cycles` is the actual blocked duration in nanoseconds (after `runtime.SetBlockProfileRate` converts ns to cycles using the local clock rate).

This formula guarantees:

- Events of duration `rate` or longer are always recorded.
- The expected recorded total time approaches the actual total as the window grows.

### CPU profile

The CPU profiler uses `SIGPROF` (Unix) or a timer interrupt (Windows) at the configured Hz. Each interrupt yields one sample with the stack of the currently-executing goroutine on each thread.

---

## Recorded Stack Attribution

### Mutex profile

The recorded stack is the **stack of the goroutine that released the lock**, captured at the call to `sync.(*Mutex).Unlock` (or `RUnlock`). Up to `Go 1.17` this was inconsistent; from Go 1.18 onward, attribution is uniformly at the unlock site.

Stack walking skips internal `sync` and `runtime` frames so that the user's `defer mu.Unlock()` line is visible at the top.

### Block profile

The recorded stack is the **stack of the goroutine that blocked**, captured at the time of `gopark`. The wait time is the difference between unblock and block timestamps.

### Goroutine profile

The recorded stack is the **current stack of each live goroutine** at the moment of the snapshot. The snapshot is taken under a brief stop-the-world (since Go 1.19, foreground-only) to ensure consistency.

### CPU profile

The recorded stack is the **stack of the goroutine executing on the interrupted thread** at the moment `SIGPROF` arrived.

---

## Profile Output Format

All profiles are emitted as **gzip-compressed protobuf** following `pprof.proto`. The schema is shared across pprof-emitting runtimes (Go, C++, JVM, Rust, etc.).

### Sample types

| Profile | sample_type entries |
|---------|---------------------|
| `goroutine` | `goroutines: count` |
| `heap` | `alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space` |
| `allocs` | `alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space` |
| `mutex` | `contentions: count`, `delay: nanoseconds` |
| `block` | `contentions: count`, `delay: nanoseconds` |
| `profile` (CPU) | `samples: count`, `cpu: nanoseconds` |
| `threadcreate` | `count` |

### Default sample index

When `go tool pprof` opens a profile without `-sample_index=`, it picks the last sample type. For mutex and block, that is `delay`.

### Labels

`pprof.Labels` propagated through `pprof.Do` or `SetGoroutineLabels` are emitted as repeated `Label` entries on each sample. Tools may filter or aggregate by these labels.

---

## Trace Event Stream

The trace stream is a custom binary format documented in `src/runtime/trace2.go` (Go 1.22+).

### Guarantees

- **Per-P ordering**: events emitted by a given P are recorded in execution order.
- **Cross-P ordering**: timestamps allow global ordering with TSC precision on supported hardware. Without TSC, `nanotime()` provides millisecond-or-better precision.
- **Completeness while enabled**: every event is recorded; the tracer does not sample.
- **No event reorder**: the parser sees events in emission order.

### What is not guaranteed

- Goroutines may briefly miss events if their P's trace buffer is being flushed when the goroutine moves between Ps. The parser detects and skips such gaps.
- Across a `GOMAXPROCS` change mid-trace, P identity is preserved but the count changes; events emit `EvProcsChange`.
- Trace events emitted from inside cgo callbacks may be attributed to a different M than the original Go goroutine; this is documented as imprecise.

### User-defined events

`trace.NewTask`, `trace.StartRegion`, and `trace.Logf` emit `EvUserTaskBegin`, `EvUserRegion`, and `EvUserLog` respectively. These are no-ops when no trace is active.

---

## Goroutine Label Propagation

Goroutine labels live in `g.labels`, a pointer to a labels map stored on the goroutine.

### Setting

- `pprof.SetGoroutineLabels(ctx)`: sets the current goroutine's labels to those of `ctx`.
- `pprof.Do(ctx, labels, f)`: sets labels for the duration of `f`. Restored on exit.
- `pprof.WithLabels(ctx, labels)`: returns a derived context carrying labels (does not change the goroutine).

### Propagation across `go`

When a goroutine starts another goroutine via the `go` statement **inside a `pprof.Do` call**, the child inherits the parent's labels. Standalone `go f()` outside of `pprof.Do` does not inherit unless the parent goroutine was already labelled with `SetGoroutineLabels`.

Specifically, the runtime copies `g.labels` to the new goroutine at `runtime.newproc`.

### Restoration

`pprof.Do` saves the previous labels on entry and restores them on exit. Even if the function panics, the labels are restored via deferred cleanup.

### Behaviour at profile sample time

When a profile sample is recorded, the runtime reads `g.labels` and emits them as sample labels. The read is atomic.

---

## Endpoint Contracts

`net/http/pprof` registers handlers on the default HTTP mux. Each is documented below.

### `/debug/pprof/`

Index page listing all registered profiles. Returns HTML.

### `/debug/pprof/goroutine`

Goroutine profile. Query parameters:

- `debug=0` (default): gzip-compressed protobuf.
- `debug=1`: plain-text, one line per unique stack with count.
- `debug=2`: plain-text, one block per goroutine with state and wait reason.

`debug=2` does not stop the world. `debug=0` and `debug=1` invoke a brief STW.

### `/debug/pprof/heap`

Heap profile. Query parameters:

- `gc=1`: invoke `runtime.GC()` before sampling.
- `debug=0` (default): protobuf.

### `/debug/pprof/allocs`

Allocations profile. Same data source as heap, different default sample index.

### `/debug/pprof/mutex`

Mutex profile. No query parameters of note. Returns protobuf.

### `/debug/pprof/block`

Block profile. No query parameters. Returns protobuf.

### `/debug/pprof/profile`

CPU profile. Query parameters:

- `seconds=N` (default 30): duration to sample.

Returns protobuf after the duration elapses.

### `/debug/pprof/trace`

Execution trace. Query parameters:

- `seconds=N` (default 1): duration to capture.

Returns the trace binary format. Only one active trace per process; concurrent requests serialise (or fail depending on Go version).

### `/debug/pprof/threadcreate`

Thread creation profile. Returns protobuf.

---

## Compatibility and Versioning

### Profile protobuf

`pprof.proto` is versioned via the protobuf schema's compatibility rules. Newer fields are optional and ignored by older parsers. The format has been stable since 2015.

### Trace format

The trace format has been rewritten twice (2014, 2022). Major version changes invalidate older tools — `go tool trace` of Go 1.22+ cannot read traces from Go 1.21 or earlier (and vice versa). Always parse a trace with the matching `go` binary.

### `SetMutexProfileFraction` / `SetBlockProfileRate` defaults

Both are `0` (disabled) by default. This has been stable since the APIs were introduced (Go 1.8 for `SetMutexProfileFraction`, Go 1.1 for `SetBlockProfileRate`). Tests that rely on enabling them must do so explicitly.

### Label propagation

Introduced in Go 1.9 (`runtime/pprof.Do`). Behaviour has been stable; minor improvements in label propagation across `go` statements landed in Go 1.18.

### PGO

Profile-guided optimization is a build-system feature, not a runtime one, but accepts a CPU profile in the standard pprof format. Stable since Go 1.21.

---

## References

- `src/runtime/cpuprof.go`
- `src/runtime/mprof.go`
- `src/runtime/trace2.go`
- `src/runtime/pprof/pprof.go`
- `src/runtime/pprof/label.go`
- `https://github.com/google/pprof/blob/main/proto/profile.proto`
- Go diagnostics overview: `https://go.dev/doc/diagnostics`
- Go 1.22 trace overhaul design: `https://go.googlesource.com/proposal/+/master/design/60773-execution-tracer-overhaul.md`
