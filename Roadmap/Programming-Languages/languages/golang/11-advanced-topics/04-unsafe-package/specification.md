# `unsafe` Package — Specification

> **Focus:** Precise reference for the `unsafe` package — what it provides, the rules that make its use sound, and what the compiler/runtime guarantees (or does not).
>
> **Sources:**
> - `unsafe` package: https://pkg.go.dev/unsafe
> - Go spec — Package unsafe: https://go.dev/ref/spec#Package_unsafe
> - Pointer rules: https://pkg.go.dev/unsafe#Pointer

---

## 1. What `unsafe` provides

| Type/Func | Purpose |
|-----------|---------|
| `unsafe.Pointer` | A pointer to arbitrary memory; no type, no GC scanning rules beyond "treat as pointer" |
| `unsafe.Sizeof(x)` | Size in bytes of the type of `x` (compile-time constant) |
| `unsafe.Alignof(x)` | Alignment in bytes (compile-time constant) |
| `unsafe.Offsetof(field)` | Byte offset of `field` within its enclosing struct |
| `unsafe.Add(p, n)` | (Go 1.17+) `unsafe.Pointer(p + n)` — typed pointer arithmetic |
| `unsafe.Slice(p, n)` | (Go 1.17+) Construct `[]T` from pointer + length |
| `unsafe.SliceData(s)` | (Go 1.20+) `*T` to the underlying array of a slice |
| `unsafe.String(p, n)` | (Go 1.20+) Construct a `string` from pointer + length |
| `unsafe.StringData(s)` | (Go 1.20+) `*byte` to the underlying bytes of a string |

`unsafe.Sizeof`, `Alignof`, `Offsetof` are constant expressions; the others are runtime operations.

---

## 2. The `unsafe.Pointer` rules

