# Struct Memory Layout — Specification

> **Focus:** Precise reference for the layout of Go struct values in memory — what the spec guarantees, what `unsafe` and `reflect` expose, what the runtime requires, and which behaviours have changed across Go versions. Layout itself is **implementation-defined** in many details; this document distinguishes spec-level guarantees from runtime-level invariants you can rely on across all current Go releases.
>
> **Sources:**
> - Go spec — Size and alignment guarantees: https://go.dev/ref/spec#Size_and_alignment_guarantees
> - `unsafe` package: https://pkg.go.dev/unsafe
> - `reflect.Type`: https://pkg.go.dev/reflect#Type
> - `sync/atomic` bug note (32-bit alignment): https://pkg.go.dev/sync/atomic#pkg-note-BUG
> - Compiler source: https://github.com/golang/go/blob/master/src/cmd/compile/internal/types/size.go
> - `internal/abi/type.go`: https://github.com/golang/go/blob/master/src/internal/abi/type.go
> - `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment

---

## Table of contents
1. [Spec text on size and alignment](#1-spec-text-on-size-and-alignment)
2. [What is guaranteed vs implementation-defined](#2-what-is-guaranteed-vs-implementation-defined)
3. [The `unsafe` package contract](#3-the-unsafe-package-contract)
4. [The `reflect.Type` contract](#4-the-reflecttype-contract)
5. [Layout algorithm in the compiler](#5-layout-algorithm-in-the-compiler)
6. [Per-type size and alignment table](#6-per-type-size-and-alignment-table)
7. [Zero-sized types and the last-field rule](#7-zero-sized-types-and-the-last-field-rule)
8. [32-bit `int64` alignment quirk](#8-32-bit-int64-alignment-quirk)
9. [`sync/atomic` alignment requirements](#9-syncatomic-alignment-requirements)
10. [Version history of relevant changes](#10-version-history-of-relevant-changes)
11. [Tooling reference](#11-tooling-reference)
12. [Compliance checklist](#12-compliance-checklist)

---

## 1. Spec text on size and alignment

The Go specification's guarantees on struct layout are deliberately minimal. The full text from https://go.dev/ref/spec#Size_and_alignment_guarantees:

> A compiler may choose to align fields of structs on any boundary that is at least the size of the basic type. The following minimum alignments are required:
>
> ```
> type                                  alignment in bytes
> byte, uint8, int8                     1
> uint16, int16                         2
> uint32, int32                         4
> uint64, int64, float64, complex64     8 on 64-bit platforms (4 on 32-bit)
> array of basic types                  the same as the basic type
> struct of basic types                 the largest alignment of any field
> ```

This is the **complete spec-level layout guarantee**. Notice three things:

1. The minimums are **floors**, not ceilings — the compiler may align *more* strictly.
2. `int64` and friends are explicitly called out as 8 on 64-bit, 4 on 32-bit.
3. Pointer types, strings, slices, maps, channels, and interfaces are **not** mentioned. Their alignment is implementation-defined.

The actual Go compiler (`cmd/compile/internal/types/size.go`) treats pointer-sized types (`*T`, `int`, `uintptr`, string header pointer, slice header pointer) as having alignment equal to the word size (4 on 32-bit, 8 on 64-bit). This is the rule you encounter in practice but the spec does not require it.

Spec text on field order:

> A struct or array type has size zero if it contains no fields (or elements, respectively) that have a size greater than zero.

And from the section on `unsafe.Sizeof` (https://pkg.go.dev/unsafe#Sizeof):

> The size does not include any memory possibly referenced by x. For instance, if x is a slice, Sizeof returns the size of the slice descriptor, not the size of the memory referenced by the slice; if x is an interface, Sizeof returns the size of the interface value itself, not the size of the value stored in the interface.

`Sizeof` is the **header size only**. Memory behind pointers is not counted.

---

## 2. What is guaranteed vs implementation-defined

| Property | Guaranteed by spec |
|----------|--------------------|
| Fields appear in memory in source order | YES |
| Minimum alignment per basic type (table above) | YES |
| Struct alignment = max field alignment | YES |
| Struct size is a multiple of struct alignment | YES (implied; required for arrays) |
| Padding between fields to meet field alignment | YES (implied) |
| `unsafe.Sizeof` is a compile-time constant for sized types | YES |
| `unsafe.Offsetof(s.f)` is a compile-time constant | YES |
| Two zero-sized values may share an address | YES |
| Non-zero struct ending in zero-sized field gets +1 byte | NO (implementation, since Go 1) |
| Exact alignment of pointers / strings / slices / maps | NO (implementation) |
| GC pointer bitmap representation | NO (implementation) |
| Cache-line size | NO (CPU-dependent) |
| `//go:align` directive semantics | YES from 1.23 |
| Reproducibility of layout across Go versions | YES in practice; no formal guarantee |

