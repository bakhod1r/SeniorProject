# Unsafe Pointer — Specification

> **Focus:** Precise reference for the `unsafe.Pointer` type and its companion APIs. Covers every exported identifier in the `unsafe` package, the exact wording of the six legal conversion patterns, the version history (Go 1.17 `Add`/`Slice`, Go 1.20 `String`/`StringData`/`SliceData`), and the deprecation timeline for `reflect.SliceHeader` / `reflect.StringHeader`. This file is the canonical lookup; the audience files (junior/middle/senior/professional) explain *why* and *when*.
>
> **Sources:**
> - `unsafe` package docs: https://pkg.go.dev/unsafe
> - Go language spec, "Package unsafe": https://go.dev/ref/spec#Package_unsafe
> - `unsafeptr` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/unsafeptr
> - `src/unsafe/unsafe.go` source (since the package is mostly compiler-implemented, the source is a doc page)
> - Go release notes: https://go.dev/doc/go1.17, https://go.dev/doc/go1.20, https://go.dev/doc/go1.21

---

## 1. The `unsafe` package surface

The complete exported API as of Go 1.22:

```go
package unsafe

// Types
type ArbitraryType  int  // placeholder used in doc signatures
type IntegerType    int  // placeholder for any integer type
type Pointer        *ArbitraryType

// Sizing primitives (compile-time constants)
func Alignof(x ArbitraryType) uintptr
func Offsetof(x ArbitraryType) uintptr   // x must be a selector expression: var.field
func Sizeof(x ArbitraryType) uintptr

// Pointer arithmetic (Go 1.17+)
func Add(ptr Pointer, len IntegerType) Pointer

// Slice / string construction (Go 1.17 / 1.20)
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
func SliceData(slice []ArbitraryType) *ArbitraryType   // Go 1.20+
func String(ptr *byte, len IntegerType) string         // Go 1.20+
func StringData(str string) *byte                       // Go 1.20+
```

The package has no non-exported runtime; all functions are compiler intrinsics. `ArbitraryType` is a stand-in in the docs (not a real type) — actual call sites use the concrete types.

---

## 2. The `unsafe.Pointer` type

### 2.1 Definition

```go
type Pointer *ArbitraryType
```

`Pointer` is the generic pointer type. It is the **only** Go type with these properties:

- A value of any pointer type can be converted to a `Pointer`.
- A `Pointer` can be converted to a value of any pointer type.
- A `uintptr` can be converted to a `Pointer`.
- A `Pointer` can be converted to a `uintptr`.

These four conversions are the syntactic permissions. The semantic rules — what makes a use *valid* vs *undefined* — are the six patterns in §4.

### 2.2 GC treatment

`Pointer` values are tracked by the garbage collector exactly like `*T`:

- An `unsafe.Pointer` field in a struct contributes a `1` bit to the type's pointer map.
- The GC follows the pointer during tracing.
- The pointed-to object is kept alive.

By contrast, `uintptr` is treated as a scalar (bit = `0`), is not followed, and does not keep memory alive.

---

## 3. Companion functions

### 3.1 `unsafe.Sizeof`

```go
func Sizeof(x ArbitraryType) uintptr
```

Returns the size in bytes of the **type** of `x`, including padding. Compile-time constant. The expression `x` is not evaluated.

| Expression | Result on 64-bit |
|------------|------------------|
| `Sizeof(int(0))` | 8 |
| `Sizeof(int32(0))` | 4 |
| `Sizeof("hello")` | 16 (string header) |
| `Sizeof([]int{})` | 24 (slice header) |
| `Sizeof(map[int]int{})` | 8 (map pointer) |
| `Sizeof(struct{ a int8; b int64 }{})` | 16 (1 + 7 padding + 8) |

### 3.2 `unsafe.Alignof`

```go
func Alignof(x ArbitraryType) uintptr
```

Returns the alignment requirement of the type of `x`. Compile-time constant.

| Type | Alignof on amd64 |
|------|------------------|
| `int8`, `bool`, `byte` | 1 |
| `int16`, `uint16` | 2 |
| `int32`, `uint32`, `float32` | 4 |
| `int64`, `uint64`, `float64`, `complex64`, `int`, `uintptr`, pointer | 8 |
| `complex128` | 8 |
| Struct | max of field alignments |

### 3.3 `unsafe.Offsetof`

```go
func Offsetof(x ArbitraryType) uintptr
```

