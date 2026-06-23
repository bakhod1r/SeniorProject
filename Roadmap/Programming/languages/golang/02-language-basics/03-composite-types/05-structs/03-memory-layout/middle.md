# Struct Memory Layout — Middle

## 1. Where this file picks up

Junior covered "what padding is" and "reorder large→small". This file fills in the **rules** behind those slogans:

- The per-type alignment requirement, formally.
- How embedded structs and arrays inherit alignment.
- Zero-sized fields, including the special "last field" rule.
- The `reflect.Type` interface for inspecting layout at runtime.
- The `fieldalignment` analyzer that automates the cleanup.

After this you'll be able to predict the layout of any struct without running it, and you'll have a CI guardrail to keep new structs from regressing.

---

## 2. The exact alignment rule

Go's compiler, for every type `T`, computes two numbers:

| Number | Meaning |
|--------|---------|
| `unsafe.Sizeof(T)` | How many bytes a value of `T` occupies in memory |
| `unsafe.Alignof(T)` | The alignment of `T` — its address must be a multiple of this |

For a struct, both are derived from the fields:

```
alignment(S) = max alignment of any field (or 1 if S has no fields)
size(S)      = compute by laying out fields in order, inserting padding
               before each field so its offset is a multiple of its alignment,
               then round the total up to a multiple of alignment(S).
```

That's the entire algorithm. Let's apply it to a non-trivial struct:

```go
type Mixed struct {
    a byte   // align 1, size 1
    b int32  // align 4, size 4
    c byte   // align 1, size 1
    d int64  // align 8, size 8
    e byte   // align 1, size 1
}
```

Walk it:

| Offset | Field | Why |
|--------|-------|-----|
| 0 | a (1 byte) | starts at 0 |
| 1–3 | pad | b needs offset multiple of 4 |
| 4 | b (4 bytes) | |
| 8 | c (1 byte) | |
| 9–15 | pad | d needs offset multiple of 8 |
| 16 | d (8 bytes) | |
| 24 | e (1 byte) | |
| 25–31 | trailing pad | size must be multiple of 8 (max alignment) |

Total = **32 bytes**, 11 of them padding. Reordered as `d, b, a, c, e`:

| Offset | Field |
|--------|-------|
| 0 | d (8) |
| 8 | b (4) |
| 12 | a (1) |
| 13 | c (1) |
| 14 | e (1) |
| 15 | trailing pad (1) |

Total = **16 bytes**. Half the size.

You can predict this by hand from the table in [junior.md](junior.md) §2 plus the rule above.

---

## 3. Alignment of compound types

Some types are not primitives and their alignment is derived:

| Type | Size on 64-bit | Alignment |
|------|----------------|-----------|
| `string` | 16 (ptr + len) | 8 |
| `[]T` | 24 (ptr + len + cap) | 8 |
| `map[K]V` | 8 (pointer to hmap) | 8 |
| `chan T` | 8 (pointer to hchan) | 8 |
| `interface{}` (eface) | 16 (type + value) | 8 |
| `error` (iface) | 16 (itab + value) | 8 |
| `func(...)` | 8 (function pointer) | 8 |
| `complex64` | 8 | 4 |
| `complex128` | 16 | 8 |
| `[N]T` | N × size(T), with elements naturally aligned | alignment(T) |
| `struct{...}` | per the algorithm above | max alignment of fields |

A few worth highlighting:

- A `string` is 16 bytes but aligned to 8, because it's `(*byte, int)`. The pointer dictates alignment.
- A slice header (`[]T`) is 24 bytes — three machine words. Same alignment as a pointer.
- An interface value is 16 bytes — `(itab*, data*)`. Always.
- An array's alignment equals its element's alignment. An array's size is `N × size(element)` with no padding *between* elements (their size already includes their tail padding).

---

## 4. Embedded structs do not magically pack

A common surprise: embedding a struct does **not** flatten it for layout purposes. The embedded struct is treated as a single field whose size and alignment come from the embedded type itself.

