# `min`, `max` & `clear` Built-ins — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why These Are Built-ins: The Design Rationale](#why-these-are-built-ins-the-design-rationale)
3. [The Cost Argument: Built-in vs Generic Function](#the-cost-argument-built-in-vs-generic-function)
4. [Floating-Point Semantics as an API Decision](#floating-point-semantics-as-an-api-decision)
5. [The `math.Min`/`math.Max` Legacy and Why It Stays](#the-mathminmathmax-legacy-and-why-it-stays)
6. [`clear` and the NaN-Key Motivation](#clear-and-the-nan-key-motivation)
7. [`clear`, Memory, and Reference Hygiene](#clear-memory-and-reference-hygiene)
8. [Designing APIs Around Ordered Built-ins](#designing-apis-around-ordered-built-ins)
9. [Migration at Scale](#migration-at-scale)
10. [Interaction with the `cmp`, `slices`, and `maps` Packages](#interaction-with-the-cmp-slices-and-maps-packages)
11. [Code Review Heuristics](#code-review-heuristics)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's interest in `min`, `max`, and `clear` is not "how do I call them" but "why did the language take the unusual step of adding three built-ins in one release, what guarantees do they encode, and how do I steer a large codebase onto them without introducing behavioural drift." These are small features, but they are *language* changes — predeclared identifiers that every Go program now sees — and the reasoning behind them is a useful case study in API design under backward-compatibility constraints.

The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md). This file is about the design, the trade-offs, and the migration.

After reading this you will:
- Articulate why `min`/`max`/`clear` are built-ins rather than library functions
- Reason about their performance relative to the generic alternatives they replace
- Treat their floating-point semantics as a deliberate API contract
- Use `clear` correctly for both correctness (NaN keys) and memory hygiene
- Drive a large-scale migration off hand-rolled helpers
- Apply review heuristics that catch the real bugs these features introduce

---

## Why These Are Built-ins: The Design Rationale

Adding to the set of predeclared identifiers is a heavy hammer. Every existing program that used `min`, `max`, or `clear` as ordinary identifiers had to keep working — and they do, because Go's predeclared identifiers can be shadowed by local declarations. A package-level `func max(...)` or a local `min := ...` still wins over the built-in. This is the compatibility escape hatch that made the addition safe.

So why not just ship `cmp.Or`-style library functions? Three reasons drove the built-in decision:

1. **Constant evaluation.** Only a built-in (or operator) can be evaluated at compile time. `min(64, 128)` as an array size, or `const C = max(A, B)`, requires the operation to be a constant expression. A function call — generic or not — is a runtime construct and cannot appear where a constant is required. This alone forecloses the library-function approach for the constant use cases.

2. **Variadic over any count with no allocation.** A generic `Max[T](a, b T)` covers two operands. `Max[T](xs ...T)` covers any count but allocates a slice for the variadic pack. The built-in `max(a, b, c, d)` covers any fixed count with zero allocation and no slice. Built-ins are exempt from the normal "variadic means slice" cost.

3. **Universality and discoverability.** `min`/`max` are so fundamental that requiring an import (and a *choice* of which package — `math`? `constraints`? a local helper?) created friction and fragmentation. Making them predeclared gives the ecosystem one canonical spelling, the way `len` and `append` are canonical.

`clear` is built-in for a different reason: it expresses an operation (empty a map including unreachable keys; bulk-zero a slice) that **cannot be written in Go at all** with the same guarantees. A library `Clear(m)` looping `delete` cannot remove NaN keys. Only the runtime, reached through a built-in, can.

---

## The Cost Argument: Built-in vs Generic Function

Before 1.21, the idiomatic "modern" max was a generic function:

```go
func Max[T cmp.Ordered](a, b T) T {
    if a > b {
        return a
    }
    return b
}
```

This is correct and, after monomorphization and inlining, often compiles to the same machine code as the built-in for a two-argument call. So the *runtime* cost difference for `max(a, b)` is frequently nil — both become a compare-and-move.

The differences that matter are elsewhere:

- **Compile-time constants.** The generic function can never produce a constant. The built-in can. This is a capability gap, not a speed gap.
- **Variadic without allocation.** `Max(xs...)` allocates; `max(a, b, c)` does not. For a fixed set of three or four values, the built-in is strictly cheaper.
- **Instantiation and binary size.** Each distinct type instantiation of a generic `Max` emits code (or shares a gcshape stencil). The built-in adds nothing to the binary beyond the inlined comparison at each call site — which the generic version also does once inlined, but the dictionary/stencil machinery is avoided entirely.
- **Inlining reliability.** The built-in is lowered directly by the compiler; it is always "inlined" in the sense that there is never a call. A generic helper relies on the inliner's budget and heuristics, which usually but not always fire.

The honest senior framing: for a simple two-argument call the performance is a wash, and the built-in wins on *capability* (constants), *allocation* (variadic), and *clarity* (no import, one spelling). Do not migrate for speed; migrate for those.

---

## Floating-Point Semantics as an API Decision

The language designers had to choose how `min`/`max` treat NaN and signed zero. The chosen contract:

- **NaN propagates.** Any NaN argument yields a NaN result.
- **Negative zero orders below non-negative zero.** `min(-0.0, 0.0) == -0.0`; `max(-0.0, 0.0) == 0.0`.
- **Infinities are extremes.**

This is a *total, consistent* ordering decision, and it is the right one for a language built-in for two reasons. First, **NaN propagation is fail-loud**: if a NaN reaches your reduction, the result is visibly NaN rather than silently the largest non-NaN value. A "skip NaN" semantics would hide data corruption. Second, **the signed-zero rule makes `min`/`max` a total order consistent with `<` extended to handle the `-0 == 0` tie deterministically**, which keeps sorting and reduction predictable.

The cost of this contract is that callers with NaN-bearing data must filter explicitly. That is a deliberate trade: the language refuses to guess what you meant by `max(value, NaN)`. As an API author building on top, you inherit the same decision — if your function reduces user floats, decide and document whether NaN is an error, is filtered, or is allowed to poison.

---

## The `math.Min`/`math.Max` Legacy and Why It Stays

`math.Min` and `math.Max` predate the built-ins by a decade. They are `float64`-only and have their own documented special cases (e.g. `math.Max(x, +Inf) = +Inf`, `math.Max(x, NaN) = NaN`, `math.Max(+0, ±0) = +0`). The Go documentation explicitly notes that the built-in `max`/`min` *differs* from these for the NaN-and-infinity combinations: the `math` functions were specified to a strict IEEE-754-style `maxNum`/`minNum` intent, while the built-ins are defined directly by the spec.

Why keep `math.Min`/`math.Max` at all, now that built-ins exist? Backward compatibility: removing them would break the ecosystem, and Go's compatibility promise forbids it. They also serve the narrow set of callers who genuinely want the IEEE-754 documented behaviour. But for new code the guidance is unambiguous:

- **New code: use the built-ins.** Generic over ordered types, no allocation, constant-foldable.
- **`math.Min`/`math.Max`: only when you need their exact documented IEEE special cases**, or are maintaining float-only code that already uses them.

A senior reviewing a PR that introduces `math.Max(a, b)` on two `int` (which does not even compile) or on two floats where the built-in would do should redirect to `max`. The reverse — replacing a deliberate `math.Max` with the built-in — must be checked against the NaN/signed-zero behaviour the original relied on.

---

## `clear` and the NaN-Key Motivation

The headline reason `clear` exists for maps is a correctness bug that was previously unfixable in pure Go: a `float`, `complex`, or interface-wrapping-NaN key cannot be removed by `delete`, because `delete(m, k)` must *find* the key, and `NaN != NaN` guarantees the lookup misses.

```go
m := map[float64]int{}
m[math.NaN()] = 1
m[math.NaN()] = 1     // a second, distinct, also-unreachable entry
len(m)                // 2
for k := range m {
    delete(m, k)      // removes nothing
}
len(m)                // 2 — the NaN keys are permanently stuck
clear(m)
len(m)                // 0
```

Before `clear`, the only way to "empty" such a map was to allocate a new one (`m = make(...)`), losing the backing storage and any aliases to the old map. `clear` empties in place. For any code that aliases a map (passes it to multiple owners, stores it in a struct) and needs a true reset, `clear` is the only correct option when NaN keys are even theoretically possible — which includes any `map[float64]V` fed by external numeric data.

This is the kind of feature that justifies a built-in: it does something the language could not previously express, and it fixes a latent bug in a large class of existing code.

---

## `clear`, Memory, and Reference Hygiene

Beyond the NaN case, `clear` is a memory-hygiene tool for slices, and seniors should know exactly what it does and does not guarantee.

### Dropping references

A `[]*Conn`, `[]string`, or `[]any` that is truncated with `s = s[:0]` keeps the underlying array — and therefore keeps the old elements *reachable*, pinning them against the garbage collector. In a pooled or long-lived slice this is a memory leak.

```go
func release(buf []*Conn) {
    clear(buf)            // drop every *Conn so the GC can reclaim them
    pool.Put(buf[:0])     // return an empty-but-allocated slice
}
```

`clear(buf)` zeroes the `len(buf)` range, dropping those references. If the slice was previously grown and shrunk, references can also live in the capacity region beyond `len`; `clear(buf[:cap(buf)])` zeroes the whole backing array.

### What `clear` does NOT guarantee

`clear` is not a secure-erase primitive. The compiler and runtime may keep copies of values that passed through registers or were copied by value; `clear`ing a slice that held secret bytes reduces but does not eliminate the residue. For cryptographic key material, use a dedicated wipe (and accept that Go gives no hard guarantee). For ordinary "don't leak the previous request's data into the next one," `clear` is the right and sufficient tool.

### `clear` vs reallocation

`clear(m)`/`clear(s)` retain the allocation; `m = make(...)`/`s = make(...)` discard it and allocate fresh. In hot loops, clear-and-reuse avoids per-iteration allocation and GC pressure. The trade-off: a retained large map that is mostly empty wastes memory. If a map ballooned to a huge size once and is now small, `m = make(...)` to shed the oversized buckets can be the better choice. Profile before assuming clear-and-reuse is always cheaper.

---

## Designing APIs Around Ordered Built-ins

When you build helpers on top of the built-ins, a few design decisions recur:

- **Constrain with `cmp.Ordered`, not a custom interface.** `func Clamp[T cmp.Ordered](x, lo, hi T) T { return min(max(x, lo), hi) }` is the idiomatic shape. It works for every ordered type and composes with the built-ins natively.
- **Decide NaN policy at the boundary.** If a public function takes floats and reduces them, document whether NaN poisons, is filtered, or errors. Do not leave it implicit — callers will be surprised by poisoning.
- **Prefer `slices.Min`/`slices.Max` for collections** and reserve the built-ins for fixed argument sets. Wrapping `slices.Max` in your own API is usually unnecessary indirection.
- **Validate `lo <= hi` in clamp helpers** if the bounds are caller-supplied; `clamp(x, 10, 5)` produces a nonsense result silently.
- **Expose `clear`-and-reuse in pooled APIs** rather than reallocation, and document that callers must not retain references to elements after release.

---

## Migration at Scale

Migrating a large codebase off `maxInt`/`minInt`/`maxF` helpers:

1. **Gate on Go version.** Bump `go.mod` to `go 1.21`+ across all modules first; the built-ins do not exist below that.
2. **Mechanize integer call sites.** `maxInt(a, b)` → `max(a, b)` is a safe, semantics-preserving rewrite for integers. A `gopls` rename-free rewrite or a `eg`/`gofmt -r` rule handles the bulk.
3. **Audit float call sites individually.** A `maxF` built on `if a > b` matches the built-in; one built on `math.Max` may differ on NaN/signed zero. These need a human to confirm the data cannot be NaN, or to preserve `math.Max` deliberately.
4. **Replace `delete`-loops with `clear`** where maps are emptied — and especially flag any `map[float64]V` for the NaN-key correctness fix.
5. **Run the test suite, then delete the dead helpers.** `deadcode`/`unused` linters confirm nothing references them.
6. **Add a lint rule** forbidding new `maxInt`/`minInt` definitions so the helpers do not creep back.

The risk surface is almost entirely in floats. Integer and string migrations are mechanical and safe.

---

## Interaction with the `cmp`, `slices`, and `maps` Packages

Go 1.21 shipped the built-ins alongside the `cmp`, `slices`, and `maps` standard packages, and they are designed as a coherent set:

- **`cmp.Ordered`** is the constraint that lets your generics accept exactly the types `min`/`max` accept.
- **`cmp.Compare` / `cmp.Less`** give a three-way / boolean comparison for sorting; `min`/`max` give the reduction. Use `cmp.Less` when you need to *sort*, the built-ins when you need an *extreme*.
- **`slices.Min` / `slices.Max`** are the collection counterparts, implemented over the built-ins. They panic on empty input; the built-ins require ≥1 argument at compile time.
- **`maps.Clone` / `maps.Copy`** pair with `clear` for the reset-and-rebuild pattern: `clear(dst); maps.Copy(dst, src)` reuses `dst`'s storage.

Knowing the division of labour prevents the common mistake of reaching for the wrong member — e.g. allocating a slice to call `max` instead of calling `slices.Max`, or writing a manual `delete` loop instead of `clear`.

---

## Code Review Heuristics

Things to flag when reviewing code that uses these built-ins:

- **`max`/`min` on floats that could be NaN** with no filtering — ask whether poisoning is intended.
- **`math.Max`/`math.Min` in new code** — redirect to the built-in unless the IEEE behaviour is specifically needed.
- **`clear(s)` where the author seems to expect length 0** — they probably want `s = s[:0]`.
- **`s = s[:0]` on a pointer slice without a preceding `clear`** — potential reference leak.
- **A `delete` loop emptying a `map[float64]V`** — should be `clear` for NaN-key correctness.
- **`clamp` with caller-supplied bounds and no `lo <= hi` check.**
- **A reintroduced `maxInt`/`minInt` helper** — should use the built-in.
- **`clear`-and-reuse on a map that grew very large once** — may waste memory vs reallocation; check the size profile.

---

## Anti-Patterns

- **Using `math.Max`/`math.Min` in new code by habit.** They are float-only, do not fold to constants, and have legacy IEEE semantics. Use the built-ins.
- **Treating `clear(s)` as truncation.** It zeroes; it does not shorten. Pair with `s = s[:0]` when you need emptiness.
- **Emptying maps with `delete` loops.** Slower, more code, and broken for NaN keys. Use `clear`.
- **Allocating a slice to call `max(xs...)`.** It does not compile, and the fix is `slices.Max`, not a temporary slice.
- **Relying on `min`/`max` to skip NaN.** They propagate it; a single NaN poisons the result.
- **Clear-and-reuse on a one-time-huge map** without measuring — retained oversized buckets can waste more than the allocation you saved.
- **Reintroducing per-package `maxInt` helpers** after migration, fragmenting the codebase again.
- **Forgetting the ≥1-argument rule in code generators**, emitting `max()` for empty inputs.
- **Using `clear` as a security wipe** and assuming the bytes are unrecoverable — it is hygiene, not a guarantee.

---

## Senior-Level Checklist

- [ ] Explain the three design reasons `min`/`max` are built-ins (constants, variadic-no-alloc, universality)
- [ ] Explain why `clear` had to be a built-in (NaN keys, in-place reset)
- [ ] State the floating-point contract and why NaN-propagation is the right default
- [ ] Redirect new `math.Min`/`math.Max` usage to the built-ins, with the one exception
- [ ] Use `clear` for both NaN-key correctness and reference hygiene
- [ ] Know when clear-and-reuse beats reallocation, and when it does not
- [ ] Design helpers with `cmp.Ordered` and explicit NaN policy
- [ ] Run a scaled migration off hand-rolled helpers, auditing floats individually
- [ ] Place each task with the right package: built-ins, `slices.*`, `cmp.*`, `maps.*`
- [ ] Apply the review heuristics that catch poisoning, leaks, and truncation confusion

---

## Summary

`min`, `max`, and `clear` are deliberately built-ins, not library functions. `min`/`max` had to be built-ins to fold to compile-time constants, to be variadic without allocation, and to give the ecosystem one canonical, import-free spelling. `clear` had to be a built-in because emptying a map including its unreachable NaN keys, and bulk-zeroing a slice in place, cannot be expressed in pure Go with the same guarantees. The floating-point contract — NaN propagates, negative zero orders below non-negative zero, infinities are extremes — is a deliberate fail-loud, total-order decision that callers with NaN data must respect by filtering.

The senior responsibilities are: migrate off hand-rolled helpers (mechanical for ints and strings, individually audited for floats and `math.Max` call sites); use `clear` for the NaN-key correctness fix and for reference hygiene in pooled slices, while knowing it is neither truncation nor a secure wipe; weigh clear-and-reuse against reallocation by profile rather than reflex; and review for NaN poisoning, reference leaks, and the truncation confusion. The features are small, but they retire a decade of fragmented helpers and close a latent correctness gap — which is exactly why they earned their place in the language rather than a package.
