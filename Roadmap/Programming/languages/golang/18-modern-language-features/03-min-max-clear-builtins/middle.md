# `min`, `max` & `clear` Built-ins — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Exact Type Rules for `min` and `max`](#the-exact-type-rules-for-min-and-max)
3. [Untyped Constants and Mixed Operands](#untyped-constants-and-mixed-operands)
4. [Constant Folding and Compile-Time Use](#constant-folding-and-compile-time-use)
5. [Floating-Point: NaN, Signed Zero, Infinities](#floating-point-nan-signed-zero-infinities)
6. [`min`/`max` vs `math.Min`/`math.Max`](#minmax-vs-mathminmathmax)
7. [`clear` on Maps: Precise Semantics](#clear-on-maps-precise-semantics)
8. [`clear` on Slices: Precise Semantics](#clear-on-slices-precise-semantics)
9. [Using the Built-ins Inside Generics](#using-the-built-ins-inside-generics)
10. [`min`/`max` vs `slices.Min`/`slices.Max`](#minmax-vs-slicesminslicesmax)
11. [Migration: Retiring Hand-Rolled Helpers](#migration-retiring-hand-rolled-helpers)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [Best Practices for Real Codebases](#best-practices-for-real-codebases)
14. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

You already know the mechanics: `min`/`max` return the smallest/largest of their arguments, `clear` empties a map or zeroes a slice. The middle-level questions are *what exactly are the type rules*, *when does the result fold to a constant*, *how do floats with NaN and signed zero behave*, and *how do these built-ins differ from the library functions they superficially resemble*.

This file pins down the spec-level behaviour you can rely on, the floating-point corners that bite, and the migration path off the `maxInt`/`minInt` helpers that pre-1.21 code carries.

After reading this you will:
- Know the precise type rules and inference for `min`/`max`
- Predict when a `min`/`max` expression is a compile-time constant
- State the NaN and signed-zero rules from the spec, and contrast them with `math.Min`/`math.Max`
- Know exactly what `clear` does to maps vs slices, including length/capacity invariants
- Use the built-ins inside generic functions constrained by `cmp.Ordered`
- Migrate a codebase off hand-rolled helpers without behavioural drift

---

## The Exact Type Rules for `min` and `max`

The spec rules, stated precisely:

- `min` and `max` take **one or more arguments** (`min(x, y, ...)`). Zero arguments is a compile error.
- The arguments must be of an **ordered type**: integers, floating-point, or strings — or named types whose underlying type is one of those. Ordered means the `<` operators are defined.
- The arguments must all be of a **single type**, after Go's normal rules for combining operands (untyped constants are converted to fit). You cannot call `max(intVar, floatVar)`.
- The **result type is that single argument type**, including named types. `min(c1, c2)` where both are `Celsius` returns a `Celsius`.

```go
type Celsius float64

func cooler(a, b Celsius) Celsius {
    return min(a, b)   // returns Celsius, not float64
}
```

A single-argument call is legal and returns the argument unchanged: `min(x) == x`. It is rarely useful but is what the "one or more" rule means.

Bool, struct, pointer, slice, map, channel, function, and interface arguments are rejected — none of those are ordered types.

---

## Untyped Constants and Mixed Operands

The "single type" rule interacts with untyped constants the same way binary operators do. Untyped constants adapt to fit:

```go
max(1, 2)        // both untyped int constants → result untyped, defaults to int
max(1, 2.0)      // 2.0 is an untyped float constant; 1 converts → float64 result
max(1.5, 2)      // 2 converts to float → 2.0; result 2.0 (float64)
```

When one operand is a *typed variable*, the untyped constant must be representable in that type:

```go
var i int = 5
max(i, 3)        // OK: 3 fits in int
max(i, 3.0)      // OK: 3.0 is integral, representable as int → 3
max(i, 3.5)      // COMPILE ERROR: 3.5 not representable as int
```

And two *differently typed* variables never mix:

```go
var i int
var f float64
max(i, f)            // COMPILE ERROR — different types
max(float64(i), f)   // OK — explicit conversion
```

The mental rule: `min`/`max` follow the *same* operand-combination rules you already know from `i + f` arithmetic. If `a < b` would not compile, neither will `min(a, b)`.

---

## Constant Folding and Compile-Time Use

If **every** argument is a constant, the whole `min`/`max` expression is a constant, evaluated by the compiler. This is something no ordinary function — generic or not — can do.

```go
const Window = max(1024, 4096)      // Window is the constant 4096
var buf [min(64, 128)]byte          // a [64]byte — array size needs a constant
const Half = min(Window/2, 4096)    // composes with other constant exprs
```

Constant `min`/`max` participate in untyped-constant arithmetic with full precision and overflow checking. `max(1<<62, 1<<63)` is evaluated at arbitrary precision and only checked against the target type when assigned.

The moment any argument is a *variable*, the expression is no longer constant and cannot be used where a constant is required:

```go
n := readSize()
var arr [max(n, 8)]byte   // COMPILE ERROR — n is not a constant
```

This is the practical reason to remember the rule: array sizes, `const` declarations, and other constant contexts only accept all-constant `min`/`max`.

---

## Floating-Point: NaN, Signed Zero, Infinities

For floating-point arguments the spec defines exact behaviour, and it is worth memorizing because it surprises people:

- **NaN propagates.** If *any* argument is a NaN, the result is a NaN. `max(1.0, NaN) == NaN`, `min(1.0, NaN) == NaN`. The built-ins do not "skip" NaN.
- **Negative zero is smaller than non-negative zero.** `min(-0.0, 0.0) == -0.0` and `max(-0.0, 0.0) == 0.0`. Even though `-0.0 == 0.0` is `true`, `min`/`max` order them.
- **Infinities are extremes.** `min(math.Inf(-1), y) == -Inf`, `max(math.Inf(1), y) == +Inf` for any non-NaN `y`.

```go
import "math"

max(1.0, math.NaN())                       // NaN
min(1.0, math.NaN())                       // NaN
max(0.0, math.Copysign(0, -1))             // 0.0  (positive zero wins for max)
min(0.0, math.Copysign(0, -1))             // -0.0 (negative zero wins for min)
max(math.Inf(1), 1e308)                    // +Inf
```

The NaN rule has a sharp practical consequence: a single NaN anywhere in a reduction poisons the whole result. If you compute `running = max(running, x)` in a loop and one `x` is NaN, `running` becomes NaN and stays NaN forever after. Defensive code filters NaN before reducing.

The signed-zero rule almost never matters in production, but it will appear in a test that prints `-0` instead of `0`, and you should recognize why.

---

## `min`/`max` vs `math.Min`/`math.Max`

This is the comparison interviewers love, because the functions look interchangeable and are not.

`math.Min` and `math.Max` are `float64`-only library functions that predate the built-ins. Their documented special cases:

```
math.Max(x, +Inf) = +Inf      math.Min(x, -Inf) = -Inf
math.Max(x, NaN)  = NaN        math.Min(x, NaN)  = NaN
math.Max(+0, ±0)  = +0         math.Min(-0, ±0)  = -0
```

The built-ins follow the spec's rules above. Both produce NaN for a NaN argument and both order signed zeros in the same direction. The Go documentation explicitly notes that the built-in `max`/`min` "differs from" `math.Max`/`math.Min` for the NaN-and-infinity combinations — the math functions were specified for strict IEEE-754 `maxNum`/`minNum`-style behaviour, while the built-ins are defined directly by the language. The practical guidance:

- For **any ordered type**, and for new code, use the **built-ins**. They are generic, allocate nothing, and fold constants.
- Use `math.Min`/`math.Max` only when you specifically need their documented IEEE behaviour, or for compatibility with existing float-only code. There is rarely a reason to reach for them in new code.

The trap: writing `math.Max(a, b)` on two `int` values does not compile (`math.Max` wants `float64`), but `max(a, b)` does. Conversely, copy-pasting old `math.Max` code into a context expecting `int` silently forces float conversions. Know which one you mean.

---

## `clear` on Maps: Precise Semantics

`clear(m)` deletes all entries from map `m`. The precise guarantees:

- It empties the map **in place**: the variable still refers to the same map, with the same backing storage retained for reuse.
- `len(m)` becomes `0`.
- It removes **all** keys, including keys that `delete` cannot reach — specifically `float`/`complex` NaN keys, for which `delete(m, k)` is a no-op because `NaN != NaN`.
- `clear` of a **nil** map is a safe no-op (no panic).

```go
m := map[float64]int{}
m[math.NaN()] = 1
m[math.NaN()] = 2          // each NaN insert is a distinct, unreachable key
len(m)                     // 2

for k := range m {
    delete(m, k)           // deletes nothing — NaN keys never match
}
len(m)                     // still 2

clear(m)
len(m)                     // 0 — clear removes them
```

Because `clear` retains the backing storage, the idiom `clear(m); /* refill */` reuses the allocation across iterations and is cheaper than `m = make(...)` each time.

---

## `clear` on Slices: Precise Semantics

`clear(s)` sets every element in `s[0:len(s)]` to the zero value of the element type. The precise guarantees:

- **Length and capacity are unchanged.** `clear` never reslices or reallocates.
- It zeroes the **length** range, not the capacity range: elements between `len(s)` and `cap(s)` are untouched.
- For element types containing pointers (`[]*T`, `[]string`, `[]any`), zeroing drops the references, letting the garbage collector reclaim what they pointed at.
- `clear` of a **nil** slice is a safe no-op.

```go
s := make([]int, 3, 5)     // len 3, cap 5, contents [0 0 0]
s[0], s[1], s[2] = 1, 2, 3
clear(s)
fmt.Println(s, len(s), cap(s))   // [0 0 0] 3 5
```

The distinction from truncation is the thing to internalize:

| Goal | Operation | Result |
|------|-----------|--------|
| Zero every element | `clear(s)` | same len, same cap, zeroed |
| Empty, keep capacity | `s = s[:0]` | len 0, same cap, old data still in backing array |
| Drop everything | `s = nil` | len 0, cap 0, garbage-collectable |

A subtle leak: `s = s[:0]` empties the slice's *view* but the backing array still holds the old elements (and their references). For a slice of pointers you want both: `clear(s)` to drop references, then `s = s[:0]` to reset length — or use `clear(s[:cap(s)])` if you need the whole backing array zeroed.

---

## Using the Built-ins Inside Generics

`min`/`max` work inside generic functions whose type parameter is constrained by `cmp.Ordered`:

```go
import "cmp"

func Clamp[T cmp.Ordered](x, lo, hi T) T {
    return min(max(x, lo), hi)
}

func RunningMax[T cmp.Ordered](xs []T) T {
    m := xs[0]
    for _, x := range xs[1:] {
        m = max(m, x)
    }
    return m
}
```

`cmp.Ordered` is the standard-library constraint (Go 1.21) for "any ordered type." Because the built-ins themselves accept any ordered type, they compose cleanly with a `cmp.Ordered`-constrained type parameter — no instantiation needed, the call is monomorphized like any other generic body.

`clear` also works generically. For a type parameter constrained to a slice or map type, `clear(v)` does the right thing:

```go
func Reset[S ~[]E, E any](s S) {
    clear(s)              // zeroes the slice generically
}
```

This is how the standard `slices`/`maps` packages reuse `clear` internally.

---

## `min`/`max` vs `slices.Min`/`slices.Max`

A frequent confusion: the built-ins are **not** slice-aware.

```go
nums := []int{3, 1, 4}
max(nums...)        // COMPILE ERROR
max(nums[0], nums[1], nums[2])   // works, but only because you spelled out the elements
```

For the largest/smallest element *of a slice*, use the `slices` package (Go 1.21):

```go
import "slices"

slices.Max(nums)    // 4
slices.Min(nums)    // 1
```

`slices.Min`/`slices.Max` panic on an empty slice and are themselves implemented using the `max`/`min` built-ins in a loop. The division of labour: built-ins for a fixed set of values, `slices.*` for a collection.

---

## Migration: Retiring Hand-Rolled Helpers

Most pre-1.21 codebases carry helpers like:

```go
func maxInt(a, b int) int { if a > b { return a }; return b }
func minInt(a, b int) int { if a < b { return a }; return b }
func maxF(a, b float64) float64 { ... }
```

Migration steps:

1. **Bump `go.mod` to `go 1.21`+.** Required before the built-ins exist.
2. **Replace call sites.** `maxInt(a, b)` → `max(a, b)`; `minInt(a, b)` → `min(a, b)`. The semantics match for integers exactly.
3. **Watch the float helpers.** If your `maxF` was a thin wrapper over `if a > b`, the built-in matches it. If it called `math.Max`, the NaN/signed-zero behaviour differs slightly — review any code that could see NaN.
4. **Delete the now-unused helpers.** A linter (`unused`/`deadcode`) will flag them.
5. **Collapse manual `if` ladders** where a `min`/`max` is clearer, but only where it does not hide important logic.

A `gofmt`-style rewrite or a `gopls` quick-fix can mechanize most of the call-site changes. Test float-touching code paths specifically.

---

## Common Errors and Their Real Causes

### `undefined: min` / `undefined: max` / `undefined: clear`

The `go` directive in `go.mod` is below `1.21`, or the toolchain is older. Fix: upgrade Go, set `go 1.21`+.

### `invalid argument: arguments to min must have the same type`

Mixed operand types, e.g. `max(intVar, floatVar)`. Fix: convert one side explicitly.

### `invalid argument: cannot use ... (untyped float constant 3.5) ... not representable by int`

An untyped constant that does not fit the typed operand: `max(intVar, 3.5)`. Fix: use a representable constant or convert the variable to float.

### `invalid argument: ... (variable of type Foo) is not ordered`

A non-ordered type (struct, bool, pointer). Fix: compare an ordered field or rethink the design.

### `invalid argument: clear expects map or slice; ... is array`

`clear` of an array. Fix: `clear(arr[:])`.

### Result is unexpectedly NaN

A NaN slipped into a float `min`/`max`. Fix: filter NaN before reducing, or validate inputs.

---

## Best Practices for Real Codebases

1. **Require Go 1.21+ and migrate off hand-rolled helpers.** One canonical spelling beats a dozen `maxInt` copies.
2. **Use the built-ins for fixed argument sets; use `slices.Min`/`slices.Max` for collections.** Do not allocate a slice to call `max`.
3. **Treat NaN deliberately.** If float inputs can be NaN and you do not want poisoning, filter first.
4. **Prefer `clear(m)` over a `delete` loop**, especially when NaN keys are possible.
5. **Know `clear(s)` zeroes, not truncates.** Pair with `s = s[:0]` when you need an empty slice with retained capacity.
6. **Use `clear` to drop references in pooled slices** before returning them to a pool.
7. **Keep argument types identical** to avoid silent float conversions.
8. **Use `cmp.Ordered` for generic helpers** that wrap `min`/`max`/`clamp`.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — NaN poisoning a running reduction

`best = max(best, x)` in a loop turns `best` into NaN permanently if any `x` is NaN. Symptom: a metric reads `NaN`. Fix: filter or use a NaN-skipping reducer.

### Pitfall 2 — Expecting `clear(s)` to empty the slice

Code does `clear(buf)` then iterates `buf` expecting nothing, but `len(buf)` is unchanged so it iterates zero values. Fix: `buf = buf[:0]` for an empty slice.

### Pitfall 3 — `clear(s[:0])` does nothing

A zero-length slice has no elements to clear. If you meant to zero the backing array, use `clear(s[:cap(s)])`. Symptom: stale data lingers in the capacity region.

### Pitfall 4 — Reference leak after `s = s[:0]`

Truncating without clearing leaves the backing array holding old pointers, pinning memory. Fix: `clear(s)` before truncating, or `clear(s[:cap(s)])`.

### Pitfall 5 — `math.Max` vs `max` confusion

A reviewer "simplifies" `max(a, b)` to `math.Max(a, b)` on floats and changes NaN/signed-zero behaviour, or breaks an `int` call site. Fix: keep the built-in; reserve `math.Max` for code that needs its specific IEEE rules.

### Pitfall 6 — Forgetting `min`/`max` need ≥1 arg in generated code

Code generators that build argument lists can emit `max()` with zero args from an empty input set, which does not compile. Fix: special-case the empty input.

### Pitfall 7 — Untyped-constant overflow surprises

`max(1<<63, x)` where `x` is an `int` may overflow on 32-bit platforms or be rejected. Fix: be explicit about the integer type and width.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] State the exact type and ordered-type rules for `min`/`max`
- [ ] Predict whether a given `min`/`max` expression is a compile-time constant
- [ ] Recite the NaN, signed-zero, and infinity rules for float `min`/`max`
- [ ] Explain how the built-ins differ from `math.Min`/`math.Max`
- [ ] State the length/capacity invariants of `clear` on a slice
- [ ] Explain why `clear` removes NaN map keys and `delete` cannot
- [ ] Use `min`/`max`/`clear` inside `cmp.Ordered`-constrained generics
- [ ] Choose between the built-ins and `slices.Min`/`slices.Max`
- [ ] Migrate a codebase off `maxInt`/`minInt` without behavioural drift
- [ ] Avoid the reference-leak and NaN-poisoning pitfalls

---

## Summary

`min` and `max` follow the language's ordinary operand-combination rules: one or more arguments of a single ordered type, result of that same type (named types preserved), and a compile-time constant when all arguments are constants — usable as array sizes and in `const` blocks. For floats, NaN poisons the result, negative zero orders below non-negative zero, and infinities are the extremes; these rules are the language's own and differ in documented corners from the older `float64`-only `math.Min`/`math.Max`.

`clear` is two operations selected by argument kind: on a map it deletes every entry in place — including NaN keys that `delete` cannot reach, the headline motivation for the built-in — and on a slice it zeroes every element across `len(s)` while leaving length and capacity untouched, which is distinct from truncation (`s = s[:0]`) and from nil-ing (`s = nil`). All three built-ins compose with `cmp.Ordered` generics and are not slice-aware (use `slices.Min`/`slices.Max` for collections). Migrate off hand-rolled helpers, treat NaN deliberately, and remember that `clear(s)` zeroes rather than empties.
