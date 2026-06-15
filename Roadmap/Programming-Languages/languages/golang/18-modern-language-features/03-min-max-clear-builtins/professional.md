# `min`, `max` & `clear` Built-ins — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where the Built-ins Live in the Compiler](#where-the-built-ins-live-in-the-compiler)
3. [Type-Checking `min` and `max`](#type-checking-min-and-max)
4. [Constant Evaluation in the Type Checker](#constant-evaluation-in-the-type-checker)
5. [Lowering `min`/`max` to SSA](#lowering-minmax-to-ssa)
6. [Floating-Point Lowering: NaN and Signed Zero](#floating-point-lowering-nan-and-signed-zero)
7. [Lowering `clear` on Maps](#lowering-clear-on-maps)
8. [Lowering `clear` on Slices](#lowering-clear-on-slices)
9. [Performance Profile and Benchmarks](#performance-profile-and-benchmarks)
10. [Behaviour Inside Generics (Stencils and Dictionaries)](#behaviour-inside-generics-stencils-and-dictionaries)
11. [Tooling: vet, gopls, linters](#tooling-vet-gopls-linters)
12. [Edge Cases the Spec and Source Reveal](#edge-cases-the-spec-and-source-reveal)
13. [Operational Playbook](#operational-playbook)
14. [Summary](#summary)

---

## Introduction

The professional level treats `min`, `max`, and `clear` not as syntax but as a pipeline: the type checker validates and (for constants) evaluates them; the compiler frontend lowers them to SSA operations; the backend emits comparison/select or memory-clearing instructions. Understanding that pipeline is what lets you predict their performance, explain a surprising NaN or signed-zero result, and reason about how they behave inside generic code.

This file is for engineers who care about generated code, compiler behaviour, and the precise guarantees these built-ins encode. After reading you will:

- Know where in `cmd/compile` and `go/types` these built-ins are handled.
- Reason about constant evaluation vs runtime lowering.
- Predict the SSA and roughly the machine code for `min`/`max` and `clear`.
- Explain the NaN/signed-zero codegen, not just the spec rule.
- Understand `clear`'s lowering to `mapclear` and `memclr` runtime routines.
- Operate confidently around the tooling that handles these features.

These are simple operations. Their value at this level is as a clean, tractable case study in how the Go compiler turns a built-in into instructions.

---

## Where the Built-ins Live in the Compiler

`min`, `max`, and `clear` are predeclared identifiers, registered in the universe scope. The relevant pieces of the toolchain:

- **`go/types`** (and the compiler's internal `types2`) recognizes the calls in `builtins.go`, validates argument counts and types, and computes constant results where applicable. The built-in kinds are `_Min`, `_Max`, and `_Clear`.
- **`cmd/compile/internal/typecheck`** mirrors this for the compiler's own type-checking pass, tagging the AST nodes with `OMIN`, `OMAX`, and `OCLEAR` operations.
- **`cmd/compile/internal/walk`** and **`ssagen`** lower those nodes: `min`/`max` to comparison-and-select SSA; `clear` to calls into `runtime.mapclear` (maps) or a `memclr`/zeroing sequence (slices).

There is no `runtime` function for `min`/`max` — they are inlined comparisons with no call. `clear` *does* reach the runtime for maps (`runtime.mapclear`) and may call `runtime.memclrNoHeapPointers` / `runtime.memclrHasPointers` for slices, depending on whether the element type contains pointers.

Reading `builtins.go` in `go/types` plus the `walkMinMax`/`walkClear` paths in the compiler gives the entire story in a few hundred lines.

---

## Type-Checking `min` and `max`

The type checker enforces, in order:

1. **At least one argument.** Zero args is an error: "not enough arguments".
2. **Each argument's type is ordered** — its underlying type is an integer, float, or string. A non-ordered argument errors: "invalid argument: x (variable of type T) is not ordered".
3. **The arguments share a single type** after the usual operand-combination rules. Untyped constants are converted toward the typed operand; two distinct typed operands are an error.
4. **The result type** is the common argument type, preserving named types.

The combination rules are the same as for a binary comparison `a < b`. The type checker effectively asks: "could these operands appear together in `a < b`?" If yes, `min`/`max` accept them; if no, they are rejected with the same class of error.

For untyped-constant arguments, the result is an untyped constant of the combined kind (e.g. mixing an untyped int and untyped float yields an untyped float), which then takes its default type (`int`, `float64`, etc.) if used in a context that requires a concrete type.

---

## Constant Evaluation in the Type Checker

When every argument is a constant, the type checker computes the result at compile time using arbitrary-precision arithmetic (the `go/constant` package). The comparison is done on `constant.Value`s; the winning value becomes the node's constant value.

```go
const A = max(1<<40, 1<<41)   // evaluated at arbitrary precision → 1<<41
var buf [min(64, 128)]byte    // min folds to 64; legal array length
```

Consequences that fall out of this:

- **Overflow is checked at assignment, not in the fold.** `max(1<<62, 1<<63)` is computed exactly; the error (if any) appears when the result is assigned to a type too small to hold it.
- **Untyped-constant `min`/`max` keep full precision** until forced to a default or target type, exactly like `+` and `*` on untyped constants.
- **A single non-constant argument disables folding.** `max(n, 8)` with variable `n` is a runtime expression and cannot appear where a constant is required.

For floats, constant `min`/`max` apply the same NaN/signed-zero rules — but note that an untyped constant NaN is not expressible (`math.NaN()` is a function call, hence non-constant), so constant float `min`/`max` in practice never involves NaN. The NaN rules matter at runtime.

---

## Lowering `min`/`max` to SSA

For non-constant arguments, the compiler reduces a multi-argument `min`/`max` to a left-fold of two-argument operations:

```
max(a, b, c, d)  ≡  max(max(max(a, b), c), d)
```

Each two-argument `max(x, y)` becomes, in SSA, a comparison feeding a conditional select. On architectures with the relevant instructions, the backend may emit a branchless select; otherwise a compare-and-branch. For integers and strings this is straightforward: `x > y ? x : y` (strings compare via the runtime string-compare for the ordering, then select).

```go
func maxOf(a, b, c int) int { return max(a, b, c) }
```

lowers to roughly:

```
t1 = (a > b) ? a : b
t2 = (t1 > c) ? t1 : c
return t2
```

No allocation, no call, fully inlined at every call site. The variadic form has no slice — the fold is unrolled at compile time based on the argument count, which is why the count must be statically known (you cannot spread a slice into `max`).

---

## Floating-Point Lowering: NaN and Signed Zero

The float case is where codegen earns its keep, because a naive `x > y ? x : y` does **not** satisfy the spec.

Two requirements complicate the lowering:

1. **NaN must propagate.** With IEEE comparisons, `NaN > y` and `y > NaN` are both false, so a naive ternary would return `y` (or `x`) and silently drop the NaN. The compiler must add an explicit NaN check so that any NaN argument forces a NaN result.
2. **Negative zero must order below positive zero.** `-0.0 > 0.0` is false and `-0.0 == 0.0` is true, so the naive select cannot distinguish them. The compiler emits extra logic so that `max(-0.0, 0.0)` yields `+0.0` and `min(-0.0, 0.0)` yields `-0.0`.

The result is that float `min`/`max` lower to a slightly longer sequence than integer `min`/`max`: a primary compare, plus NaN handling, plus signed-zero disambiguation. On amd64 this is typically a small fixed number of instructions (`MINSD`/`MAXSD` family plus correction), not a function call — but it is not a single instruction the way integer `max` can be, precisely because the hardware `MINSD`/`MAXSD` do not match Go's NaN/signed-zero semantics on their own.

The takeaway: integer/string `min`/`max` are essentially free; float `min`/`max` carry a few extra instructions to honour the spec's NaN and signed-zero contract. Both are still allocation-free and call-free.

---

## Lowering `clear` on Maps

`clear(m)` lowers to a call to `runtime.mapclear` (the generic path; the runtime has type-specialized fast variants). `mapclear` walks the map's internal structure and resets it to empty while **retaining** the allocated buckets where possible, so the map can be refilled without reallocating.

Key properties that fall out of the runtime implementation:

- It removes **every** key/value, including keys that are unreachable by `delete` — NaN floats, NaN-containing structs/arrays used as keys, and interfaces wrapping such values. The runtime iterates structurally, not by hash-lookup, so unreachable keys are still cleared.
- A **nil** map argument is handled as a no-op (the lowering guards against it), matching the spec's safety.
- It is **O(buckets)**: proportional to the map's current bucket count, not just its live element count. A map that grew huge and is now small still costs proportional to its capacity to clear.

This last point is the performance-relevant one: `clear(m)` on a map that once held millions of entries is not cheap even if it now holds three, because the bucket array is large. In that situation `m = make(...)` can be faster and also sheds the oversized allocation.

---

## Lowering `clear` on Slices

`clear(s)` zeroes `s[0:len(s)]`. The lowering depends on the element type:

- **Pointer-free element types** (e.g. `[]byte`, `[]int`, `[]float64`): lowered to `runtime.memclrNoHeapPointers` over the `len(s)*elemsize` byte range — a fast, vectorizable memory clear.
- **Pointer-containing element types** (e.g. `[]*T`, `[]string`, `[]any`): lowered to `runtime.memclrHasPointers`, which zeroes while cooperating with the garbage collector's write barriers so the dropped references are observed correctly.

Properties:

- **Only the `len(s)` range is zeroed**, never the capacity region beyond `len`. To zero the whole backing array, clear `s[:cap(s)]`.
- **Length and capacity of the slice header are unchanged** — `clear` operates on the backing array, not the header.
- A **nil** or zero-length slice clears nothing (safe no-op).

For small slices the compiler may inline a short zeroing loop rather than call `memclr`; for larger ranges it calls the runtime routine, which uses SIMD where available. Either way `clear(s)` is typically the fastest correct way to zero a slice — faster and clearer than a hand-written `for i := range s { s[i] = zero }` loop, which the compiler does also recognize and may rewrite to the same `memclr` (the "memclr idiom").

---

## Performance Profile and Benchmarks

What to expect when you benchmark:

| Operation | Cost | Notes |
|-----------|------|-------|
| `max(a, b)` int/string | ~1 compare + select | Inlined, no call, no alloc |
| `max(a, b)` float | a few instructions | Extra NaN + signed-zero handling |
| `max(a, b, c, d)` | unrolled fold | Cost scales with arg count, no alloc |
| constant `max(A, B)` | zero | Folded at compile time |
| `clear(m)` | O(map buckets) | `runtime.mapclear`; retains storage |
| `clear(s)` pointer-free | O(bytes), vectorized | `memclrNoHeapPointers` |
| `clear(s)` with pointers | O(elems), GC-aware | `memclrHasPointers`, write barriers |

Benchmark hygiene for these:

```go
func BenchmarkMax(b *testing.B) {
    x, y := 3, 7
    var sink int
    for i := 0; i < b.N; i++ {
        sink = max(x, y)   // keep x,y non-constant or it folds away
    }
    _ = sink
}
```

If you pass constants, the compiler folds the call and you benchmark nothing. Force the inputs to be variables (and consume the result) to measure the real comparison.

For `clear`, the meaningful comparison is `clear(m)` + refill vs `m = make(...)` + fill across iterations — the former wins when the map stays a similar size, the latter when it once grew large and you want to release buckets.

---

## Behaviour Inside Generics (Stencils and Dictionaries)

`min`/`max`/`clear` inside a generic function are lowered after the generic body is instantiated. When the compiler produces a gcshape stencil for `func F[T cmp.Ordered](...)`, the `max(a, b)` inside it lowers according to `T`'s shape:

- For a stencil shared across integer types of the same shape, the comparison-and-select code is shared.
- For float type arguments, the NaN/signed-zero handling is emitted in the float stencil.

The built-ins do **not** force extra dictionary entries — they are not method calls and need no itab/dictionary lookup. This is part of why building helpers on top of them (`Clamp[T cmp.Ordered]`) is cheap: the generic machinery adds its usual stencil/dictionary cost for the function, but the `min`/`max`/`clear` operations inside add nothing beyond their inlined instructions.

`clear` inside a generic over `~[]E` lowers per the element shape: pointer-bearing shapes get the GC-aware clear, pointer-free shapes get the plain `memclr`. The runtime routine selected is determined at instantiation, not by a runtime type switch.

---

## Tooling: vet, gopls, linters

- **`go vet`** has no special checks for `min`/`max`/`clear` as of current releases, but the type checker it shares catches misuse (wrong arity, mixed types, non-ordered args) at compile time anyway.
- **`gopls`** offers completion and signature help for the built-ins like any predeclared identifier, and its diagnostics surface the same type errors inline. Some quick-fixes can rewrite a manual max `if` into `max(...)`.
- **Static analyzers** (`staticcheck`) flag related smells: a manual `for k := range m { delete(m, k) }` loop may be flagged in favour of `clear`; a hand-rolled `maxInt` helper may be flagged as redundant; a `for i := range s { s[i] = 0 }` loop is recognized as the memclr idiom and is fine, but `clear(s)` is clearer.
- **`gofmt -r` / `eg`** rewrite rules are the practical mechanism for bulk-migrating `maxInt(a, b)` → `max(a, b)` across a codebase.

Because the language-version gate is enforced by the type checker, a project with `go 1.20` in `go.mod` gets a clear compile error rather than silent wrong behaviour — tooling does not need to special-case the version.

---

## Edge Cases the Spec and Source Reveal

- **Single-argument `min(x)`** is legal and returns `x`. Useful only in generated code; harmless.
- **Named-type preservation:** `min(Celsius(1), Celsius(2))` returns `Celsius`, not `float64`. The result is *not* converted to the underlying type.
- **String comparison cost:** `max("a", "b")` uses the runtime string compare for ordering; for many string arguments this is a fold of string compares, each O(min-length). Not free the way integer compare is.
- **`clear` on `s[:0]`** clears nothing (zero-length range). To zero the backing array use `clear(s[:cap(s)])`.
- **`clear(m)` on a map shared via multiple aliases** empties it for all aliases — it is the *map* that is cleared, not a copy.
- **Constant float `min`/`max` cannot involve NaN** because NaN is not a constant expression (`math.NaN()` is a call). NaN handling is purely a runtime concern.
- **Untyped-constant overflow:** `max(1<<63, x)` may be rejected or overflow depending on the target integer width; the fold is exact but the assignment is checked.
- **`clear` rejects arrays directly:** `clear(arr)` is an error; `clear(arr[:])` works because it passes a slice.

These are pointers to *reach for the spec and source* when a result surprises you. The implementation is small and well-commented; an afternoon with `builtins.go` and the `walkMinMax`/`walkClear` paths resolves most questions.

---

## Operational Playbook

| Scenario | Recipe |
|----------|--------|
| Enable the built-ins | Set `go 1.21`+ in `go.mod`; upgrade the toolchain. |
| Migrate `maxInt`/`minInt` | `gofmt -r 'maxInt(a, b) -> max(a, b)'`; audit float helpers by hand. |
| Empty a map for reuse | `clear(m)` then refill; avoids reallocation. |
| Empty a map that grew huge | `m = make(...)` to shed oversized buckets. |
| Zero a slice's contents | `clear(s)` (len range) or `clear(s[:cap(s)])` (full backing array). |
| Empty a slice keeping capacity | `s = s[:0]` (pair with `clear(s)` first for pointer slices). |
| Remove NaN map keys | `clear(m)` — `delete` cannot. |
| Clamp a value | `min(max(x, lo), hi)`; consider a `cmp.Ordered` helper. |
| Largest element of a slice | `slices.Max(s)` (panics on empty), not `max`. |
| Benchmark `min`/`max` | Force variable inputs and consume the result, or it folds away. |
| Debug a surprising NaN result | A NaN argument poisons; filter before reducing. |
| Debug a surprising `-0` in output | Signed-zero ordering: `min(-0, 0) == -0`. |

---

## Summary

`min`, `max`, and `clear` are predeclared built-ins handled end-to-end by the toolchain: validated and constant-folded by the type checker (`go/types` `builtins.go`), lowered by the compiler frontend to SSA. `min`/`max` over integers and strings become inlined compare-and-select with no call and no allocation; over floats they carry a few extra instructions to honour the spec's NaN-propagation and signed-zero rules, because the hardware min/max instructions alone do not match Go's semantics. Multi-argument forms are a compile-time-unrolled left-fold, which is why the argument count must be static and a slice cannot be spread.

`clear` lowers to `runtime.mapclear` for maps — clearing every entry including unreachable NaN keys, retaining buckets, and costing O(bucket count) — and to `memclrNoHeapPointers`/`memclrHasPointers` for slices, zeroing the `len(s)` range (GC-aware for pointer elements) without touching the header's length or capacity. Inside generics the built-ins add no dictionary cost and lower per instantiation shape. The practical operational knowledge is knowing when `clear`-and-reuse beats reallocation, that float `min`/`max` carry NaN/signed-zero handling, and that the built-ins are not slice-aware — `slices.Min`/`slices.Max` own that job. The features are simple; mastering where the work actually happens in the pipeline is the professional insight.
