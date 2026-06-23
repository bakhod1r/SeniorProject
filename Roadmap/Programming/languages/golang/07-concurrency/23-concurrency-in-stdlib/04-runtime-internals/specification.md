---
layout: default
title: Runtime Internals — Specification
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/specification/
---

# Runtime Internals Used by Stdlib — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [`runtime` package godoc — exported helpers](#runtime-package-godoc--exported-helpers)
3. [Go memory model statements about runtime](#go-memory-model-statements-about-runtime)
4. [`runtime/race` documentation](#runtimerace-documentation)
5. [`runtime/trace` event format](#runtimetrace-event-format)
6. [`runtime/pprof` profile definitions](#runtimepprof-profile-definitions)
7. [`internal/poll` runtime hooks](#internalpoll-runtime-hooks)
8. [`runtime/metrics` schema](#runtimemetrics-schema)
9. [Cross-reference table](#cross-reference-table)
10. [References](#references)

---

## Introduction

This file collects normative text from `pkg.go.dev/runtime`, the Go memory model document, and runtime/race documentation. Citations are paraphrased where necessary for clarity. The original sources are listed at the end.

---

## `runtime` package godoc — exported helpers

### `func Gosched()`

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

Source: `src/runtime/proc.go`. Implementation in `src/runtime/proc.go:Gosched_m`.

### `func LockOSThread()` / `func UnlockOSThread()`

> LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread. If the calling goroutine exits without unlocking the thread, the thread will be terminated.

> All init functions are run on the startup thread. Calling LockOSThread from an init function will cause the main function to be invoked on that thread.

> A goroutine should call LockOSThread before calling OS services or non-Go library functions that depend on per-thread state.

### `func SetFinalizer(obj any, finalizer any)`

> SetFinalizer sets the finalizer associated with obj to the provided finalizer function. When the garbage collector finds an unreachable block with an associated finalizer, it clears the association and runs finalizer(obj) in a separate goroutine. This makes obj reachable again, but now without an associated finalizer. Assuming that SetFinalizer is not called again, the next time the garbage collector sees that obj is unreachable, it will free obj.

> SetFinalizer(obj, nil) clears any finalizer associated with obj.

> The argument obj must be a pointer to an object allocated by calling new, by taking the address of a composite literal, or by taking the address of a local variable. The argument finalizer must be a function that takes a single argument to which obj's type can be assigned, and can have arbitrary ignored return values. If either of these is not true, SetFinalizer may abort the program.

> Finalizers are run in the dependency order of the values they reference. … In a program that uses finalizers, the program must call SetFinalizer for every value that needs cleanup.

> It is not guaranteed that a finalizer will run if the size of *obj is zero bytes, because it may share same address with other zero-size objects in memory. … There is no guarantee that finalizers will run before a program exits, so typically they are useful only for releasing non-memory resources associated with an object during a long-running program.

### `func Goexit()`

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine. Because Goexit is not a panic, any recover calls in those deferred functions will return nil.

> Calling Goexit from the main goroutine terminates that goroutine without func main returning. Since func main has not returned, the program continues execution of other goroutines. If all other goroutines exit, the program crashes.

### `func GC()`

> GC runs a garbage collection and blocks the caller until the garbage collection is complete. It may also block the entire program.

### `func NumGoroutine() int`

> NumGoroutine returns the number of goroutines that currently exist.

### `func NumCPU() int`

> NumCPU returns the number of logical CPUs usable by the current process. The set of available CPUs is checked by querying the operating system at process startup.

### `func GOMAXPROCS(n int) int`

> GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously and returns the previous setting. If n < 1, it does not change the current setting.

### `func Stack(buf []byte, all bool) int`

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

### `func SetCPUProfileRate(hz int)`

> SetCPUProfileRate sets the CPU profiling rate to hz samples per second. If hz <= 0, SetCPUProfileRate turns off profiling.

### `func SetBlockProfileRate(rate int)`

> SetBlockProfileRate controls the fraction of goroutine blocking events that are reported in the blocking profile. The profiler aims to sample an average of one blocking event per rate nanoseconds spent blocked. To include every blocking event in the profile, pass rate = 1.

### `func SetMutexProfileFraction(rate int) int`

> SetMutexProfileFraction controls the fraction of mutex contention events that are reported in the mutex profile. On average 1/rate events are reported.

### `type Pinner` (Go 1.21+)

> A Pinner is a set of Go objects each pinned to a fixed location in memory. The Pinner.Pin method pins one object, while Pinner.Unpin unpins all pinned objects.

> A pinned object will remain pinned until either Unpin is called or Pinner is no longer referenced and is garbage collected. … It is safe to pin a Go object multiple times, possibly with multiple Pinners. … A pinned object cannot be moved by the garbage collector.

> Memory occupied by pinned objects is not reclaimed, even if all references to them go out of scope.

### `func KeepAlive(x any)`

> KeepAlive marks its argument as currently reachable. This ensures that the object is not freed, and its finalizer is not run, before the point in the program where KeepAlive is called.

---

## Go memory model statements about runtime

From the Go memory model document (https://go.dev/ref/mem):

> The go statement that starts a new goroutine happens before the goroutine's execution begins.

> The exit of a goroutine is not guaranteed to happen before any event in the program. For example, in this program:
> ```go
> var a string
> func hello() {
>     go func() { a = "hello" }()
>     print(a)
> }
> ```
> the assignment to a is not followed by any synchronization event, so it is not guaranteed to be observed by any other goroutine. In fact, an aggressive compiler might delete the entire go statement.

On finalizers:
> The call to runtime.SetFinalizer(x, f) happens before the finalization call f(x).

On `sync.Once`:
> A single call of f from once.Do(f) is synchronized before the return of any call of once.Do(f).

On atomic operations (Go 1.19+):
> The APIs in the sync/atomic package are collectively "atomic operations" that can be used to synchronize the execution of different goroutines. If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

---

## `runtime/race` documentation

From `src/runtime/race/README` and `src/runtime/race.go`:

> The race detector is integrated with the Go runtime via callbacks that the compiler inserts at every load and store of memory, and at every synchronization point. The runtime forwards these events to the ThreadSanitizer library (tsan_go.cpp).

Compiler-inserted callbacks (declared in `src/runtime/race.go`):
- `racefuncenter(callpc uintptr)` — at every function entry.
- `racefuncexit()` — at every function exit.
- `raceread(addr uintptr)` — before every read of memory.
- `racewrite(addr uintptr)` — before every write of memory.
- `racereadrange(addr, size uintptr)` — for slice ranges.
- `racewriterange(addr, size uintptr)` — for slice ranges.

Synchronization callbacks (called from runtime when synchronization happens):
- `raceacquire(addr unsafe.Pointer)` — called by `sync.Mutex.Lock` slow path, by channel receive, etc.
- `racerelease(addr unsafe.Pointer)` — called by `sync.Mutex.Unlock`, by channel send.
- `racereleaseacquire(addr unsafe.Pointer)` — combined release-acquire.

A happens-before edge from one goroutine's `racerelease(p)` to another goroutine's `raceacquire(p)` is established when `p` is the same address. The TSan runtime maintains a vector clock per goroutine and shadow memory recording the last reader/writer of each word.

---

## `runtime/trace` event format

From `src/runtime/trace.go` and `internal/trace`:

Each trace event has the form `<event-type-byte> <varint-length> <varint-args>...`. Key event types:

| Event | Code | When emitted | Arguments |
|-------|------|--------------|-----------|
| `EvGoCreate` | 12 | `runtime.newproc` | new-g-id, new-pc, parent-stack |
| `EvGoStart` | 13 | `runtime.execute` | g-id, seq |
| `EvGoEnd` | 14 | `runtime.goexit0` | — |
| `EvGoStop` | 15 | `gopark`(non-block) | reason, stack |
| `EvGoSched` | 16 | `runtime.Gosched_m` | stack |
| `EvGoPreempt` | 17 | preemption signal | stack |
| `EvGoSleep` | 18 | `time.Sleep` | stack |
| `EvGoBlock` | 19 | `gopark`(generic) | stack |
| `EvGoBlockSend` | 20 | chan send block | stack |
| `EvGoBlockRecv` | 21 | chan recv block | stack |
| `EvGoBlockSelect` | 22 | select block | stack |
| `EvGoBlockSync` | 23 | sync.Mutex block | stack |
| `EvGoBlockCond` | 24 | sync.Cond.Wait | stack |
| `EvGoBlockNet` | 25 | netpoll block | stack |
| `EvGoSysCall` | 26 | `entersyscall` | stack |
| `EvGoSysExit` | 27 | `exitsyscall` | seq, ts |
| `EvProcStart` | 5 | `acquirep` | thread-id |
| `EvProcStop` | 6 | `releasep` | — |
| `EvGCStart` | 7 | GC begins | stack |
| `EvGCDone` | 8 | GC ends | — |

Each event is written to a per-P buffer to avoid contention.

---

## `runtime/pprof` profile definitions

From `pkg.go.dev/runtime/pprof`:

### CPU profile
Emitted by SIGPROF; rate set via `runtime.SetCPUProfileRate` or `pprof.StartCPUProfile`. Samples consist of a stack trace and a count (cycle of the SIGPROF clock).

### Goroutine profile
> Stack traces of all current goroutines.

Implemented via `runtime.GoroutineProfile`. Requires STW.

### Heap profile
> A sampling of memory allocations of live objects.

Sample rate controlled by `runtime.MemProfileRate` (default 512 KB).

### Allocs profile
> A sampling of all past memory allocations.

### Block profile
> Stack traces that led to blocking on synchronization primitives.

Recorded only if `runtime.SetBlockProfileRate(rate > 0)` was called.

### Mutex profile
> Stack traces of holders of contended mutexes.

Recorded only if `runtime.SetMutexProfileFraction(rate > 0)` was called.

### Threadcreate profile
> Stack traces that led to the creation of new OS threads.

---

## `internal/poll` runtime hooks

`internal/poll/fd_poll_runtime.go` declares the runtime functions stdlib calls:

```go
// runtime_pollServerInit is called once to initialize the netpoller.
func runtime_pollServerInit()

// runtime_pollOpen registers a fd with the netpoller; returns pollDesc.
func runtime_pollOpen(fd uintptr) (uintptr, int)

// runtime_pollClose deregisters a fd.
func runtime_pollClose(ctx uintptr)

// runtime_pollWait blocks the calling goroutine until the fd is ready
// for the requested operation (mode: 'r' or 'w').
func runtime_pollWait(ctx uintptr, mode int) int

// runtime_pollSetDeadline sets a deadline on a poll desc.
func runtime_pollSetDeadline(ctx uintptr, d int64, mode int)

// runtime_pollUnblock wakes any goroutines waiting on a fd.
func runtime_pollUnblock(ctx uintptr)
```

These are linked at build time via `go:linkname` to runtime implementations in `src/runtime/netpoll.go`.

---

## `runtime/metrics` schema

Since Go 1.16, the `runtime/metrics` package provides low-overhead access to runtime statistics. Selected metrics:

| Name | Kind | Meaning |
|------|------|---------|
| `/gc/cycles/total:gc-cycles` | counter | Total GC cycles completed |
| `/gc/heap/live:bytes` | gauge | Live heap bytes after last GC |
| `/gc/pauses:seconds` | distribution | GC pause durations |
| `/sched/goroutines:goroutines` | gauge | Number of goroutines |
| `/sched/latencies:seconds` | distribution | Time goroutines spent in run queues |
| `/sched/pauses/stopping/gc:seconds` | distribution | STW stopping latency for GC |
| `/sched/pauses/total/gc:seconds` | distribution | Total STW duration for GC |
| `/sync/mutex/wait/total:seconds` | counter | Accumulated mutex wait time |
| `/cpu/classes/gc/total:cpu-seconds` | counter | CPU time attributed to GC |
| `/cpu/classes/scavenge/total:cpu-seconds` | counter | CPU time attributed to scavenger |

Read with:
```go
samples := make([]metrics.Sample, 1)
samples[0].Name = "/sched/goroutines:goroutines"
metrics.Read(samples)
```

---

## Cross-reference table

| Stdlib API | Runtime function | File |
|------------|------------------|------|
| `time.Sleep` | `runtime.timeSleep` | `src/runtime/time.go` |
| `time.NewTimer` | `runtime.newTimer` | `src/runtime/time.go` |
| `sync.Mutex.Lock` (slow) | `runtime.semacquire1` | `src/runtime/sema.go` |
| `sync.Mutex.Unlock` (slow) | `runtime.semrelease` | `src/runtime/sema.go` |
| `sync.WaitGroup.Wait` | `runtime_SemacquireWaitGroup` | `src/runtime/sema.go` |
| `sync.Cond.Wait` | `runtime.notifyListWait` | `src/runtime/sema.go` |
| `sync.Cond.Signal` | `runtime.notifyListNotifyOne` | `src/runtime/sema.go` |
| `sync.Cond.Broadcast` | `runtime.notifyListNotifyAll` | `src/runtime/sema.go` |
| `sync.Pool.Get` | `runtime_procPin` | `src/runtime/proc.go` |
| `sync.Once.Do` | atomic + `Mutex` | `src/sync/once.go` |
| `net.Conn.Read` (blocked) | `runtime_pollWait` | `src/runtime/netpoll.go` |
| `os.Signal` | dedicated goroutine via `signal_recv` | `src/runtime/signal_unix.go` |
| `runtime.SetFinalizer` | `runtime.SetFinalizer` (impl) | `src/runtime/mfinal.go` |
| `runtime/pprof.StartCPUProfile` | `runtime.SetCPUProfileRate` | `src/runtime/cpuprof.go` |

---

## References

1. Go runtime package documentation — https://pkg.go.dev/runtime
2. Go memory model — https://go.dev/ref/mem
3. `runtime/race` README — `$GOROOT/src/runtime/race/README`
4. Russ Cox, "The Go Memory Model" — https://research.swtsh.com/go-mem
5. Go execution trace format — https://golang.org/s/go15trace
6. `runtime/metrics` documentation — https://pkg.go.dev/runtime/metrics
7. Dmitry Vyukov, "Go scheduler design" — https://golang.org/s/go11sched
8. Austin Clements, "Go 1.14 async preemption" — https://golang.org/issue/24543
9. `internal/poll` source — `$GOROOT/src/internal/poll/`
10. `runtime/cgocall.go` — cgo entry/exit machinery

This document is the source of truth for any claim made in `junior.md`, `middle.md`, `senior.md`, and `professional.md` regarding `runtime` package semantics.
