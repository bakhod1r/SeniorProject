# Iterators & Range-over-Func — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where Range-over-Func Is Specified](#where-range-over-func-is-specified)
3. [Permitted Range Function Signatures](#permitted-range-function-signatures)
4. [The Spec Rules for Ranging over a Function](#the-spec-rules-for-ranging-over-a-function)
5. [The `iter` Package](#the-iter-package)
6. [The `yield` Contract and Panics (Per Reference)](#the-yield-contract-and-panics-per-reference)
7. [Standard-Library Additions (1.23)](#standard-library-additions-123)
8. [Version Gating (`go` directive)](#version-gating-go-directive)
9. [Differences Across Go Versions](#differences-across-go-versions)
10. [References](#references)

---

## Introduction

Unlike `go mod` subcommands, range-over-func *is* part of the Go language and is specified in the **Go Language Specification** (`go.dev/ref/spec`), in the *"For statements with range clause"* section. The `iter`, `slices`, and `maps` library APIs are specified by their package documentation.

Sources of truth, in decreasing formality:

1. **Go Language Specification — "For statements"** — `go.dev/ref/spec#For_statements`, the range-clause rules including function values.
2. **`iter` package documentation** — `pkg.go.dev/iter`, defining `Seq`, `Seq2`, `Pull`, `Pull2`.
3. **`slices` / `maps` package documentation** — the 1.23 iterator helpers.
4. **Go 1.23 Release Notes** — `go.dev/doc/go1.23`.

This file separates "what the spec mandates" from package convention and toolchain behaviour.

---

## Where Range-over-Func Is Specified

Range-over-func is documented in:

1. **The Go spec, "For statements with `range` clause."** This section was extended in Go 1.23 to allow the range expression to be a function value of specific signatures.
2. **The `iter` package** (`pkg.go.dev/iter`) — the canonical names for the iterator types and the pull converters.
3. **The Go 1.23 release notes** — the user-facing announcement and the list of `slices`/`maps` additions.

The spec defines *which function signatures may be ranged* and *the semantics of the loop*; the `iter` package gives those signatures named types but adds no new language semantics.

---

## Permitted Range Function Signatures

Per the spec, the range expression in `for ... range f` may be a function `f` whose type is one of:

```
func(yield func() bool)
func(yield func(V) bool)
func(yield func(K, V) bool)
```

for some types `K` and `V`. Correspondingly:

| Range clause | Required `f` type | Iteration values |
|--------------|-------------------|------------------|
| `for range f` | `func(func() bool)` | none (yield takes no args) |
| `for v := range f` | `func(func(V) bool)` | one value `v` |
| `for k, v := range f` | `func(func(K, V) bool)` | two values `k`, `v` |

The number of iteration variables in the range clause must be compatible with the number of parameters of the `yield` function. The named types `iter.Seq[V]` (= `func(func(V) bool)`) and `iter.Seq2[K, V]` (= `func(func(K, V) bool)`) are exactly the one- and two-value forms; the zero-value form has no named alias in `iter`.

The function `f` is called the *range function*; its `yield` parameter is the *yield function*.

---

## The Spec Rules for Ranging over a Function

The spec text (paraphrased; consult `go.dev/ref/spec#For_statements` for exact wording) states:

1. **The range function is called once**, with a `yield` function synthesised by the compiler as its argument.
2. **Each call to `yield` produces one iteration** of the loop body, binding the iteration variables to `yield`'s arguments.
3. **`yield` returns `false`** if the loop body terminated the loop (via `break`, `return`, `goto` out of the loop, a labelled `break`/`continue` to an enclosing statement, or a panic), and `true` otherwise.
4. **The range function must return** when `yield` returns `false`; continuing to call `yield` is a runtime error (panic).
5. **It is a run-time error to call `yield`** after the range function has returned.
6. **Break, continue, return, goto, and labelled statements** behave as they would in any other `for` loop: they affect the loop and the enclosing function exactly as expected.
7. **The iteration variables** follow the same per-iteration scoping rules as other range loops (each iteration has fresh variables, per Go 1.22+).

The spec is explicit that, from the perspective of the loop body, ranging over a function is *semantically equivalent* to ranging over any other rangeable type with respect to control flow. The novelty is entirely on the producer side.

---

## The `iter` Package

The `iter` package (`pkg.go.dev/iter`) defines the standard iterator vocabulary:

```go
package iter

// Seq is an iterator over sequences of individual values.
// When called as seq(yield), seq calls yield(v) for each value v
// in the sequence, stopping early if yield returns false.
type Seq[V any] func(yield func(V) bool)

// Seq2 is an iterator over sequences of pairs of values,
// most commonly key-value pairs.
type Seq2[K, V any] func(yield func(K, V) bool)

// Pull converts the "push-style" iterator seq into a
// "pull-style" iterator accessed by the two functions next and stop.
//
// next returns the next value in the sequence and a boolean
// indicating whether the value is valid. When the sequence is over,
// next returns the zero V and false. It is valid to call next after
// reaching the end of the sequence or after calling stop.
//
// stop ends the iteration. It must be called when the caller is no
// longer interested in next's values and did not reach the end of
// the sequence. It is valid to call stop multiple times and when
// next has already returned false.
//
// It is an error to call next or stop from multiple goroutines
// simultaneously.
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func())

// Pull2 converts the "push-style" iterator seq into a
// "pull-style" iterator accessed by next and stop.
func Pull2[K, V any](seq Seq2[K, V]) (next func() (K, V, bool), stop func())
```

The documented contract for `Pull`/`Pull2` is authoritative on three points:

- **`stop` must be called** when the caller stops early (did not drain to `false`). Omitting it leaks the resources held by the underlying iterator (in the implementation, a parked goroutine).
- **`stop` is idempotent** — safe to call multiple times, and safe after `next` returned `false`.
- **`next`/`stop` are not safe for concurrent use** — calling them from multiple goroutines simultaneously is an error.

---

## The `yield` Contract and Panics (Per Reference)

The spec and `iter` documentation together define two distinct error conditions, both of which the runtime detects with a panic:

1. **Calling `yield` after it has returned `false`.** Once the loop body has signalled termination, the range function must stop. A further `yield` call is a runtime error. The panic message is of the form: *"runtime error: range function continued iteration after function for loop body returned false."*

2. **Calling `yield` after the range function has returned.** The yield function is only valid during the dynamic extent of the range-function call. A captured-and-deferred call is a runtime error: *"runtime error: range function continued iteration after whole loop exit."*

Both are *defined* errors, not implementation accidents — the spec mandates that these be errors, and the toolchain implements them as panics so that incorrect iterators fail loudly rather than corrupting loop state.

The contract on the *consumer* side (the compiler-generated `yield`) is that it returns `true` while the loop wants more values and `false` exactly once the loop is finished. Iterator authors rely on this and must honour it.

---

## Standard-Library Additions (1.23)

Go 1.23 added iterator producers and collectors. Specified by package docs:

### `slices`

```go
func All[Slice ~[]E, E any](s Slice) iter.Seq2[int, E]
func Values[Slice ~[]E, E any](s Slice) iter.Seq[E]
func Backward[Slice ~[]E, E any](s Slice) iter.Seq2[int, E]
func Collect[E any](seq iter.Seq[E]) []E
func Sorted[E cmp.Ordered](seq iter.Seq[E]) []E
func SortedFunc[E any](seq iter.Seq[E], cmp func(E, E) int) []E
func SortedStableFunc[E any](seq iter.Seq[E], cmp func(E, E) int) []E
func AppendSeq[Slice ~[]E, E any](s Slice, seq iter.Seq[E]) Slice
```

### `maps`

```go
func Keys[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[K]
func Values[Map ~map[K]V, K comparable, V any](m Map) iter.Seq[V]
func All[Map ~map[K]V, K comparable, V any](m Map) iter.Seq2[K, V]
func Collect[K comparable, V any](seq iter.Seq2[K, V]) map[K]V
func Insert[Map ~map[K]V, K comparable, V any](m Map, seq iter.Seq2[K, V])
```

Documented semantics worth noting:

- `maps.Keys`, `maps.Values`, `maps.All` yield in **unspecified (randomised) order**, matching `for range` over a map.
- `slices.Sorted(seq)` requires `cmp.Ordered`; it collects then sorts.
- `slices.Collect`/`maps.Collect` drain the iterator fully; using them on an infinite iterator never returns.

---

## Version Gating (`go` directive)

Per the Go 1.23 release notes and the language-version mechanism:

- Range-over-func is enabled when the module's `go` directive in `go.mod` is **`go 1.23` or higher**. The language version, not merely the toolchain version, is the gate.
- A module with a lower `go` directive rejects `for ... range f` at compile time, even when built with a 1.23+ toolchain.
- The `iter`, and the 1.23 additions to `slices`/`maps`, require the Go 1.23 standard library; importing them needs a 1.23+ toolchain.
- During Go 1.22, the feature existed only under `GOEXPERIMENT=rangefunc` (and required `go 1.22`); this is obsolete from 1.23.

This is the same per-module language-versioning approach that gated the Go 1.22 loop-variable scoping change.

---

## Differences Across Go Versions

- **Go 1.21 and earlier** — no range-over-func; `for ... range` works only over slices, arrays, maps, strings, channels.
- **Go 1.22** — integer range (`for i := range n`) added; range-over-func available **only** behind `GOEXPERIMENT=rangefunc`, with `go 1.22`. The `iter` package and runtime coroutine support were under development. Per-iteration loop-variable scoping became the default.
- **Go 1.23** — range-over-func **GA**. The `iter` package (`Seq`, `Seq2`, `Pull`, `Pull2`) is standard. `slices` gains `All`, `Values`, `Backward`, `Collect`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `AppendSeq`. `maps` gains `Keys`, `Values`, `All`, `Collect`, `Insert`. Feature gated on `go 1.23`.
- **Go 1.24+** — the feature is stable; additional convenience helpers may appear in `slices`/`maps`/other packages, but the language rules for ranging over a function are unchanged from 1.23.

The language semantics of ranging over a function have been stable since 1.23 GA; the principal additions across versions are standard-library helpers, not language changes.

---

## References

- [Go Language Specification — For statements](https://go.dev/ref/spec#For_statements) — authoritative for the range-clause rules.
- [`iter` package](https://pkg.go.dev/iter) — `Seq`, `Seq2`, `Pull`, `Pull2` and their documented contracts.
- [`slices` package](https://pkg.go.dev/slices) — `All`, `Values`, `Backward`, `Collect`, `Sorted`, `SortedFunc`, `SortedStableFunc`, `AppendSeq`.
- [`maps` package](https://pkg.go.dev/maps) — `Keys`, `Values`, `All`, `Collect`, `Insert`.
- [Go 1.23 Release Notes — Iterators](https://go.dev/doc/go1.23#iterators) — the GA announcement.
- [Go blog: Range Over Function Types](https://go.dev/blog/range-functions) — official introduction.
- [Proposal #61405 — range over func](https://go.dev/issue/61405) — the design discussion and accepted proposal.
