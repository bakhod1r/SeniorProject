# Goroutine Lifecycle — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Go Language Specification Says](#what-the-go-language-specification-says)
3. [What the `runtime` Package Documents](#what-the-runtime-package-documents)
4. [What the Memory Model Says](#what-the-memory-model-says)
5. [Guaranteed Behavior](#guaranteed-behavior)
6. [Implementation-Defined Behavior](#implementation-defined-behavior)
7. [Unspecified Behavior](#unspecified-behavior)
8. [Version Differences](#version-differences)
9. [Summary](#summary)

---

## Introduction

This document separates **specification** (what the language and standard library *guarantee*) from **implementation** (what Go currently does, but might change). When you read pretty diagrams of goroutine state machines, much of that is implementation. The actual specification gives you a much smaller surface to depend on.

This matters when you write portable code, when you target alternative Go implementations (TinyGo, gccgo), or when you reason about what the *language* requires versus what the *current* runtime delivers.

---

## What the Go Language Specification Says

The [Go specification](https://go.dev/ref/spec) addresses goroutines only briefly. The full relevant section, "Go statements":

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or *goroutine*, within the same address space.
>
> ```
> GoStmt = "go" Expression .
> ```
>
> The expression must be a function or method call; as with defer statements, parentheses around a call expression are not allowed. Calls of built-in functions are restricted as for expression statements.
>
> The function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete. Instead, the function begins executing independently in a new goroutine. When the function terminates, its goroutine also terminates. If the function has any return values, they are discarded when the function completes.

This is the entire specified lifecycle:

1. The `go` statement's arguments are evaluated in the calling goroutine.
2. A new goroutine is created and begins executing.
3. When the function terminates, the goroutine terminates.

Nothing else about lifecycle is in the language specification. Everything else — runqueues, parking, the `g` struct, even `runtime.Goexit` — is the *runtime*, not the language.

### Implicit but specified

- **Concurrency, not parallelism.** Whether two goroutines run truly in parallel is not specified; it depends on `GOMAXPROCS`.
- **No goroutine identity.** The language defines no `goroutine.ID()` or similar.
- **Termination by panic.** From "Run-time panics": "If the panic ... results in the program terminating before any deferred call... has finished, ..." — implying panics terminate the goroutine.

### What is *not* in the spec

- The states (`_Grunnable`, `_Gwaiting`, etc.) — implementation.
- The `g` struct — implementation.
- The `g` free list — implementation.
- Async preemption semantics — implementation (since Go 1.14).
- Stack initial size and growth — implementation.
- `runtime.NumGoroutine`, `runtime.Goexit`, etc. — part of the *standard library*, not the language.

---

## What the `runtime` Package Documents

The `runtime` package documentation ([pkg.go.dev/runtime](https://pkg.go.dev/runtime)) defines several lifecycle-relevant functions. These are *standard library* guarantees, somewhat more stable than runtime internals but still subject to change.

### `func Goexit()`

> Goexit terminates the goroutine that calls it. No other goroutine is affected. Goexit runs all deferred calls before terminating the goroutine. Because Goexit is not a panic, any recover calls in those deferred functions will return nil.
>
> Calling Goexit from the main goroutine terminates that goroutine without func main returning. Since func main has not returned, the program continues execution of other goroutines. If all other goroutines exit, the program crashes.

Guarantees:

- Deferred calls run.
- `recover` in deferred calls returns `nil`.
- Other goroutines are unaffected.
- `Goexit` from main does not return from main; program continues until all goroutines exit.

### `func NumGoroutine() int`

> NumGoroutine returns the number of goroutines that currently exist.

Guarantee: returns a snapshot of the count. The count may change immediately after.

### `func Stack(buf []byte, all bool) int`

> Stack formats a stack trace of the calling goroutine into buf and returns the number of bytes written to buf. If all is true, Stack formats stack traces of all other goroutines into buf after the trace for the current goroutine.

Guarantee: dumps the current goroutine's stack (and others if requested). No guarantee that the dump is consistent — other goroutines may be running.

### `func Gosched()`

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

Guarantee: a hint to the scheduler. The current goroutine resumes "soon."

### `func GoroutineProfile(p []StackRecord) (n int, ok bool)`

> GoroutineProfile returns n, the number of records in the active goroutine stack profile. If len(p) >= n, GoroutineProfile copies the profile into p and returns n, true.

Guarantee: snapshot of every live goroutine's stack.

### `func SetFinalizer(obj any, finalizer any)`

> The argument obj must be a pointer to an object allocated by calling new, by taking the address of a composite literal, or by taking the address of a local variable. ... SetFinalizer arranges to call f when the object that obj refers to has become unreachable. ... Finalizers are run in dependency order: if A points at B, both A and B have finalizers, and they are otherwise unreachable, only the finalizer for A runs; once A is freed, the finalizer for B can run.

Lifecycle guarantees:

- Finalizers run *before* the GC reclaims the object.
- They run on their own goroutine.
- They are *not* guaranteed to run before program exit.

### `func LockOSThread()` / `func UnlockOSThread()`

> LockOSThread wires the calling goroutine to its current operating system thread. ... If the calling goroutine exits without unlocking the thread, the thread will be terminated.

Guarantee:

- The goroutine runs on a single OS thread for the duration of the lock.
- If the goroutine dies while locked, the thread is terminated.

---

## What the Memory Model Says

The [Go memory model](https://go.dev/ref/mem) addresses lifecycle indirectly:

### Goroutine creation

> The `go` statement that starts a new goroutine *happens before* the goroutine's execution begins.

So when you write:

```go
x := 1
go f() // f reads x
```

`f` is guaranteed to see `x == 1`. The argument evaluation in the parent happens-before `f` starts.

### Goroutine termination

> The exit of a goroutine is *not* guaranteed to happen before any event in the program.

In other words, the program does not block waiting for goroutines to finish. You must arrange a synchronization (channel, `WaitGroup`, etc.) to observe a goroutine's exit.

### `sync.WaitGroup`

> A call to `wg.Wait()` returning is happens-before-by all the `wg.Done()` calls.

So if you `wg.Done()` at the end of a goroutine and `wg.Wait()` in the parent, anything written before `Done` is observable after `Wait`.

### Channel close

> The closing of a channel happens-before a receive that returns because the channel is closed.

So receivers see all sends that happened before the close, plus the close itself.

---

## Guaranteed Behavior

The following are guaranteed by the spec or library docs:

1. **`go f(x)` evaluates `x` in the caller before the new goroutine starts.**
2. **The new goroutine begins executing `f`.** No timing guarantee on when.
3. **When `f` returns, the goroutine terminates.** Return values are discarded.
4. **`runtime.Goexit` runs all deferred functions of the current goroutine and terminates it.**
5. **An unrecovered panic terminates the goroutine, runs deferred functions, and (if the panic propagates out) terminates the program.**
6. **`recover` inside a deferred function called during panic stops the panic.**
7. **A locked OS thread (via `LockOSThread`) is destroyed when the locked goroutine dies without unlocking.**
8. **Finalizers run on fresh goroutines, in dependency order, but are not guaranteed to run before program exit.**
9. **The main goroutine returning from `main()` terminates the program.**

---

## Implementation-Defined Behavior

The following are *currently* true in the standard Go runtime, but the language spec does not require them:

1. **Stack starts at 2 KB and grows.** TinyGo uses different sizes. The spec only requires that goroutine stacks can grow.
2. **The runtime uses a GMP scheduler.** gccgo previously used a different scheduler.
3. **Goroutines are multiplexed onto OS threads.** True everywhere but conceptually not required — a Go implementation could pin goroutines to threads.
4. **Dead `g` structs are pooled and reused.** Optimization; not visible to user code except via `runtime.NumGoroutine` snapshots.
5. **Async preemption since Go 1.14.** Before 1.14, only cooperative preemption.
6. **The `_Gwaiting`, `_Grunnable`, etc. state names.** Internal.
7. **`GOMAXPROCS` defaulting to NumCPU.** Documented but tunable.
8. **The exact set of "system" goroutines** (GC, sysmon, finalizer) is implementation-defined.

---

## Unspecified Behavior

Things the spec explicitly does *not* define:

1. **Order of execution.** Two goroutines running on a single thread may interleave in any order.
2. **Time to start.** A `go f()` may start immediately, in a microsecond, or much later.
3. **Time of `gFree` reclamation.** Dead `g` structs may be reused immediately or after a delay.
4. **Goroutine identity.** No public ID, no name, no parent-child API.
5. **Behavior of `runtime.Gosched`.** Hint only; the runtime may ignore it.
6. **When finalizers actually fire.** Often during GC, but not guaranteed before program exit.
7. **Interaction with signals.** Some signals are delivered to specific goroutines, others to the process. The mapping is OS-specific.

Code that depends on unspecified behavior is brittle. Examples of brittle assumptions:

- "If I spawn 100 goroutines, they all start within 1 ms."
- "If two goroutines do `ch <- x` in different orders, the receiver reads them in that order."
- "After `wg.Wait()`, `runtime.NumGoroutine` equals the baseline."

The last one is *almost* true but has a small race window because the scheduler may not have transitioned all `g`s to `_Gdead` by the moment `Wait` returns. Tests should give a small grace period (10-100 ms).

---

## Version Differences

| Go version | Lifecycle change |
|---|---|
| 1.0 | Basic spec stable. Cooperative preemption only. |
| 1.5 | `GOMAXPROCS` defaults to `NumCPU` (was 1 before). |
| 1.14 | Async preemption. The `_Gpreempted` state added. |
| 1.18 | Generic functions can be passed to `go`. |
| 1.20 | `parentGoid` field added to `g` for profiling. |
| 1.21 | `goroutine` `pprof` profile includes "created by" stack with goid. The loop-variable scoping (per-iteration) introduced experimentally. |
| 1.22 | Loop variable scoping made default. Each iteration of `for ... range` and `for i := ...` creates a fresh variable per iteration. |
| 1.24 | `runtime.AddCleanup` introduced as the modern replacement for `SetFinalizer`. |
| 1.25 (planned) | `runtime.GoroutineProfile` produces richer parent/creator info. |

Loop variable scoping is the lifecycle-relevant change. Before 1.22:

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }() // all see i = 3 after loop
}
```

In 1.22+, each iteration gets a fresh `i`, so each goroutine prints its own value.

---

## Summary

The Go language specification says very little about goroutine lifecycle: `go` starts a goroutine, the function executes independently, the goroutine ends when the function returns. The `runtime` package documents a small set of lifecycle-related functions: `Goexit`, `NumGoroutine`, `Stack`, `Gosched`, `LockOSThread`, `SetFinalizer`. The memory model establishes happens-before relations for goroutine creation, channel operations, and `WaitGroup` synchronization.

Everything else — state names, the `g` struct, the free list, async preemption mechanics, the GMP scheduler, exact stack sizing — is implementation-defined. The current standard Go runtime implements all of it consistently, but the language does not require any of it.

When writing portable, durable Go code, lean on the specified behavior:

- `go f(x)` evaluates `x` in the parent, then starts `f`.
- A goroutine ends when its function returns, panics out, or calls `Goexit`.
- Use channels, `WaitGroup`, `errgroup`, and `context.Context` for synchronization.
- Do not assume execution order or precise timing.
- Use the memory model's happens-before relations to reason about visibility.

For deeper runtime details, see [professional.md](professional.md).