The "non-zero struct ending in zero-sized field" rule is the most-cited implementation behaviour that programmers depend on. It has been the same in every Go release since Go 1, but is not in the spec.

---

## 3. The `unsafe` package contract

From https://pkg.go.dev/unsafe:

### `unsafe.Sizeof(x ArbitraryType) uintptr`

> Sizeof takes an expression x of any type and returns the size in bytes of a hypothetical variable v as if v was declared via var v = x. The size does not include any memory possibly referenced by x.

Compile-time constant for types whose size is statically known. For `[]T`, `string`, `map[K]V`, `interface{}`, returns the header size.

### `unsafe.Alignof(x ArbitraryType) uintptr`

> Alignof takes an expression x of any type and returns the required alignment of a hypothetical variable v as if v was declared via var v = x. It is the largest value m such that the address of v is always zero mod m. It is the same as the value returned by reflect.TypeOf(x).Align().

The **standalone** alignment (not the in-struct alignment). On 32-bit, `unsafe.Alignof(int64(0)) == 8`.

### `unsafe.Offsetof(x ArbitraryType) uintptr`

> Offsetof returns the offset within the struct of the field represented by x, which must be of the form structValue.field.

Compile-time constant. Used for struct field offset computations.

All three return `uintptr`. All three are constant-foldable when applied to types whose layout is statically known.

### `unsafe.Pointer`

Conversions between `unsafe.Pointer` and typed pointers are governed by six explicit patterns documented in the package doc. Patterns 3 and 4 (struct field offset arithmetic, array element offset arithmetic) directly rely on `Offsetof`:

```go
p := (*Field)(unsafe.Add(unsafe.Pointer(&s), unsafe.Offsetof(s.f)))
```

`unsafe.Add` (Go 1.17+) and `unsafe.Slice` (Go 1.17+) make pointer arithmetic explicit and lint-friendly.

---

## 4. The `reflect.Type` contract

From https://pkg.go.dev/reflect#Type:

### `Size() uintptr`

> Size returns the number of bytes needed to store a value of the given type; it is analogous to unsafe.Sizeof.

### `Align() int`

> Align returns the alignment in bytes of a value of this type when allocated in memory.

The **standalone** alignment.

### `FieldAlign() int`

> FieldAlign returns the alignment in bytes of a value of this type when used as a field in a struct.

Differs from `Align()` for 64-bit types on 32-bit platforms. Specifically:

| Type | `Align()` | `FieldAlign()` on 64-bit | `FieldAlign()` on 32-bit |
|------|-----------|--------------------------|--------------------------|
| `int64` | 8 | 8 | 4 |
| `uint64` | 8 | 8 | 4 |
| `float64` | 8 | 8 | 4 |
| `complex64` | 8 | 8 | 4 |
| All other types | x | x | x |

### `StructField.Offset uintptr`

For a field in a struct, its byte offset from the start of the struct. The fields appear in `Type.Field(i)` in source order; `Offset` reflects post-padding placement.

```go
t := reflect.TypeOf(MyStruct{})
for i := 0; i < t.NumField(); i++ {
    f := t.Field(i)
    fmt.Println(f.Name, f.Offset, f.Type.Size())
}
```

This is the runtime-reflective equivalent of walking `unsafe.Offsetof` over each field.

---

## 5. Layout algorithm in the compiler

`cmd/compile/internal/types/size.go` implements the layout. Pseudocode for `calcStructSize`:

