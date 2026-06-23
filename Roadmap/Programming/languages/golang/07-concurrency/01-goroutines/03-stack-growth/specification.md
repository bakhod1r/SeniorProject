# Goroutine Stack Growth — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Go Spec Says (and Does Not Say) About Stacks](#what-the-go-spec-says-and-does-not-say-about-stacks)
3. [`runtime/debug` Package — Stack APIs](#runtimedebug-package--stack-apis)
4. [`runtime` Package — Stack-Related APIs](#runtime-package--stack-related-apis)
5. [`runtime/metrics` Names Related to Stacks](#runtimemetrics-names-related-to-stacks)
6. [Stack-Related GODEBUG Knobs](#stack-related-godebug-knobs)
7. [Go Release History for Stack Behaviour](#go-release-history-for-stack-behaviour)
8. [Compiler Directives Related to Stacks](#compiler-directives-related-to-stacks)
9. [References](#references)

---

## Introduction

This file catalogues the *normative* sources for goroutine stack behaviour: what the Go language specification, runtime documentation, and release notes formally guarantee. Anything stated here is part of the documented contract. Anything not stated here is implementation detail and may change between versions.

The Go Programming Language Specification does not specify stacks at all; stack management is a runtime concern, and the runtime documentation covers it through public APIs (`runtime.MemStats`, `runtime/debug.SetMaxStack`, etc.). This file focuses on those normative sources.

---

## What the Go Spec Says (and Does Not Say) About Stacks

### Direct mentions in the spec

The Go Programming Language Specification (`https://go.dev/ref/spec`) does **not** mention the word "stack" in a normative sense. Searching the spec for "stack" returns no hits in the syntactic or semantic definitions. The closest reference is in the discussion of `go` statements, which mentions goroutines as having an "independent concurrent thread of control."

### What the spec leaves unspecified

- Initial stack size.
- Whether stacks grow.
- Maximum stack size.
- What happens when a stack overflows.
- Where the stack lives (heap, OS-managed thread stack, etc.).
- Whether the stack pointer is observable.

### Practical consequence

The Go runtime is free to change stack mechanics between releases. From Go 1.0 to Go 1.4, the initial stack size moved from 8 KB to 4 KB to 2 KB. From 1.0/1.2 to 1.3+, the growth mechanism changed from segmented to copying. These were implementation changes, not language changes.

User code should not assume:

- A particular initial stack size.
- That stacks are contiguous.
- That stack addresses are stable across function calls.
- That `unsafe.Pointer(&local)` retains validity after subsequent function calls.

User code may assume:

- Stacks grow as needed up to some limit.
- The limit is at least the value configured by `runtime/debug.SetMaxStack`.
- Stack overflow produces a fatal error, not a recoverable panic.

---

## `runtime/debug` Package — Stack APIs

The `runtime/debug` package (`https://pkg.go.dev/runtime/debug`) exposes the public, supported API for tweaking stack behaviour.

### `SetMaxStack`

```go
func SetMaxStack(bytes int) int
```

> SetMaxStack sets the maximum amount of memory that can be used by a single goroutine stack. If any goroutine exceeds this limit while growing its stack, the program crashes. SetMaxStack returns the previous setting. The initial setting is 1 GB on 64-bit systems, 250 MB on 32-bit systems. There may be a minimum value below which SetMaxStack will reject the request, and there may also be granularity in the setting. SetMaxStack is useful mainly for limiting the damage done by goroutines that enter an infinite recursion.

Key guarantees:

- The default is **1 GB on 64-bit**, **250 MB on 32-bit**.
- Returns the previous setting (allowing restore via `defer`).
- Crashing on overflow is normative — the runtime is permitted to abort the process.
- The runtime may round up to a granular boundary.

### `Stack` (from `runtime/debug`)

```go
func Stack() []byte
```

> Stack returns a formatted stack trace of the goroutine that calls it. It calls runtime.Stack with a large enough buffer to capture the entire trace.

Note: `runtime/debug.Stack()` is different from `runtime.Stack(buf, all)`. The debug version returns a self-sized byte slice for the current goroutine only.

### `PrintStack`

```go
func PrintStack()
```

> PrintStack prints to standard error the stack trace returned by runtime.Stack.

Convenience function for logging.

### `SetGCPercent`, `FreeOSMemory`

Indirectly related: FreeOSMemory forces a GC and tries to return memory to the OS. The stack pool's free pages may be reclaimed.

```go
func FreeOSMemory()
```

> FreeOSMemory forces a garbage collection followed by an attempt to return as much memory to the operating system as possible. (Even if this is not called, the runtime gradually returns memory to the operating system in a background task.)

---

## `runtime` Package — Stack-Related APIs

### `runtime.Stack`

```go
func Stack(buf []byte, all bool) int
```

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written to buf. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

The buffer is *not* grown. If too small, the result is truncated. Standard idiom:

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

### `runtime.Caller`

```go
func Caller(skip int) (pc uintptr, file string, line int, ok bool)
```

Returns information about a single frame. `skip=0` is the caller of `Caller`.

### `runtime.Callers`

```go
func Callers(skip int, pc []uintptr) int
```

Fills `pc` with PC values of calling functions. Use with `runtime.CallersFrames` to extract function names and source positions.

### `runtime.MemStats` — stack fields

```go
type MemStats struct {
    // ...
    StackInuse   uint64  // bytes in stacks
    StackSys     uint64  // bytes obtained from OS for stacks
    // ...
}
```

- **StackInuse** — bytes currently in use by all stacks (active goroutines + pool).
- **StackSys** — bytes obtained from the OS for stack memory. Includes the unused pool.

Note: `StackInuse` *includes* stacks in the per-P cache that have been allocated but no longer assigned to a goroutine. It is not solely the bytes used by running goroutines' stacks.

### `runtime.ReadMemStats`

```go
func ReadMemStats(m *MemStats)
```

Fills `m` with current stats. Stops the world briefly; do not call in hot paths.

---

## `runtime/metrics` Names Related to Stacks

Go 1.16+ exposes structured metrics via `runtime/metrics`:

| Metric | Description |
|---|---|
| `/memory/classes/heap/stacks:bytes` | Bytes of stack memory obtained from the heap. |
| `/memory/classes/other:bytes` | Includes stack pool overhead. |
| `/sched/goroutines:goroutines` | Live goroutine count. |

Read with:

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/memory/classes/heap/stacks:bytes"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)
for _, s := range samples {
    fmt.Println(s.Name, s.Value.Uint64())
}
```

There is **no** metric for "current max stack" — that is set by `SetMaxStack` and not exposed via `runtime/metrics`.

There is no metric for "number of stack-growth events" or "bytes copied during stack growth." Profiling these requires `morestack_noctxt` appearing in pprof CPU profiles.

---

## Stack-Related GODEBUG Knobs

Environment variables that affect stack behaviour. **Not part of the Go 1 compatibility promise.** May change between releases. Use for diagnostics.

| Knob | Effect |
|---|---|
| `GODEBUG=stackalloc=1` | Print each stack allocation. Extremely chatty. |
| `GODEBUG=stackdebug=N` | Verbose stack-growth tracing. `N=0` off; `N=1,2,3` increasing verbosity. |
| `GODEBUG=gctrace=1` | GC trace; shrinking happens during GC, so this surfaces shrink events indirectly. |
| `GODEBUG=stackpoisoning=1` | Fill freed stacks with a poison pattern to detect use-after-free. Debugging only. |
| `GODEBUG=stackswapprobe=1` | Probe for stack swaps. Internal. |
| `GOTRACEBACK=all` | On panic, dump stacks of all goroutines. |
| `GOTRACEBACK=system` | Show extra runtime detail in traces. |
| `GOTRACEBACK=crash` | On panic, dump core. |

Documented at `https://pkg.go.dev/runtime#hdr-Environment_Variables`. Many of these are runtime-internal and not stable.

---

## Go Release History for Stack Behaviour

| Go version | Stack-relevant change |
|---|---|
| 1.0 (2012) | Segmented stacks. Initial stack ~8 KB. |
| 1.1 (2013) | Stack split changes; M:N scheduler. |
| 1.2 (2013) | Stack overflow now detected. Tracking work was improved. |
| **1.3** (2014) | **Contiguous (copying) stacks** replace segmented stacks. Hot-split problem solved. Initial stack 8 KB. |
| **1.4** (2014) | **Initial stack reduced to 2 KB** (from 8 KB). |
| 1.5 (2015) | Concurrent GC. Stack scanning made concurrent. |
| 1.6 (2016) | More precise pointer maps. Tighter stack scanning. |
| 1.7 (2016) | Stack reuse improvements. |
| 1.8 (2017) | Argument liveness tracking improvements. |
| 1.13 (2019) | Open-coded defers. Reduces defer overhead in tight loops. |
| 1.14 (2020) | Asynchronous preemption via `SIGURG`. Preemption overloaded onto `stackguard0`. |
| 1.17 (2021) | Register-based ABI. `g` register dedicated (R14 on amd64). |
| 1.18 (2022) | Generics. Stack-related runtime changes minimal. |
| 1.22 (2024) | `for` loop variable scope change — fixes a common goroutine-with-loop-variable bug but is orthogonal to stacks. |

The big inflection points: **1.3 (copying stacks)**, **1.4 (2 KB initial size)**, **1.14 (preemption via stackguard0)**. These define modern Go stack behaviour.

---

## Compiler Directives Related to Stacks

These are compiler pragmas (annotations on Go functions). Not stable; meant primarily for the runtime itself.

### `//go:nosplit`

```go
//go:nosplit
func runtime_critical_helper() {
    // ...
}
```

Tells the compiler: **do not emit the stack-growth check** in this function's prologue. The function is now a "nosplit" function. The runtime guarantees a budget of `_StackGuard` (~928) bytes of free stack below any nosplit chain's entry point.

Caveats:

- Nosplit functions must have small frames.
- They must not call non-nosplit functions (or if they do, the compiler verifies the chain still fits the budget).
- They are used internally by the runtime; user code should generally not use this.

### `//go:nowritebarrier` / `//go:nowritebarrierrec`

Related to GC, not stacks directly, but often accompany `//go:nosplit` in runtime code.

### `//go:noinline`

Prevents inlining. Indirectly affects stack growth — an inlined function shares the caller's frame; a non-inlined function adds its own frame.

### `//go:linkname`

Lets user code reference internal runtime symbols. Often used to call internal stack-related functions in code that has special needs (e.g., libraries that mimic `runtime/debug.Stack` but want stack-based addressing).

### Compiler flags

| Flag | Effect |
|---|---|
| `-gcflags="-m"` | Print escape analysis decisions. Indirectly shows which variables stay on the stack. |
| `-gcflags="-S"` | Print generated assembly, including the stack-growth check. |
| `-gcflags="-N -l"` | Disable optimisations and inlining; useful when reading prologues. |

---

## References

- **Go Language Specification**: <https://go.dev/ref/spec>
- **`runtime` package** documentation: <https://pkg.go.dev/runtime>
- **`runtime/debug` package**: <https://pkg.go.dev/runtime/debug>
- **`runtime/metrics` package**: <https://pkg.go.dev/runtime/metrics>
- **`runtime/HACKING.md`** — runtime invariants and architectural notes: <https://github.com/golang/go/blob/master/src/runtime/HACKING.md>
- **`runtime/stack.go`** — canonical implementation: <https://github.com/golang/go/blob/master/src/runtime/stack.go>
- **`runtime/runtime2.go`** — type definitions: <https://github.com/golang/go/blob/master/src/runtime/runtime2.go>
- **`runtime/asm_amd64.s`** — assembly entries (`morestack`): <https://github.com/golang/go/blob/master/src/runtime/asm_amd64.s>
- **`runtime/symtab.go`** — `pcdata`/`funcdata` access: <https://github.com/golang/go/blob/master/src/runtime/symtab.go>
- **`runtime/mgcmark.go`** — GC stack scanning: <https://github.com/golang/go/blob/master/src/runtime/mgcmark.go>
- **Go 1.3 release notes** — contiguous stacks: <https://go.dev/doc/go1.3>
- **Go 1.4 release notes** — 2 KB initial stack: <https://go.dev/doc/go1.4>
- **Go 1.14 release notes** — async preemption: <https://go.dev/doc/go1.14>
- **"Goroutines: Stacks"** — Russ Cox's notes on segmented vs copying stacks
- **"Contiguous stacks in Go"** — Dmitry Vyukov, design doc
- **GopherCon 2014: "Go's growing stacks"** — Keith Randall
- **Design doc: Async preemption** (Austin Clements, 2018): <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- **`man 2 mmap`** — used by the runtime to obtain stack memory.
- **`man 2 sigaltstack`** — used for `gsignal` stacks.
- **POSIX `pthread_attr_setstacksize`** — comparison with C threads.
