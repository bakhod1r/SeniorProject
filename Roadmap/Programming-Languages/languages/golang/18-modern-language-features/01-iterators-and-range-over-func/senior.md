# Iterators & Range-over-Func — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing an Iterator API: First Principles](#designing-an-iterator-api-first-principles)
3. [Seq vs Seq2 vs Method vs Slice: Choosing the Return Type](#seq-vs-seq2-vs-method-vs-slice-choosing-the-return-type)
4. [The Pull Lifecycle and Goroutine Leaks](#the-pull-lifecycle-and-goroutine-leaks)
5. [Resource Safety Across Early Exit and Panic](#resource-safety-across-early-exit-and-panic)
6. [Single-Use vs Restartable Iterators](#single-use-vs-restartable-iterators)
7. [Errors, Cancellation, and `context`](#errors-cancellation-and-context)
8. [Composition at Scale](#composition-at-scale)
9. [Iterators vs Channels: The Real Trade-off](#iterators-vs-channels-the-real-trade-off)
10. [Backward Compatibility and the `go` Directive](#backward-compatibility-and-the-go-directive)
11. [Concurrency: What Iterators Are and Are Not](#concurrency-what-iterators-are-and-are-not)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with range-over-func is not "can I write a `yield` loop" but "should this API return an iterator at all, and if so, which shape, with what lifecycle guarantees." The mechanics are in [junior.md](junior.md) and [middle.md](middle.md). This file is about the design decisions: when an iterator is the right boundary, how to keep pull iterators leak-free, how to make iterators safe under early exit and panic, and how to weigh them against channels and slices.

After reading you will:
- Decide *whether* an API should expose an iterator, and which of `Seq`/`Seq2`/method/slice to use
- Design pull-based iterators that never leak goroutines
- Guarantee resource safety across `break`, `return`, and `panic`
- Reason about single-use vs restartable semantics and document them
- Thread `context` cancellation and errors through an iterator pipeline
- Choose iterators vs channels on real engineering grounds, not fashion

---

## Designing an Iterator API: First Principles

An iterator is a *contract about laziness and lifecycle*, not just a fancy loop. Before returning one, answer three questions.

### 1. Is laziness valuable here?

If the producer can compute all elements cheaply and they fit in memory, a `[]T` is simpler: callers get `len`, indexing, reslicing, and reuse for free. Return an iterator only when laziness buys something concrete — unbounded/large data, expensive per-element production, or early-exit savings. Returning `iter.Seq[T]` for a three-element in-memory list is over-engineering.

### 2. Does the iterator own a resource?

If producing values requires an open file, DB cursor, network connection, or lock, the iterator now owns a *lifecycle*, and the caller's loop controls *when it ends* (including early `break`). That obligates you to clean up via `defer` inside the iterator and to document that ranging is the only safe way to drive it. A resource-owning iterator is a much heavier contract than a pure one; make it deliberate.

### 3. Single pass or repeatable?

A slice can be ranged any number of times. An iterator *might* be single-use (stream-backed) or repeatable (re-reads its source each call). This is invisible from the type — `iter.Seq[T]` says nothing about it — so it must be in the doc comment. Mismatched expectations here are a top source of bugs.

The senior framing: an iterator is an *interface* with hidden invariants. The type system enforces the shape; you must enforce (and document) laziness, ownership, and reusability.

---

## Seq vs Seq2 vs Method vs Slice: Choosing the Return Type

| Option | Use when | Cost |
|--------|----------|------|
| `[]T` | Data is small, in memory, callers want random access / `len` | Eager allocation; no early-exit savings |
| `iter.Seq[V]` | Lazy single-value stream | New shape; no `len`/index |
| `iter.Seq2[K,V]` | Each element is naturally a pair (index/key + value, value + error) | Same; two loop vars |
| `func() (V, bool)` (raw pull) | Caller must drive manually, no `for range` | Caller-managed lifecycle, error-prone |
| Method returning `iter.Seq` | The sequence belongs to a receiver (`tree.InOrder()`) | Couples lifetime to receiver |

### Guidance

- **Prefer `Seq` over `Seq2`** unless the pair is genuinely intrinsic. `Seq2[T, error]` is the main reason to use `Seq2` for non-keyed data — it is the idiomatic streaming-error shape.
- **Return the named `iter.Seq`/`iter.Seq2` type**, never a bare `func(func(V) bool)`. The name is documentation and lets `go doc` link it.
- **Offer both an iterator and a slice collector** for ergonomics when callers commonly want all values: `Values() iter.Seq[T]` plus letting callers use `slices.Collect`. Don't ship a redundant `ToSlice()` if `slices.Collect` already does it.
- **Mirror the stdlib naming**: `All` for index/key+value `Seq2`, `Values` for value `Seq`, `Keys` for key `Seq`. Predictability is an API feature.

---

## The Pull Lifecycle and Goroutine Leaks

`iter.Pull` is the single most dangerous part of the feature, because it introduces a goroutine the caller must reclaim.

### The mechanism, precisely

`iter.Pull(seq)` starts a goroutine that runs `seq`. Each time the producer calls `yield`, that goroutine **blocks**, parked, holding the value. `next()` unblocks it for exactly one step and returns the parked value. Between calls, the producer goroutine is suspended at the `yield` point — alive, holding its stack, any open resources, and any held locks.

### The leak

If you stop calling `next()` early and never call `stop()`, the producer goroutine stays parked **forever**. It is leaked: it never runs its `defer`s, never closes its file, never releases its lock. Under load this is a slow-burning resource exhaustion.

```go
next, stop := iter.Pull(seq)
defer stop() // the ONLY thing standing between you and a leak

for {
    v, ok := next()
    if !ok || done(v) {
        break // without defer stop(), this break leaks the producer
    }
}
```

### The rules

1. **Always `defer stop()`** immediately after `iter.Pull`. No exceptions, even if you intend to drain fully — a panic mid-drain still needs `stop()`.
2. **`stop()` is idempotent.** Calling it after full drain, or twice, is safe.
3. **`stop()` makes the next `yield` in the producer return `false`**, so the producer unwinds and runs its `defer`s. This is how the producer's resources get released.
4. **Do not share `next`/`stop` across goroutines** without your own synchronisation; they are not safe for concurrent use.
5. **Pull iterators are not free.** Each one is a goroutine plus two channel-like handoffs per element. For hot paths, push (`for range`) is much cheaper. Use pull only for merge/zip/interleave.

### Detecting leaks in CI

Run tests with `go.uber.org/goleak` or compare `runtime.NumGoroutine()` before/after. A pull iterator that leaks shows up as a lingering goroutine parked in `iter.Pull`'s internal `yield`. Make this a standard test for any package that uses `iter.Pull`.

---

## Resource Safety Across Early Exit and Panic

The defining hazard of resource-owning iterators is that the consumer controls termination. Three exit paths must all clean up.

### Normal completion

The iterator's loop ends, control falls past the last statement, `defer`s run. Easy.

### Early `break`/`return` in the consumer

`yield` returns `false`. Your `if !yield(v) { return }` returns from the iterator; the `defer` you registered runs. This only works if you actually `defer`ed cleanup and actually guarded `yield`. Forgetting either leaks.

```go
func Rows(db *sql.DB, q string) iter.Seq[Row] {
    return func(yield func(Row) bool) {
        rows, err := db.Query(q)
        if err != nil {
            return
        }
        defer rows.Close() // runs on normal end, early break, AND panic
        for rows.Next() {
            var r Row
            rows.Scan(&r)
            if !yield(r) {
                return // defer rows.Close() fires here
            }
        }
    }
}
```

### Panic in the consumer's loop body

A panic in the body unwinds *through* `yield`, through the iterator (running its `defer`s), and out of the `range` statement. So `defer rows.Close()` also covers the panic case — provided cleanup is in a `defer`, not in code after the loop. **Cleanup after the loop body (not deferred) is wrong**: it is skipped on early break and on panic.

### The hard rule

All cleanup in a resource-owning iterator goes in a `defer` registered immediately after acquiring the resource. Never "close after the loop." This is the iterator analogue of the universal Go rule and it is more important here because there are more exit paths.

---

## Single-Use vs Restartable Iterators

The type `iter.Seq[T]` is silent on reusability. You must decide and document.

### Restartable (idempotent)

`slices.Values(s)` is restartable: each range re-reads the slice from the start. Pure, stateless-over-its-source iterators are restartable. Prefer this when feasible — it matches slice intuition and avoids surprises.

```go
// Restartable: re-reads s every time it is ranged.
func Values[T any](s []T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for _, v := range s {
            if !yield(v) { return }
        }
    }
}
```

### Single-use (consuming)

An iterator wrapping a `*bufio.Scanner`, an `*sql.Rows`, or a network stream is single-use: once drained, ranging again yields nothing (or errors). This is sometimes unavoidable — the underlying source is itself single-pass.

```go
// Single-use: the scanner is consumed; a second range yields nothing.
func Lines(r io.Reader) iter.Seq[string] { ... }
```

### The senior obligations

- **Document it.** "This iterator may be ranged multiple times" or "single-use; collect if you need replay." One sentence prevents a class of bugs.
- **Prefer restartable for library APIs** that take a value (slice, map) you can re-read. Reserve single-use for genuinely streaming sources.
- **If callers need replay of a single-use iterator, hand them `slices.Collect`** rather than trying to make the stream restartable.
- **Be wary of accidental statefulness** — closures that capture a mutable counter make an otherwise-restartable iterator silently single-use.

---

## Errors, Cancellation, and `context`

A push iterator returns nothing, so errors and cancellation need channels other than the return value.

### Errors: `Seq2[T, error]`

The idiomatic streaming-error shape. Each element carries its own error; the consumer checks per element. Terminal errors are yielded once and the iterator returns.

```go
for rec, err := range stream(r) {
    if err != nil {
        return err
    }
    handle(rec)
}
```

This composes with generic helpers and reads naturally. The alternative — a post-loop `Err()` method — is fine for `bufio.Scanner`-style terminal-only errors but does not compose through `Map`/`Filter` wrappers.

### Cancellation: pass `context` to the producer, not through `yield`

`yield` cannot carry a cancel signal. Instead, the iterator *constructor* takes a `context.Context` and the producer checks it:

```go
func Stream(ctx context.Context, r io.Reader) iter.Seq2[Record, error] {
    return func(yield func(Record, error) bool) {
        dec := json.NewDecoder(r)
        for dec.More() {
            if err := ctx.Err(); err != nil {
                yield(Record{}, err) // surface cancellation
                return
            }
            var rec Record
            if err := dec.Decode(&rec); err != nil {
                yield(Record{}, err)
                return
            }
            if !yield(rec, nil) {
                return
            }
        }
    }
}
```

The consumer cancels by cancelling `ctx`; the producer notices on its next iteration and stops. Note the cooperative nature: cancellation takes effect at the next `ctx.Err()` check, not instantly mid-`Decode`. For blocking producers, give the blocking call the `ctx` (e.g. `db.QueryContext`).

---

## Composition at Scale

Composed iterators (Filter → Map → Take → ...) form a *pull-through* pipeline where each layer forwards the stop signal upstream. Three scaling concerns:

### Stop-signal propagation must be perfect

Each wrapper must do `if !yield(v) { return }`. A single wrapper that ignores the bool breaks short-circuiting for the entire pipeline and can panic (double-`yield`). Code review of iterator combinators should specifically check every `yield` is guarded.

### Inlining degrades with depth

Each wrapper is a closure call per element. The compiler inlines shallow pipelines into a single loop (zero allocation), but deep or dynamically-built pipelines (slices of transforms) may allocate closures and fail to inline, costing per-element function-call overhead. Measure deep pipelines; don't assume they vanish. (See [optimize.md](optimize.md).)

### Error threading through combinators

If your stream is `Seq2[T, error]`, your `Map`/`Filter` must thread the error through unchanged and only transform the value half. Many naive combinators drop the error. Design combinators for `Seq2[T, error]` from the start if errors are in play, or convert to a "result" struct.

---

## Iterators vs Channels: The Real Trade-off

Before 1.23, the idiomatic "custom sequence" was a channel fed by a goroutine. Iterators replace most of those uses. The trade-off:

| Dimension | Push iterator (`iter.Seq`) | Channel + goroutine |
|-----------|---------------------------|---------------------|
| Concurrency | None — synchronous ping-pong | Producer runs concurrently |
| Cost per element | Near-zero (inlined) | Channel send/recv + scheduling |
| Early stop | `break`; iterator's `defer` cleans up | Must signal goroutine (close a done chan) or leak |
| Backpressure | Implicit (producer blocks at `yield`) | Buffer size tuning |
| Leak risk | Low (push); pull needs `stop()` | High — abandoned goroutines are the classic Go leak |
| Cross-goroutine fan-out | No | Yes — natural for worker pools |

### The rule

- **In-process, single-consumer iteration → push iterator.** It is faster, leak-resistant, and `break`-clean. This is the common case and where channels were always overkill.
- **You need real concurrency** (the producer should run on its own goroutine while the consumer does other work, or you fan out to N workers) → channel. Iterators are synchronous; they do not give you parallelism.
- **`iter.Pull` is a channel in disguise** for the merge/zip case — it uses a goroutine internally, so it has channel-like cost. Don't reach for it expecting push-iterator performance.

Iterators did not make channels obsolete. They made channels-as-a-sequence-abstraction obsolete. Channels remain the tool for concurrency and communication.

---

## Backward Compatibility and the `go` Directive

Range-over-func is gated on the module's `go` directive, and this is a deliberate compatibility design.

- A package whose `go.mod` says `go 1.23+` can use `for range f`. One that says `go 1.22` cannot — it is a compile error in that module, even on a 1.23 toolchain. The *language version*, set per module (and overridable per file with a `//go:build go1.23` line in some setups), gates the feature.
- This means you can **safely add an iterator-returning function to a library** without breaking consumers on older Go versions *at their build* — but consumers who want to *use* range-over-func need their own module at 1.23+. The function signature (`iter.Seq[T]`) compiles fine for them to *call*; only the `for range f` syntax needs 1.23.
- The `iter` package itself requires Go 1.23. A library that returns `iter.Seq[T]` raises its minimum supported Go version to 1.23. Treat that as a (minor) breaking change for very conservative consumers and note it in release notes.

Senior takeaway: exposing iterators in a public library is a *versioning decision*. It bumps your minimum Go. For widely-depended-on libraries, weigh that against shipping a slice-returning API alongside.

---

## Concurrency: What Iterators Are and Are Not

Misconceptions here cause real bugs.

- **A push iterator is single-threaded.** Producer and consumer alternate on one goroutine. There is no parallelism and no data race between them by construction.
- **An iterator is not safe for concurrent ranging** unless explicitly designed so. Two goroutines ranging the same stateful iterator race on its internal state.
- **`iter.Pull` introduces exactly one extra goroutine** (the producer), parked between `next()` calls. `next`/`stop` are not safe for concurrent use.
- **Values escaping the loop need care.** If the loop body sends `v` to another goroutine, remember per-iteration scoping gives a fresh `v` each step (1.22+), so capturing it is safe — but the *referent* (e.g. a reused buffer the producer mutates) may not be. Producers that reuse a backing buffer per `yield` must document it.
- **Cancellation is cooperative**, via `context` checked by the producer — never assume an iterator stops instantly.

---

## Anti-Patterns

- **Returning `iter.Seq[T]` for tiny in-memory data.** Just return `[]T`. The iterator adds cognitive cost and removes `len`/indexing for nothing.
- **Forgetting `defer stop()` after `iter.Pull`.** Guaranteed goroutine leak under early exit. The number-one pull bug.
- **Cleaning up after the loop instead of `defer` inside the iterator.** Skipped on early `break` and panic. Always `defer`.
- **Ignoring `yield`'s return in a combinator.** Breaks short-circuiting for the whole pipeline and can panic. Every `yield` gets a guard.
- **Letting `yield` escape the iterator** (storing it, calling it later, from a goroutine). Panics with "after whole loop exit."
- **Spawning a goroutine inside a plain push iterator** "for speed." It adds leak surface and synchronisation for no benefit — push is already synchronous and fast.
- **Undocumented single-use semantics.** Callers assume slice-like replay and get silent empty ranges.
- **Using an iterator where you needed concurrency.** Iterators are synchronous; if you wanted the producer to run in parallel, you wanted a channel/goroutine.
- **Threading errors via panic.** Don't panic to signal a normal error across the boundary; use `Seq2[T, error]`.
- **Bumping a widely-used library's minimum Go to 1.23 silently** by adding `iter.Seq` returns without a release note.

---

## Senior-Level Checklist

- [ ] Return an iterator only when laziness, size, or early-exit actually pay off
- [ ] Prefer `[]T` for small in-memory data; prefer `Seq` over `Seq2` unless pairs are intrinsic
- [ ] Return the named `iter.Seq`/`iter.Seq2` type, mirror stdlib naming
- [ ] `defer` all resource cleanup *inside* the iterator; never clean up after the loop
- [ ] Verify cleanup survives early `break`, `return`, and `panic`
- [ ] After every `iter.Pull`, `defer stop()` — and test for goroutine leaks
- [ ] Use pull only for merge/zip/interleave; know it costs a goroutine
- [ ] Document single-use vs restartable in the doc comment
- [ ] Stream errors via `Seq2[T, error]`; thread the error through every combinator
- [ ] Pass `context` to the producer for cancellation; know it is cooperative
- [ ] Guard every `yield` in every combinator (`if !yield(v) { return }`)
- [ ] Treat adding `iter.Seq` returns as a minimum-Go-version bump in public libraries

---

## Summary

At senior level, range-over-func is an API-design and lifecycle problem, not a syntax problem. An `iter.Seq[T]` is an interface with hidden invariants — laziness, resource ownership, reusability — that the type system does not express and you must document. Return an iterator only when laziness buys something; otherwise a slice is simpler and gives callers `len` and indexing. Prefer `Seq` to `Seq2` except for the idiomatic `Seq2[T, error]` streaming-error shape, and mirror the standard library's naming.

The two operational hazards are resource safety and goroutine leaks. Resource-owning iterators must `defer` cleanup inside the iterator so it survives early `break`, `return`, and `panic` — never clean up after the loop. `iter.Pull` parks a producer goroutine between `next()` calls; forgetting `defer stop()` leaks it, so the must-call-`stop` rule is absolute and worth a CI leak test. Use pull only when push (`for range`) genuinely cannot express the iteration — merge, zip, manual interleave — and remember it carries channel-like cost.

Iterators replaced channels-as-sequences, not channels-for-concurrency: a push iterator is single-threaded synchronous ping-pong with no parallelism. Cancellation flows through `context` checked cooperatively by the producer, errors through `Seq2[T, error]`, and composition works only because every layer honours `yield`'s `false`. Finally, exposing iterators bumps a library's minimum Go to 1.23 — a versioning decision to make deliberately, not by accident.