```go
type Inner struct {
    a byte   // 1
    b int64  // 8
}
// Sizeof(Inner) = 16, alignment 8 (1 + 7 pad + 8)

type Outer struct {
    x byte    // 1
    i Inner   // 16 bytes, alignment 8
    y byte    // 1
}
```

Layout of `Outer`:

| Offset | Field |
|--------|-------|
| 0 | x (1) |
| 1–7 | pad (Inner needs alignment 8) |
| 8 | Inner.a (1) |
| 9–15 | pad (Inner.b needs offset multiple of 8) |
| 16 | Inner.b (8) |
| 24 | y (1) |
| 25–31 | trailing pad |

Total = **32 bytes** of which 22 are padding. Even if you reorder `x, i, y`, you can't fix the internal hole in `Inner` from outside. The right fix is to **flatten `Inner` into `Outer`** if you control both:

```go
type Flat struct {
    b   int64  // 8
    a   byte   // 1
    x   byte   // 1
    y   byte   // 1
}
// Sizeof = 16, just 5 bytes of trailing pad
```

That cut the size from 32 to 16. The cost: you've broken encapsulation. Whether that trade is worth it depends on how often you allocate `Outer`. For a struct allocated once, leave it alone. For one in a `[]Outer` of millions, flatten.

---

## 5. Zero-sized fields and the last-field rule

`struct{}` has size 0 and alignment 1. Two zero-sized values can — and do — share the same memory address.

```go
type Empty struct{}
fmt.Println(unsafe.Sizeof(Empty{})) // 0
```

But there's a wrinkle. Consider:

```go
type S struct {
    a int32   // 4 bytes
    b struct{}  // 0 bytes
}
```

Without intervention, `Sizeof(S)` would be 4 and `&s.b` would point at offset 4 — which is **one past the end of the allocation**. Past-end pointers are dangerous: the garbage collector treats them as pointers into the next object. To prevent this, the Go runtime adds **1 byte of padding** when a non-zero-sized struct ends with a zero-sized field:

```go
type S struct {
    a int32     // offset 0, size 4
    b struct{}  // offset 4, size 0
}
// Sizeof(S) = 8: 4 (a) + 3 (pad to align to 4) + 1 (the special end pad)
// Actually: 4 (a) + 0 (b) + 4 (alignment trail) = 8 — depends on view
```

Inspect:

```go
type S struct {
    a int32
    b struct{}
}

var s S
fmt.Println(unsafe.Sizeof(s))         // 8
fmt.Println(unsafe.Offsetof(s.b))     // 4 — NOT 8
```

The offset of `b` is the natural offset (4); the **size** is bumped to 8 because the trailing zero-sized field would otherwise produce a past-end pointer. The Go FAQ documents this as the "non-empty struct that ends with an empty struct gets one extra byte" rule.

If the zero-sized field is **not last**, no extra padding is needed:

```go
type S2 struct {
    a int32
    b struct{}  // not last
    c byte
}
// Sizeof(S2) = 8: 4 (a) + 0 (b) + 1 (c) + 3 (trail) — no special rule fired
```

The relevant runtime source is `cmd/compile/internal/types/size.go` — search for `IsLastInStruct`.

This rule is genuinely important for any code that puts `struct{}` markers at the end of a struct for compile-time-constant signalling. Don't.

---

## 6. `reflect` for layout introspection at runtime

`unsafe.Sizeof` works at compile time and only on values of statically known types. For a `reflect.Value`, use `reflect`:

```go
package main

import (
    "fmt"
    "reflect"
)

type User struct {
    Name string
    ID   int64
    Age  int32
    Ok   bool
}

func main() {
    t := reflect.TypeOf(User{})
    fmt.Printf("size=%d align=%d\n", t.Size(), t.Align())
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        fmt.Printf("  %-5s type=%-8s offset=%-3d align=%d fieldAlign=%d\n",
            f.Name, f.Type, f.Offset, f.Type.Align(), f.Type.FieldAlign())
    }
}
```

