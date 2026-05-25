# Slice Header Internals — Specification

> **Spec note:** Go's language specification defines slice *types* and their *operations*, but the **memory layout** of slice values is **implementation-defined**. This file cites the spec for behaviour and the official runtime sources for layout. Treat the three-word `(Data, Len, Cap)` layout as guaranteed by every existing Go implementation but not by the language.
>
> Spec: https://go.dev/ref/spec#Slice_types
> Runtime sources: `src/runtime/slice.go`, `src/reflect/value.go`, `src/internal/abi/type.go`, `src/unsafe/unsafe.go`.

---

## Table of Contents
1. [Spec references](#1-spec-references)
2. [Defined behaviour the spec guarantees](#2-defined-behaviour-the-spec-guarantees)
3. [Implementation contract from runtime/slice.go](#3-implementation-contract-from-runtimeslicego)
4. [Layout details](#4-layout-details)
5. [Indexing and slicing rules — formal](#5-indexing-and-slicing-rules--formal)
6. [`append` semantics](#6-append-semantics)
7. [`copy` semantics](#7-copy-semantics)
8. [`make` semantics](#8-make-semantics)
9. [Conversions](#9-conversions)
10. [Reflection contract](#10-reflection-contract)
11. [Version history](#11-version-history)
12. [Compliance checklist](#12-compliance-checklist)

---

## 1. Spec references

### Slice types

> A slice is a descriptor for a contiguous segment of an underlying array and provides access to a numbered sequence of elements from that array. A slice type denotes the set of all slices of arrays of its element type. The value of an uninitialized slice is nil.
>
> — https://go.dev/ref/spec#Slice_types

### Length and capacity

> The length of a slice s can be discovered by the built-in function len; unlike with arrays it may change during execution. The elements can be addressed by integer indices 0 through len(s)-1. The slice index of a given element may be less than the index of the same element in the underlying array.
>
> A slice, once initialized, is always associated with an underlying array that holds its elements. A slice therefore shares storage with its array and with other slices of the same array; by contrast, distinct arrays always represent distinct storage.
>
> The array underlying a slice may extend past the end of the slice. The capacity is a measure of that extent: it is the sum of the length of the slice and the length of the array beyond the slice; a slice of length up to that capacity can be created by slicing a new one from the original slice. The capacity of a slice a can be discovered using the built-in function cap(a).
>
> — https://go.dev/ref/spec#Length_and_capacity

### Slice expressions

> For arrays or strings, the indices are in range if 0 <= low <= high <= len(a), otherwise they are out of range. For slices, the upper index bound is the slice capacity cap(a) rather than the length.
>
> — https://go.dev/ref/spec#Slice_expressions

### Full slice expressions

> For arrays or *arrays of arrays, the indices low and high must satisfy 0 <= low <= high <= max <= len(a); for slices, 0 <= low <= high <= max <= cap(a). The full slice expression a[low : high : max] yields a slice ... with capacity equal to max - low. Only the first index may be omitted; it defaults to 0.
>
> — https://go.dev/ref/spec#Slice_expressions

### Appending and copying

> If s has sufficient capacity, the destination is resliced to accommodate the new elements. If it does not, a new underlying array will be allocated. Append returns the updated slice. It is therefore necessary to store the result of append, often in the variable holding the slice itself.
>
> — https://go.dev/ref/spec#Appending_and_copying_slices

### Conversions between slices and arrays

> Converting a slice to an array yields an array containing the elements of the underlying array of the slice. Similarly, converting a slice to an array pointer yields a pointer to the underlying array of the slice. In both cases, if the length of the slice is less than the length of the array, a run-time panic occurs.
>
> — https://go.dev/ref/spec#Conversions_from_slice_to_array_or_array_pointer

### Nil

> The nil identifier is the predeclared zero value for pointer, channel, function, interface, map, or slice types.
>
> — https://go.dev/ref/spec#Predeclared_identifiers

The spec does **not** describe the three-word header layout. That is an implementation detail in `runtime/slice.go`.

---

## 2. Defined behaviour the spec guarantees

| Property | Guaranteed by spec |
|----------|--------------------|
| Three-word memory layout | NO — implementation defined |
| `len(s)` and `cap(s)` semantics | YES |
| `s[i:j]` bounded by `cap(s)`, not `len(s)`, for the upper index | YES |
| Full slice expression `s[i:j:k]` (Go 1.2+) | YES |
| `append` returns the updated slice | YES |
| `append` may allocate a new backing array | YES — but timing is unspecified |
| The growth formula | NO — implementation defined |
| `copy` returns the number of elements copied | YES |
| `copy` handles overlapping slices via `memmove` semantics | YES |
| Nil slice has `len == 0`, `cap == 0` | YES |
| Nil slice can be appended to | YES |
| Nil slice can be `range`d over | YES |
| Slice types are not comparable except to `nil` | YES |
| Two slices sharing a backing array | YES (consequence of "shares storage") |

The layout you study in this section is reliable on **all current Go releases** but is not a portable language guarantee.

---

## 3. Implementation contract from runtime/slice.go

The Go runtime defines:

```go
// src/runtime/slice.go
type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

This struct is **unexported**. User code cannot reference `runtime.slice` directly. The exported window into it is via `reflect.SliceHeader` (deprecated) or `unsafe.Slice`/`unsafe.SliceData`.

Runtime entry points called by compiler-emitted code:

| Function | Purpose |
|----------|---------|
| `makeslice(et *_type, len, cap int) unsafe.Pointer` | Allocate backing array; return pointer. Panics on overflow or `cap < 0`. |
| `makeslice64(et *_type, len64, cap64 int64) unsafe.Pointer` | 64-bit variant for explicit `int64` args. |
| `makeslicecopy(et *_type, tolen int, fromlen int, from unsafe.Pointer) unsafe.Pointer` | Allocate + copy in one call (used when `make` immediately precedes `copy`). |
| `growslice(oldPtr unsafe.Pointer, newLen, oldCap, num int, et *_type) slice` | Backing array resize used by `append` when `cap < len + num`. Returns new header. |
| `slicecopy(toPtr unsafe.Pointer, toLen int, fromPtr unsafe.Pointer, fromLen int, width uintptr) int` | Elementwise copy for non-pointer element types. |
| `typedslicecopy(elemType *_type, dst, src slice) int` | Pointer-safe copy with write barriers. |
| `mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer` | Underlying allocator. |

These names are stable enough for runtime authors and debuggers but not part of the public API.

---

## 4. Layout details

### Word sizes

On every supported architecture:

| Architecture | Word size | Header size |
|--------------|-----------|-------------|
| `amd64`, `arm64`, `riscv64`, `ppc64`, `mips64`, etc. | 8 bytes | 24 bytes |
| `386`, `arm`, `mips`, `mipsle` | 4 bytes | 12 bytes |
| `wasm` | 8 bytes (treated as 64-bit) | 24 bytes |

### Alignment

The header is naturally aligned to the word size. The backing array's alignment depends on the element type (e.g., `[]float64` is 8-aligned; `[]byte` is 1-aligned).

### Backing array layout

The backing array is a contiguous run of `cap` elements of the element type, each at offset `i * sizeof(T)` from `array`. There is **no per-element header**; the slice's header is the only descriptor.

### Element addressability

Elements of a slice are addressable: `&s[i]` is well-defined and yields a `*T`. The pointer remains valid until either (a) the backing array is garbage-collected (impossible while the pointer is reachable) or (b) `append` causes `growslice` to allocate a new array — in which case the old `*T` still points into the old (now possibly unreachable) array, but the slice itself sees the new array.

```go
s := make([]int, 1, 1)
p := &s[0]
s = append(s, 1) // growslice runs; s's Data changes
*p = 99          // writes into the OLD array; s[0] is unaffected
```

This is why "keeping pointers into slices" is fragile across `append`.

---

## 5. Indexing and slicing rules — formal

### Indexing `s[i]`

```
panic if i < 0 OR i >= len(s)
otherwise: returns *(s.Data + i * sizeof(T))
```

The bounds check is `i >= 0` and `i < len(s)`. The compiler can elide it when it can prove the indices are in range (e.g., inside `for i := range s`).

### Two-index slicing `s[i:j]`

```
panic if i < 0 OR j < i OR j > cap(s)
otherwise: returns slice{
    Data: s.Data + i * sizeof(T),
    Len:  j - i,
    Cap:  cap(s) - i,
}
```

Default values:
- `s[i:]` ≡ `s[i:len(s)]`
- `s[:j]` ≡ `s[0:j]`
- `s[:]` ≡ `s[0:len(s)]`

### Three-index slicing `s[i:j:k]` (Go 1.2+)

```
panic if i < 0 OR j < i OR k < j OR k > cap(s)
otherwise: returns slice{
    Data: s.Data + i * sizeof(T),
    Len:  j - i,
    Cap:  k - i,
}
```

The first index may not be omitted in the three-index form (`s[:j:k]` is legal because the `:` before `j` defaults `i` to 0; `s[j:k]` is two-index, not three-index).

### String slicing

For `s` of type `string`, `s[i:j]` produces a new string header `{Data, Len}` — no Cap, because strings are immutable. The bounds check is `0 <= i <= j <= len(s)` (not `cap`, which doesn't exist for strings).

---

## 6. `append` semantics

Per spec:

> If s has sufficient capacity, the destination is resliced to accommodate the new elements. If it does not, a new underlying array will be allocated.

Implementation:

```
n = len(s)
m = n + len(items)
if m <= cap(s):
    s.Len = m
    memmove(s.Data + n * sizeof(T), items.Data, len(items) * sizeof(T))
    return s
else:
    s = runtime.growslice(s.Data, m, cap(s), len(items), elemType)
    memmove(s.Data + n * sizeof(T), items.Data, len(items) * sizeof(T))
    return s
```

`growslice` allocates a backing array with new capacity (see "Growth formula" below), copies the existing `n` elements, and returns the new header. The new `Len` equals `m`; the new `Cap` is the rounded-up size class.

### Growth formula (Go 1.18+)

From `src/runtime/slice.go`:

```go
newcap := oldCap
doublecap := newcap + newcap
if cap > doublecap {
    newcap = cap
} else {
    const threshold = 256
    if oldCap < threshold {
        newcap = doublecap
    } else {
        for 0 < newcap && newcap < cap {
            newcap += (newcap + 3*threshold) / 4
        }
        if newcap <= 0 {
            newcap = cap
        }
    }
}
```

The output is rounded up to the next `mallocgc` size class.

### Pre-1.18 formula

> double until 1024, then grow by 25 %

Replaced because the cliff at 1024 caused near-pathological patterns for slices growing through that boundary.

---

## 7. `copy` semantics

```go
n := copy(dst, src)
```

Returns `n = min(len(dst), len(src))`. Elements are copied via:

- `runtime.memmove` for non-pointer element types or when the compiler can prove pointer-safety.
- `runtime.typedslicecopy` for pointer-containing element types, which enforces write barriers.

Overlap is permitted; `memmove` handles forward/backward copy direction automatically. This is why `copy(s[1:], s[:len(s)-1])` correctly shifts a slice right by one.

Special-case: `copy(dst []byte, src string)` is a recognized form and is lowered to `memmove`.

---

## 8. `make` semantics

```go
s := make([]T, len, cap)        // explicit cap
s := make([]T, len)             // cap == len
```

Implementation:

```
panic if len < 0 OR cap < len OR cap * sizeof(T) overflows int
allocate cap * sizeof(T) bytes via mallocgc, zero-initialized
return slice{Data: allocated, Len: len, Cap: roundedUpCap}
```

The `roundedUpCap` may exceed the requested `cap` because of malloc size-class rounding. Observable: `make([]byte, 0, 5)` may have `cap(s) == 8` or 16, depending on the allocator.

---

## 9. Conversions

### `[]T` to `[N]T` (Go 1.20+)

```go
s := []int{1, 2, 3, 4}
a := [4]int(s)   // copies elements; panics if len(s) < 4
```

The result is an array value, not a slice. It does not share storage with `s`. Panics if `len(s) < N`.

### `[]T` to `*[N]T` (Go 1.17+)

```go
s := []int{1, 2, 3, 4}
p := (*[4]int)(s) // points into s's backing array; aliases s
p[0] = 99
fmt.Println(s[0]) // 99
```

Shares storage. Panics if `len(s) < N`.

### `*[N]T` to `[]T`

```go
var a [4]int
s := a[:]    // s.Data == &a[0], s.Len == 4, s.Cap == 4
```

Always allowed (no allocation, no copy). The slice aliases the array.

### `string` to `[]byte` and back

`[]byte(s)` allocates and copies. `string(b)` allocates and copies. The compiler has peephole optimisations to elide the copy in specific patterns (see [senior.md](senior.md#9-slicebytetostring-and-conversions)).

---

## 10. Reflection contract

### `reflect.SliceHeader` (deprecated Go 1.20)

```go
// reflect/value.go
type SliceHeader struct {
    Data uintptr
    Len  int
    Cap  int
}
```

Deprecation comment:

> Deprecated: Use unsafe.Slice or unsafe.SliceData instead.

Why deprecated:

1. `Data uintptr` is not a GC root. The runtime cannot tell that the array referenced by a `SliceHeader` is still in use. Code that constructs a slice via `SliceHeader` may have its backing array freed.
2. The presence of a public `SliceHeader` type locked the runtime to a specific layout.

The type **still exists** for backward compatibility but linters warn on its use.

### `unsafe.Slice` (Go 1.17)

```go
func Slice[T any](ptr *T, len IntegerType) []T
```

Builds a slice from a typed pointer and a length. The pointer is GC-tracked (it's `*T`, not `uintptr`). The runtime panics if `ptr == nil && len != 0`, or if `len < 0`, or if `len * sizeof(T)` overflows.

### `unsafe.SliceData` (Go 1.20)

```go
func SliceData[T any](s []T) *T
```

Returns the underlying data pointer as `*T`. Equivalent to `&s[0]` when `len(s) > 0`, but defined even for empty slices (returns the underlying pointer if `cap(s) > 0`, else may return `nil` for nil slices).

### `reflect.Value.Slice`, `.Cap`, `.Len`

These methods exist on `reflect.Value` for slices. They read from the `Value.ptr` and stored type, not from a `SliceHeader`. Internally, `reflect` uses the same three-word layout.

### `reflect.MakeSlice`

```go
func MakeSlice(typ Type, len, cap int) Value
```

Calls `runtime.makeslice` internally and wraps the result in a `reflect.Value`.

---

## 11. Version history

| Go Version | Change |
|------------|--------|
| 1.0 | Initial slice design: header `(array, len, cap)`; `make`, `append`, `copy`, `len`, `cap`. |
| 1.2 | Full slice expression `s[i:j:k]` introduced. |
| 1.5 | Compiler emits inlined fast path for `append` cap check (previously always called `runtime.growslice`). |
| 1.7 | `copy(dst, src)` peephole for `[]byte`+`string`. |
| 1.10 | `for range string(b)` no longer allocates the intermediate string. |
| 1.13 | `runtime.makeslicecopy` introduced to fuse `make`+`copy`. |
| 1.17 | Pointer-to-array-to-slice conversion `(*[N]T)(s)` permitted. `unsafe.Slice` introduced. Register-based calling convention: slices pass in three registers. |
| 1.18 | `growslice` formula rewritten for smoother transition through ~1024 (see Section 6). |
| 1.20 | `unsafe.SliceData` introduced. `[N]T(s)` (slice-to-array-value) conversion permitted. `reflect.SliceHeader` officially deprecated. |
| 1.21 | `slices` package added to the standard library. `runtime.Pinner` added (relevant for `unsafe.Slice` over GC memory). |
| 1.22 | `range int` syntax — incidental to slices but used in slice idioms. |
| 1.23 | Loop-variable scoping change: `for i, v := range s` makes `v` a fresh variable per iteration (no behaviour change for slice mechanics, but eliminates a classic aliasing bug with `&v`). |

The three-word layout has been stable since 1.0. The `growslice` *formula* changed in 1.18; the *header* did not.

---

## 12. Compliance checklist

- [ ] Code does not depend on the exact ratio of `growslice`'s output (only on the spec guarantee that `append` returns the updated slice and grows when needed).
- [ ] Code does not assume `cap(s)` is exactly what was passed to `make([]T, n, cap)` — the allocator may round up.
- [ ] Code does not use `reflect.SliceHeader` for new constructions; uses `unsafe.Slice`/`unsafe.SliceData` instead.
- [ ] Code does not retain `&s[i]` across `append(s, ...)` calls that might trigger reallocation.
- [ ] Code does not compare slices with `==` (only to `nil`); uses `slices.Equal` or `bytes.Equal`.
- [ ] Code distinguishes `nil` from `[]T{}` only where JSON, `reflect.DeepEqual`, or explicit `== nil` requires it.
- [ ] Functions returning sub-slices of internal state use `s[:n:n]` or `slices.Clone` when callers may append or mutate.
- [ ] Conversion `(*[N]T)(s)` or `[N]T(s)` is guarded against `len(s) < N` (these panic).
- [ ] `cgo` interop passes data via `unsafe.SliceData` (Go 1.20+) or `runtime.Pinner` (Go 1.21+) for asynchronous callbacks.
- [ ] Concurrent access to a shared backing array (even through disjoint slice ranges) is synchronised.

---

## Spec quote — concluding text

> The array underlying a slice may extend past the end of the slice. The capacity is a measure of that extent: it is the sum of the length of the slice and the length of the array beyond the slice.

The three-word `(Data, Len, Cap)` header is the implementation expression of that sentence. The runtime sources (`runtime/slice.go`, `runtime/typekind.go`) are authoritative beyond the spec for layout questions. They are open, well-commented, and required reading for anyone debugging slice-value behaviour at depth.

---

## Further reading
- Go spec on slices — https://go.dev/ref/spec#Slice_types
- `runtime/slice.go` source — https://github.com/golang/go/blob/master/src/runtime/slice.go
- `unsafe.Slice` proposal — https://github.com/golang/go/issues/19367
- `unsafe.SliceData` proposal — https://github.com/golang/go/issues/53003
- Go 1.18 release notes (growth formula) — https://go.dev/doc/go1.18#runtime
- Go 1.20 release notes (`unsafe.SliceData`, slice-to-array-value, `SliceHeader` deprecation) — https://go.dev/doc/go1.20
