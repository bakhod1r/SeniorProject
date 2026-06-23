# Generic Performance — Specification

## Table of Contents
1. [Source of truth](#source-of-truth)
2. [The Go spec is silent on implementation](#the-go-spec-is-silent-on-implementation)
3. [The implementation design documents](#the-implementation-design-documents)
4. [GC shape stenciling — design doc](#gc-shape-stenciling-design-doc)
5. [Dictionaries — design doc](#dictionaries-design-doc)
6. [Compiler source pointers](#compiler-source-pointers)
7. [Runtime behavior excerpts](#runtime-behavior-excerpts)
8. [Stable vs unstable contracts](#stable-vs-unstable-contracts)
9. [Summary](#summary)

---

## Source of truth

For generic performance there are **three** layers to consult, in order of precedence:

1. **The Go Programming Language Specification** (`https://go.dev/ref/spec`) — defines what programs **mean**, not how they perform.
2. **The Type Parameters Proposal** (`design/43651-type-parameters.md`) — accepted design.
3. **Implementation design documents** in `golang.org/proposal` — the actual mechanism.

For day-to-day work the spec is enough. For arguing about runtime cost, the implementation docs are the canonical references.

---

## The Go spec is silent on implementation

A crucial point: the Go specification **does not** mandate any particular implementation strategy for generics. From the spec on type parameters:

> Within a type parameter list of a generic type, all non-blank names must be unique. The scope of a type parameter is the entire declaration the type parameter list belongs to.

That sentence is about **scoping**, not codegen. The spec lays out semantics — what `[T any]` means, what `comparable` allows, when type inference succeeds. It says nothing about whether the compiler monomorphizes, erases, or stencils.

This is intentional. A Go compiler implementer can choose any strategy that produces a program with the specified behavior. In practice, the official `gc` toolchain uses **GC shape stenciling with dictionary passing**, but a hypothetical alternative implementation could monomorphize without violating the spec.

### What that means for performance

Performance characteristics are a property of the **implementation**, not the **language**. When you read benchmarks, you are measuring the `gc` toolchain on a specific Go release. A different toolchain (`gccgo`, an experimental fork) might produce different numbers. The portable, future-proof view is:

- The spec guarantees **type safety** and **semantic behavior**.
- The implementation guarantees current benchmark numbers.
- Future implementations may change the numbers, not the meaning.

---

## The implementation design documents

The Go team published a series of implementation design documents under `golang.org/proposal/+/refs/heads/master/design/`. The two essential ones for performance:

### `generics-implementation-gcshape.md`

Authors: Keith Randall (and others), 2021. Describes how the compiler groups types into shapes for stenciling.

Key excerpt (paraphrased):

> A GC shape is a property of the type which determines how the GC and the rest of the runtime see the type. Two types with the same GC shape are interchangeable from the runtime's point of view. […] We generate one stencil per GC shape, which keeps binary growth proportional to the number of distinct shapes rather than the number of distinct types.

The doc enumerates which type properties define a shape:
- Size in bytes
- Pointer-bit pattern
- Alignment
- Whether the type is itself an interface

Two `*T` types with the same size and pointer pattern share a shape. Two struct types with identical layouts share a shape.

### `generics-implementation-dictionaries.md`

Authors: Randall, Cox, Taylor, Griesemer (and others), 2021. Describes the dictionary structure passed to a stencil body.

Key excerpts (paraphrased):

> Each generic function receives a hidden first argument: a pointer to a dictionary describing the type arguments. The dictionary contains the runtime type descriptors, equality functions, hash functions, and method tables that the body needs to operate on values of the parameterized types.

> Where possible, the compiler eliminates the dictionary call by inlining the body or by devirtualizing the indirect call when the concrete type is known at the call site.

The doc also covers:
- Layout of the dictionary structure
- How sub-dictionaries are nested for generics calling other generics
- Performance trade-offs the team accepted

### `generics-implementation-stenciling.md`

Earlier alternative considered: pure monomorphization (one body per type). Rejected because of binary size growth. The doc explains why and references C++ template metrics.

### `generics-implementation-dictionaries-go1.18.md`

The shipping plan for 1.18 — what landed, what was deferred, known performance limitations.

---

## GC shape stenciling — design doc

A useful summary of the doc's claims:

| Claim | Implication |
|-------|-------------|
| One stencil per GC shape | Binary growth is sub-linear in the number of types |
| Pointer-shaped types share one stencil | Diverse pointer types pay dictionary cost on type-dependent ops |
| Numeric types may have unique shapes | Numeric generics often inline cleanly |
| Dictionary holds equality, hash, type descriptor | Operations like `==` on `comparable` go through the dictionary by default |

### Trade-offs explicitly accepted

The design doc lists trade-offs the team chose deliberately:

1. **Some runtime cost on shape-shared instantiations** — accepted in exchange for binary size.
2. **Compile-time devirtualization is a "best effort"** — not all dictionary calls become direct calls.
3. **No explicit specialization syntax** — the language has no `func F[int](...)` form.

These are commitments to the implementation strategy that affect everyday performance.

---

## Dictionaries — design doc

The dictionary design doc is the authoritative description of what a generic call passes around.

### Dictionary contents (paraphrased from the doc)

Each dictionary contains:

1. **Type descriptors** — `*runtime._type` for each type parameter.
2. **Sub-dictionaries** — for generic functions called from within the body.
3. **Method tables (itabs)** — when the constraint includes methods.
4. **Operation closures** — for `==`, hash, and similar on `comparable` constraints.

### Key performance excerpts

Paraphrased:

> The dictionary is built once per call site that passes a unique combination of type arguments. The compiler emits a static dictionary value into the binary for each such combination, avoiding any runtime allocation.

> Dictionary lookups are typically a single indirect function call. On modern hardware this costs roughly 1-3 ns when the prediction is good and the cache line is hot, and 10-30 ns on a cold path.

These numbers explain the per-iteration penalties seen in benchmarks of pointer-shape generics.

### When the dictionary disappears

The doc lists four scenarios:

1. **Inlining** — the body is inlined into the caller; the dictionary is constant-folded.
2. **Devirtualization** — the compiler proves the concrete type at the call site and replaces the indirect call.
3. **Constant-fold of a primitive op** — `int + int` is recognised regardless of the dictionary.
4. **PGO-driven specialization** — the compiler emits a fast-path for the dominant type observed in the profile.

---

## Compiler source pointers

For readers who want to read the actual code:

| File | Purpose |
|------|---------|
| `cmd/compile/internal/typecheck/iexport.go` | Mangling of generic symbols — how `Sum[int]` becomes a name |
| `cmd/compile/internal/reflectdata/reflect.go` | Type descriptor generation |
| `cmd/compile/internal/noder/stencil.go` | Stencil emission |
| `cmd/compile/internal/typecheck/subr.go` | Dictionary structure |
| `runtime/iface.go` | Interface conversion (relevant when generics box) |
| `runtime/runtime2.go` | `_type` definition |

Not for casual reading — but if you are debugging a regression in the compiler, these are the places.

---

## Runtime behavior excerpts

The Go runtime has a few generic-specific code paths:

### `runtime.convT2I*` family

Used when the compiler emits a "convert T to interface" operation. Generic functions calling `fmt.Println(v)` go through here. Optimization in successive Go releases has reduced these costs measurably.

### `runtime.mapaccess*` and friends

Map access for generic maps uses the same fast-path as concrete maps when the key shape and hash function are well-known. `runtime.mapaccess2_fast64` handles 64-bit integer keys at concrete speed; generic maps over `[K comparable, V any]` reach this path when `K` is `int`.

### `runtime.eqstring`, `runtime.cmpstring`

Generic string comparisons go through the standard string equality functions. No dictionary cost beyond the indirection itself.

### `runtime.ifaceeq`

Two interface values compared with `==` end up here. Pre-1.20, `comparable` excluded interfaces; post-1.20, this path can be reached and may panic if the dynamic types are not comparable.

---

## Stable vs unstable contracts

A subtle point for advanced readers:

| Contract | Stability |
|----------|-----------|
| Spec semantics (what code does) | Stable — backed by Go 1 compatibility |
| Performance characteristics (how fast) | Unstable — improves each release, occasionally regresses |
| Binary size of generic instantiations | Unstable — varies by release |
| `pprof` symbol names (`go.shape.X`) | Conventionally stable but not guaranteed |
| `gcflags=-m` output format | Unstable; intended for human eyes |
| Dictionary layout in memory | Internal — not part of any contract |

The practical implication: never rely on a specific dictionary layout, never write code that depends on a specific stencil being shared. The compiler is free to change either at any time.

---

## Summary

The Go specification deliberately avoids dictating how generics are implemented. Performance is a property of the **toolchain** — currently, the official `gc` compiler uses **GC shape stenciling with dictionary passing**, formally described in two design documents under `golang.org/proposal/`.

For everyday work:

1. Read the **spec** for semantics.
2. Read the **type parameters proposal** for design rationale.
3. Read the **implementation design docs** when you need to argue about performance.
4. Read the **compiler source** when you need to debug a specific issue.
5. Treat performance characteristics as **release-specific** — re-benchmark with each Go upgrade.

The lesson is that "Go generics performance" is not a fixed property of the language. It is a property of the current implementation, observable through `pprof`, configurable via PGO, and likely to keep improving. A specification-aware engineer separates **what the language guarantees** from **what the toolchain does today**.

Move on to `interview.md` to drill the implementation-level questions you will face on senior interviews.