Output:

```
size=40 align=8
  Name  type=string   offset=0   align=8 fieldAlign=8
  ID    type=int64    offset=16  align=8 fieldAlign=8
  Age   type=int32    offset=24  align=4 fieldAlign=4
  Ok    type=bool     offset=28  align=1 fieldAlign=1
```

Two methods worth distinguishing:

- `Align()` — alignment when **used standalone** (not as a struct field).
- `FieldAlign()` — alignment when **used as a struct field**. Usually the same as `Align()`, but on 32-bit platforms an `int64` has `Align()=8` (atomic ops need 8-byte alignment) while `FieldAlign()=4` (the compiler only guarantees 4-byte alignment inside a struct). This is the source of the famous 32-bit atomic bug — covered in [senior.md](senior.md) §6.

`reflect.Type.Size()`, `Align()`, `FieldAlign()`, and `Offset` (on `StructField`) are documented at https://pkg.go.dev/reflect#Type.

---

## 7. The `fieldalignment` analyzer

`golang.org/x/tools/go/analysis/passes/fieldalignment` is a static analyzer maintained by the Go team. It walks every struct in your package and reports:

1. **Pointer-bytes** — how many bytes the GC has to scan looking for pointers in this struct.
2. **Total size** — current size and the size if reordered optimally.

Install and run:

```bash
go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest

fieldalignment ./...
```

Sample output:

```
internal/types/user.go:12:6: struct of size 56 could be 40
internal/types/user.go:30:6: struct with 24 pointer bytes could be 16
```

With `-fix` it will rewrite your source to the optimal order:

```bash
fieldalignment -fix ./internal/types/...
```

Be careful: `-fix` reorders fields **without semantic understanding**. If your struct is consumed by `encoding/binary` or marshalled to a fixed wire format, reordering breaks it. Add a `// nolint:fieldalignment` comment on those types or exclude the package.

Integrate in CI:

```yaml
- name: fieldalignment
  run: |
    go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest
    fieldalignment ./... && echo "all structs are tight"
```

It exits non-zero on findings. Pin the analyzer to a specific version in `tools.go` to avoid CI surprises when upstream changes.

---

## 8. Pointer bytes: the GC angle

The second metric `fieldalignment` reports — "pointer bytes" — is about garbage collection. The GC scans the heap looking for pointers. For each allocation, the runtime stores a **bitmap** indicating which 8-byte words contain pointers. The fewer pointer-containing words, the less work the GC does.

Example:

```go
type WithPointers struct {
    name  string  // contains a pointer
    email string  // contains a pointer
    id    int64
    age   int32
}
// pointer bytes: 16 (two string pointers, at offsets 0 and 16)

type ByValue struct {
    name  [32]byte  // no pointers
    email [64]byte  // no pointers
    id    int64
    age   int32
}
// pointer bytes: 0
```

For caches, message queues, and very large slices, switching from `[]string` to `[][N]byte` can dramatically reduce GC pressure even though each value is larger. The trade-off: bigger heap, lighter GC. Measure with `runtime.MemStats.GCSys` and `PauseNs`.

The analyzer's "pointer bytes could be N" suggestion is about field order: if you cluster pointer-containing fields together, the bitmap encoding is more compact and the GC's pointer-walk is faster.

---

## 9. Arrays and struct layout

An array is laid out like a tightly packed sequence of its element type. **Element padding is included in the per-element size**, so the array has no extra padding between elements:

```go
type Cell struct {
    v int32
    f byte
}
// Sizeof(Cell) = 8 (4 + 1 + 3 trail)

type Grid struct {
    cells [3]Cell
}
// Sizeof(Grid) = 24 = 3 × 8
```

Each element's trail padding is already counted. The array doesn't add extra space.

This has a consequence: if you make `Cell` more tightly packed (e.g. by using `int16` instead of `int32`), the per-element size shrinks and the array shrinks proportionally. For megabyte-sized arrays this is a significant lever.

---

## 10. Slices, maps, channels: no surprises