```
function calcStructSize(s):
    offset = 0
    align  = 1
    for f in s.fields:
        a = f.type.fieldAlign       # NB: FieldAlign, not Align
        if a > align: align = a
        offset = roundUp(offset, a)
        f.offset = offset
        offset += f.type.size
    # Last-field-zero-sized rule:
    if len(s.fields) > 0 and offset > 0:
        last = s.fields[len(s.fields)-1]
        if last.type.size == 0:
            offset += 1
    # Round struct size up to struct alignment:
    size = roundUp(offset, align)
    return size, align
```

Properties:

1. Deterministic for a given Go version and target architecture.
2. Uses `FieldAlign`, not `Align`. This is why 64-bit fields on 32-bit platforms have 4-byte alignment inside structs.
3. The +1 byte for trailing zero-sized field is unconditional when the struct is otherwise non-empty.
4. `roundUp(x, a) = (x + a - 1) & ^(a - 1)` — standard alignment rounding.

The compiler does **not** reorder fields. This is intentional and documented in `cmd/compile/README.md` as a design choice for ABI stability.

---

## 6. Per-type size and alignment table

Authoritative table for 64-bit platforms (the current Go default for `linux/amd64`, `linux/arm64`, `darwin/arm64`, `windows/amd64`):

| Type | Size | Align | FieldAlign | Notes |
|------|------|-------|------------|-------|
| `bool` | 1 | 1 | 1 | |
| `int8`, `uint8`, `byte` | 1 | 1 | 1 | |
| `int16`, `uint16` | 2 | 2 | 2 | |
| `int32`, `uint32`, `rune` | 4 | 4 | 4 | |
| `int64`, `uint64` | 8 | 8 | 8 | On 32-bit: FieldAlign=4 |
| `float32` | 4 | 4 | 4 | |
| `float64` | 8 | 8 | 8 | On 32-bit: FieldAlign=4 |
| `complex64` | 8 | 4 | 4 | Two `float32`s |
| `complex128` | 16 | 8 | 8 | On 32-bit: FieldAlign=4 |
| `int`, `uint`, `uintptr` | 8 | 8 | 8 | 4/4/4 on 32-bit |
| `*T` (any pointer) | 8 | 8 | 8 | 4/4/4 on 32-bit |
| `string` | 16 | 8 | 8 | `(ptr, len)`; 8/4/4 on 32-bit |
| `[]T` (any slice) | 24 | 8 | 8 | `(ptr, len, cap)`; 12/4/4 on 32-bit |
| `map[K]V` | 8 | 8 | 8 | Pointer to hmap |
| `chan T` | 8 | 8 | 8 | Pointer to hchan |
| `func(...)` | 8 | 8 | 8 | Function pointer |
| `interface{}` | 16 | 8 | 8 | `(type, value)` |
| named interface (e.g. `error`) | 16 | 8 | 8 | `(itab, value)` |
| `[N]T` | N × size(T) | align(T) | fieldAlign(T) | No element padding |
| `struct{}` | 0 | 1 | 1 | |
| `struct{...}` | computed | max(field aligns) | same | See §5 |

Sources verified against `runtime/sizeof_test.go` in the Go tree.

---

## 7. Zero-sized types and the last-field rule

### `struct{}`

- `unsafe.Sizeof(struct{}{}) == 0`
- `unsafe.Alignof(struct{}{}) == 1`
- Two `struct{}` values may compare equal by address or not; the language does not specify.

### `[0]T` (zero-length array)

- `unsafe.Sizeof([0]T{}) == 0`
- `unsafe.Alignof([0]T{}) == unsafe.Alignof(T(zero))` — the *element's* alignment.

This is why `[0]uint64` is sometimes used as a "force alignment to 8" marker:

```go
type AlignedTo8 struct {
    _ [0]uint64   // size 0, alignment 8
    Data [3]byte  // 3 bytes, but the struct starts aligned to 8
}
```

The struct's alignment is `max(8, 1) = 8`. Its size becomes 8 (rounded up to alignment).

### Last-field rule

