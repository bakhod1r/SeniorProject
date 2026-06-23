# Iterators & Range-over-Func — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Compiler Transform, Step by Step](#the-compiler-transform-step-by-step)
3. [Non-Local Control Flow: How `break`/`return`/`goto` Are Compiled](#non-local-control-flow-how-breakreturngoto-are-compiled)
4. [The `#stateVar` and the Two Runtime Panics](#the-statevar-and-the-two-runtime-panics)
5. [`iter.Pull` Internals: Coroutines](#iterpull-internals-coroutines)
6. [Inlining and the Zero-Allocation Path](#inlining-and-the-zero-allocation-path)
7. [The GOEXPERIMENT=rangefunc History](#the-goexperimentrangefunc-history)
8. [The `go` Directive Gating Mechanism](#the-go-directive-gating-mechanism)
9. [Escape Analysis and Closure Allocation](#escape-analysis-and-closure-allocation)
10. [Standard-Library Implementation Notes](#standard-library-implementation-notes)
11. [Edge Cases the Spec and Source Reveal](#edge-cases-the-spec-and-source-reveal)
12. [Operational Playbook](#operational-playbook)
13. [Summary](#summary)

---

## Introduction

The professional level treats range-over-func as a *compiler rewrite plus a runtime contract*, not a library feature. `for x := range f` is not interpreted at runtime; the compiler in the `cmd/compile/internal/rangefunc` package transforms each such loop into an explicit call to `f` with a synthesised closure, plus state machinery to make non-local control flow (`break`, `return`, labelled jumps) work across the function boundary. Misunderstanding that rewrite is the source of every "why did this panic" and "why did this allocate" question.

This file is for engineers who own the performance and correctness of iterator-heavy code, write iterator libraries, or need to reason precisely about what the toolchain emits. After reading you will:
- Know what `for x := range f` is rewritten into, in pseudocode
- Understand the state variable and predict both runtime panics exactly
- Know how `iter.Pull` uses the runtime coroutine primitive (`runtime.newcoro`)
- Reason about inlining and when iterators are truly zero-allocation
- Recount the 1.22 experiment → 1.23 GA history and the `go`-directive gate
- Debug allocation and leak issues from first principles

---

## The Compiler Transform, Step by Step

When the front end encounters a range over a function value of type `func(func(K, V) bool)` (or the 0/1-parameter variants), it does not lower it like a slice range. Instead, the `rangefunc` rewriter restructures the loop body into a closure and calls the iterator.

Conceptually, `for x := range f { Body }` becomes:

```go
{
    // #next encodes how the loop terminated; see next sections.
    var (
        #stateK = abi.RF_READY // runtime state guard
    )
    f(func(x V) bool {
        // ---- Body, with break/return/goto rewritten ----
        Body
        return true // normal completion of one iteration => continue
    })
    // post-loop fixups for non-local jumps
}
```

The real rewrite (in `cmd/compile/internal/rangefunc/rewrite.go`) is more elaborate. Key points:

1. **The loop body becomes the `yield` closure.** Its parameters are the loop variables. Returning `true` means "continue"; returning `false` means "stop."
2. **A state variable guards the closure.** The runtime uses it to detect calls to `yield` after the loop is logically over (the two panics in section 4).
3. **Per-iteration variable semantics (Go 1.22+) are preserved.** Each call to the closure binds fresh loop variables, so closures capturing `x` are safe.
4. **`defer`s in the *enclosing* function** still run at function return, even when a `return` happens inside the ranged body — handled by the non-local-control rewrite.

The transform is per-loop and local; it does not change the iterator function `f` at all. `f` is ordinary Go that happens to call its parameter.

---

## Non-Local Control Flow: How `break`/`return`/`goto` Are Compiled

The hard engineering problem is making `break`, `return`, `continue`, labelled jumps, and `goto` work when the body lives inside a closure passed to `f`. A naive "body returns a bool" cannot express "return from the *enclosing* function with value 7."

The rewriter solves this with a small state machine. Each non-local control statement in the body is replaced by:

1. Recording *what* should happen (continue, break, return-with-value, goto-label-N) in a synthesised state variable.
2. Returning `false` from the `yield` closure to stop the iterator.

After `f` returns (the iterator has unwound and run its `defer`s), generated code *after* the call inspects the state variable and performs the recorded action: it executes the real `return`, jumps to the label, or breaks the outer loop.

Concretely, `return 7` inside the body compiles to something like:

```go
f(func(x V) bool {
    ...
    #retval = 7
    #next   = RETURN
    return false        // stop the iterator first
})
if #next == RETURN {
    return #retval      // now actually return from the enclosing func
}
```

`continue` is the simple case: the closure returns `true` and nothing is recorded. `break` records "break" and returns `false`. Labelled `break`/`continue` to an outer loop, and `goto` to a label outside the range body, record the target and are dispatched after `f` returns. This is why a `return` inside a range-over-func body correctly runs the iterator's `defer`s *before* the enclosing function returns — the iterator unwinds first, the real return happens second.

The guarantee for users: control flow is *semantically identical* to a slice range. The cost is the synthesised state variable and the post-call dispatch — usually optimised away when the body has no non-local control.

---

## The `#stateVar` and the Two Runtime Panics

The runtime needs to detect two illegal situations, because the `yield` closure is only valid during `f`'s execution.

The rewriter allocates a per-loop state value (in practice an `int` flag updated by the closure and by post-loop code). The runtime's `panicrangestate` (and related helpers) check it.

### Panic 1 — "continued iteration after function for loop body returned false"

The closure has already returned `false` (the body broke/returned), but the iterator calls `yield` again. The state flag is in the "exhausted" state; the next `yield` call sees it and panics. This catches the iterator-author bug of not honouring the `if !yield(v) { return }` contract.

### Panic 2 — "continued iteration after whole loop exit"

`f` has already returned (the entire `for range` is over), but someone calls the captured `yield` afterwards — e.g. the iterator stashed `yield` in a goroutine or struct and invoked it later. The state flag is set to "done" when `f` returns; a subsequent `yield` panics.

Both panics are *defensive*: the closure captures loop state (locals, the state variable) whose lifetime ends when the loop ends. Calling it afterwards would read invalid state or violate the loop's invariants. The flag-and-check turns silent corruption into a clear panic.

Implication for library authors: `yield` must never escape the dynamic extent of the iterator call. Don't store it, don't hand it to a goroutine that outlives the call. If you need that pattern, you need `iter.Pull` (which is built exactly for safely advancing a producer on another goroutine).

---

## `iter.Pull` Internals: Coroutines

`iter.Pull` is implemented on top of the runtime *coroutine* primitive introduced for this feature: `runtime.newcoro`, `runtime.coroswitch`, `runtime.coroexit` (exposed to `iter` via `//go:linkname`-style internal hooks). A coroutine here is a goroutine that switches control cooperatively rather than being scheduled preemptively against its partner.

Roughly, `iter.Pull(seq)`:

1. Creates a coroutine that runs `seq(yield)`, where `yield` performs a `coroswitch` back to the consumer, parking the producer.
2. Returns `next` and `stop`:
   - `next()` does a `coroswitch` into the producer coroutine, runs it until its next `yield` (or completion), and returns the yielded value (or `ok=false`).
   - `stop()` switches into the producer with a flag that makes the in-flight `yield` return `false`, so the producer unwinds (`defer`s run) and the coroutine exits.

Why a coroutine rather than a plain goroutine + channel:

- **Lower overhead.** `coroswitch` is a direct stack switch between two specific goroutines, cheaper than a channel send/receive that goes through the scheduler's run queues.
- **No parallelism, by design.** The producer and consumer never run simultaneously; only one holds control. This preserves the single-threaded semantics of push iterators and avoids data races.
- **Deterministic handoff.** Exactly one step per `next()`.

The leak story falls directly out of this: a parked coroutine is a live goroutine pinned at `coroswitch`. If you never `stop()` and never drain, it is never resumed and never exits — a leak. `stop()` is the only way to resume-and-terminate an undrained producer. This is the runtime-level reason the must-call-`stop` rule exists.

---

## Inlining and the Zero-Allocation Path

The headline performance claim — "iterators are zero-allocation when inlined" — is precise and conditional.

### When it holds

For a simple `for v := range seq` where:
- `seq` is a concrete function (often inlinable), and
- the synthesised `yield` closure does not escape, and
- the iterator body is simple enough to inline,

the compiler inlines the iterator into the caller, inlines the `yield` closure, and the whole thing collapses into a plain loop. The `yield` closure is stack-allocated (or eliminated); no heap allocation occurs. Benchmarks show such loops matching hand-written slice loops.

### When it does not hold

Heap allocation or call overhead appears when:
- **The iterator is called through an interface or a `iter.Seq` variable** the compiler can't devirtualise. The closure may then escape and be heap-allocated.
- **The pipeline is deep or built dynamically** (a `[]func` of transforms). Each layer is a real closure call; inlining budgets are exceeded; closures escape.
- **The body or iterator is large** and exceeds the inliner's cost budget.
- **`yield` escapes** to the heap because the iterator stores or passes it somewhere the compiler must assume outlives the call.

### How to verify

```bash
go build -gcflags='-m' ./...        # inlining and escape decisions
go test -bench=. -benchmem ./...    # allocs/op
go build -gcflags='-m=2' ./...      # verbose inlining reasoning
```

`-m` will print `inlining call to ...` and `... escapes to heap` / `... does not escape`. An iterator on the hot path should show the closure not escaping and the iterator inlined. If `allocs/op` is non-zero on a loop you expect to be allocation-free, the escape analysis output tells you which closure escaped and why.

---

## The GOEXPERIMENT=rangefunc History

The feature shipped in two stages, which matters for reading older code and blog posts.

- **Go 1.22 (Feb 2024) — experiment.** Range-over-func was available only behind `GOEXPERIMENT=rangefunc`, with the package then called `iter` still being finalised. Code had to be built with `GOEXPERIMENT=rangefunc go build`, and the `go` directive needed to be `go 1.22`. This was an opt-in preview for feedback; not for production. The `iter` package's `Pull`/`Pull2` API and the runtime coroutine support were developed during this window.
- **Go 1.23 (Aug 2024) — GA.** The feature graduated. No experiment flag is needed. The `iter` package is part of the standard library. `slices` and `maps` gained the iterator helpers (`All`, `Values`, `Backward`, `Collect`, `Sorted`, `SortedFunc`, `Keys`). The feature is gated on the module's `go` directive being `1.23+`.

Practical consequences:
- Tutorials dated early-to-mid 2024 may reference `GOEXPERIMENT=rangefunc` — obsolete on 1.23+.
- Code written against the 1.22 experiment may use a slightly different `iter` API; re-check against [pkg.go.dev/iter](https://pkg.go.dev/iter).
- The runtime coroutine primitive (`newcoro`/`coroswitch`) landed to support `iter.Pull`; it is internal and not a public API.

---

## The `go` Directive Gating Mechanism

Range-over-func is gated by the *language version*, set by the `go` directive in `go.mod` and refinable per file.

- A module with `go 1.23` (or higher) in `go.mod` enables `for range f` in all its packages.
- A module with `go 1.22` (or lower) rejects `for range f` with a compile error, *even on a 1.23+ toolchain*. The toolchain reads the language version and applies the 1.22 rules to that module.
- Per-file overrides via a `//go:build go1.23` constraint affect build selection, but the language-version gate is the `go.mod` directive; you cannot enable a newer language feature in a module pinned to an older language version merely by build tags.
- Calling a function that *returns* `iter.Seq[T]` does not require 1.23 syntax — that is an ordinary function call. Only the `for range f` *syntax* needs language version 1.23. However, importing the `iter` package requires the 1.23 standard library.

This is the same mechanism that gated the 1.22 loop-variable scoping change: per-module language versioning lets the toolchain evolve the language without breaking modules that have not opted in. For toolchain owners, this is why a single `go` binary can compile both old and new modules correctly.

---

## Escape Analysis and Closure Allocation

The `yield` closure and the iterator function are the allocation-sensitive parts.

### The `yield` closure

The compiler-synthesised `yield` captures the loop's variables and state. If escape analysis proves it does not outlive the `f(yield)` call (the common case), it lives on the stack. It escapes — and heap-allocates — if:
- The iterator `f` is opaque (interface/indirect call) and the compiler must conservatively assume `yield` might be stored.
- The body captures variables in a way that forces them to the heap (then the closure environment may too).

### The iterator function value

`iter.Seq[T]` is a func value. Stored in a variable and passed around, it is a pointer-sized value; it does not itself allocate unless it closes over heap variables. A *constructor* like `Count(n)` that returns `func(yield...) {...}` allocates a closure for the returned function — once per call to `Count`, not per element. That per-iterator allocation is usually negligible; the per-element path is what must stay clean.

### Reading the evidence

`-gcflags=-m` output for a clean iterator loop shows the `yield` "does not escape" and the iterator "inlining call." Any `escapes to heap` on the per-element path is the thing to chase. The fix is usually to make the iterator a concrete (inlinable) call rather than an interface dispatch, or to flatten a deep pipeline.

---

## Standard-Library Implementation Notes

The 1.23 helpers are thin, predictable wrappers worth knowing precisely.

- **`slices.Values(s)`** returns `Seq[V]`: a closure ranging `s` by value. Restartable. Zero-allocation when inlined.
- **`slices.All(s)`** returns `Seq2[int, V]`: index + value. **`slices.Backward(s)`** is the descending `Seq2[int, V]`.
- **`slices.Collect(seq)`** = grow-and-append into a `[]V`; it is `append` in a loop, so it amortises but may reallocate. For known sizes, pre-sizing manually beats it.
- **`slices.Sorted(seq)`** = `Collect` then `slices.Sort`. **`slices.SortedFunc`/`SortedStableFunc`** take a comparison; the stable variant uses a stable sort.
- **`maps.Keys(m)`/`maps.Values(m)`** return `Seq[K]`/`Seq[V]` in *randomised* map order. **`maps.All(m)`** is `Seq2[K, V]`. **`maps.Collect(seq2)`** builds a `map[K]V`.

Two correctness notes:
- Map-based iterators reflect *live* map state if the map is mutated during iteration — same hazard as a normal map range. Don't mutate the map mid-range.
- `slices.Sorted(maps.Keys(m))` is the canonical "iterate a map in sorted key order" idiom and is allocation-bounded by the collected slice.

---

## Edge Cases the Spec and Source Reveal

- **Panic in the loop body** unwinds through `yield` and the iterator (running its `defer`s) and out of the range statement. The iterator's `defer rows.Close()` therefore covers panics — but only if it is a `defer`.
- **`yield` captured and called late** → "after whole loop exit" panic (section 4). Never let it escape.
- **Calling `yield` after `false`** → "after function for loop body returned false" panic.
- **`iter.Pull` `stop()` is idempotent and goroutine-safe to call once** from the owning goroutine; concurrent `next`/`stop` from multiple goroutines is undefined — synchronise yourself.
- **A nil iterator** (`var s iter.Seq[int]; for range s`) panics with a nil-function call, like calling any nil func.
- **Deeply nested range-over-func loops** each get their own state machinery; labelled breaks to outer ranged loops are handled but generate more dispatch code.
- **`go vet`** (1.23+) includes checks that flag obviously-wrong iterator usage in some cases; rely on tests and `-gcflags=-m` for the rest.
- **`runtime.Gosched`/blocking inside a producer driven by `iter.Pull`** parks the coroutine; it does not deadlock the consumer, but it does keep the producer goroutine alive until `next`/`stop`.

These are pointers to *reach for the source* (`cmd/compile/internal/rangefunc`, `src/iter/`, `runtime/coro.go`) when behaviour surprises you. The implementation is well-commented and tractable.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Confirm a loop is allocation-free | `go test -bench -benchmem`; expect `0 allocs/op` on the per-element path |
| See why a closure escaped | `go build -gcflags='-m=2'`; look for `escapes to heap` on `yield` |
| Detect a pull-iterator goroutine leak | `go.uber.org/goleak` in tests, or compare `runtime.NumGoroutine()` |
| Reproduce the double-yield panic | call `yield` without `if !yield(v){return}` and `break` in the consumer |
| Build under the (legacy) 1.22 experiment | `GOEXPERIMENT=rangefunc go build` with `go 1.22` — only for old toolchains |
| Enable the feature | set `go 1.23` (or higher) in `go.mod`; use toolchain ≥ 1.23 |
| Iterate a map deterministically | `slices.Sorted(maps.Keys(m))` |
| Convert iterator → slice/map | `slices.Collect(seq)` / `maps.Collect(seq2)` |
| Merge two sorted iterators | `iter.Pull` both, compare heads, `defer stop()` each |
| Profile a deep pipeline | `pprof` CPU profile; watch for per-element closure-call frames |

---

## Summary

Range-over-func is a compiler rewrite backed by a runtime contract, not a library trick. `for x := range f` is transformed by `cmd/compile/internal/rangefunc` into `f(yield)` where the loop body becomes the `yield` closure; non-local control (`break`, `return`, `goto`, labels) is implemented by recording the intent in a state variable, returning `false` to unwind the iterator first, and dispatching the real jump after `f` returns — so the body behaves exactly like a slice range and the iterator's `defer`s run at the right moment. A per-loop state guard powers the two defensive panics: calling `yield` after it returned `false`, and calling it after the loop exited.

`iter.Pull` is built on the runtime coroutine primitive (`newcoro`/`coroswitch`): the producer runs as a parked goroutine resumed one step per `next()`, which is why an undrained producer without `stop()` leaks. Performance is the conditional "zero-allocation when inlined": concrete, shallow, non-escaping loops collapse to plain loops; interface-dispatched or deep dynamic pipelines allocate closures and pay call overhead, verifiable with `-gcflags=-m` and `-benchmem`.

The feature was a `GOEXPERIMENT=rangefunc` preview in 1.22 and GA in 1.23, gated per module by the `go` directive (1.23+) — the same language-versioning mechanism that gated 1.22 loop scoping. Knowing where the complexity sits — the control-flow rewrite, the coroutine, and the escape/inline decisions — is what lets you reason precisely about correctness, leaks, and allocations instead of treating iterators as magic.