A slice header is `(ptr, len, cap)` — 24 bytes on 64-bit. The pointer and the lengths are independent of the element type. So:

```go
fmt.Println(unsafe.Sizeof([]byte{}))   // 24
fmt.Println(unsafe.Sizeof([]int64{}))  // 24
fmt.Println(unsafe.Sizeof([]struct{ a, b, c int64 }{})) // 24
```

The element data lives behind the pointer; only the header is in the struct.

Same logic for `map`, `chan`, `func`, `interface`: the header in your struct is one word (or two for interfaces). The "real" data is elsewhere.

This means a struct field of type `map[string]int` contributes only **8 bytes** to the struct's size, regardless of how much data the map holds. The GC still scans it (it's a pointer), but the struct itself is cheap.

---

## 11. Bool fields and bitfields

Each `bool` field in Go occupies **one full byte**, not one bit. Unlike C, Go has no bitfield syntax. If you have ten bools and you want them packed:

```go
type Flags struct {
    a, b, c, d, e, f, g, h, i, j bool  // 10 bytes + trailing pad
}
// Sizeof = 16 (next multiple of 8)

type FlagsPacked struct {
    bits uint16  // 2 bytes, holds 16 bool-equivalent bits
}
// Sizeof = 2 (or 8 with trailing if alone in larger struct)
```

You manage the bits yourself:

```go
const (
    FlagA = 1 << iota
    FlagB
    FlagC
)

func (f *FlagsPacked) Set(bit uint16)  { f.bits |= bit }
func (f *FlagsPacked) Has(bit uint16) bool { return f.bits&bit != 0 }
```

For a struct allocated in millions of copies (game entities, packet headers, large in-memory indexes), packing is worth the helper boilerplate. For occasional structs, leave them as bools and forget it.

---

## 12. Strings, byte slices, and layout traps

A `string` is a (pointer, length) header — 16 bytes. The string's bytes live elsewhere and are shared with any value that refers to the same underlying data.

```go
type Header struct {
    method string   // 16
    path   string   // 16
    host   string   // 16
}
// Sizeof(Header) = 48
```

That tells you nothing about how much memory each `Header` actually keeps alive. If `method` was sliced out of a 4 MiB request buffer, the header keeps that buffer rooted until the header is collected.

Two layout-adjacent gotchas:

1. **Substring retention** — `s[10:20]` shares the underlying bytes with `s`. The string field looks 16 bytes wide but the bytes it pins can be much larger.
2. **Conversion `[]byte(s)`** allocates a copy. This is good for memory hygiene; it's bad for hot-path CPU.

These are not strictly *layout* issues but they're often confused with layout. The 16 bytes in the struct is the cost; the kilobytes behind the pointer are the real cost.

---

## 13. The `unsafe.Pointer` confirm pattern

Use this when you need to be 100 % sure a struct field is at the offset you think:

```go
type Packet struct {
    Magic   uint32
    Length  uint32
    Payload [256]byte
}

const expectedPayloadOffset = 8

func init() {
    if off := unsafe.Offsetof(Packet{}.Payload); off != expectedPayloadOffset {
        panic(fmt.Sprintf("packet layout drift: payload at %d, want %d", off, expectedPayloadOffset))
    }
}
```

This is a compile-time-ish check (`unsafe.Offsetof` is constant-foldable). It catches accidental field reordering by future maintainers when the struct corresponds to a fixed wire format.

For C interop, the `cgo` `_Ctype_struct_foo` types come with C's alignment rules — usually the same as Go's, but verify with `unsafe.Sizeof`.

---

## 14. Sanity checks on different architectures

If you build for both 64-bit (amd64, arm64) and 32-bit (386, arm), some structs change size. The classic case: `int` and `uintptr` are 4 bytes on 32-bit, 8 on 64-bit.

```go
type Page struct {
    ptr  *byte    // 8 on 64-bit, 4 on 32-bit
    size int      // 8 on 64-bit, 4 on 32-bit
}
// Sizeof = 16 on 64-bit, 8 on 32-bit
```

