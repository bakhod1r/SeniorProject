# Memory Layout — Junior Level
> **Topic:** [Memory Layout](README.md)
> **Focus:** How a struct's fields are arranged in memory, why padding exists, and why `sizeof` is not the sum of the parts.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

When you declare a struct with three fields, you might assume the computer stores those fields back-to-back, using exactly as many bytes as the fields need. It does not. The compiler inserts invisible gaps — **padding** — between and after fields so each one lands on an address the hardware likes. The result: a struct can be noticeably larger than the sum of its fields, and simply **reordering the fields** can shrink it without changing what it stores.

This is the foundation of *memory layout*: how aggregate data (structs, objects, arrays) is physically arranged in RAM. It is one of the highest-leverage things a programmer can understand, because the CPU does not read memory one byte at a time — it reads **cache lines** of 64 bytes — and how your data is laid out decides how many of those reads it takes to do real work.

At the junior level we focus on the single most important consequence of layout: **alignment and padding**, and the rule that lets you make structs smaller for free.

---

## Prerequisites

- You know what a **byte** is (8 bits) and that memory is addressed byte-by-byte (address 0, 1, 2, …).
- You know basic C-family types and their sizes: `char`/`bool` = 1 byte, `int16`/`short` = 2, `int32`/`float` = 4, `int64`/`double`/pointer = 8 bytes (on a 64-bit machine).
- You have written a `struct` (C, Go, Rust) or a class with fields.
- You know `sizeof` (C) / `unsafe.Sizeof` (Go) / `std::mem::size_of` (Rust) reports a type's size in bytes.

---

## Glossary

- **Alignment** — a requirement that a value of a given type be stored at a memory address that is a multiple of some number (its *alignment*, usually equal to its size). An 8-byte `int64` is typically 8-byte aligned: its address must be divisible by 8.
- **Natural alignment** — the default alignment a type gets: equal to its size for primitive types. 4-byte types align to 4, 8-byte types align to 8.
- **Padding** — unused filler bytes the compiler inserts between fields to satisfy alignment.
- **Trailing padding** — padding added at the *end* of a struct so the whole struct's size is a multiple of its largest field's alignment.
- **Word** — the CPU's natural unit of data, usually 8 bytes on a 64-bit machine.
- **Cache line** — the fixed-size chunk (almost always 64 bytes) the CPU loads from RAM at once.
- **Aggregate** — a type built from other types: a struct, array, or object.

---

## Core Concepts

### 1. The hardware wants aligned data

The CPU reads memory in fixed-size, aligned chunks (often 8 bytes at a time, and 64 bytes per cache line). If a 4-byte integer sits neatly at an address divisible by 4, the CPU grabs it in one operation. If it straddles a boundary — say bytes 6 through 9 — the CPU may need **two** reads and some stitching, which is slower. On some architectures (older ARM, many DSPs) a misaligned read does not just go slow: it **faults** and crashes the program.

So compilers play it safe: they place each field at a "natural" address for its type. The rule is simple:

> A field of size *N* is placed at an offset that is a multiple of its alignment (usually *N*).

### 2. Padding fills the gaps

Consider this C struct:

```c
struct Bad {
    char  a;   // 1 byte
    int   b;   // 4 bytes
    char  c;   // 1 byte
};
```

You might expect 1 + 4 + 1 = 6 bytes. The actual size is **12**. Here is why, offset by offset:

| Offset | Bytes | Field | Note |
|-------:|:-----:|-------|------|
| 0      | 1     | `a`   | char, aligns anywhere |
| 1–3    | 3     | —     | **padding** so `b` lands on a multiple of 4 |
| 4–7    | 4     | `b`   | int, needs 4-byte alignment |
| 8      | 1     | `c`   | char |
| 9–11   | 3     | —     | **trailing padding** so the struct size is a multiple of 4 |

Total: 12 bytes. Six of them are wasted padding.

### 3. Field order changes the size

Now reorder the *same fields*, largest-to-smallest:

```c
struct Good {
    int   b;   // 4 bytes, offset 0
    char  a;   // 1 byte,  offset 4
    char  c;   // 1 byte,  offset 5
};             // offset 6,7: 2 bytes trailing padding -> size 8
```

Same data, but now the size is **8 bytes** instead of 12 — a 33% saving, just from ordering. The two `char`s share the gap that used to be wasted, and only 2 bytes of trailing padding remain.

> **The golden rule:** order struct fields from **largest alignment to smallest**. This minimizes padding almost every time.

### 4. Trailing padding and arrays

Why trailing padding at all? Because structs go into **arrays**. If `struct Good` were 6 bytes, then in an array `Good arr[2]`, the second element would start at offset 6 — and its `int b` would be misaligned. By rounding the struct size up to 8 (a multiple of its largest alignment), every element in an array stays aligned. The struct's *alignment* equals its largest field's alignment; its *size* is always a multiple of that alignment.

---

## Real-World Analogies

**Egg cartons.** An egg carton has 12 slots in a fixed grid. You cannot place an egg "between" two slots — each egg must sit in a slot. If you have oddly shaped items, some slots stay empty. Memory alignment is the same: values must land in specific slots (aligned addresses), and the gaps left over are padding.

**Parking a bus in a car park.** Cars (small types) fit in any space. A bus (an 8-byte field) needs a long aligned bay. If you interleave buses and cars badly, you leave half-empty bays everywhere. Park all the buses first, then squeeze the cars into the leftover space — that is exactly "largest field first."

**Moving boxes by the truckload.** The CPU never carries one item; it backs up a truck (cache line) and loads 64 bytes at once. If the one field you need sits alone in its own truckload, you wasted 60+ bytes of hauling. Packing related fields together means one truck trip does more useful work.

---

## Mental Models

- **"The address must be divisible."** Whenever you wonder where a field goes, ask: what is the smallest offset ≥ the current position that is divisible by this field's alignment? That is its offset. The gap you skipped is padding.
- **"Size is a multiple of alignment."** A struct's total size always rounds up to a multiple of its strictest field's alignment. If that surprises you, picture the struct sitting inside an array.
- **"Reordering is free real estate."** Changing field order never changes behavior (in Go/Rust/C the compiler still accesses fields by name), but it can shrink the struct. It is the cheapest optimization in programming.

---

## Code Examples

### C — measure the difference

```c
#include <stdio.h>

struct Bad  { char a; int b; char c; };           // 12 bytes
struct Good { int b; char a; char c; };            // 8 bytes

int main(void) {
    printf("Bad  = %zu\n", sizeof(struct Bad));    // 12
    printf("Good = %zu\n", sizeof(struct Good));   // 8
    printf("sum of fields = %zu\n",
           sizeof(char) + sizeof(int) + sizeof(char)); // 6
    return 0;
}
```

The "sum of fields" (6) matches neither layout — proof that `sizeof` is *not* the sum of the parts.

### Go — `unsafe.Sizeof` and `Offsetof`

```go
package main

import (
    "fmt"
    "unsafe"
)

type Bad struct {
    A byte  // 1
    B int32 // 4
    C byte  // 1
}

type Good struct {
    B int32 // 4
    A byte  // 1
    C byte  // 1
}

func main() {
    fmt.Println(unsafe.Sizeof(Bad{}))  // 12
    fmt.Println(unsafe.Sizeof(Good{})) // 8

    // Where does each field actually live?
    fmt.Println(unsafe.Offsetof(Bad{}.A)) // 0
    fmt.Println(unsafe.Offsetof(Bad{}.B)) // 4  (offsets 1-3 are padding)
    fmt.Println(unsafe.Offsetof(Bad{}.C)) // 8
}
```

### Rust — `size_of` and the same rule

```rust
use std::mem::size_of;

struct Bad  { a: u8, b: u32, c: u8 }   // Rust may reorder; force C layout below
#[repr(C)] struct BadC  { a: u8, b: u32, c: u8 } // 12
#[repr(C)] struct GoodC { b: u32, a: u8, c: u8 } // 8

fn main() {
    println!("{}", size_of::<BadC>());  // 12
    println!("{}", size_of::<GoodC>()); // 8
    // Note: plain Rust structs (no repr) let the compiler reorder fields
    // for you, so `Bad` may already be 8. C/Go keep your declared order.
}
```