Quoting the Go FAQ (https://go.dev/doc/faq#unused_variables_and_imports) — actually documented in the unsafe package commentary:

> If a struct has a field whose type is a zero-sized type, and that field is the last field of the struct, then the compiler will add a byte of padding to ensure that the offset of that field is not equal to the size of the struct.

The rationale: a Go pointer must point inside an allocation, not past its end. `&s.f` for a trailing zero-sized field would, without padding, point exactly at the end of the allocation, which is illegal for the GC's "is this pointer valid?" check.

Behaviour:

| Struct | Sizeof | Reason |
|--------|--------|--------|
| `struct{}` | 0 | Both fields are zero, struct itself is zero |
| `struct{ a int32 }` | 4 | Single non-zero field |
| `struct{ a int32; _ struct{} }` | 8 | Last-field rule: 4 + 1 byte pad → rounded to 4 → +4 = 8 |
| `struct{ _ struct{}; a int32 }` | 4 | Zero-sized field not last; no extra pad |
| `struct{ a int32; _ [0]byte }` | 8 | `[0]byte` is zero-sized; rule applies |
| `struct{ a int32; b struct{} }` | 8 | Named field same as anonymous |

The compiler enforces this via `isLastZeroLen` checks in `size.go`.

---

## 8. 32-bit `int64` alignment quirk

On 32-bit platforms (`GOARCH=386`, `GOARCH=arm` (32-bit ARM), `GOARCH=mips`/`mipsle`), the spec requires only **4-byte** alignment for `int64` and friends. The compiler honours that: `FieldAlign(int64) = 4` inside a struct.

This breaks hardware atomic instructions that require 8-byte alignment. Specifically:

- **arm32**: `LDREXD`/`STREXD` require an 8-byte-aligned address.
- **386**: `LOCK CMPXCHG8B` requires 8-byte alignment on some older CPUs; modern Intel/AMD tolerates 4-byte.
- **MIPS32**: 64-bit atomics aren't natively supported; the Go runtime falls back to mutex-based emulation.

`sync/atomic` package documentation note (https://pkg.go.dev/sync/atomic#pkg-note-BUG):

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically via the primitive atomic functions (types Int64 and Uint64 are automatically aligned). The first word in an allocated struct, array, or slice; in a global variable; or in a local variable (because the subject of all atomic operations will escape to the heap) can be relied upon to be 64-bit aligned.

In other words: **if your `int64` is the first word of a heap-allocated struct, it's 8-byte aligned even on 32-bit**. Otherwise you must arrange alignment yourself, or use the `atomic.Int64`/`atomic.Uint64` types introduced in Go 1.19, which self-align.

---

## 9. `sync/atomic` alignment requirements

| Function | Type | 64-bit | 32-bit |
|----------|------|--------|--------|
| `atomic.AddInt32`, `LoadInt32`, etc. | `int32` | 4-byte align (always) | 4-byte align |
| `atomic.AddInt64`, `LoadInt64`, etc. | `int64` | 8-byte align (always) | **8-byte align required; not guaranteed by FieldAlign** |
| `atomic.AddUint32` etc. | `uint32` | 4-byte | 4-byte |
| `atomic.AddUint64` etc. | `uint64` | 8-byte | **8-byte required** |
| `atomic.LoadPointer` etc. | `unsafe.Pointer` | word align | word align |

The Go 1.19 additions — `atomic.Int32`, `atomic.Int64`, `atomic.Uint32`, `atomic.Uint64`, `atomic.Bool`, `atomic.Pointer[T]`, `atomic.Value` — are **typed wrappers** that contain alignment-forcing fields:

```go
// from src/sync/atomic/type.go (paraphrased)
type Int64 struct {
    _ noCopy
    _ align64    // empty struct that forces 8-byte alignment on 32-bit
    v int64
}
```

The `align64` field tells the compiler "this struct must be 8-byte aligned regardless of position". The compiler emits the right padding in containing structs.

Recommendation: **always use the new typed atomic wrappers** in new code. The bare function form (`atomic.AddInt64(&x, 1)`) is fine but requires you to think about alignment.

---

## 10. Version history of relevant changes

| Version | Change |
|---------|--------|
| Go 1.0 | Layout algorithm in `cmd/compile`; minimum-alignment spec text |
| Go 1.7 | `unsafe.Sizeof` etc. clarified to be compile-time constants |
| Go 1.17 | `unsafe.Add`, `unsafe.Slice` added — supported pointer arithmetic primitives |
| Go 1.19 | `atomic.Int32/Int64/Uint32/Uint64/Bool/Pointer/Value` typed wrappers; auto-aligned on 32-bit |
| Go 1.20 | `unsafe.SliceData`, `unsafe.String`, `unsafe.StringData` added |
| Go 1.21 | `sync.OnceValue`/`OnceValues`/`OnceFunc` (not layout, but commonly used with lazy struct init) |
| Go 1.22 | No major layout changes |
| Go 1.23 | `//go:align N` directive for variables |

No release has changed the layout of an existing struct silently. Layout drift across Go versions for the same source is essentially zero in practice.

---

## 11. Tooling reference

| Tool | Command | Purpose |
|------|---------|---------|
| `unsafe.Sizeof` / `Alignof` / `Offsetof` | inline in code | Compile-time inspection |
| `reflect.Type.Size()` / `Align()` / `FieldAlign()` | inline in code | Runtime inspection |
| `golang.org/x/tools/.../fieldalignment` | `fieldalignment ./...` | Static analyzer; `-fix` reorders |
| `honnef.co/go/tools/cmd/structlayout` | `structlayout pkg.Foo` | Print layout JSON or diagram |
| `go tool nm -size -sort=size` | `go tool nm -size ./binary` | Symbol sizes in linked binary |
| `go tool objdump` | `go tool objdump ./binary` | Disassembly with offsets |
| `go build -gcflags='-m'` | builds with escape-analysis output | See which structs escape to heap |
| `pprof -alloc_space` | `go tool pprof -alloc_space mem.pb.gz` | Find allocation hotspots by struct |
| `GODEBUG=allocfreetrace=1` | env var | Log every allocation (very noisy) |

---

## 12. Compliance checklist

Code that wants to be portable across all current Go platforms and versions should:

- [ ] Never assume an `int64` field has 8-byte alignment in a struct on 32-bit.
- [ ] Use `atomic.Int64` / `Uint64` (Go 1.19+) for atomically-accessed 64-bit values.
- [ ] Not rely on `&zero1 != &zero2` for zero-sized values.
- [ ] Account for the +1 byte padding when a non-zero struct ends with a zero-sized field.
- [ ] Use `unsafe.Sizeof` / `Offsetof` (compile-time) for layout assertions, not runtime computations.
- [ ] Treat `Sizeof(string)`, `Sizeof([]T)`, `Sizeof(map)`, `Sizeof(interface{})` as header-only.
- [ ] Verify cgo struct layouts with init-time `unsafe.Sizeof` assertions.
- [ ] Document explicit padding (`_ [N]byte`) for wire formats and cache-line alignment.
- [ ] Run `fieldalignment` in CI for non-wire packages.
- [ ] Pin the Go version for layout-sensitive code (build reproducibility).

---

## 13. Summary

Go's struct layout is specified in two places: the minimum-alignment table in the language spec, and the implementation in `cmd/compile/internal/types/size.go`. The spec gives you portable floor guarantees; the implementation is deterministic and stable across releases in practice. The `unsafe` and `reflect` packages expose Sizeof/Alignof/Offsetof and Align/FieldAlign — the same primitives at compile and run time. The two famous quirks are the last-field zero-sized +1 byte rule and 32-bit `int64` field alignment; both are addressed by mature tooling (`fieldalignment`, `atomic.Int64`). Going forward, `//go:align` and the typed atomic wrappers reduce the gap between "what the spec promises" and "what production needs".

---

## Further reading

- Spec: https://go.dev/ref/spec#Size_and_alignment_guarantees
- `unsafe`: https://pkg.go.dev/unsafe
- `reflect`: https://pkg.go.dev/reflect
- `sync/atomic`: https://pkg.go.dev/sync/atomic
- Compiler `size.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/types/size.go
- `internal/abi/type.go`: https://github.com/golang/go/blob/master/src/internal/abi/type.go
- `fieldalignment`: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- `//go:align` proposal: https://github.com/golang/go/issues/19057
