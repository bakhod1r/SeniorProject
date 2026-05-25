# Struct Memory Layout — Junior

## 1. What this topic is about

A Go struct is **not** just a list of fields. When the compiler arranges those fields in memory, it leaves invisible gaps — bytes of **padding** — so each field starts at an address the CPU is happy to read. Two structs with the same fields in different order can take **different amounts of memory**. On a 64-bit machine the difference is usually small (8 bytes), but multiplied across millions of values it becomes meaningful.

This file teaches you:

- What padding and alignment are, in concrete terms.
- How to measure a struct's size with `unsafe.Sizeof`.
- The single most famous Go example: reordering fields to shrink a struct.
- The basic rules you can apply without reading the spec.

The general usage of structs (definition, methods, embedding, tags) lives in the sibling topics. This one is specifically about **bytes in memory**.

---

## 2. What does "alignment" mean?

CPUs prefer to read multi-byte values from addresses that are a multiple of the value's size. A 4-byte `int32` should live at an address divisible by 4; an 8-byte `int64` at an address divisible by 8. The hardware reason is that the CPU's memory bus reads in fixed-width chunks (typically 8 or 16 bytes at a time). A misaligned 8-byte read may straddle two chunks, forcing two reads and an internal shift.

On x86_64 the CPU **tolerates** misaligned reads (they just go slower). On older ARM and on some atomic instructions, a misaligned read **traps** — the program crashes with `SIGBUS`. The Go runtime never produces misaligned values for normal field access. It does that by inserting padding.

Each type has an **alignment requirement** — the multiple-of value its address must satisfy:

| Type | Size (bytes) | Alignment |
|------|--------------|-----------|
| `bool`, `int8`, `uint8`, `byte` | 1 | 1 |
| `int16`, `uint16` | 2 | 2 |
| `int32`, `uint32`, `float32`, `rune` | 4 | 4 |
| `int64`, `uint64`, `float64`, `complex64` | 8 | 8 (on 64-bit) / 4 (on 32-bit) |
| `int`, `uint`, `uintptr` | 8 | 8 (64-bit) / 4 (32-bit) |
| Pointer types (`*T`, slice, map, chan, func, interface header word) | 8 | 8 (64-bit) |
| `string` | 16 | 8 |
| Slice | 24 | 8 |
| Interface | 16 | 8 |

You can verify any of these with the `unsafe` package:

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var x int64
    fmt.Println(unsafe.Sizeof(x))   // 8
    fmt.Println(unsafe.Alignof(x))  // 8
}
```

`unsafe.Sizeof` returns how many bytes a value occupies. `unsafe.Alignof` returns the required address multiple.

---

## 3. The famous reorder example

Here is the example almost every Go talk on memory uses:

```go
package main

import (
    "fmt"
    "unsafe"
)

type Bad struct {
    a bool   // 1 byte
    b int64  // 8 bytes
    c bool   // 1 byte
}

type Good struct {
    b int64  // 8 bytes
    a bool   // 1 byte
    c bool   // 1 byte
}

func main() {
    fmt.Println(unsafe.Sizeof(Bad{}))  // 24
    fmt.Println(unsafe.Sizeof(Good{})) // 16
}
```

Both structs have one `int64` and two `bool`s. They hold the same data. Yet `Bad` takes **24 bytes** and `Good` takes **16 bytes** — a 33 % size difference.

Why? Walk through the layout byte by byte. In `Bad`:

| Offset | Field | Bytes |
|--------|-------|-------|
| 0 | `a` (bool) | 1 |
| 1–7 | padding (to align `b` to offset 8) | 7 |
| 8 | `b` (int64) | 8 |
| 16 | `c` (bool) | 1 |
| 17–23 | trailing padding (so the struct as a whole aligns to 8) | 7 |

Total: 1 + 7 + 8 + 1 + 7 = **24 bytes**, of which **14 are padding**.

In `Good`:

| Offset | Field | Bytes |
|--------|-------|-------|
| 0 | `b` (int64) | 8 |
| 8 | `a` (bool) | 1 |
| 9 | `c` (bool) | 1 |
| 10–15 | trailing padding | 6 |

Total: 8 + 1 + 1 + 6 = **16 bytes**, of which only **6 are padding**.

The lesson: **the compiler will not reorder your fields for you.** Go's spec promises that fields appear in memory in source order. You — the human — choose the order, and the choice matters.

---

## 4. Why trailing padding?

Why does `Good` need 6 bytes of trailing padding to reach 16? Because of arrays. If you write `[2]Good{}` the compiler must place the second element right after the first, and the second element's first field (`b`) must satisfy its alignment requirement of 8. So **the struct's size must be a multiple of its largest alignment requirement**. The largest field in `Good` is `int64` (alignment 8), so the struct's size rounds up to a multiple of 8.

This rule explains a lot:

```go
type S struct {
    a int32  // 4 bytes
    b int32  // 4 bytes
}
// Sizeof = 8, no trailing padding (already a multiple of 4)

type T struct {
    a int32  // 4 bytes
    b int64  // 8 bytes
}
// Sizeof = 16: a(4) + pad(4) + b(8)
```

---

## 5. The mental rule (good enough for 90 % of cases)

When you write a struct:

1. **Put the biggest fields first** (`int64`, `float64`, pointers, slices, maps).
2. **Then medium fields** (`int32`, `float32`).
3. **Then small fields** (`int16`, `uint16`).
4. **Then 1-byte fields** (`bool`, `byte`, `int8`) at the end.

That single rule eliminates most internal padding. The trailing padding (to make the size a multiple of the largest alignment) is unavoidable.

Counter-example showing the rule in action:

```go
type Naive struct {
    flag bool       // 1
    id   int64      // 8
    age  int32      // 4
    name string     // 16
    okay bool       // 1
}
// Sizeof = 48 on 64-bit

