# Profiling Concurrent Go Code — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Inside the CPU Sampler](#inside-the-cpu-sampler)
3. [Inside the Mutex Sampler](#inside-the-mutex-sampler)
4. [Inside the Block Sampler](#inside-the-block-sampler)
5. [The Goroutine Profile Snapshot](#the-goroutine-profile-snapshot)
6. [The Trace Event Protocol](#the-trace-event-protocol)
7. [Profile pprof.proto Format](#profile-pprofproto-format)
8. [Fleet-Wide Profiling Architecture](#fleet-wide-profiling-architecture)
9. [Profile-Guided Optimization Internals](#profile-guided-optimization-internals)
10. [Open Research and Future Directions](#open-research-and-future-directions)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

You have lived with these tools long enough to spot their limits. Mutex profile fraction `100` "samples 1 in 100" — but how is that 1 picked? The trace flushes events to a file — but in what order, and what happens if the buffer overflows? Goroutine labels propagate to children — through what mechanism, and what does that cost per `go` statement? At professional level you read `runtime/cpuprof.go`, `runtime/mprof.go`, `runtime/trace2.go`, and the `pprof.proto` schema until you can predict what a sample will look like before you take it. You can answer questions like "would a 32-bit atomic suffice for the mutex profile counter?" or "what is the order of events when a goroutine moves between Ps mid-trace?"

This file gives you the map. The territory is `src/runtime/` in the Go source tree.

---

## Inside the CPU Sampler

The CPU profiler is driven by a kernel signal — `SIGPROF` on Unix, a timer on Windows. The Go runtime installs the handler at startup if profiling is requested.

```
src/runtime/cpuprof.go
src/runtime/signal_unix.go
src/runtime/proc.go (sigprof function)
```

### How a sample is taken

When `SIGPROF` fires:

1. The kernel interrupts whatever thread is currently running.
2. Go's signal handler runs in signal context.
3. The handler reads the current goroutine via `getg().m.curg`.
4. It walks the stack of the running goroutine into a fixed-size buffer.
5. It writes the stack into a lock-free ring buffer (`cpuprofile.log`).
6. Returns from signal.

The sampling rate is set by `runtime.SetCPUProfileRate(hz)` (default 100). The kernel timer drives at that rate **per OS thread**, so a 4-P program with all 4 threads busy gets ~400 samples/s.

### Why concurrent code looks different in a CPU profile

Each P-bound thread samples independently. Time when no thread is running Go code (e.g., everyone is in `gopark`) gets no samples — there's no goroutine on-CPU to sample. The CPU profile therefore *under-counts off-CPU time by construction*.

### `runtime.SetCPUProfileRate` interactions

Calling `SetCPUProfileRate` while a profile is active is undefined. The runtime checks for an active session and returns silently. To change the rate, stop the profile first.

### Wall-clock profiling (off by default)

Go does not ship a true wall-clock profiler. The closest equivalent is `runtime/trace`, which records events in real time. Third-party libraries (`fgprof`, `goroutine-inspect`) approximate wall-clock by combining the goroutine profile with stack walks of off-CPU goroutines.

---

## Inside the Mutex Sampler

```
src/runtime/mprof.go (mutexProfile, mutexevent)
src/runtime/sema.go (semrelease, semacquire1)
```

### Where the sample is taken

A contention sample is recorded when:

1. A goroutine attempts `runtime.semacquire1` (the lock primitive underneath `sync.Mutex.Lock`).
2. The semaphore is unavailable.
3. The goroutine sleeps, then is woken when the holder releases.
4. **On release** in `semrelease1`, the releaser checks whether anyone waited. If so, and if a probabilistic sampling check passes, it calls `mutexevent` with the waiter's wait time and the releaser's stack.

```go
// Simplified from runtime/sema.go
func semrelease1(addr *uint32, handoff bool, skipframes int) {
    ...
    if waited {
        if cheaprandn(uint32(rate)) == 0 {
            mutexevent(cycles*tickspersecond, ...)
        }
    }
    ...
}
```

The randomness is `cheaprandn(rate)` — a fast PRNG returning 0 with probability 1/rate. So `fraction=100` means each contended release records with probability 1%.

### Why attribution is on the holder, not the waiter

This is a deliberate design choice. The interesting question is "which critical section is causing contention?" The release point is the end of the critical section — its stack identifies the protected region. The waiter's stack is less useful: many goroutines from many sites may wait on the same lock.

### `RWMutex` semantics

`RWMutex` adds two paths: `RLock` waiting for a writer, and `Lock` waiting for readers. Both go through `semacquire1`, so both feed `mutexevent` on release. The profile distinguishes them by the call stack (RUnlock vs Unlock paths).

### Counter overflow

The internal counters are `int64` nanoseconds. Overflow at ~292 years of wait time, so not a real concern.

---

## Inside the Block Sampler

```
src/runtime/mprof.go (blockProfile, blockevent)
src/runtime/proc.go (goparkunlock, calls into blockevent)
```

### Hooks

The runtime sprinkles `blockevent` calls at every `gopark` reason that represents blocking:

- `chanrecv` / `chansend` (channels)
- `selectgo` (select)
- `runtime.semacquire1` (mutex/WaitGroup)
- `notesleep`
- `time.Sleep`
- `sync.Cond.Wait`

The sample is recorded when the goroutine *unblocks*, not when it goes to sleep. The runtime captures the duration `unblock_time - block_time` and the stack at the block point.

### Sampling discipline

```go
// Simplified
func blockevent(cycles int64, skip int) {
    if cycles <= 0 {
        cycles = 1
    }
    rate := atomic.Loadint64(&blockprofilerate)
    if rate <= 0 || (rate > cycles && cheaprand64()%rate > cycles) {
        return
    }
    saveBlockEventStack(...)
}
```

If the actual wait time meets or exceeds the configured rate (in cycles), the sample is always taken. If it's shorter, a probabilistic check decides. Short events therefore appear with frequency proportional to duration.

### Why block profile time can exceed wall-clock time

Multiple goroutines blocked simultaneously each contribute their own duration. A channel send blocked for 1 s with 100 waiters contributes 100 s. This is the source of the "block profile reports more time than the profile window" confusion at junior level.

### Block profile sees mutex too — so why have a separate mutex profile?

Three reasons:

1. The mutex profile attributes to the **releaser**, the block profile to the **waiter**. Different questions.
2. The mutex profile is cheaper at low fractions because its sampling is at release, after the wait — fewer total events than tracking every `gopark`.
3. Historical: `sync.Mutex` was added before block profiling existed. The two profiles coexist; both are useful.

---

## The Goroutine Profile Snapshot

```
src/runtime/mprof.go (goroutineProfileWithLabels)
```

A goroutine profile is taken by walking the global goroutine list and recording each `g`'s stack. To get a consistent snapshot the runtime stops the world briefly (since Go 1.19, this is *forb-stop only* — a much shorter pause than full STW).

### Cost

For a process with `N` goroutines, the snapshot is `O(N * stack_depth)`. On a service with 100k goroutines, expect tens of milliseconds. Visible but tolerable.

### Goroutine labels in the snapshot

Each `g` has a `g.labels` pointer to a `*labelMap`. The snapshot records both the stack and the labels. The pprof file records the labels as **sample labels**, allowing tools like `go tool pprof -tagfocus` to slice.

### `debug=2` text format

`debug=2` does not stop the world. It iterates goroutines best-effort, printing each. As a result the count can be slightly off; a goroutine that exits during the dump may or may not appear. Acceptable for diagnostics.

---

## The Trace Event Protocol

```
src/runtime/trace2.go (Go 1.22+ rewrite)
src/internal/trace/v2/    (parser)
```

The trace is a stream of binary events. Go 1.22 introduced a new format ("trace2") with better timestamping and per-P partitioning. The schema lives in `src/runtime/trace2.go` as event types.

### Major event types

| Event | Meaning |
|-------|---------|
| `EvProcsChange` | `GOMAXPROCS` changed |
| `EvProcStart` | A P started running |
| `EvProcStop` | A P went idle |
| `EvGoCreate` | A goroutine was created (with creator stack) |
| `EvGoStart` | A goroutine started running on a P |
| `EvGoEnd` | A goroutine exited |
| `EvGoBlock` | A goroutine blocked (with reason) |
| `EvGoUnblock` | A goroutine became runnable again |
| `EvGoSysCall` | Entered a syscall |
| `EvGoSysExit` | Exited a syscall |
| `EvGCStart` | GC began |
| `EvGCEnd` | GC ended |
| `EvHeapAlloc` | Heap size change |
| `EvUserTaskBegin` / `EvUserTaskEnd` | `trace.NewTask` / `task.End` |
| `EvUserRegion` | `trace.StartRegion` / `region.End` |
| `EvUserLog` | `trace.Logf` |

The full set is larger; these are the ones you'll see most.

### Per-P buffering

Each P writes events to its own buffer. When the buffer fills, the P flushes to the trace file via a CAS-protected write path. The buffer is sized so that flushes are infrequent (default 64 KB per P).

If the writer falls behind, the runtime can stall **briefly** waiting for buffer space — visible in the trace as a small gap. Set `GODEBUG=traceadvanceperiod=...` only if you're debugging the tracer itself.

### Timestamping

Trace2 (Go 1.22+) uses TSC (CPU timestamp counter) where available, falling back to `nanotime()`. TSC is consistent across cores on modern x86 / ARM but not on older machines. The format records the calibration so the parser can convert to nanoseconds.

### Trace file size estimation

For a healthy 4-P service handling 1k req/s:

- ~6 events per goroutine cycle (create, start, block, unblock, end, GC).
- Each event ~30 bytes after compression.
- 1k req/s × ~10 goroutines/req × 6 events × 30 B = 1.8 MB/s.
- 5 s of trace: ~9 MB. Manageable.

At 10k req/s, 90 MB. Still loads, slowly.

At 100k req/s on 16 P, you're looking at 1+ GB and the viewer struggles. Use targeted traces or a downsampling proxy.

---

## Profile pprof.proto Format

A Go pprof profile is a **gzip-compressed protobuf** following `google/pprof/proto/profile.proto`. The format is shared with C++, Java, JavaScript, Rust — anyone who emits pprof.

### Schema essentials

```
message Profile {
    repeated Sample sample = 1;
    repeated Location location = 4;
    repeated Function function = 5;
    repeated string string_table = 6;
    repeated ValueType sample_type = 1;
    ...
}

message Sample {
    repeated uint64 location_id = 1;
    repeated int64 value = 2;
    repeated Label label = 3;
}
```

A `Sample` is one stack with one or more values (count + duration, or alloc objects + alloc bytes, etc.) plus zero or more labels (the `pprof.Do` labels).

### Value types

A profile carries a `repeated ValueType`:

- CPU profile: `[samples count, cpu nanoseconds]`.
- Heap profile: `[alloc_objects, alloc_space, inuse_objects, inuse_space]`.
- Mutex profile: `[contentions, delay nanoseconds]`.
- Block profile: `[contentions, delay nanoseconds]`.

`go tool pprof` switches view via `sample_index=delay` etc.

### Decoding by hand

```bash
gunzip -c mutex.prof | protoc --decode=perftools.profiles.Profile profile.proto
```

Or in Go:

```go
import "github.com/google/pprof/profile"

f, _ := os.Open("mutex.prof")
p, _ := profile.Parse(f)
for _, s := range p.Sample {
    fmt.Println(s.Value, s.Label, s.Location)
}
```

The `pprof.Parse` returns a Go struct you can manipulate, diff programmatically, or feed into custom dashboards.

### Custom profiles

`pprof.NewProfile(name)` creates a user-defined profile type. The pprof handler `/debug/pprof/<name>` will serve it. Useful for application-level counters that should look like profiles ("open file descriptors by stack site").

---

## Fleet-Wide Profiling Architecture

Designing a continuous profiler from first principles:

### Push vs pull

- **Pull** (Parca, Pyroscope-pull): the backend scrapes `/debug/pprof/*` from each instance. Familiar to anyone running Prometheus. Service must expose pprof on a network-reachable port.
- **Push** (Pyroscope-push, Polar Signals agent): an in-process or sidecar agent posts profiles to the backend. No exposed port; easier across firewalls.

### Sampling at fleet scale

A 1000-instance fleet pulling every minute = 1000 profile uploads/min per profile type. Six types = 6000 uploads/min = 100/s. Manageable but not negligible.

Strategies:

- **Per-instance interval jitter**: stagger scrapes so they don't bunch.
- **Per-pod sampling**: only 10% of pods are scraped continuously. Diagnostic profiles are scraped on demand from any pod.
- **Edge aggregation**: deploy local Pyroscope/Parca agents that aggregate, dedupe, and forward in batches.

### Storage backends

- Pyroscope: BadgerDB locally, or any S3-compatible store.
- Parca: Parquet on S3, queried via Arrow.
- Polar Signals: managed.

Parquet is the winner at scale — columnar, compressed, queryable.

### Querying

The query model is "profile_type{labels} over time range." All three backends support this. The flame graph is rendered server-side or client-side from the aggregated data.

---

## Profile-Guided Optimization Internals

```
src/cmd/compile/internal/pgo/
```

The compiler reads the PGO profile and uses three signals:

1. **Inlining**: hot functions get more aggressive inlining. Specifically, calls in hot blocks past the usual size limit.
2. **Devirtualisation**: an interface method dispatch where the profile shows one dominant concrete type can be devirtualised, with a type check + fall-through.
3. **Basic block ordering**: hot blocks are laid out together to improve I-cache hit rate.

PGO does **not** currently affect:

- Register allocation (planned).
- Lock-related decisions.
- Goroutine scheduling.

### Why concurrent profile is not useful for PGO

The compiler wants on-CPU samples — "which instructions execute often." A mutex profile says "which goroutines wait." Wait is not optimisable at compile time; only the work inside the critical section is. Use a CPU profile for PGO.

### Reproducible builds and PGO

A PGO profile makes a build profile-dependent. To keep builds reproducible:

- Pin `default.pgo` in version control.
- Refresh it on a schedule (weekly?) as a separate PR.
- CI compares the new profile's effect via benchmark deltas before accepting.

---

## Open Research and Future Directions

A few areas where Go's concurrent profiling is still evolving:

### Wall-clock profiler

There is community interest (and a long-standing proposal) for a built-in wall-clock profiler — a CPU-profile-like sample of off-CPU goroutines too. `fgprof` implements this externally by walking the goroutine list periodically and writing pprof. Bringing it into the runtime would let it use proper sampling on `gopark` events.

### Lock-name attribution

Today the mutex profile attributes by stack. Two different mutexes used at the same release site collapse. A proposed change would tag each `sync.Mutex` instance with a synthetic name (perhaps its address or its allocation site) so the profile distinguishes them. Not yet upstream.

### Runtime-internal locks in the mutex profile

`runtime.mutex` (used for scheduler, GC, etc.) does not feed `mutexevent`. With `GOEXPERIMENT=staticlockranking` you can get some visibility, but only at trace level. A user-facing feature is on roadmaps.

### Trace v3

Go 1.22's trace2 was the first full rewrite in a decade. Trace v3 (speculative) would push per-CPU partitioning further and shrink the format. The bigger goal: tracing as a "production-always" feature, not a forensic tool.

### Cross-runtime trace correlation

OpenTelemetry traces and Go traces share the concept of "task" but not the format. A future convergence would let a Jaeger UI render a Go runtime trace as one span graph. Not yet, but the work is underway.

---

## Self-Assessment

- [ ] I can describe how SIGPROF reaches the Go signal handler and where the stack is captured.
- [ ] I can explain why the mutex profile attributes to the releaser.
- [ ] I can walk the sequence of trace events for a single goroutine that creates another, blocks, and exits.
- [ ] I can parse a pprof.proto file with the `github.com/google/pprof/profile` package.
- [ ] I can argue for or against scraping mutex profiles every minute on a 1000-pod fleet.
- [ ] I can explain what PGO does and does not optimise.
- [ ] I have read at least `src/runtime/mprof.go` and `src/runtime/trace2.go` once.

---

## Summary

Professional-level concurrent profiling means knowing the runtime well enough to predict its behaviour. The samplers are small files in `src/runtime/`: `cpuprof.go`, `mprof.go`, `trace2.go`. The protobuf format is `pprof.proto`. The fleet architecture trade-offs (push vs pull, jitter, retention) are operational. PGO is a related but distinct loop. None of these are mysteries once you've read the sources. They are the foundation on which the entire performance toolchain — `go tool pprof`, `go tool trace`, Pyroscope, Parca, the compiler's PGO pass — is built.