The Go runtime treats `unsafe.Pointer` specially. The [package doc](https://pkg.go.dev/unsafe#Pointer) lists six valid conversion patterns. Outside these, your code is undefined-behavior territory.

The six valid patterns:

1. **Conversion of `*T1` to `unsafe.Pointer` to `*T2`** — type-punning two pointer types.
2. **Conversion of `unsafe.Pointer` to `uintptr` (and back) without intervening operations** — for syscall/cgo arguments only.
3. **Conversion of `unsafe.Pointer` to `uintptr` and back, with arithmetic, in one expression** — for indexing into a known structure.
4. **Conversion of an `unsafe.Pointer` from `reflect.Value.Pointer` or `reflect.Value.UnsafeAddr`** — the result must be converted to a `*T` immediately.
5. **Conversion of an `unsafe.Pointer` to/from `reflect.SliceHeader`/`StringHeader`** — deprecated; use `unsafe.Slice`/`SliceData`/`String`/`StringData` (Go 1.20+).
6. **Conversion of `unsafe.Pointer` returned by `syscall.Syscall` etc.** — for low-level OS interop.

Pattern 3 is the most subtle: the entire arithmetic chain must be a single expression, because the GC may move the underlying object between statements (in practice it doesn't move objects, but the spec reserves the right).

---

## 3. The `uintptr` trap

`uintptr` is an **integer**, not a pointer. The GC does not consider it a reference; an object reachable only through a `uintptr` can be collected.

```go
p := unsafe.Pointer(&x)
n := uintptr(p)
// x may be collected here if no other reference exists
back := (*T)(unsafe.Pointer(n))   // dereferencing may read freed memory
```

Use `runtime.KeepAlive(x)` to extend the original lifetime past the dereference, or never let the pointer become a `uintptr` outside the syscall/arithmetic patterns above.

---

## 4. Constant operations

```go
var s struct {
    a int32
    b int64
}

const sz   = unsafe.Sizeof(s)        // 16 (with padding)
const off  = unsafe.Offsetof(s.b)    // 8 on 64-bit
const al   = unsafe.Alignof(s)       // 8 on 64-bit
```

These are compile-time constants and can appear in type-switch cases, array sizes, etc. Their values are platform-dependent.

---

## 5. `unsafe.Add` and `unsafe.Slice` (Go 1.17+)

`unsafe.Add(p, len)` — equivalent to `unsafe.Pointer(uintptr(p) + len)` but type-checked and easier to reason about.

`unsafe.Slice(*T, len)` — returns `[]T` with the pointer as the backing array start, length and capacity equal to `len`. The underlying memory must be valid for `len * sizeof(T)` bytes.

```go
arr := [4]int{1, 2, 3, 4}
s := unsafe.Slice(&arr[0], 4)        // []int{1,2,3,4}
```

These functions made the older `reflect.SliceHeader` approach largely obsolete.

---

## 6. `unsafe.String`, `unsafe.StringData`, `unsafe.SliceData` (Go 1.20+)

Provide a typed way to alias between `[]byte` and `string` without the unsafe-pointer dance.

```go
func b2s(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func s2b(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

Rules:

- The aliased memory must remain unchanged for the lifetime of the resulting view.
- Mutating a `[]byte` whose memory is aliased by a live `string` violates Go's immutable-string assumption — undefined behavior follows.

---

## 7. Alignment requirements

Some platforms (notably 32-bit ARM and some MIPS variants) require aligned access for 64-bit atomics. Misaligned `unsafe.Pointer` dereferences may fault.

```go
type T struct { a int32; b int64 }
// On 64-bit: b has offset 8; on 32-bit, may be 4 — atomic ops on b panic
```

For atomics, `atomic.Int64` (Go 1.19+) guarantees alignment via its struct layout, removing the historical 32-bit headache.

---

## 8. GC implications

The runtime tracks pointers to heap objects through *typed* references. `unsafe.Pointer` is treated as a pointer (the GC traces it). `uintptr` is not.

Consequences:

- Storing pointers as `unsafe.Pointer` in heap objects works; the GC sees them.
- Storing pointers as `uintptr` in heap objects breaks the GC's view; the pointed-to object may be collected.
- Cgo allocations (`C.malloc`) live outside the Go heap; the GC never traces or frees them.

---

## 9. What `unsafe` cannot do

- Cannot create a `Pointer` to a non-existent type at compile time.
- Cannot bypass the language's type system at the call boundary (you still must cast through `unsafe.Pointer`).
- Cannot make atomically safe accesses to misaligned memory.
- Cannot enable behavior the runtime forbids (e.g., writing to a string's bytes).

`unsafe` is an escape hatch for the language's type system, **not** for the runtime's invariants.

---

## 10. Common idioms

| Pattern | Use case |
|---------|----------|
| `*(*T)(unsafe.Pointer(&otherT))` | Reinterpret a value as a different type (same size and layout) |
| `unsafe.Add(p, offset)` | Indexing into a struct or array |
| `unsafe.Slice(*T, n)` | Wrapping C-allocated memory as a Go slice |
| `unsafe.String(*byte, n)` | Avoiding the copy from `[]byte` to `string` (read-only) |
| `(*reflect.SliceHeader)(unsafe.Pointer(&s))` | Legacy slice-header access — replace with `unsafe.SliceData` |

---

## 11. Versioning notes

| Version | Addition |
|---------|----------|
| 1.17 | `unsafe.Add`, `unsafe.Slice` |
| 1.20 | `unsafe.String`, `unsafe.StringData`, `unsafe.SliceData` |
| 1.21+ | Minor clarifications in the pointer rules |

Code targeting older Go must use the legacy `reflect.SliceHeader` style.

---

## 12. Stability and the Go 1 compatibility promise

`unsafe` is **excluded** from the Go 1 compatibility promise. The exact rules can change between releases (rare but possible). New analyzers (`vet` checks) may flag patterns that previously compiled cleanly.

In practice, the `unsafe.Pointer` rules have been stable for years, but always re-read the package doc when upgrading.

---

## 13. Tooling

| Tool | Purpose |
|------|---------|
| `go vet` | `unsafeptr` analyzer warns on suspicious `uintptr` ↔ `Pointer` conversions |
| `go test -race` | Detects data races on `unsafe`-accessed memory |
| `cgo` | Provides `C.malloc`, `C.free` and the bridge for unsafe-pointer-passing patterns |
| `runtime.KeepAlive` | Extends object lifetime past a `uintptr` use |

---

## 14. Related references

- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- Go spec on `unsafe`: https://go.dev/ref/spec#Package_unsafe
- "The Go Memory Model": https://go.dev/ref/mem
- cgo + `unsafe`: [06-cgo-basics](../06-cgo-basics/)