On a 32-bit platform, `int64`/`float64` fields have only 4-byte alignment when used inside a struct (`FieldAlign() = 4`). This is what causes the famous `sync/atomic` misalignment bug on 32-bit ARM. The full story is in [senior.md](senior.md) §6.

A defensive pattern for cross-platform code:

```go
func init() {
    if unsafe.Alignof(uint64(0)) != 8 {
        // 32-bit platform; use 8-byte-aligned wrappers for atomic uint64
    }
}
```

---

## 15. A worked example: shrinking a real config struct

Take a representative server config:

```go
type ServerConfig struct {
    UseTLS       bool
    Port         int32
    MaxClients   int64
    ReadBuf      int32
    Hostname     string
    EnableDebug  bool
    DBPoolSize   int32
    StartupDelay int64
    LogLevel     string
}
```

Layout walk:

| Offset | Field | Size | Note |
|--------|-------|------|------|
| 0 | UseTLS (1) | 1 | |
| 1–3 | pad | 3 | Port needs align 4 |
| 4 | Port (4) | 4 | |
| 8 | MaxClients (8) | 8 | |
| 16 | ReadBuf (4) | 4 | |
| 20–23 | pad | 4 | Hostname needs align 8 |
| 24 | Hostname (16) | 16 | |
| 40 | EnableDebug (1) | 1 | |
| 41–43 | pad | 3 | DBPoolSize needs align 4 |
| 44 | DBPoolSize (4) | 4 | |
| 48 | StartupDelay (8) | 8 | |
| 56 | LogLevel (16) | 16 | |

Total: **72 bytes** (already a multiple of 8). Wasted on padding: **10**.

Reordered, large→small:

```go
type ServerConfig struct {
    Hostname     string
    LogLevel     string
    MaxClients   int64
    StartupDelay int64
    Port         int32
    ReadBuf      int32
    DBPoolSize   int32
    UseTLS       bool
    EnableDebug  bool
}
```

| Offset | Field | Size |
|--------|-------|------|
| 0 | Hostname (16) | 16 |
| 16 | LogLevel (16) | 16 |
| 32 | MaxClients (8) | 8 |
| 40 | StartupDelay (8) | 8 |
| 48 | Port (4) | 4 |
| 52 | ReadBuf (4) | 4 |
| 56 | DBPoolSize (4) | 4 |
| 60 | UseTLS (1) | 1 |
| 61 | EnableDebug (1) | 1 |
| 62–63 | trailing pad | 2 |

Total: **64 bytes**. Saved **8 bytes** — a ~11 % reduction. For a config allocated once, irrelevant. For a per-connection config in a server with 100 K connections, that's 800 KiB.

---

## 16. Summary

The middle-level facts:

1. **Alignment of a struct = max alignment of its fields**. Its size is a multiple of that.
2. **Embedded structs aren't flattened**; their internal padding stays.
3. **Zero-sized fields are free** unless they're the **last** field of a non-zero struct, in which case the runtime adds 1 byte of trailing padding to prevent past-end pointers.
4. **`reflect.Type.Align()` vs `FieldAlign()`** — usually equal; differ on 32-bit for 64-bit types.
5. **`fieldalignment`** is the tool to automate detection (and, with `-fix`, repair).
6. **Pointer bytes matter for GC** — clustering pointer fields reduces scan work.

The next file (`senior.md`) walks the compiler source that implements all this and explains the platform-specific bits (32-bit atomics, cache-line concerns).

---

## Further reading

- `unsafe` package: https://pkg.go.dev/unsafe
- `reflect` package: https://pkg.go.dev/reflect
- `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- Spec on size and alignment: https://go.dev/ref/spec#Size_and_alignment_guarantees
- Compiler source: https://github.com/golang/go/blob/master/src/cmd/compile/internal/types/size.go
- Sibling: [embedding-structs](../02-embedding-structs/) for the semantics of embedded fields beyond layout.
