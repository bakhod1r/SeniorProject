# Interface Internals — Specification

> **Spec note:** Go's language specification defines *interface types* and their semantics, but the **memory layout** of interface values (`iface`, `eface`, `itab`) is **implementation-defined**. The text below cites the spec for behaviour and the official runtime sources for layout.
>
> Spec: https://go.dev/ref/spec#Interface_types
> Runtime sources: `runtime/iface.go`, `runtime/runtime2.go`, `runtime/type.go`, `internal/abi/iface.go`.

---

## Table of Contents
1. [Spec references](#1-spec-references)
2. [Defined behaviour the spec guarantees](#2-defined-behaviour-the-spec-guarantees)
3. [Implementation contract from runtime/iface.go](#3-implementation-contract-from-runtimeifacego)
4. [Layout in runtime/runtime2.go](#4-layout-in-runtimeruntime2go)
5. [Type identity and the _type descriptor](#5-type-identity-and-the-_type-descriptor)
6. [Comparison rules — formal](#6-comparison-rules-formal)
7. [Conversion semantics](#7-conversion-semantics)
8. [Type assertion semantics](#8-type-assertion-semantics)
9. [Reflection contract](#9-reflection-contract)
10. [Version history of internals](#10-version-history-of-internals)
11. [Compliance checklist](#11-compliance-checklist)

---

## 1. Spec references

### Interface types

> An interface type defines a type set. A variable of interface type can store a value of any type that is in the type set of the interface. Such a type is said to implement the interface.
>
> — https://go.dev/ref/spec#Interface_types

### Static and dynamic type

> A variable of interface type also has a distinct dynamic type, which is the non-interface type of the value assigned to the variable at run time (unless the value is the predeclared identifier nil, which has no type).
>
> — https://go.dev/ref/spec#Variables

### Type assertions

> For an expression x of interface type, but not a type parameter, and a type T, the primary expression `x.(T)` asserts that x is not nil and that the value stored in x is of type T.
>
> — https://go.dev/ref/spec#Type_assertions

### Comparison operators

> Interface values are comparable. Two interface values are equal if they have identical dynamic types and equal dynamic values or if both have value nil.
>
> A comparison of two interface values with identical dynamic types causes a run-time panic if values of that type are not comparable.
>
> — https://go.dev/ref/spec#Comparison_operators

### Nil

> The nil identifier is the predeclared zero value for pointer, channel, function, interface, map, or slice types.
>
> — https://go.dev/ref/spec#Predeclared_identifiers

The spec does **not** describe the two-word layout. That is an implementation detail in the runtime sources.

---

## 2. Defined behaviour the spec guarantees

| Property | Guaranteed by spec |
|----------|--------------------|
| Two-word memory layout | NO — implementation defined |
| Equality of `==`-comparable interface values | YES |
| Panic on `==` for uncomparable dynamic type | YES |
| Type assertion is a runtime check | YES |
| Comma-ok form does not panic | YES |
| `nil` interface == `nil` | YES |
| Typed-nil != nil | YES (follows from the spec definition) |
| Method dispatch through interface | YES (semantics) — implementation via itab is runtime-defined |

So the layout you study in this section is reliable on **all current Go releases** but is not a portable language guarantee.

---

## 3. Implementation contract from runtime/iface.go

The Go runtime, since 1.4, defines and maintains:

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
    hash  uint32
    _     [4]byte
    fun   [1]uintptr // variable length
}
```

`runtime/iface.go` exposes (internal) helpers:

- `getitab(inter *interfacetype, typ *_type, canfail bool) *itab` — global cache lookup + lazy build.
- `convT*(...)` — boxing helpers per kind (`convT64`, `convTstring`, `convTslice`, `convT16`, `convT32`, `convT`).
- `assertE2I`, `assertI2I`, `assertE2I2`, `assertI2I2` — interface-target assertions.
- `panicdottypeI`, `panicdottypeE` — panic builders for failing `x.(T)` (non-comma-ok).

These names are stable enough for runtime authors but not part of the public API. Tools like `delve`, `pprof`, and `gdb` know about them.

---

## 4. Layout in runtime/runtime2.go

```go
type interfacetype struct {
    typ     _type
    pkgpath name
    mhdr    []imethod  // sorted alphabetically by method name
}

type imethod struct {
    name nameOff
    ityp typeOff
}

type _type struct {
    size       uintptr
    ptrdata    uintptr
    hash       uint32
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind       uint8       // see runtime/typekind.go
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte
    str        nameOff
    ptrToThis  typeOff
}
```

Key invariants:

- `_type` is **unique per type** (pointer equality == type identity).
- `interfacetype` is unique per interface declaration.
- `_type.equal` is `nil` for slice, map, function types — encoding "uncomparable" right in the type descriptor.

---

## 5. Type identity and the _type descriptor

The spec on type identity (https://go.dev/ref/spec#Type_identity) defines when two types are the "same". The runtime materialises this with a single `*_type` per identity. For named types this is straightforward; for **structurally identical** types declared in different packages, the runtime still gives them distinct `_type` pointers (consistent with the spec, since named types are not identical to their underlying types).

Generic types complicate this: each instantiation of `List[int]` shares one `_type` because the GCShape algorithm picks a representative shape per pointer-shape category. See `internal/abi/type.go` and the Go 1.18 generics implementation notes.

---

## 6. Comparison rules — formal

From the spec, expanded with implementation detail:

```
i == j  iff  (i is nil and j is nil)
         or  (i.tab == j.tab AND
              (i.tab._type.equal != nil) AND
              i.tab._type.equal(i.data, j.data))

If i.tab == j.tab AND i.tab._type.equal == nil → runtime panic.
```

For `eface`:

```
i == j  iff  (i._type == j._type AND
              (i._type.equal != nil) AND
              i._type.equal(i.data, j.data))
         or  (i._type == nil AND j._type == nil)
```

Comparing `iface` to `eface` (one is interface{}, other is typed): the runtime first checks both `_type`s equal, then proceeds.

---

## 7. Conversion semantics

The spec (https://go.dev/ref/spec#Conversions) says a value of type `T` is **assignable** to interface `I` when `T` implements `I`. The runtime implements:

- **Concrete `T` → `I`**: build an `iface` header. If the static `(I, T)` pair is known to the linker, use the precomputed `*itab`; else call `getitab`.
- **Concrete `T` → `any`**: build an `eface` header. Box the value via `convT*` if not pointer-shaped.
- **Interface `I` → `J`**: rebuild the header. If `J` is `any`, wrap directly; else `getitab(J, i.tab._type)`.
- **Interface `I` → `T` (concrete)**: this is a type assertion, not a conversion.

Boxing rule (per `runtime/iface.go` `convT`):

```
size := typ.size
if isDirectIface(typ) {
    return *(*unsafe.Pointer)(v) // store value directly in data word
}
ptr := mallocgc(size, typ, true)
typedmemmove(typ, ptr, v)
return ptr
```

`isDirectIface` is true when `typ.kind & kindDirectIface != 0`, set for pointer, channel, map, func, slice-of-pointer-element single-pointer struct, etc.

---

## 8. Type assertion semantics

Per spec, `x.(T)` produces:
- A panic if `T` is a non-interface type and `x`'s dynamic type is not `T`.
- A zero-value + false in comma-ok form.

Implementation:

| Source | Target | Helper |
|--------|--------|--------|
| `iface` | concrete | `i.tab._type == *_type(T)` compare; else `panicdottypeI` |
| `eface` | concrete | `i._type == *_type(T)` compare; else `panicdottypeE` |
| `iface` | interface `J` | `assertI2I(J, i.tab._type)` returns new itab; else panic |
| `eface` | interface `J` | `assertE2I(J, i._type)` returns new itab; else panic |

Comma-ok variants (`*2I2`, etc.) return `(itab, true)` or `(nil, false)` instead of panicking. The compiler chooses the variant by the syntactic form (`v, ok := i.(T)` vs `v := i.(T)`).

---

## 9. Reflection contract

`reflect.TypeOf(i any) Type` reads `eface._type`. `reflect.ValueOf(i any) Value` reads both fields and packs them into a `Value` struct (defined in `reflect/value.go`):

```go
type Value struct {
    typ_ *abi.Type
    ptr  unsafe.Pointer
    flag
}
```

`v.Interface()` rebuilds an `eface` header from the value's `typ_` and `ptr`, allocating a heap copy if the original was inline.

`reflect.Value.Pointer()` returns the address of the underlying value when the kind is pointer-shaped (Ptr, UnsafePointer, Func, Chan, Map, Slice). For other kinds it panics — consistent with the layout (no pointer to return for an inline scalar).

---

## 10. Version history of internals

| Go Version | Change |
|------------|--------|
| 1.4 | `iface`, `eface`, `itab` formalised in `runtime/runtime2.go`. |
| 1.5 | Linker emits static itabs in `.rodata`. |
| 1.7 | `_type` reorganised; `equal` function pointer added (replacing per-kind switch). |
| 1.9 | `convT2*` family split for fast paths. |
| 1.13 | `staticuint64s` cache extends boxing fast paths for small ints. |
| 1.18 | Generics: GCShape stenciling; `internal/abi` introduced as the new home for type descriptors. |
| 1.21 | `runtime.Pinner` added; cleanup of conversion helper names. |
| 1.22 | Refactored `getitab` and `assertX` for register ABI. |
| 1.23 | Devirtualization improvements; method-value dispatch can sometimes inline. |

The two-word layout has been stable since 1.4. The `itab.fun` variable-length scheme is unchanged.

---

## 11. Compliance checklist

- [ ] Code does not depend on the order of `itab.fun` entries — that order matches `interfacetype.mhdr` (sorted by method name).
- [ ] Code does not assume that two `*_type` pointers for structurally identical types are equal — they are NOT for distinct named types.
- [ ] Code does not retain raw `unsafe.Pointer` to `itab` across plugin reloads (plugins are not unloadable; the issue does not arise, but the assumption is documented).
- [ ] Comparisons of interface values guarded against panic when dynamic type may be uncomparable (`reflect.DeepEqual` or explicit type switch).
- [ ] Functions returning `error` return literal `nil`, not a typed nil pointer.
- [ ] Hot paths avoid converting non-pointer values to `any` unless required.
- [ ] cgo boundaries do not pass interface headers; they pass handles or raw pointers with `runtime.Pinner`.
- [ ] Reflection-driven code calls `Interface()` only when needed; repeated round-trips are profiled.

---

## Spec quote — concluding text

> Two interface values are equal if they have identical dynamic types and equal dynamic values or if both have value nil.

The two-word implementation makes this deterministic and cheap. The runtime sources (`runtime/iface.go`, `runtime/runtime2.go`) are authoritative beyond the spec for layout questions; they are open and well-commented and should be considered required reading for anyone debugging interface-value behaviour at depth.
