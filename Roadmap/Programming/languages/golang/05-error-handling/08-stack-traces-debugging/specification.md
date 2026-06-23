# Stack Traces & Debugging — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The runtime Package: Stack-Related API](#the-runtime-package-stack-related-api)
3. [The runtime/debug Package](#the-runtimedebug-package)
4. [The pprof Package and Endpoints](#the-pprof-package-and-endpoints)
5. [GOTRACEBACK and SetTraceback](#gotraceback-and-settraceback)
6. [Signal Handling](#signal-handling)
7. [Build Flags Affecting Traces](#build-flags-affecting-traces)
8. [Spec Behavior of Panic and Trace](#spec-behavior-of-panic-and-trace)
9. [Compatibility Across Versions](#compatibility-across-versions)
10. [Things the Spec Does NOT Define](#things-the-spec-does-not-define)
11. [References](#references)

---

## Introduction

The Go specification does not define stack traces. They are an implementation feature of the gc compiler and runtime, exposed through the standard library. This document collects the *de facto* API surface: what is documented, what is stable, what is platform-specific, and what behavior every Go programmer can rely on.

Reference: [The Go Programming Language Specification](https://go.dev/ref/spec) (note: silent on stack traces) and [Go Diagnostics](https://go.dev/doc/diagnostics).

---

## The runtime Package: Stack-Related API

From `pkg/runtime`:

```go
// Caller reports file and line number information about function invocations
// on the calling goroutine's stack. The argument skip is the number of stack
// frames to ascend, with 0 identifying the caller of Caller.
func Caller(skip int) (pc uintptr, file string, line int, ok bool)

// Callers fills the slice pc with the return program counters of function
// invocations on the calling goroutine's stack. The argument skip is the
// number of stack frames to skip before recording in pc, with 0 identifying
// the frame for Callers itself and 1 identifying the caller of Callers.
func Callers(skip int, pc []uintptr) int

// FuncForPC returns a *Func describing the function that contains the
// given program counter address, or else nil.
//
// If pc represents multiple functions because of inlining, it returns the
// *Func describing the innermost function, but with an entry of the
// outermost function.
func FuncForPC(pc uintptr) *Func

// CallersFrames takes a slice of PC values returned by Callers and prepares
// to return function/file/line information. Do not change the slice until
// you are done with the Frames.
func CallersFrames(callers []uintptr) *Frames

// Stack formats a stack trace of the calling goroutine into buf and returns
// the number of bytes written to buf. If all is true, Stack formats stack
// traces of all other goroutines into buf after the trace for the current
// goroutine.
func Stack(buf []byte, all bool) int

// NumGoroutine returns the number of goroutines that currently exist.
func NumGoroutine() int

// Goexit terminates the goroutine that calls it. Deferred functions still run.
func Goexit()
```

`Frames` and `Frame`:

```go
type Frame struct {
    PC       uintptr
    Func     *Func
    Function string
    File     string
    Line     int
    Entry    uintptr
    // ...
}

type Frames struct{ /* unexported */ }

func (f *Frames) Next() (frame Frame, more bool)
```

**Key contract**: `Caller(skip)` and `Callers(skip, pc)` use *different* `skip` semantics. `Caller(0)` returns the caller of `Caller`; `Callers(0, ...)` would put `runtime.Callers` itself in slot 0. Always read the doc for the exact version you target.

---

## The runtime/debug Package

From `pkg/runtime/debug`:

```go
// PrintStack prints to standard error the stack trace returned by Stack.
func PrintStack()

// Stack returns a formatted stack trace of the goroutine that calls it.
// It calls runtime.Stack with a large enough buffer to capture the entire trace.
func Stack() []byte

// SetTraceback sets the amount of detail printed by the runtime in the
// traceback it prints before exiting due to an unrecovered panic or an
// internal runtime error. The level argument takes the same values as the
// GOTRACEBACK environment variable.
func SetTraceback(level string)

// SetPanicOnFault controls the runtime's behavior when a program faults at
// an unexpected (non-nil) address. Such faults are typically caused by bugs
// such as runtime memory corruption, so the default response is to crash
// the program. Programs working with memory-mapped files or unsafe
// manipulation of memory may cause faults at non-nil addresses in less
// dramatic situations; SetPanicOnFault allows such programs to request that
// the runtime trigger only a panic, not a crash.
func SetPanicOnFault(enabled bool) (old bool)

// SetGCPercent sets the garbage collection target percentage.
// (Not stack-related, but commonly used in debug code.)
func SetGCPercent(percent int) int

// ReadBuildInfo returns the build information embedded in the running binary.
func ReadBuildInfo() (info *BuildInfo, ok bool)
```

`SetTraceback` accepts the same string values as the `GOTRACEBACK` env var. It can only **increase** verbosity, not decrease it below the env-set level.

---

## The pprof Package and Endpoints

`runtime/pprof` exposes the profiling primitives:

```go
// Lookup returns the profile with the given name, or nil if no such profile exists.
//
// Predefined profiles:
//   "goroutine"    - stack traces of all current goroutines
//   "heap"         - a sampling of memory allocations of live objects
//   "allocs"       - a sampling of all past memory allocations
//   "threadcreate" - stack traces that led to the creation of new OS threads
//   "block"        - stack traces that led to blocking on synchronization primitives
//   "mutex"        - stack traces of holders of contended mutexes
func Lookup(name string) *Profile

// WriteTo writes a pprof-formatted snapshot of the profile to w.
// debug=0 emits the protobuf format; debug=1 emits a deduplicated text
// format; debug=2 (for the goroutine profile) emits the same format as
// runtime.Stack.
func (p *Profile) WriteTo(w io.Writer, debug int) error

// CPU and trace recording:
func StartCPUProfile(w io.Writer) error
func StopCPUProfile()
```

`net/http/pprof` provides HTTP handlers that wrap these:

```go
import _ "net/http/pprof"

// Then GET on:
//   /debug/pprof/                       index page
//   /debug/pprof/profile?seconds=N      CPU profile for N seconds
//   /debug/pprof/heap                   heap snapshot
//   /debug/pprof/goroutine?debug=2      verbose goroutine dump
//   /debug/pprof/block, /mutex          must enable via SetBlockProfileRate / SetMutexProfileFraction
//   /debug/pprof/symbol                 PC -> name resolution for clients
//   /debug/pprof/trace?seconds=N        execution trace
```

Block and mutex profiles require runtime opt-in:

```go
runtime.SetBlockProfileRate(1)         // sample every blocking event
runtime.SetMutexProfileFraction(1)     // sample every mutex contention event
```

Higher rates have higher overhead. Production typical: 100-1000 (sample every Nth event).

---

## GOTRACEBACK and SetTraceback

From the runtime documentation:

> The `GOTRACEBACK` variable controls the amount of output generated when a Go program fails due to an unrecovered panic or an unexpected runtime condition. By default, a failure prints a stack trace for the current goroutine, eliding functions internal to the run-time system, and then exits with exit code 2. The failure prints stack traces for all goroutines if there is no current goroutine or the failure is internal to the run-time. `GOTRACEBACK=none` omits the goroutine stack traces entirely. `GOTRACEBACK=single` (the default) behaves as described above. `GOTRACEBACK=all` adds stack traces for all user-created goroutines. `GOTRACEBACK=system` is like all but adds stack frames for run-time functions and shows goroutines created internally by the run-time. `GOTRACEBACK=crash` is like system but crashes in an operating system-specific manner instead of exiting.

Numeric equivalents (legacy): `0=none`, `1=single`, `2=all`. Both forms are accepted.

`debug.SetTraceback` is the programmatic equivalent. It takes the same level strings.

---

## Signal Handling

The Go runtime installs handlers for several signals. Behavior of each w.r.t. tracebacks (Unix):

| Signal | Default action |
|--------|----------------|
| SIGSEGV | Convert to runtime panic + traceback + exit. |
| SIGBUS | Same. |
| SIGFPE | Same. |
| SIGILL | Same. |
| SIGABRT | Print traceback + abort (may core dump). |
| SIGQUIT | Print traceback for *all* goroutines + exit (status 2 + 128). |
| SIGINT | Default Go behavior: exit. Can be intercepted by `os/signal`. |
| SIGTERM | Same as SIGINT. |
| SIGPIPE | Ignored (Go runtime decides per FD). |

`SIGQUIT` is the operationally important one: pressing Ctrl-\ in the running terminal triggers it, and the resulting goroutine dump is the same as `runtime.Stack(buf, true)` would produce.

`os/signal.Notify` lets you intercept most signals, but the runtime keeps its own handlers for fatal signals; you cannot fully suppress the runtime's own panic-on-segfault behavior.

---

## Build Flags Affecting Traces

| Flag | Effect on traces |
|------|------------------|
| (default build) | Full names, paths, lines. |
| `-trimpath` | File paths in traces are module-relative (`mymod/foo.go` instead of `/Users/.../mod/foo.go`). |
| `-ldflags='-s'` | Strips Go symbol table; `FuncForPC`/`CallersFrames` produce mostly empty results. |
| `-ldflags='-w'` | Strips DWARF; `dlv` source-level debug breaks. Stack traces still work. |
| `-gcflags='all=-l'` | Disables inlining; traces show all original frames. Slower binary. |
| `-gcflags='-N -l'` | Disables optimization and inlining; required for full `dlv` fidelity. |
| `-buildmode=plugin` | Plugin-loaded code's PCs may not resolve in the host's symbol table. |
| `CGO_ENABLED=0` | Pure-Go build; no C frames in traces. |

Recommended production combo: `-trimpath` and (optionally) `-ldflags='-w'`. **Never** strip with `-s` if you want production stack traces.

---

## Spec Behavior of Panic and Trace

The spec mentions `panic` and `recover` but says nothing about tracebacks:

> A run-time panic (such as an index out of range or a nil pointer dereference) starts a panic, also stops normal execution, runs deferred function calls and so on; ...

The fact that a panic *prints* a trace is a runtime behavior, not a spec one. A theoretical Go implementation could print nothing. The gc reference implementation prints a trace governed by `GOTRACEBACK`.

Similarly, `runtime.Caller` and `runtime.Callers` are runtime-package contracts, not language ones. Other Go implementations (gccgo, llgo) implement them but with potentially different cost characteristics.

---

## Compatibility Across Versions

| Go version | Notable change |
|-----------|----------------|
| 1.0 | `runtime.Caller`, `runtime.Callers`, `runtime.Stack`, `runtime/debug.Stack`. |
| 1.7 | `runtime.CallersFrames` introduced (handles inlining correctly). |
| 1.10 | Improved `pprof` block/mutex profiles; better inline metadata. |
| 1.12 | Async preemption groundwork; `runtime.Stack` works during more states. |
| 1.14 | Async preemption shipped; goroutine dumps now reflect more goroutines accurately. |
| 1.17 | `[]uintptr` `runtime.Callers` performance improvements. |
| 1.21 | Frame-pointer unwinding on amd64/arm64 by default; faster traces, smaller binaries. |
| 1.22 | `runtime.PinUnpin` and other pinning helpers; signal handling cleanup. |

`CallersFrames` is the safe baseline since 1.7. Code that targets older versions must use `FuncForPC` and accept inlining quirks.

The traceback **format** is informally stable but not part of the spec. Tools that parse panic output (e.g., crash reporters) typically tolerate minor changes; do not parse traces with brittle regexes.

---

## Things the Spec Does NOT Define

- **The format of a stack trace.** It is documented in the standard library but may change.
- **The `goroutine [N]` line.** Goroutine IDs are not part of any public API.
- **Whether inlined functions are visible.** Implementation-defined.
- **Cost model of `runtime.Callers` or `debug.Stack`.** Documented as "fast" or "moderate" but no numeric guarantee.
- **Whether `recover()` returns a captured stack.** It does not — `recover` returns only the panic value. Stack capture must be done by the caller of `recover`.
- **Behavior under stripped builds.** `runtime.FuncForPC` may return nil; `CallersFrames` may return placeholders.

This is consistent with Go's overall design: the spec defines the language; the runtime defines the *how*; the standard library publishes interfaces that compose them. Stacks are entirely in the runtime + standard library layer.

---

## References

- [The Go Programming Language Specification](https://go.dev/ref/spec)
- [Package runtime](https://pkg.go.dev/runtime)
- [Package runtime/debug](https://pkg.go.dev/runtime/debug)
- [Package runtime/pprof](https://pkg.go.dev/runtime/pprof)
- [Package net/http/pprof](https://pkg.go.dev/net/http/pprof)
- [Diagnostics — go.dev](https://go.dev/doc/diagnostics)
- [Go runtime: GOTRACEBACK documentation](https://pkg.go.dev/runtime#hdr-Environment_Variables)
- [Go 1.21 release notes — Frame Pointers](https://go.dev/doc/go1.21#frame-pointers)
- `$GOROOT/src/runtime/traceback.go`
- `$GOROOT/src/runtime/symtab.go`
- `$GOROOT/src/runtime/debug/stack.go`