type Tidy struct {
    name string     // 16
    id   int64      // 8
    age  int32      // 4
    flag bool       // 1
    okay bool       // 1
}
// Sizeof = 32 on 64-bit
```

Same fields, 16 bytes saved per value. Allocate 10 million of those and you save 160 MiB.

---

## 6. Why the compiler doesn't reorder for you

Languages like C# reorder struct fields automatically (sometimes). Go does not. The spec is explicit: fields appear in memory in source order. Three reasons:

1. **Interop**: a Go struct may be passed to C, marshalled to a network format, or written to disk. If the compiler silently reordered fields, the binary representation would change between Go versions.
2. **`unsafe.Offsetof`**: Go programs use this to compute field offsets. A reordering compiler would break that math at build time depending on optimization flags.
3. **Reflection stability**: `reflect.Type` walks fields in declaration order. Reorder them and reflection-based marshallers (`encoding/json`, `encoding/binary`) silently change behaviour.

The decision is: programmer in control, with a linter to flag waste. That linter is `fieldalignment` (covered in [middle.md](middle.md)).

---

## 7. Measuring a real struct

Print every field's offset and the total size:

```go
package main

import (
    "fmt"
    "unsafe"
)

type User struct {
    Name  string
    ID    int64
    Email string
    Age   int32
    Admin bool
}

func main() {
    var u User
    fmt.Printf("Name  offset=%2d size=%2d\n", unsafe.Offsetof(u.Name), unsafe.Sizeof(u.Name))
    fmt.Printf("ID    offset=%2d size=%2d\n", unsafe.Offsetof(u.ID), unsafe.Sizeof(u.ID))
    fmt.Printf("Email offset=%2d size=%2d\n", unsafe.Offsetof(u.Email), unsafe.Sizeof(u.Email))
    fmt.Printf("Age   offset=%2d size=%2d\n", unsafe.Offsetof(u.Age), unsafe.Sizeof(u.Age))
    fmt.Printf("Admin offset=%2d size=%2d\n", unsafe.Offsetof(u.Admin), unsafe.Sizeof(u.Admin))
    fmt.Printf("total %d bytes\n", unsafe.Sizeof(u))
}
```

Output on a 64-bit machine:

```
Name  offset= 0 size=16
ID    offset=16 size= 8
Email offset=24 size=16
Age   offset=40 size= 4
Admin offset=44 size= 1
total 48 bytes
```

There are 3 bytes of padding after `Admin` (offset 45 to 47) to make the total a multiple of 8 (the alignment of `string` and `int64`). No internal padding, because the author lucked into a tidy order.

Try reordering: move `Admin` before `Name`. Now `Admin` is at offset 0 (1 byte) and the compiler inserts 7 bytes of padding before `Name` to align it to 8. The total grows from 48 to 56.

---

## 8. The zero-byte struct

`struct{}` — a struct with no fields — is **zero bytes**.

```go
fmt.Println(unsafe.Sizeof(struct{}{})) // 0
```

This is used as a memory-free sentinel:

```go
set := map[string]struct{}{}
set["x"] = struct{}{}
_, ok := set["x"]  // ok is true; value cost zero bytes
```

A map's value type of `struct{}` makes it behave like a set without paying for a value.

There's one subtle rule: if a non-zero-sized struct *ends* with a zero-sized field, the compiler adds one byte of padding to keep the struct's size from being zero (and to keep `&s.last` from pointing past the end of the allocation). You'll meet this in [middle.md](middle.md) §5.

---

## 9. What the compiler will guarantee

A short list of guarantees from the spec and the runtime:

| Guarantee | Source |
|-----------|--------|
| Fields appear in memory in source order | spec |
| Each field is naturally aligned for its type | runtime |
| `unsafe.Sizeof(s)` is a compile-time constant for fixed-size types | spec |
| `unsafe.Offsetof(s.f)` is the byte offset of `f` from the start of `s` | spec |
| Two values of the same struct type always have the same layout | spec |
| Size of a struct is a multiple of its alignment | implementation, since Go 1 |

Things that are **not** guaranteed:

- The exact size on different architectures (32-bit vs 64-bit).
- The alignment of `int64` on 32-bit platforms (see [senior.md](senior.md)).
- The order of fields after reflection-based serialization unless tagged.

---

## 10. Quick experiments to try today

1. Take any struct from a codebase you know. Print all its field offsets. How much padding is there?
2. Write a 1-`int64` 1-`bool` struct. Move the bool around. Watch the size change.
3. Compare `unsafe.Sizeof(string(""))` with `unsafe.Sizeof([]byte{})`. Why does the slice take 8 more bytes than the string?
4. Allocate `make([]Bad, 1<<20)` and `make([]Good, 1<<20)`. Compare `runtime.MemStats.HeapAlloc` before and after.

---

## 11. The 30-second summary

Go structs have invisible padding between fields and at the end, inserted so every field starts at a CPU-friendly address. The compiler never reorders fields — that's your job. Putting bigger types before smaller ones nearly always shrinks the struct. Use `unsafe.Sizeof` and `unsafe.Offsetof` to see exactly what the compiler did. The `fieldalignment` linter automates spotting bad layouts. Padding usually doesn't matter; for hot, frequently-allocated structs, it can save tens of megabytes.

The remaining files dig into the why (alignment rules per type, embedded structs, 32-bit oddities), the compiler's actual algorithm, and the production cases where layout becomes a load-bearing optimization.

---

## Further reading

- `unsafe` package: https://pkg.go.dev/unsafe
- Go spec on alignment guarantees: https://go.dev/ref/spec#Size_and_alignment_guarantees
- `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- Sibling: [struct-basics](../01-struct-tags-and-json/) for general struct usage.
