# Goroutine Common Pitfalls — Specification

> Focus: which pitfalls the Go specification *prevents*, which it *permits*, and which lie in the gap between "well-formed program" and "correct program."

## Table of Contents
1. [What the spec is and is not](#what-the-spec-is-and-is-not)
2. [The Go statement](#the-go-statement)
3. [The memory model](#the-memory-model)
4. [Channel semantics](#channel-semantics)
5. [Map semantics](#map-semantics)
6. [Panic, recover, and the goroutine boundary](#panic-recover-and-the-goroutine-boundary)
7. [Loop variable semantics across versions](#loop-variable-semantics-across-versions)
8. [`sync` package contracts](#sync-package-contracts)
9. [`runtime` package guarantees](#runtime-package-guarantees)
10. [Implementation-defined vs spec-defined](#implementation-defined-vs-spec-defined)
11. [Summary](#summary)

---

## What the spec is and is not

The Go Programming Language Specification (<https://go.dev/ref/spec>) and the Go Memory Model (<https://go.dev/ref/mem>) define what the language *guarantees*. They do not define what is *idiomatic*, what is *safe in practice*, or what is *easy to misuse*. Many pitfalls in this subsection are spec-compliant: the language permits the code, the compiler accepts it, the runtime runs it. The pitfall is that the *behaviour* the developer assumed is not what the spec promises.

This file walks the spec sections relevant to each pitfall family, noting where the spec is silent and where the contract lives in convention rather than text.

---

## The Go statement

From the Go specification, "Go statements":

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or goroutine, within the same address space.
>
> ```
> GoStmt = "go" Expression .
> ```
>
> The expression must be a function or method call; as with defer statements, parentheses around a call are not allowed. Calls of built-in functions are restricted as for expression statements.
>
> The function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete. Instead, the function begins executing independently in a new goroutine. When the function terminates, its goroutine also terminates. If the function has any return values, they are discarded when the function completes.

Pitfalls this section informs:

### 1. Argument evaluation order

`go f(getValue())` runs `getValue()` in the *parent* goroutine, before the new goroutine starts. If `getValue` is slow, `go` is slow.

### 2. Closure captures bind to variables, not values

Until Go 1.22, the loop variable was a single variable per loop. Closures referenced *that variable*, not its value at capture time. The spec was clear; the behaviour was a frequent source of bugs. The 1.22 change made each iteration introduce a fresh variable.

### 3. Return values are discarded

`go f()` discards `f`'s return values. There is no language-level mechanism to retrieve them. Channels, `sync` primitives, or shared variables are required — all of which are user-space constructs.

### 4. The spawning function does not wait

The parent goroutine does not block on `go f()`. The spec gives no implicit synchronisation between parent and child. Pitfalls in this family (the captured-variable bug, the `wg.Add` race) stem from assuming an ordering the spec does not provide.

---

## The memory model

The Go Memory Model defines *happens-before*: the conditions under which one goroutine's writes are visible to another goroutine's reads. Most concurrency pitfalls are memory-model violations dressed up as application bugs.

Key clauses (paraphrased, with citation):

### Happens-before is intra-goroutine sequential

> Within a single goroutine, the happens-before order is the order expressed by the program.

A single goroutine sees its own writes in program order. The spec does not require this for cross-goroutine observation.

### Synchronisation is established by specific operations

The spec enumerates the operations that synchronise across goroutines:

- `chan` send/receive
- `chan` close / receive-after-close
- `sync.Mutex.Lock`/`Unlock`
- `sync.RWMutex` operations
- `sync.WaitGroup` `Wait`/`Add`/`Done`
- `sync.Once.Do`
- `sync/atomic` operations
- `runtime.SetFinalizer`

Operations *not* on this list — `time.Sleep`, `runtime.Gosched`, `runtime.NumGoroutine` — do not synchronise. The pitfall "I added a `Gosched`, so now the read is safe" is a memory-model violation.

### Init is special

> The completion of init() runs in a single goroutine that happens before the start of any goroutine created by it.

This is why a package-level variable initialised in `init` is safe to read from any goroutine — the init's writes happen-before any later goroutine starts.

### Race-free programs are sequentially consistent

The Go 1.19 memory model update (<https://go.dev/ref/mem>) added: race-free programs behave as if all memory accesses were sequentially consistent. Race-ful programs have *no* defined behaviour.

This is the formal underpinning of "the race detector is finding real bugs." A race is not a "performance issue" — it is undefined behaviour by the spec.

---

## Channel semantics

From the spec:

> Sending on or closing a closed channel causes a run-time panic.
>
> A send on a nil channel blocks forever. A receive from a nil channel blocks forever.
>
> The capacity, in number of elements, sets the size of the buffer in the channel. If the capacity is zero or absent, the channel is unbuffered and communication succeeds only when both a sender and receiver are ready. Otherwise, the channel is buffered and communication succeeds without blocking if the buffer is not full (sends) or not empty (receives).
>
> A nil channel is never ready for communication.

Pitfalls this section anchors:

### Double close, send on closed → spec-defined panics

The spec mandates the panic. Tools detect it; recover handles it. The pitfall is *reaching* the state, not the language's reaction to it.

### Nil channel blocks forever

Spec-defined. The pitfall is unintentional nil — typically from forgetting to initialise a channel field. Bugs of the form "select never fires" often have a nil case.

### Capacity bounds the buffer, not the senders

A buffered channel does not limit the number of goroutines that can be *sending*. They are queued in the runtime's wait list. The pitfall: developers assume buffer size N means at most N senders pending. In fact, any number of senders can be blocked.

### `range ch` exits only on close

Spec-defined. The receiver cannot tell "channel is empty for now" from "channel is empty forever, sender exited." Closing is the only signal. The pitfall: forgetting to close. The fix: single-closer pattern.

---

## Map semantics

From the spec:

> The comparison operators == and != must be fully defined for operands of the key type; thus the key type must not be a function, map, or slice. If the key type is an interface type, these comparison operators must be defined for the dynamic key values; failure will cause a run-time panic.

And, from the runtime documentation:

> Maps are not safe for concurrent use: it's not defined what happens when you read and write to them simultaneously. If you need to read from and write to a map from concurrently executing goroutines, the accesses must be mediated by some kind of synchronization mechanism. Common ways to protect maps are sync.RWMutex and sync.Map.

The runtime adds *explicit checks* for concurrent map writes (`fatal error: concurrent map writes`). This is implementation-level; the spec leaves the behaviour undefined and the runtime helpfully aborts to surface the bug.

The pitfall: assuming "the program crashed" is recoverable. It is not — `fatal error` is below the panic level and `recover` does not catch it.

---

## Panic, recover, and the goroutine boundary

From the spec, "Handling panics":

> The recover built-in function allows a program to manage behavior of a panicking goroutine. [...] The return value of recover is nil if any of the following conditions holds: panic's argument was nil; the goroutine is not panicking; recover was not called directly by a deferred function.

Two consequences relevant to pitfalls:

### `recover` is per-goroutine

Panicking goroutine A's panic cannot be caught by goroutine B's `recover`. Each goroutine that runs untrusted code must install its own `defer recover`.

The spec is explicit: panicking a goroutine without a recovery in *that goroutine's* defer chain terminates the entire program.

### `recover` must be inside `defer`

`recover` called outside a deferred function returns `nil` always. The deferred-call requirement is part of the language definition, not a convention.

### Some runtime errors are not recoverable

Fatal errors like `concurrent map writes`, `stack overflow`, and certain runtime corruption are not `panic`s. They bypass `recover`. The spec defers this to the implementation: "Run-time errors such as ... cause a run-time panic" — but the *runtime* distinguishes some errors as fatal.

---

## Loop variable semantics across versions

Pre-Go 1.22 (per the spec at that time):

> For statements with for clause: the init statement may be a short variable declaration, but the post statement must not. Variables declared by the init statement are re-used in each iteration.

The phrase "re-used in each iteration" is the source of the captured-loop-variable bug. A single variable, captured by reference, mutated each iteration.

Go 1.22 changed the spec (and the language version-gating):

> If a "for" statement declares variables in its init clause using the short declaration form, the scope of each declared variable is one iteration of the loop. That is, each iteration has its own instance of those variables.

This is a *language change* affecting program semantics. Code compiled with `go 1.22` or later sees per-iteration variables; code compiled with earlier `go.mod` directives sees the old semantics. The `go.mod` file's `go` directive is the version selector.

Pitfall: relying on "1.22 fixed it" without checking that all build targets are on 1.22+. A `go 1.21` `go.mod` file produces 1.21 semantics even on a 1.22 toolchain.

---

## `sync` package contracts

The `sync` package documents many constraints that are pitfall fences.

### `sync.WaitGroup`

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time. Typically this means the calls to Add should execute before the statement creating the goroutine or other event to be waited for.

The "must happen before a Wait" is what makes `wg.Add(1)` inside the goroutine wrong. The spec-level statement is the foundation for the pitfall.

### `sync.Mutex`

> A Mutex must not be copied after first use.

`go vet`'s `copylocks` check catches this. Copying a mutex creates a separate lock — both can be "held" simultaneously, defeating the purpose.

### `sync.Once`

> Do calls f if and only if Do is being called for the first time for this instance of Once.

Concurrent calls to `Once.Do` block all but the first until `f` returns. After `f` returns, subsequent calls return immediately. The pitfall: assuming `Do` is idempotent for arbitrary `f` — it is, but `f` may have side effects (like setting a global with stale config) that the second caller silently inherits.

### `sync.Pool`

> Get may choose to ignore the pool and treat it as empty. Callers should not assume any relation between values passed to Put and the values returned by Get.

`sync.Pool` may discard objects at any time (typically at GC). The pitfall: using a `sync.Pool` as a connection pool. Connections are dropped unpredictably.

### `sync.Map`

> Map is like a Go map[interface{}]interface{} but is safe for concurrent use by multiple goroutines without additional locking or coordination. Loads, stores, and deletes run in amortized constant time.
>
> The Map type is specialized. Most code should use a plain Go map instead, with separate locking or coordination, for better type safety and to make it easier to maintain other invariants along with the map content.
>
> The Map type is optimized for two common use cases: (1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys. In these two cases, use of a Map may significantly reduce lock contention compared to a Go map paired with a separate Mutex or RWMutex.

The pitfall: assuming `sync.Map` is a drop-in faster map. It is *slower* outside its two specialised use cases.

---

## `runtime` package guarantees

### `runtime.LockOSThread`

From the docs:

> LockOSThread wires the calling goroutine to its current operating system thread. The calling goroutine will always execute in that thread, and no other goroutine will execute in it, until the calling goroutine has made as many calls to UnlockOSThread as to LockOSThread. If the calling goroutine exits without unlocking the thread, the thread will be terminated.

This is the spec-level basis for the "M leaks via cgo" pitfall. The runtime *will* destroy the M if a pinned goroutine exits unlocked. Whether this is a leak depends on whether you wanted thread reuse.

### `runtime.Gosched`

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

The docs explicitly state: yield only. No memory barrier. No "wait for X." Pitfalls that use `Gosched` as a synchronisation primitive are misreading the docs.

### `runtime.NumGoroutine`

> NumGoroutine returns the number of goroutines that currently exist.

That is the entire guarantee. No information about *which* goroutines, *what* they are doing, or how they relate. Pitfalls in observability (using `NumGoroutine` for SLOs without supplementary detail) read more into the API than the docs promise.

### `runtime.GOMAXPROCS`

> GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously and returns the previous setting. It defaults to the value of runtime.NumCPU. If n < 1, it does not change the current setting.

The default is `NumCPU`, *not* cgroup-aware until Go 1.16+. This explains the misconfigured-container pitfall.

---

## Implementation-defined vs spec-defined

Some pitfalls are implementation-defined: they depend on the Go runtime, not the language spec. Examples:

- Goroutine stack size (~2 KB initial, doubling growth).
- Scheduler implementation (GMP).
- The exact moment of async preemption.
- The garbage collector's pacing.
- M creation policy.

A program that works on the Go runtime may or may not work on TinyGo or gccgo. The pitfall: assuming spec compliance is enough. For production Go, you usually pin to the official runtime, but be aware that some properties are not language-level.

---

## Summary

The Go specification draws a sharp line: it defines what is *possible to express* and *required for valid programs*. Most goroutine pitfalls live *above* this line — they are spec-compliant programs that violate the developer's mental model. The spec did not promise the captured loop variable would behave the way the developer expected (it explicitly stated "re-used in each iteration"). The spec did not promise `wg.Add` inside the goroutine would race with `Wait` (it documented that `Add` "must happen before a Wait"). The spec did not promise `time.Sleep` would synchronise (the memory model does not list it among synchronising operations).

The result: pitfall-prone Go is rarely "buggy" in the spec sense. It is unsafe in the *contract* sense. The cure is reading the spec — and reading the docs of `sync`, `runtime`, and `context` — and writing code that matches what the docs promise, not what the docs sound like.
