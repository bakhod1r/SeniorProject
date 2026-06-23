# Goroutines — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The `go` Statement (Language Spec)](#the-go-statement-language-spec)
3. [Goroutine Termination](#goroutine-termination)
4. [The Memory Model](#the-memory-model)
5. [Runtime Guarantees and Non-Guarantees](#runtime-guarantees-and-non-guarantees)
6. [`runtime` Package APIs](#runtime-package-apis)
7. [Scheduler Behaviour Across Versions](#scheduler-behaviour-across-versions)
8. [Stack Sizes and Limits](#stack-sizes-and-limits)
9. [Cooperative vs Asynchronous Preemption](#cooperative-vs-asynchronous-preemption)
10. [`GODEBUG` Knobs](#godebug-knobs)
11. [References](#references)

---

## Introduction

The behaviour of goroutines is documented in three normative sources:

- **The Go Programming Language Specification** (`go.dev/ref/spec`) — defines the syntax and semantics of the `go` statement.
- **The Go Memory Model** (`go.dev/ref/mem`) — defines when one goroutine's reads observe another goroutine's writes.
- **The `runtime` package documentation** (`pkg.go.dev/runtime`) — defines the public APIs for inspecting and controlling goroutines.

Several behaviours are deliberately *not* specified, leaving room for the runtime to evolve. This file separates what is guaranteed from what is implementation detail.

---

## The `go` Statement (Language Spec)

From `https://go.dev/ref/spec#Go_statements`:

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or *goroutine*, within the same address space.
>
> ```
> GoStmt = "go" Expression .
> ```
>
> The expression must be a function or method call; as with the `defer` statement, parentheses around a built-in function are not allowed for purposes of disambiguation.
>
> The function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete. Instead, the function begins executing independently in a new goroutine. When the function terminates, its goroutine also terminates. If the function has any return values, they are discarded when the function completes.

Key normative points:

1. The argument must be a *call expression*. `go x` (where `x` is a function value) is invalid; it must be `go x()`.
2. Arguments are evaluated **in the caller**, before the goroutine starts.
3. Return values are discarded.
4. The new goroutine runs *in the same address space* — it shares all globals and heap with all other goroutines.

### Examples from the spec

```go
go Server()
go func(ch chan<- bool) { for { sleep(10); ch <- true } }(c)
go server.Serve(listener)
```

Invalid:

```go
go x        // x must be a call
go { f() }  // a block is not a call
go (f)()    // parentheses around the function call are allowed
```

---

## Goroutine Termination

A goroutine terminates when:

1. The function it was spawned with returns normally.
2. An unrecovered panic propagates out of the function. **In this case, the entire program terminates** — not just the goroutine. This is specified in *Handling panics*: "If a panic occurs and is not recovered, the runtime terminates the program."
3. The program calls `runtime.Goexit`, which terminates the goroutine after running deferred functions.

`runtime.Goexit` is a less commonly used escape:

```go
func runtime.Goexit()
```

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine. Because Goexit is not a panic, any recover calls in those deferred functions will return nil.
>
> Calling Goexit from the main goroutine terminates that goroutine without `func main` returning. Since `func main` has not returned, the program continues execution of other goroutines. If all other goroutines exit, the program crashes.

### Behaviour when `main` returns

The spec says:

> Program execution begins by initializing the main package and then invoking the function `main`. When that function invocation returns, the program exits. It does not wait for other (non-main) goroutines to complete.

This is unconditional. Spawned goroutines that have not finished are abandoned mid-execution.

---

## The Memory Model

The Go memory model (`https://go.dev/ref/mem`) defines a *happens-before* relation. Without a happens-before relationship, one goroutine has *no guarantee* of seeing another's writes.

### Synchronisation primitives that establish happens-before

| Operation | Establishes |
|---|---|
| `go` statement | The body of the new goroutine happens-after the `go` statement (and after evaluation of its arguments). |
| Channel send / receive | A send on a channel happens-before the corresponding receive completes. |
| Channel close | The close of a channel happens-before a receive that returns because the channel is closed. |
| `sync.Mutex.Lock` / `Unlock` | Each `Unlock` happens-before the next successful `Lock`. |
| `sync.WaitGroup.Wait` | All `Done` calls happen-before any `Wait` call returns. |
| `sync.Once.Do(f)` | `f`'s return happens-before any `Do` returns. |
| `sync/atomic` operations | Sequentially consistent across atomic operations on the same memory. |

### Without synchronisation, anything goes

Two goroutines reading and writing the same variable without synchronisation produce a **data race**. The behaviour is undefined: the read may see torn writes, stale values, or values that never existed in source order. The race detector is the only way to find these reliably.

### A small canonical example

```go
var a string
var done bool

func setup() {
    a = "hello"
    done = true
}

func main() {
    go setup()
    for !done {}     // race; may loop forever
    print(a)         // race; may print empty
}
```

Without `sync`, `atomic`, or channel synchronisation, the writer's `a = "hello"` and `done = true` may be observed in any order — or not at all — by the reader. The "fix" is to communicate via a channel, mutex, or atomic.

---

## Runtime Guarantees and Non-Guarantees

### Guaranteed

- A spawned goroutine *will eventually* run if it is runnable and there is sufficient CPU and no halt of the program.
- A blocked goroutine *will* be resumed when its blocking condition is resolved (channel ready, mutex available, syscall returns).
- An unrecovered panic in any goroutine terminates the program (after deferred functions in the panicking goroutine run).
- `runtime.Goexit` runs deferred functions before exiting the goroutine.
- The number of goroutines that may run *concurrently* (in parallel) is bounded by `GOMAXPROCS`.
- Stacks grow as needed up to the configured limit.

### Not Guaranteed

- The **order** in which spawned goroutines start running.
- The **timing** of when a goroutine starts after `go` is executed.
- Whether two goroutines run on the same OS thread.
- Which OS thread a goroutine runs on (it may move between threads, except `LockOSThread`).
- The frequency or order of preemption.
- The exact size of the runtime's run queues, free lists, or sysmon period.
- The numeric value of `goid` (and the API to read it is intentionally absent).
- Whether `runtime.Gosched` actually yields (it is a hint).

The runtime's scheduler is allowed to evolve significantly between Go versions without breaking the language guarantee.

---

## `runtime` Package APIs

Selected exported APIs from `pkg.go.dev/runtime`:

### `runtime.NumGoroutine() int`

> NumGoroutine returns the number of goroutines that currently exist.

### `runtime.GOMAXPROCS(n int) int`

> GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously and returns the previous setting. If n < 1, it does not change the current setting.

Pass `0` to read without changing.

### `runtime.NumCPU() int`

> NumCPU returns the number of logical CPUs usable by the current process. The set of available CPUs is checked by querying the operating system at process startup. Changes to operating system CPU allocation after process startup are not reflected.

### `runtime.Gosched()`

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

### `runtime.Goexit()`

> Goexit terminates the goroutine that calls it. No other goroutine is affected.

### `runtime.LockOSThread()` and `runtime.UnlockOSThread()`

> LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread.

Required for code that interacts with thread-local OS state (OpenGL, certain `cgo` libraries, signal handling).

### `runtime.Stack(buf []byte, all bool) int`

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written to the buffer. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

### `runtime.SetFinalizer(obj any, finalizer any)`

Schedules a finalizer to run in a goroutine when the GC determines `obj` is unreachable. Finalizers always run in their own goroutine.

### `runtime/debug.SetMaxStack(bytes int) int`

Sets the maximum amount of memory that can be used by a single goroutine's stack. Default is 1 GB on 64-bit.

### `runtime/debug.SetGCPercent(percent int) int`

Indirectly affects scheduler behaviour by changing GC frequency.

---

## Scheduler Behaviour Across Versions

Selected milestones (see release notes for full details):

| Go version | Change |
|---|---|
| 1.0 | Cooperative scheduler; preemption only at function-call safe points. |
| 1.1 | Scheduler rewritten with `M:N` model and `P` abstraction. |
| 1.2 | Preemption added at function entry (on call to morestack). |
| 1.4 | Concurrent GC; scheduler integrates with GC marking. |
| 1.5 | `GOMAXPROCS` defaults to `NumCPU` (was 1). |
| 1.14 | **Asynchronous preemption** via signals — tight loops are now preemptable. |
| 1.16 | `GOMAXPROCS` respects Linux cgroup CPU quota. |
| 1.18 | Generics — does not affect scheduler. |
| 1.21 | Goroutine creator's PC stored in `g.parentGoid`; better stack traces. |
| 1.22 | `for` loop variable scope changed — fixes captured-variable bug in goroutines. |
| 1.24 | `testing/synctest` (experimental) — deterministic scheduler for tests. |

### What the spec promises across versions

The Go 1 compatibility promise (`https://go.dev/doc/go1compat`) commits to source compatibility for *language and standard library*. The internal scheduler is explicitly **not** part of the promise — it can change behaviour as long as observable language semantics hold.

---

## Stack Sizes and Limits

From the runtime documentation and source:

| Quantity | Value | Notes |
|---|---|---|
| Initial stack size | 2 KB | Since Go 1.4. |
| Maximum stack size (64-bit) | 1 GB | Default; settable via `debug.SetMaxStack`. |
| Maximum stack size (32-bit) | 250 MB | Default. |
| Growth strategy | Double on overflow | Copying GC. |
| Shrink threshold | 1/4 used | Conservative. |

Hitting the maximum causes:

```
runtime: goroutine stack exceeds 1000000000-byte limit
fatal error: stack overflow
```

Almost always means runaway recursion.

---

## Cooperative vs Asynchronous Preemption

### Pre-Go 1.14: cooperative

A goroutine could only be preempted at a function-call safe point. The compiler emitted a stack-bound check at function entry; if `g.preempt == true`, the runtime descheduled the G.

This meant:

```go
for { /* no calls inside */ }
```

was uninterruptable. The Go runtime would never preempt it. With `GOMAXPROCS=1`, the entire program froze.

### Go 1.14+: asynchronous preemption

The runtime sends a POSIX signal (`SIGURG` on Linux/macOS, custom thread mechanisms on Windows) to the M running a goroutine that has been on-CPU too long. The signal handler arranges for the goroutine to resume in a state where the runtime can deschedule it.

Implementation is in `runtime/preempt.go`. Documented in design doc 24543: *Non-cooperative goroutine preemption*.

Effect on user code: tight loops are now safe. Most production code does not need to add `runtime.Gosched` calls anywhere.

---

## `GODEBUG` Knobs

Environment variables that control runtime behaviour. Useful for diagnostics; **not** part of the Go 1 compatibility promise.

| Knob | Effect |
|---|---|
| `GODEBUG=schedtrace=1000` | Print scheduler statistics every 1000 ms. |
| `GODEBUG=scheddetail=1` | When `schedtrace` is on, also print per-G/per-M/per-P detail. |
| `GODEBUG=gctrace=1` | Print GC events; affects scheduling indirectly. |
| `GODEBUG=asyncpreemptoff=1` | Disable asynchronous preemption (debugging only). |
| `GODEBUG=allocfreetrace=1` | Print stack traces for allocations and frees (very chatty). |
| `GODEBUG=cgocheck=2` | Enable thorough checks for invalid passing of pointers across cgo. |
| `GOMAXPROCS=N` | Set GOMAXPROCS at program start. |
| `GOTRACEBACK=all` | On panic, print stacks of all goroutines (default is current only). |
| `GOTRACEBACK=crash` | On panic, dump core in addition to printing stacks. |

`GODEBUG` is documented at `https://pkg.go.dev/runtime#hdr-Environment_Variables`.

---

## References

- **Go Language Specification** — `go` statements: <https://go.dev/ref/spec#Go_statements>
- **The Go Memory Model**: <https://go.dev/ref/mem>
- **`runtime` package**: <https://pkg.go.dev/runtime>
- **The Go 1 compatibility promise**: <https://go.dev/doc/go1compat>
- **Design doc: Non-cooperative goroutine preemption** (Austin Clements): <https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md>
- **Scheduler tracer documentation**: <https://github.com/golang/go/blob/master/src/runtime/HACKING.md>
- **`runtime/proc.go`** in Go source — the heart of the scheduler: <https://github.com/golang/go/blob/master/src/runtime/proc.go>
- **The Go scheduler** (Dmitry Vyukov, original design doc): <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/>
- **GopherCon 2020 — Pardon the Interruption: Loop Preemption in Go 1.14** (Austin Clements): <https://www.youtube.com/watch?v=1I1WmeSjRSw>
