# Method Dispatch — Specification

> **Reference**: Go Language Specification — §Calls, §Selectors, §Method_values, §Method_expressions
> **Implementation**: `cmd/compile/internal/devirtualize`, `cmd/compile/internal/inline`, `cmd/compile/internal/pgo`, `runtime/iface.go`, `runtime/runtime2.go`

---

## Table of Contents

1. [Spec Reference for Method Calls](#1-spec-reference-for-method-calls)
2. [Defined Behavior of a Method Call](#2-defined-behavior-of-a-method-call)
3. [Static vs Dynamic Dispatch — Spec Mapping](#3-static-vs-dynamic-dispatch-spec-mapping)
4. [`itab` and `iface` — Runtime Layout](#4-itab-and-iface-runtime-layout)
5. [Compiler Optimization Guarantees](#5-compiler-optimization-guarantees)
6. [Devirtualization — Documented Behavior](#6-devirtualization-documented-behavior)
7. [PGO — Documented Behavior (Go 1.21+)](#7-pgo-documented-behavior-go-121)
8. [Generics Stenciling — Documented Behavior (Go 1.18+)](#8-generics-stenciling-documented-behavior-go-118)
9. [Implementation-Specific Details](#9-implementation-specific-details)
10. [Version History](#10-version-history)
11. [Related Spec Sections](#11-related-spec-sections)

---

## 1. Spec Reference for Method Calls

### Calls — Official Text

> A method call `x.m()` is valid if the method set of (the type of) `x` contains
> `m` and the argument list can be assigned to the parameter list of `m`. If `x`
> is addressable and `&x`'s method set contains `m`, `x.m()` is shorthand for
> `(&x).m()`.

Source: https://go.dev/ref/spec#Calls

### Selectors — Official Text

> For a value `x` of type `T` or `*T` where `T` is not a pointer or interface
> type, `x.f` denotes the field or method at the shallowest depth in `T` where
> there is such an `f`.

Source: https://go.dev/ref/spec#Selectors

### Method Expressions — Official Text

> `T.M` yields a function value, where the receiver is the first parameter of
> the resulting function. The expression `T.M` is equivalent to a function
> literal: `func(t T, args) (results) { return t.M(args) }`.

Source: https://go.dev/ref/spec#Method_expressions

The Go specification deliberately does **not** prescribe whether a method call
is dispatched statically or dynamically. That is an implementation concern.

---

## 2. Defined Behavior of a Method Call

The spec specifies *semantics*, not *mechanism*:

| Property | Specified by spec? |
|---|---|
| Which method body runs | Yes — by method-set rules |
| Argument evaluation order | Yes — left to right |
| Whether the call is direct or indirect | No — implementation choice |
| Whether the call is inlined | No — implementation choice |
| Whether `itab` exists | No — runtime artifact, not language |

A conforming Go implementation could use any dispatch mechanism, including one
without an `itab`-style table, as long as the observable semantics match.

---

## 3. Static vs Dynamic Dispatch — Spec Mapping

### Static dispatch (gc compiler)

A call `x.M()` is statically dispatched when the compiler can determine the
concrete type of `x` at compile time. The spec guarantees the result; the
implementation decides the mechanism.

```go
var t T
t.M() // gc emits a direct CALL to T.M
```

### Dynamic dispatch (gc compiler)

A call `i.M()` where `i` has an interface type uses the runtime `itab` to find
the function pointer. The spec only requires that `M` from the method set of
the dynamic type of `i` is invoked.

```go
var i I = T{}
i.M() // gc loads itab.fun[k] and emits an indirect CALL
```

### Method values

```go
fn := t.M
```

The spec says `fn` is a function value whose receiver is bound to the value of
`t` evaluated *once* at the point of the method-value creation. In gc this is
implemented as a closure containing the receiver and a function pointer.

### Method expressions

```go
fn := T.M
```

The spec says `fn` is a function value of type `func(T, args) results`. The
receiver is *not* bound; it is supplied at call time. In gc this is a direct
function pointer to the method body — no closure.

---

## 4. `itab` and `iface` — Runtime Layout

The runtime's interface layout is documented in `runtime/runtime2.go`. The key
types are:

```go
// runtime/runtime2.go
type iface struct {
    tab  *itab
    data unsafe.Pointer
}

type eface struct {
    _type *_type
    data  unsafe.Pointer
}

type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32       // copy of _type.hash for type switches
    _     [4]byte
    fun   [1]uintptr   // variable-sized; one per interface method
}
```

Source: `src/runtime/runtime2.go`

### `iface` invariants

- For any interface variable holding a non-nil value, `tab` is non-nil and
  `tab.fun[i]` is non-zero.
- A zeroed `iface` (both fields nil) represents the nil interface.
- An interface holding a `nil` concrete pointer has `tab` non-nil but `data`
  nil — the famous "typed nil" pitfall.

### `eface` invariants

- Used for `interface{}` (also called `any`).
- Has no method table — `_type` only.
- Method calls on an `eface` value require either a type assertion or
  reflection.

### `getitab` lookup

`runtime.getitab(inter *interfacetype, typ *_type, canfail bool) *itab` is the
lazy populator. First call for a `(inter, typ)` pair allocates and fills `fun[]`
by walking the type's method table. Subsequent calls return the cached itab.

Source: `src/runtime/iface.go`

---

## 5. Compiler Optimization Guarantees

The Go compiler (gc) makes **no formal guarantees** about which calls are
inlined, devirtualized, or escape-analyzed. These are best-effort
optimizations subject to change between releases.

### Stable expectations (informal)

- Calls to methods with bodies under the inline budget (~80 nodes since 1.22)
  are usually inlined when statically dispatched.
- Calls through interface variables that are locally proven to be a single
  concrete type are usually devirtualized.
- PGO-driven devirtualization fires for hot call sites with strong bias (>~80%
  toward one concrete type).

### Things explicitly not guaranteed

- Tail-call optimization: **not performed**.
- Cross-function devirtualization without PGO: **not performed**.
- Stable inline-budget across versions: **may change**.

For these reasons, optimization-sensitive code should be benchmark-validated on
the target Go version.

---

## 6. Devirtualization — Documented Behavior

The compiler's devirtualization pass lives in
`cmd/compile/internal/devirtualize`. Its job is to identify interface call
sites whose receiver has a provable concrete type and rewrite them as direct
calls.

### Static devirtualization triggers

1. Local assignment dominates the call:
   ```go
   var i I = &Concrete{}
   i.M() // rewritten
   ```
2. Type assertion immediately precedes use:
   ```go
   c := i.(*Concrete)
   c.M() // already direct
   ```
3. Inlined caller passes a known concrete type to a callee parameter.

### Static devirtualization non-triggers

- Interface variable is a struct field.
- Multiple concrete types reach the call along different paths.
- Function call between assignment and use that could mutate the variable.

### Diagnostic flag

```bash
go build -gcflags='-m=2' ./...
# main.go:42:5: devirtualizing i.M to *Concrete
```

---

## 7. PGO — Documented Behavior (Go 1.21+)

Profile-Guided Optimization is documented at https://go.dev/doc/pgo. The
relevant Go release notes:

- Go 1.20: PGO preview (CPU profile-driven inlining).
- Go 1.21: PGO general availability; devirtualization driven by PGO.
- Go 1.22: PGO improvements; build speed and effectiveness gains.

### How PGO devirtualization works (documented)

1. The compiler reads a CPU profile (`pprof` format) from `default.pgo` or the
   `-pgo=` flag.
2. For each interface call site, it computes the relative weight of distinct
   concrete types observed in the profile.
3. If one concrete type dominates (above an internal threshold), the compiler
   emits a *guarded direct call*:
   ```
   if iface._type == &expectedType { directCall(...) } else { indirectCall(...) }
   ```
4. The direct branch is inline-eligible.

### Documented limitations

- Profiles must reflect realistic production traffic.
- Profile staleness can degrade performance.
- PGO can occasionally regress individual functions; the documentation
  recommends benchmarking.

---

## 8. Generics Stenciling — Documented Behavior (Go 1.18+)

Go's generics implementation is documented in:
- Go 1.18 release notes — https://tip.golang.org/doc/go1.18
- Design doc: https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md
- Implementation: `cmd/compile/internal/typecheck/subr.go`,
  `cmd/compile/internal/reflectdata/reflect.go`

### GCShape stenciling — official summary

> Currently, the compiler instantiates each function for each set of type
> arguments that have the same "GCshape". A GCshape is determined by the
> underlying type (size, alignment, GC pointer mask).

In practice:
- Each unique pointer-bearing layout shares one stencil.
- Each unique scalar size/alignment shares one stencil.
- Within a stencil, generic operations that depend on the type parameter use a
  runtime **dictionary**.

### Dispatch implications

- Calls on type-parameter values within a generic function go through the
  dictionary, costing roughly one indirect call.
- Calls on concrete types within the stencil are static.
- Inlining can sometimes specialize the generic body further at use sites.

---

## 9. Implementation-Specific Details

The following are gc compiler / runtime specifics, not language requirements.

### Inline budget

- `cmd/compile/internal/inline/inl.go` — budget constants.
- Approximately 80 since Go 1.22; subject to change.

### itab caching

- `runtime.itabTable` is a hash table; lookups are amortized O(1).
- First-use cost: roughly 30-60 ns. Subsequent calls: standard indirect-call
  cost.

### Tail-call optimization

- gc does not implement TCO. Recursion grows the stack until the runtime
  triggers a stack-copy resize. There is no language guarantee against TCO; it
  simply isn't done.

### Reflection-based dispatch

- `reflect.Value.Call` uses an interpreter-style argument marshaler.
- Cost: ~100-500 ns + allocations.
- Documented behavior: matches the spec semantics for the corresponding direct
  call.

---

## 10. Version History

| Go Version | Change Relevant to Dispatch |
|---|---|
| 1.0  | Static and dynamic dispatch via `itab` defined in runtime |
| 1.5  | Bootstrapped runtime; `itab` layout stable |
| 1.10 | Mid-stack inlining (across multiple call levels) |
| 1.13 | `defer` overhead reduced (improves inline-friendliness) |
| 1.14 | Open-coded `defer`; cheap `defer` in inline-eligible bodies |
| 1.17 | Register-based ABI on amd64; method calls receive args in registers |
| 1.18 | Generics; GCShape stenciling; methods on generic types |
| 1.20 | PGO preview (inlining) |
| 1.21 | PGO general availability; PGO devirtualization |
| 1.22 | Inline budget refined; PGO improvements; loop-variable scoping |

References:
- Release notes index: https://go.dev/doc/devel/release
- PGO design: https://go.dev/blog/pgo

---

## 11. Related Spec Sections

| Section | URL | Relevance |
|---|---|---|
| Calls | https://go.dev/ref/spec#Calls | Method-call semantics |
| Selectors | https://go.dev/ref/spec#Selectors | `x.f` lookup rules |
| Method sets | https://go.dev/ref/spec#Method_sets | Which methods belong to a type |
| Method values | https://go.dev/ref/spec#Method_values | Bound method expressions |
| Method expressions | https://go.dev/ref/spec#Method_expressions | Type-level method references |
| Interface types | https://go.dev/ref/spec#Interface_types | Method-set semantics for interfaces |
| Type assertions | https://go.dev/ref/spec#Type_assertions | Cost-related operation |
| Type switches | https://go.dev/ref/spec#Type_switches | Multi-type dispatch construct |

### `cmd/compile` references

| Path | Relevance |
|---|---|
| `cmd/compile/internal/devirtualize/devirtualize.go` | Static devirtualizer |
| `cmd/compile/internal/devirtualize/pgo.go` | PGO devirtualizer |
| `cmd/compile/internal/inline/inl.go` | Inline budget logic |
| `cmd/compile/internal/pgo` | Profile parsing |
| `cmd/compile/internal/ssagen/ssa.go` | Lowering of method calls |

### `runtime` references

| Path | Relevance |
|---|---|
| `runtime/iface.go` | `getitab`, type assertion helpers |
| `runtime/runtime2.go` | `iface`, `eface`, `itab` definitions |
| `runtime/typehash.go` | Hash for itab lookup |