> Key difference to remember: **C and Go keep your field order exactly as written**, so ordering is *your* job. **Rust is allowed to reorder fields itself** unless you pin the layout with `#[repr(C)]`.

---

## Pros & Cons

**Padding (pros):** correctness and speed — every access is aligned, so no faults and no slow split reads. You rarely have to think about it.

**Padding (cons):** wasted memory. A poorly ordered struct can be 50–100% larger than necessary. In an array of millions of these, that waste multiplies and pushes useful data out of cache.

**Reordering (pros):** smaller structs, more elements per cache line, better performance — for free, no behavior change.

**Reordering (cons):** in C and over-the-wire formats, field order can be part of a contract (a binary protocol, a hardware register map). You cannot freely reorder those; the order *is* the spec.

---

## Use Cases

- **Any struct stored in large quantities** — array elements, slice/`Vec` contents, hash-map values, graph nodes. Shrinking each element by 4 bytes across a million-element array saves 4 MB and fits more in cache.
- **Hot data structures** — the per-request object, the per-particle struct, the per-entity record in a game loop.
- **Embedded / memory-constrained systems** — where every byte of RAM counts literally.

---

## Best Practices

1. **Order fields largest-alignment-first** when you control the order (Go, C, plain Rust where layout is unspecified anyway). Group your `int64`s/pointers, then `int32`s/`float`s, then `int16`s, then `byte`s/`bool`s.
2. **Measure, don't guess.** Print `sizeof`/`unsafe.Sizeof`/`size_of` and field offsets. Surprises are common.
3. **Group related small fields together** so they share one padding gap instead of each creating its own.
4. **Don't micro-optimize one-off structs.** A config struct you allocate once is not worth reordering for readability's sake. Save the effort for structs that exist in bulk.
5. **Keep a meaningful order when it aids readability**, and only reorder for size when the struct is genuinely hot or numerous.

---

## Edge Cases & Pitfalls

- **`sizeof` ≠ sum of fields.** This trips up nearly everyone the first time. Always account for padding.
- **Booleans cost more than a bit.** A `bool` takes a whole byte (sometimes more after padding), not one bit. Eight `bool` fields can balloon a struct; consider bit flags if it matters.
- **Empty structs are not always zero-sized.** In Go an empty struct is 0 bytes; in C `sizeof(struct{})` is 1 by language rule (so distinct objects get distinct addresses). Languages differ — check.
- **Nested structs carry their own alignment.** Embedding a struct whose largest field is 8 bytes raises the outer struct's alignment to 8, which can add padding before the nested field.
- **Reordering breaks binary layouts.** If a struct is read/written to disk, sent over a socket, or maps onto hardware registers, the field order is a contract. Do not reorder those without updating both sides.
- **The compiler may reorder for you (Rust).** Don't rely on declared order in Rust unless you used `#[repr(C)]` — and don't reorder a `#[repr(C)]` struct thinking it's free.

---

## Summary

- Memory layout is how a struct's fields are physically arranged in RAM.
- The hardware wants **aligned** data: a value of size *N* sits at an address that is a multiple of *N*. Misaligned access is slow or, on some CPUs, a crash.
- Compilers insert **padding** between fields (to align them) and at the end (**trailing padding**, so the struct fits cleanly in arrays).
- Therefore a struct's `sizeof` is usually **larger** than the sum of its fields.
- **Ordering fields largest-to-smallest** minimizes padding and shrinks the struct — a free optimization that changes size but not behavior.
- C and Go keep your declared order (it's your job to order well); Rust may reorder for you unless you use `#[repr(C)]`.
- Measure with `sizeof` / `unsafe.Sizeof` / `size_of` and field offsets; don't guess.

Next, the **middle** tier explains the mechanisms — how packing pragmas work, how cache lines turn layout into measured performance, and the first look at false sharing.