The argument must be a selector expression `s.f` where `s` is a struct value. Returns the byte offset of `f` within `s`'s type. Compile-time constant.

```go
type T struct {
    a int32
    b int64
}
unsafe.Offsetof(T{}.b)   // 8 (4 bytes + 4 padding)
```

Embedded fields are reached by their name; promoted fields require the embedded type's name. `Offsetof(T{}.embedded.field)` works.

### 3.4 `unsafe.Add` (Go 1.17+)

```go
func Add(ptr Pointer, len IntegerType) Pointer
```

Returns `ptr + len` interpreted as a byte offset. The `len` argument can be any integer type (it's auto-converted to `uintptr`).

| Equivalent expression | Note |
|----------------------|------|
| `unsafe.Pointer(uintptr(p) + uintptr(n))` | The pre-1.17 form |

The function is safer than the manual form because the conversion happens internally to the runtime/compiler — there's no `uintptr` exposed at the Go source level for the GC to miss.

`Add` does not bounds-check. `unsafe.Add(p, 100)` where `p` points to a 16-byte object produces an address into other memory; reading from it is undefined.

### 3.5 `unsafe.Slice` (Go 1.17+)

```go
func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
```

Returns a slice whose underlying array starts at `ptr` and has length and capacity equal to `len`.

| Condition | Result |
|-----------|--------|
| `ptr == nil && len == 0` | `nil` |
| `ptr == nil && len != 0` | **panic** |
| `len < 0` | **panic** |
| `len * sizeof(T)` overflows `uintptr` | **panic** |
| Otherwise | slice of `len` elements |

The panics are *runtime* panics, not compile-time checks. Pre-1.22 some edge cases were silently undefined; Go 1.22 tightened the checks.

### 3.6 `unsafe.SliceData` (Go 1.20+)

```go
func SliceData(slice []ArbitraryType) *ArbitraryType
```

Returns a pointer to the underlying array of `slice`.

| Condition | Result |
|-----------|--------|
| `cap(slice) > 0` | `&slice[:1][0]` (the first element of the underlying array) |
| `slice == nil` | `nil` |
| `slice != nil && cap(slice) == 0` | non-nil; address is implementation-defined |

Replaces the pre-1.20 `(*reflect.SliceHeader)(unsafe.Pointer(&s)).Data`.

### 3.7 `unsafe.String` (Go 1.20+)

```go
func String(ptr *byte, len IntegerType) string
```

Returns a string whose underlying bytes start at `ptr` and have length `len`.

| Condition | Result |
|-----------|--------|
| `len == 0` | `""` (regardless of `ptr`) |
| `ptr == nil && len != 0` | **panic** |
| `len < 0` | **panic** |
| Otherwise | string aliasing the bytes at `ptr` |

The caller is responsible for ensuring the bytes do not change. Strings are by-spec immutable; if the underlying bytes change, the program is in an inconsistent state.

### 3.8 `unsafe.StringData` (Go 1.20+)

```go
func StringData(str string) *byte
```

Returns a pointer to the first byte of `str`'s underlying bytes. For an empty string the result is implementation-defined but always non-nil for non-empty strings.

Replaces the pre-1.20 `(*reflect.StringHeader)(unsafe.Pointer(&s)).Data`.

---

## 4. The six legal conversion patterns

Quoted (paraphrased) from [pkg.go.dev/unsafe#Pointer](https://pkg.go.dev/unsafe#Pointer). Any use of `unsafe.Pointer` not matching one of these patterns is **undefined behaviour**.

### Pattern 1: Conversion of a `*T1` to `*T2`

> Provided that T2 is no larger than T1 and that the two share an equivalent memory layout, this conversion allows reinterpreting data of one type as data of another.

Practical reading: cast `*int64` to `*[8]byte` for byte access; cast a struct pointer to `*byte` to compute a checksum. Sizes need not match exactly but the second must not read past the first.

### Pattern 2: Conversion of a `Pointer` to a `uintptr` (but not back)

> Converting a Pointer to a uintptr produces the memory address of the value pointed at, as an integer.

The `uintptr` so produced can be **printed, logged, compared**, but must not be stored and converted back later. Storing it and converting back is Pattern 3 (constrained) or undefined (if the round trip spans statements).

### Pattern 3: Conversion of a `Pointer` to a `uintptr` and back, with arithmetic

> If p points into an allocated object, it can be advanced through the object by conversion to uintptr, addition of an offset, and conversion back to Pointer.

The conversion-to-`uintptr` + arithmetic + conversion-back **must be one expression**:

```go
// Legal
p2 := unsafe.Pointer(uintptr(p) + offset)

// Illegal — the uintptr is stored
u := uintptr(p)
p2 := unsafe.Pointer(u + offset)
```

The doc states valid arithmetic forms: subtraction of two pointers, addition of `unsafe.Sizeof`, `unsafe.Offsetof`, or `unsafe.Alignof` constants, and conversion of the result back via `unsafe.Pointer`. Anything else (multiplying, masking the low bits, etc.) is not explicitly covered.

`unsafe.Add` (Go 1.17+) is the modern equivalent.

### Pattern 4: Conversion of a `Pointer` to a `uintptr` when calling `syscall.Syscall`

> The Syscall functions in package syscall pass their uintptr arguments directly to the operating system, which may then, depending on the details of the call, reinterpret some of them as pointers. ... a uintptr conversion of a Pointer argument must appear in the call expression itself.

Specifically valid:

```go
syscall.Syscall(SYS_READ, uintptr(fd), uintptr(unsafe.Pointer(p)), uintptr(n))
```

The compiler recognizes this exact pattern in calls to functions whose names start with `syscall.Syscall`, `syscall.SyscallN`, `syscall.RawSyscall`, etc., and keeps the pointer live for the duration of the call. The recognition is hardcoded — wrapper functions don't inherit it.

### Pattern 5: Conversion of the result of `reflect.Value.Pointer` or `reflect.Value.UnsafeAddr` from `uintptr` to `Pointer`

> Package reflect's Value methods named Pointer and UnsafeAddr return type uintptr instead of unsafe.Pointer to keep callers from changing the result to an arbitrary type without first importing unsafe. However, this means that the result is fragile and must be converted to Pointer immediately after making the call, in the same expression.

Legal:

```go
p := unsafe.Pointer(rv.UnsafeAddr())   // one expression
```

Illegal:

```go
u := rv.UnsafeAddr()
p := unsafe.Pointer(u)                  // GC may have moved/freed
```

Go 1.18 added `reflect.Value.UnsafePointer()` returning `unsafe.Pointer` directly — prefer it.

### Pattern 6: Conversion of a `reflect.SliceHeader` or `reflect.StringHeader` Data field to or from `Pointer`

> Reading or modifying the slice/string header via reflect.SliceHeader / reflect.StringHeader's Data field is permitted only by converting it to or from unsafe.Pointer.

```go
var s string = "hello"
sh := (*reflect.StringHeader)(unsafe.Pointer(&s))
// sh.Data is a uintptr — must be converted via unsafe.Pointer for use as a pointer
p := unsafe.Pointer(sh.Data)
```

**Deprecated as of Go 1.20.** Use `unsafe.SliceData` / `unsafe.StringData` instead. See §6 below.

---

## 5. The `unsafeptr` analyzer

The `unsafeptr` analyzer (`golang.org/x/tools/go/analysis/passes/unsafeptr`) is included in `go vet`'s default analyzer set.

| Pattern detected | Reported |
|------------------|----------|
| `unsafe.Pointer(x)` where `x` is `uintptr` but did not originate from `uintptr(unsafe.Pointer(...))` in this expression | Yes |
| `unsafe.Pointer(uintptr(p) + N)` where `N` is `unsafe.Sizeof`/`Alignof`/`Offsetof` or a multiple thereof | Allowed |
| `unsafe.Pointer(rv.Pointer())` where `rv` is `reflect.Value` | Allowed (Pattern 5) |

The analyzer is **syntactic**: it pattern-matches AST shapes and does not perform data-flow or alias analysis. Bugs that hide behind a wrapper function or behind dataflow that the analyzer doesn't traverse are not flagged.

Run explicitly:

```bash
go vet -unsafeptr ./...
```

Disable (not recommended):

```bash
go vet -unsafeptr=false ./...
```

---

## 6. Version history

| Go version | Change |
|-----------|--------|
| 1.0 | `unsafe.Pointer`, `Sizeof`, `Alignof`, `Offsetof` |
| 1.0 | Six legal patterns documented |
| 1.5 | `unsafeptr` analyzer added to `go vet` |
| 1.8 | `unsafeptr` strengthened to flag arithmetic-without-keep-alive |
| 1.14 | `-d=checkptr` runtime check added (alignment, bounds) |
| 1.17 | `unsafe.Add(p, n)` and `unsafe.Slice(p, n)` added; replace manual `uintptr` arithmetic |
| 1.18 | `reflect.Value.UnsafePointer()` added; obsoletes `Value.Pointer()` for the Pattern 5 case |
| 1.20 | `unsafe.String(p, n)`, `unsafe.StringData(s)`, `unsafe.SliceData(s)` added |
| 1.20 | `reflect.SliceHeader` and `reflect.StringHeader` **deprecated** |
| 1.21 | `runtime.Pinner` added; supersedes cgo's `C.malloc`-then-copy workaround |
| 1.22 | `unsafe.Slice` and `unsafe.String` panic on overflow/negative length (was undefined) |

---

## 7. The `runtime.KeepAlive` companion

```go
package runtime

func KeepAlive(x any)
```

Marks `x` as reachable at the call site. No-op at runtime; purely a compile-time signal to escape analysis.

Used to extend a variable's lifetime past its apparent last use, typically when the address has been passed to a syscall or cgo call via `uintptr` (where the compiler can't see the dependency).

```go
n, _, _ := syscall.Syscall(SYS_WRITE, uintptr(fd), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
runtime.KeepAlive(buf)
```

Without `KeepAlive`, the compiler could conclude `buf` is dead after the `uintptr(unsafe.Pointer(&buf[0]))` expression and free it before the syscall returns.

For `syscall.Syscall` itself, the keepalive is automatic; but for any wrapper, you must add it.

---

## 8. The `runtime.Pinner` API (Go 1.21+)

```go
package runtime

type Pinner struct { /* opaque */ }

func (p *Pinner) Pin(pointer any)
func (p *Pinner) Unpin()
```

`Pin` marks an object so it cannot be moved or collected. `Unpin` releases all pins for the receiver.

Use in cgo to pass mutable Go memory to a C function that retains the pointer (e.g., for an async callback). Pre-1.21, this required copying to `C.malloc`-allocated memory.

```go
var pinner runtime.Pinner
defer pinner.Unpin()
pinner.Pin(&buf[0])
C.someAsyncFunc(unsafe.Pointer(&buf[0]))
```

The pin lasts until `Unpin`. Multiple pins on the same object are reference-counted by the runtime.

---

## 9. Build-time toggles

| Flag | Effect |
|------|--------|
| `go vet -unsafeptr` | Run only the `unsafeptr` analyzer |
| `go build -gcflags="all=-d=checkptr"` | Insert runtime checks for alignment, bounds, validity |
| `go test -race` | Enable race detector + `checkptr` |
| `go build -ldflags="-s -w"` | Strip symbols; unrelated to safety |

For CI on `unsafe`-touching packages:

```bash
go vet ./...
go test -race ./...
go test -gcflags="all=-d=checkptr" ./...
```

This combination catches the vast majority of `unsafe.Pointer` misuse in tests. See [professional.md](professional.md) §7 for the full CI recipe.

---

## 10. Deprecated and grandfathered APIs

| API | Status | Replacement |
|-----|--------|-------------|
| `reflect.SliceHeader` | Deprecated 1.20 | `unsafe.Slice`, `unsafe.SliceData` |
| `reflect.StringHeader` | Deprecated 1.20 | `unsafe.String`, `unsafe.StringData` |
| `reflect.Value.Pointer()` returning `uintptr` | Soft-deprecated 1.18 | `reflect.Value.UnsafePointer()` |
| `reflect.Value.UnsafeAddr()` returning `uintptr` | Still supported | Same — but consider Addr().UnsafePointer() |
| Manual `uintptr`-arithmetic for offsetting | Still supported | `unsafe.Add` |
| `unsafe.Pointer(uintptr(p) + n)` for slice construction | Still supported | `unsafe.Slice(p, n)` |

`staticcheck` rule `SA1019` flags `reflect.SliceHeader` / `StringHeader` usage. Treat warnings as errors in new code.

---

## 11. Interaction with `cgo`

`cgo` adds its own rules on top of `unsafe.Pointer`:

| Direction | Rule |
|-----------|------|
| Go → C: passing `*T` (T has no pointer fields) | OK; no special action needed |
| Go → C: passing `*T` (T contains Go pointer fields) | C must not store the pointer; or use `runtime.Pinner` |
| Go → C: passing `unsafe.Pointer(&slice[0])` | OK for the call duration; `KeepAlive(slice)` after |
| C → Go: receiving C pointer | Treat as `unsafe.Pointer`; do not feed to GC-tracked Go pointer fields |
| C → Go: `C.GoString`, `C.GoBytes` | Copy from C memory into Go memory; safe |
| C → Go: `unsafe.Slice((*byte)(cmem), n)` | Alias of C memory; valid until `C.free` is called |

See [cgo's pointer-passing docs](https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers) for the canonical rules.

---

## 12. Comparison to `*T` and `uintptr`

| Property | `*T` | `unsafe.Pointer` | `uintptr` |
|----------|------|------------------|-----------|
| Type-safe | Yes | No | N/A (integer) |
| GC-tracked | Yes | Yes | No |
| Convertible to/from `uintptr` | No | Yes | N/A |
| Convertible to other pointer types | No (except via `unsafe.Pointer`) | Yes | No |
| Survives stack-grow | Yes | Yes | No |
| Vet-checked usage rules | Standard | Six patterns | N/A |
| `Sizeof` on amd64 | 8 | 8 | 8 |

The three are size-equal at runtime; the type system difference is the entire point.

---

## 13. Quick-reference: legal vs illegal

| Code | Legal? | Pattern |
|------|--------|---------|
| `p := unsafe.Pointer(&x)` | Yes | — (constructor) |
| `q := (*int64)(unsafe.Pointer(&x))` | Yes (if sizes match) | 1 |
| `u := uintptr(unsafe.Pointer(&x)); log.Print(u)` | Yes (read-only use of uintptr) | 2 (one-way) |
| `p2 := unsafe.Pointer(uintptr(p) + 8)` | Yes (one expression) | 3 |
| `u := uintptr(p); p2 := unsafe.Pointer(u + 8)` | **No** | — |
| `p2 := unsafe.Add(p, 8)` | Yes | 3 (modern) |
| `syscall.Syscall(N, 0, uintptr(unsafe.Pointer(p)), 0)` | Yes | 4 |
| `mySyscall(N, 0, uintptr(unsafe.Pointer(p)), 0)` (custom) | No (without `KeepAlive`) | — |
| `unsafe.Pointer(rv.UnsafeAddr())` | Yes | 5 |
| `u := rv.UnsafeAddr(); unsafe.Pointer(u)` | **No** | — |
| `sh := (*reflect.SliceHeader)(unsafe.Pointer(&b))` | Yes (deprecated) | 6 |
| `unsafe.String(unsafe.SliceData(b), len(b))` | Yes (modern equivalent) | 1 + 3 |

---

## 14. Pointer alignment table (amd64 / arm64)

| Type | Alignof | Notes |
|------|---------|-------|
| `byte`, `bool`, `int8` | 1 | |
| `int16`, `uint16` | 2 | |
| `int32`, `uint32`, `float32`, `rune` | 4 | |
| `int64`, `uint64`, `float64`, `int`, `uintptr`, `Pointer`, `*T` | 8 | |
| `complex128` | 8 | |
| `string` header | 8 | |
| `[]T` header | 8 | |
| `map[K]V` | 8 | |
| `interface{}` | 8 | |
| Struct | max of fields' Alignof | |

A `*T` reads or writes require the address to be `Alignof(T)`-aligned. On amd64, misalignment is slow but usually works; on arm64 it may fault with `SIGBUS`.

---

## 15. Related references

- `unsafe` doc page (with rules): https://pkg.go.dev/unsafe#Pointer
- Language spec on `unsafe`: https://go.dev/ref/spec#Package_unsafe
- `unsafeptr` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/unsafeptr
- `runtime.Pinner`: https://pkg.go.dev/runtime#Pinner
- `runtime.KeepAlive`: https://pkg.go.dev/runtime#KeepAlive
- `-d=checkptr` issue: https://github.com/golang/go/issues/22218
- `unsafe.Add` proposal: https://github.com/golang/go/issues/40481
- `unsafe.Slice` proposal: https://github.com/golang/go/issues/19367
- `unsafe.String`/`Data` proposal: https://github.com/golang/go/issues/53003
- Related: [string-internals](../../02-data-types/07-string-internals/)
- Related: [slice-header-internals](../../03-composite-types/02-slices/05-slice-header-internals/)
- Related: [unsafe-package](../../../11-advanced-topics/04-unsafe-package/)
