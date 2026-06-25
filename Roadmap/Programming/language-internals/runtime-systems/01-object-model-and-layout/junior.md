# Object Model & Layout — Junior Level

> **Topic:** [Object Model & Layout](README.md)
> **Focus:** What does an object actually look like in memory? Fields, padding, headers, and why the order you declare things changes the size of the box.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **An object is not a magic blob. It is a sequence of bytes at a known address, laid out by rules you can learn.**

When you write `struct Point { int x; int y; }` or `class User { name; age; }`, you are describing a **shape**. The compiler or runtime turns that shape into a concrete **memory layout**: a fixed number of bytes, with each field sitting at a known **offset** from the start. Reading `point.y` is, underneath, "take the address of `point`, add 4 bytes, load 4 bytes." That `+4` is the offset. It is computed once, baked into the machine code, and costs nothing at runtime.

This page is about how that box is built. Three things decide its shape:

1. **The fields you declared** — their types and sizes.
2. **Alignment and padding** — the CPU likes data at "round" addresses, so the compiler inserts invisible gap bytes to keep fields aligned. This is why a struct can be *bigger* than the sum of its fields.
3. **Headers** — many runtimes prepend bookkeeping bytes to every object (a type pointer, a reference count, lock/GC bits). You never declared these fields, but you pay for them on every object.

In one sentence: **an object is a header (maybe) followed by your fields, with padding wedged in to keep everything aligned, and the total rounded up to a multiple of the alignment.**

> 🎓 **Why this matters for a junior:** The first time you'll care is when someone says "reorder the fields in that struct and it shrinks from 24 bytes to 16." That sounds like black magic. It isn't — it's alignment and padding, and once you see it once you'll see it everywhere. The second time you'll care is when a data structure that *should* fit in cache doesn't, and your loop is mysteriously slow. Layout is the bridge between "the code I wrote" and "what the hardware actually touches."

This page covers: what a field offset is, what alignment and padding are, why reordering fields shrinks a struct, what an object header is and why every object carries one, and a first look at "array of structs" versus "struct of arrays." The next level (`middle.md`) goes deep on the JVM object header, V8 hidden classes, and AoS vs SoA cache effects. `senior.md` covers compressed oops, vtables, and hidden-class deoptimization. `professional.md` covers production layout engineering.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a variable and a struct/class are in at least one language (C, Java, Python, JS, Go, or Rust).
- **Required:** The idea that memory is a big array of bytes, each with an **address** (a number).
- **Required:** Roughly how big basic types are: a byte is 1, an `int` is usually 4, a pointer is usually 8 on a 64-bit machine.
- **Helpful but not required:** A vague sense that the CPU has a **cache** — a small, fast memory between it and RAM.
- **Helpful but not required:** Having once printed `sizeof(struct X)` and been surprised.

You do **not** need to know:

- How the garbage collector uses the header bits (that's `middle.md` and beyond).
- How virtual dispatch reads a vtable (that's `senior.md` and the next topic, method dispatch).
- Anything about hidden-class transition trees or compressed oops yet.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Object** | A region of memory holding one instance's data: optional header + fields, at a single address. |
| **Field / member** | One named piece of data inside an object (`x`, `name`, `age`). |
| **Layout** | The concrete arrangement: which field sits at which byte offset, and how big the whole thing is. |
| **Offset** | The distance, in bytes, from the start of the object to a given field. Field access = base address + offset. |
| **Size** | Total bytes the object occupies, including padding and header. `sizeof` in C. |
| **Alignment** | The rule that a value of size N must usually start at an address that is a multiple of N (or of its required alignment). |
| **Padding** | Filler bytes inserted between or after fields so that each field lands on an aligned address. Wasted space. |
| **Header** | Hidden bookkeeping bytes the runtime prepends to objects (type pointer, refcount, GC/lock bits). You didn't declare them. |
| **Word** | The CPU's natural unit, usually 8 bytes on a 64-bit machine. |
| **Cache line** | The unit the CPU moves between RAM and cache, typically 64 bytes. You fetch a whole line, not one byte. |
| **AoS** | "Array of Structs" — `[{x,y}, {x,y}, ...]`. Each element holds all its fields together. |
| **SoA** | "Struct of Arrays" — `{xs:[...], ys:[...]}`. Each field gets its own array. |
| **Boxed** | A value stored as a separate heap object you reach through a pointer (e.g., Java `Integer`, Python `int`). |
| **Inline / unboxed** | A value stored *directly* in the bytes of its container, no extra pointer hop. |
| **Type pointer / class pointer** | A field in the header pointing to the object's class/type metadata. |
| **Reference count** | A counter in the header tracking how many references point at the object (Python, Swift). |

---

## Core Concepts

### 1. A Field Is Just an Offset

Take this C struct:

```c
struct Point {
    int x;   // offset 0
    int y;   // offset 4
};
```

`struct Point` is 8 bytes. `x` lives at offset 0, `y` at offset 4. When you write `p.y`, the compiler emits "load 4 bytes from address-of-`p` + 4." The name `y` exists only in your source code; at runtime there is only the number 4.

This is the single most important idea on this page: **field access is a constant offset, computed at compile time, free at runtime.** Most of the clever machinery in fast runtimes (hidden classes, shapes) exists to *preserve* this property — to keep field access as a fixed `+offset` rather than a dictionary lookup.

### 2. Alignment: The CPU Likes Round Addresses

The CPU does not read memory one byte at a time. It reads in chunks, and it is fastest (or on some chips, *only correct*) when a value sits at an address that is a multiple of its size. A 4-byte `int` "wants" to start at an address divisible by 4. An 8-byte `double` or pointer wants an address divisible by 8.

This requirement is called **alignment**. A type's alignment is usually equal to its size (for primitives). The rule: **a field of alignment A must be placed at an offset that is a multiple of A.**

### 3. Padding: The Price of Alignment

What happens when fields don't naturally line up? The compiler inserts **padding** — wasted filler bytes — to push the next field onto an aligned offset.

```c
struct Bad {
    char  a;   // offset 0, size 1
    // 3 bytes of PADDING here, so the int is aligned to 4
    int   b;   // offset 4, size 4
    char  c;   // offset 8, size 1
    // 3 bytes of PADDING at the end, so the struct's size is a multiple of 4
};
// sizeof(Bad) == 12, even though 1 + 4 + 1 = 6 bytes of real data.
```

Half the struct is air. The struct's own alignment is the **largest** alignment of its fields (here 4, because of `b`), and the total size is rounded up to a multiple of that — which is why there's trailing padding too.

### 4. Reordering Fields Shrinks the Struct

Here is the trick that looks like magic. Take the same three fields and reorder them, biggest-alignment-first:

```c
struct Good {
    int   b;   // offset 0, size 4
    char  a;   // offset 4, size 1
    char  c;   // offset 5, size 1
    // 2 bytes of trailing padding
};
// sizeof(Good) == 8.
```

Same data, **12 bytes shrank to 8** — a 33% saving — purely by reordering. The general rule of thumb: **declare fields from largest alignment to smallest.** Pointers and 8-byte values first, then 4-byte, then 2-byte, then bytes. The padding collapses.

For one struct, 4 bytes is nothing. For a million-element array of that struct, it's 4 MB of pure waste — and worse, it means fewer objects fit in each cache line, so your loops touch more memory and run slower.

### 5. The Object Header: Bytes You Didn't Declare

In C and Rust, a plain struct is *just* your fields (plus padding). Nothing extra. But in most managed runtimes, every object carries a **header** the runtime needs:

- **Java (HotSpot):** every object has a **mark word** (hash code, lock state, GC age bits) and a **class pointer** (which class is this?). On a 64-bit JVM that's typically 12–16 bytes *before your first field even starts*.
- **Python (CPython):** every object begins with a **reference count** and a **type pointer**. A bare `object` is already 16 bytes; a Python `int` is ~28 bytes.
- **C++ with virtual methods:** an object with virtual functions carries a hidden **vtable pointer** (8 bytes) so the runtime can find the right method.
- **Go, Rust, C structs:** *no per-object header* for plain values. This is a big reason they're memory-lean.

The lesson: **a 4-byte `int` field can cost you 20+ bytes once you make it a heap object in a managed language.** Headers are the tax for features like garbage collection, reflection, and dynamic typing.

### 6. Boxed vs Inline

When you put a number inside a container, it can live one of two ways:

- **Inline (unboxed):** the bytes of the number sit directly inside the container. `struct Point { int x; }` stores `x`'s four bytes *in* the Point. Fast, compact, one memory access.
- **Boxed:** the container holds a *pointer* to a separate heap object that holds the number. Java's `Integer`, Python's `int`, a `List<Integer>` of boxed integers. Each access is a pointer hop, and each number carries a full object header.

A `int[]` in Java is a tight block of 4-byte integers (inline). An `Integer[]` is an array of *pointers*, each pointing to a separate ~16-byte heap object (boxed). Same logical data, wildly different memory and speed. Knowing which you have is a junior-level superpower.

### 7. Array of Structs vs Struct of Arrays (a First Look)

Say you have 1,000 particles, each with a position and a velocity. Two ways to store them:

```
AoS (Array of Structs):   [ {pos,vel}, {pos,vel}, {pos,vel}, ... ]
SoA (Struct of Arrays):   { pos:[...,...,...], vel:[...,...,...] }
```

If your loop only reads `pos` for all particles, **SoA is faster**: all the positions are packed together, so each cache line you fetch is 100% useful. With **AoS**, every cache line you fetch also drags in the `vel` you didn't want, wasting bandwidth.

If you usually touch *all* fields of one particle at a time, **AoS wins** — everything for one particle is together. There's no universal winner; it depends on your access pattern. We'll go deeper in `middle.md`. For now: **layout should follow how you read the data.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Object** | A labeled storage box on a shelf at a fixed spot. |
| **Field / offset** | A compartment inside the box at a fixed position ("3rd slot from the left"). |
| **Alignment** | A rule that wide items must start on a grid line — a 4-foot couch can only go where the floor tiles line up by 4. |
| **Padding** | Empty filler foam stuffed in the box so each item sits on a grid line. Wasted space you paid to ship. |
| **Reordering to shrink** | Packing a suitcase shoes-first, then shirts, then socks — same clothes, smaller bag, less wasted air. |
| **Object header** | The shipping label, barcode, and customs form stapled to *every* box, even a tiny one. |
| **Boxed value** | A claim ticket that points to a coat in the cloakroom, instead of the coat itself in your hand. |
| **Cache line** | The whole pallet the forklift moves at once — you can't fetch one box, you fetch the pallet. |
| **AoS vs SoA** | Storing each customer's full file in one folder (AoS) vs one drawer of all names, one drawer of all phone numbers (SoA). |
| **Type pointer** | The "this box contains: kitchen items" category label that tells the unpacker what's inside. |

---

## Mental Models

### The "Box of Slots" Model

Picture an object as a box divided into byte-slots, numbered from 0. Your fields claim slots starting at their offset. Padding is the empty slots between them, there only so the next field lands on a grid line. The header (if any) sits in the first slots, before your fields begin. When you reorder fields, you're repacking the box to leave fewer empty slots.

### The "+offset" Model

Whenever you see `object.field`, mentally rewrite it as `*(base_address + offset)`. The field name vanishes; only the number remains. This explains why field access is fast (it's just addition) and sets up *why* dynamic languages work so hard — if `object.field` were a hash-map lookup instead of a fixed offset, it would be dozens of times slower. Hidden classes (in `middle.md`) exist to turn that lookup back into a `+offset`.

### The "Cache Line Budget" Model

Every memory access drags in a whole 64-byte cache line, whether you wanted 4 bytes or 64. So think of each cache line as a budget: how much of it is data you actually use? A tight struct with no padding spends its budget well. A padded, header-heavy object, or an AoS layout where you only read one field, wastes most of every line. Good layout = high "useful bytes per cache line."

---

## Code Examples

### C — Watching padding happen

```c
#include <stdio.h>
#include <stddef.h>

struct Bad  { char a; int b; char c; };   // poorly ordered
struct Good { int b; char a; char c; };   // well ordered

int main(void) {
    printf("sizeof(Bad)  = %zu\n", sizeof(struct Bad));   // 12
    printf("sizeof(Good) = %zu\n", sizeof(struct Good));  // 8

    printf("offset a=%zu b=%zu c=%zu (Bad)\n",
        offsetof(struct Bad, a), offsetof(struct Bad, b), offsetof(struct Bad, c));
    // a=0  b=4  c=8   <- note the gap: b is NOT at offset 1
    return 0;
}
```

Run it. The compiler told you, in numbers, exactly where padding went. `b` is at offset 4, not 1, because of the 3 padding bytes after `a`.

### C — Packing to remove padding (with a warning)

```c
#include <stdio.h>

#pragma pack(push, 1)
struct Packed { char a; int b; char c; };  // forced to 6 bytes, no padding
#pragma pack(pop)

int main(void) {
    printf("sizeof(Packed) = %zu\n", sizeof(struct Packed));  // 6
    return 0;
}
```

`#pragma pack(1)` says "no padding, ever." The struct is now 6 bytes — but `b` is now *misaligned* (offset 1). On some CPUs that's slower; on a few it's a crash. Use packing only for wire formats (network/file structs), never as a default. We'll revisit this in `middle.md`.

### Java — Boxed vs inline, the size surprise

```java
// int[] is a tight block of 4-byte integers — inline.
int[] inline = new int[1_000_000];        // ~4 MB of data

// Integer[] is an array of pointers, each to a separate heap object — boxed.
Integer[] boxed = new Integer[1_000_000]; // ~4 MB of pointers
for (int i = 0; i < boxed.length; i++) boxed[i] = i;  // + ~16 MB of Integer objects
```

The `int[]` is one compact array. The `Integer[]` is an array of 8-byte pointers *plus* a million separate `Integer` objects, each carrying a 12–16 byte header around a single 4-byte value. Same logical data, roughly 5x the memory and far worse cache behavior. **Prefer primitive arrays for bulk numeric data.**

### Python — Every object carries a header

```python
import sys

print(sys.getsizeof(0))          # ~28 bytes for a single small int!
print(sys.getsizeof([]))         # ~56 bytes for an empty list
print(sys.getsizeof("a"))        # ~50 bytes for a one-char string
```

A Python `int` is not 4 or 8 bytes — it's a full heap object with a reference count and a type pointer baked in, so even the number `0` costs ~28 bytes. This is why number-crunching in pure Python is slow and memory-heavy, and why NumPy (which stores raw, header-free C arrays) is so much leaner and faster.

### Go — Struct alignment, the same rules as C

```go
package main

import (
    "fmt"
    "unsafe"
)

type Bad  struct { a byte; b int32; c byte }  // poorly ordered
type Good struct { b int32; a byte; c byte }  // well ordered

func main() {
    fmt.Println(unsafe.Sizeof(Bad{}))   // 12
    fmt.Println(unsafe.Sizeof(Good{}))  // 8
}
```

Go has the same padding and alignment rules as C. `unsafe.Sizeof` and `unsafe.Offsetof` let you inspect them. Field ordering matters in Go too — `go vet` and tools like `fieldalignment` will warn you about wasteful structs.

### Rust — Plain structs are just your fields (the compiler may even reorder them)

```rust
struct Point { x: i32, y: i32 }   // 8 bytes, no header

fn main() {
    println!("{}", std::mem::size_of::<Point>());  // 8
}
```

A Rust struct, like a C one, has **no per-object header** — `Point` is exactly 8 bytes. Unlike C, the Rust compiler is *allowed to reorder your fields* to minimize padding automatically (unless you ask for a fixed layout with `#[repr(C)]`). So you often get the "Good" packing for free.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Inline fields** | One memory access, compact, cache-friendly. | The container's size grows with the field. |
| **Boxed fields** | Container stays pointer-sized; supports polymorphism and nullability. | Extra pointer hop, extra header per value, terrible cache behavior in bulk. |
| **Tight packing (reordered)** | Smaller objects, more per cache line, less RAM. | Requires thought; the "natural" declaration order is often not the best. |
| **`#pragma pack` / packed** | No padding; exact byte layout for wire formats. | Misaligned access — slower or unsafe on some CPUs. Never a default. |
| **Object headers** | Enable GC, reflection, locking, dynamic typing. | Per-object memory tax; brutal for many small objects. |
| **AoS** | Great when you touch all of one object's fields together. | Wastes bandwidth when a loop reads only one field across many objects. |
| **SoA** | Great when a loop reads one field across many objects; vectorizable. | Awkward to pass "one whole object" around; more arrays to manage. |

---

## Use Cases

Caring about object layout pays off when:

- **You have a huge number of small objects.** A million points, particles, graph nodes, or cache entries — header bytes and padding multiply by a million.
- **You're in a hot loop over an array.** Cache behavior dominates; AoS vs SoA and struct size directly set your speed.
- **You're parsing or emitting a binary/wire format.** The bytes must match a spec exactly — packing and field order are correctness, not just performance.
- **You're tuning memory footprint.** Shrinking a frequently allocated struct can cut RAM and GC pressure measurably.
- **You're choosing a data representation.** "Should this be an `int[]` or a `List<Integer>`?" is a layout question with a 5x memory answer.

It matters **less** when:

- You have a handful of objects. The padding on one struct is irrelevant.
- You're far from any performance or memory limit. Don't pre-optimize layout for code that runs once.
- The language hides it entirely and you're early in a project. Correctness first, then measure, then lay out.

---

## Coding Patterns

### Pattern 1: Order fields largest-alignment-first

```c
// Instead of declaring in "logical" order, group by size:
struct Entity {
    void*    parent;   // 8-byte pointer first
    uint64_t id;       // 8
    int32_t  x, y;     // 4 + 4
    int16_t  hp;       // 2
    uint8_t  flags;    // 1
    bool     alive;    // 1
};  // packs tightly, minimal padding
```

Pointers and 8-byte values first, then 4, then 2, then 1-byte fields. The padding collapses on its own.

### Pattern 2: Prefer primitive arrays over boxed collections for bulk numbers

```java
int[] scores = new int[n];          // good: tight, inline
// not:
List<Integer> scores = new ArrayList<>();  // boxed: header per element
```

### Pattern 3: Use packed layout *only* for wire structs

```c
#pragma pack(push, 1)
struct WirePacket { uint8_t type; uint32_t length; uint16_t checksum; };
#pragma pack(pop)
// Exact 7-byte layout to match a network protocol. NOT for in-memory hot data.
```

### Pattern 4: Reach for SoA when a loop touches one field across many objects

```c
// AoS: struct Particle { float x, y, z, vx, vy, vz; } particles[N];
// SoA, if your update loop only reads positions:
struct Particles { float x[N], y[N], z[N], vx[N], vy[N], vz[N]; };
// Updating all x[] now streams contiguous memory — cache-friendly and vectorizable.
```

### Pattern 5: Measure size, don't guess

```c
printf("%zu\n", sizeof(struct Thing));          // C
```
```go
fmt.Println(unsafe.Sizeof(Thing{}))              // Go
```
```rust
println!("{}", std::mem::size_of::<Thing>());    // Rust
```

Always confirm with a real number before and after you reorder. Surprises are common.

---

## Best Practices

- **Group fields by descending alignment.** It's free and routinely shrinks structs 20–40%.
- **Measure `sizeof` before and after.** Don't trust your mental arithmetic; the tool is exact.
- **Use primitive arrays (`int[]`, `float[]`) for bulk numeric data.** Avoid boxed collections in hot paths.
- **Reserve `#pragma pack` / `repr(packed)` for wire and file formats.** Never apply it to in-memory hot structures — misalignment costs more than the padding you saved.
- **Let the layout follow the access pattern.** Loop over one field across many objects? Lean SoA. Touch whole objects? AoS.
- **Know your language's per-object header cost.** ~16 bytes in Java/Python is the difference between "this fits in cache" and "it doesn't."
- **Don't fight your runtime early.** Get it correct, profile, then optimize the layout of the structures that actually show up hot.
- **Separate hot fields from cold fields** when an object is huge but loops only touch a few fields (introduced properly in `senior.md`).

---

## Edge Cases & Pitfalls

- **The "sum of my fields" trap.** A struct is almost never the sum of its field sizes. Padding makes it bigger. Always check `sizeof`.
- **Declaration order matters.** `{char, int, char}` and `{int, char, char}` hold identical data but have different sizes. The compiler (in C/Go) does not reorder for you.
- **Boxed numbers everywhere.** A `Map<String, List<Integer>>` in Java can be mostly headers and pointers. The actual numbers are a tiny fraction of the memory.
- **`#pragma pack` makes misaligned fields.** It removes padding but the fields are now off-grid. On x86 it's a slowdown; on some ARM/embedded chips it faults. Don't reach for it casually.
- **A one-char Python string costs ~50 bytes.** Tiny logical data, large physical cost, because of the universal object header. Bulk text belongs in `bytes`/`bytearray` or NumPy, not lists of strings.
- **Arrays of objects are arrays of pointers** in managed languages. `User[]` in Java is a row of pointers, each to a scattered heap object — bad for cache. A flat struct array (where the language allows it) is far better.
- **Endianness in wire structs.** When you pack a struct to send over the network, the byte *order within* a multi-byte field (big-endian vs little-endian) matters. Two machines must agree, or the numbers come out scrambled.
- **Trailing padding is real.** Even if your last field is a single byte, the struct's size is rounded up to its alignment, so there can be padding at the *end* you never see.

---

## Test Yourself

1. By hand, compute `sizeof` for `struct { char a; double b; char c; }` on a 64-bit machine, showing every padding byte. Then reorder to minimize it. Verify with a real compiler.
2. Why is `sizeof(struct { int x; int y; })` exactly 8 with no padding, but `sizeof(struct { char a; int b; })` is 8 *with* padding?
3. In Java, estimate the memory of `Integer[] a = new Integer[1000]` filled with distinct values, versus `int[] a = new int[1000]`. Why the gap?
4. Run `sys.getsizeof(0)` in Python. Why is a single integer not 8 bytes? What are the extra bytes for?
5. You have 10 million particles and a loop that only updates each particle's `x`. Sketch the AoS and SoA layouts and predict which loop touches less memory. Why?
6. Take a Go struct with fields `byte, int64, byte, int32`. Reorder the fields to minimize `unsafe.Sizeof`. What's the before and after?
7. When would `#pragma pack(1)` be the *right* choice, and when would it cause a bug or a slowdown?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    OBJECT MODEL & LAYOUT                          │
├──────────────────────────────────────────────────────────────────┤
│ An object = [header?] + fields + padding, rounded to alignment   │
│ Field access = base_address + constant_offset  (free at runtime) │
├──────────────────────────────────────────────────────────────────┤
│ ALIGNMENT: a value of size N starts at an offset multiple of N   │
│ PADDING:   filler bytes inserted to satisfy alignment            │
│ Struct alignment = largest field alignment; size rounds up to it │
├──────────────────────────────────────────────────────────────────┤
│ SHRINK A STRUCT: declare fields largest-alignment-first          │
│   {char,int,char} = 12 bytes  ->  {int,char,char} = 8 bytes      │
├──────────────────────────────────────────────────────────────────┤
│ HEADERS (per object):                                            │
│   C / Rust / Go value : none                                     │
│   C++ (virtual)       : + vtable pointer (8B)                    │
│   Java                : mark word + class pointer (~12-16B)       │
│   Python              : refcount + type pointer (int ~ 28B)      │
├──────────────────────────────────────────────────────────────────┤
│ INLINE vs BOXED:                                                 │
│   int[]      = tight inline values        (good)                 │
│   Integer[]  = pointers to heap objects   (bad in bulk)          │
├──────────────────────────────────────────────────────────────────┤
│ AoS vs SoA:                                                      │
│   AoS = [{x,y},{x,y}]   touch whole objects -> AoS               │
│   SoA = {x:[],y:[]}     touch one field across many -> SoA       │
├──────────────────────────────────────────────────────────────────┤
│ #pragma pack / repr(packed): wire formats ONLY, never hot data   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- An **object** is a region of bytes: an optional **header**, then your **fields**, with **padding** inserted to satisfy **alignment**, and the whole thing rounded up to a multiple of the object's alignment.
- A **field is an offset** — a constant number computed at compile time. `obj.field` becomes `*(base + offset)`, which is why field access is essentially free.
- **Alignment** requires values to sit at "round" addresses; **padding** is the filler bytes that make that happen. This is why a struct is almost never the sum of its fields.
- **Reordering fields** largest-alignment-first collapses padding and can shrink a struct by a third — same data, smaller box.
- Many runtimes prepend a **per-object header** (Java mark word + class pointer, Python refcount + type pointer, C++ vtable pointer). C, Rust, and Go values carry none. The header is the tax for GC, reflection, and dynamic typing.
- **Inline** values live directly in the container; **boxed** values are reached through a pointer and each carries its own header. `int[]` vs `Integer[]` can be a 5x memory difference.
- **AoS vs SoA** is a layout choice driven by access pattern: touch whole objects → AoS; touch one field across many → SoA.
- `#pragma pack` / packed layouts are for **wire formats only** — they trade alignment (and thus speed/safety) for exact byte control.
- A junior's #1 habit: when memory or a hot loop matters, **look at the actual `sizeof`, reorder fields, and ask "inline or boxed?"** before reaching for anything fancier.

---

## What You Can Build

- **A struct-size visualizer.** Read a struct definition, print each field's offset and the padding bytes, and suggest a reordered version with its smaller size.
- **A "boxed vs inline" benchmark.** Sum a million values stored as `int[]` versus `Integer[]` (or a Python list of ints vs a NumPy array). Chart the time and memory.
- **An AoS vs SoA particle demo.** Store 10M particles both ways, run a position-only update loop on each, and measure the speed difference. Explain it with cache lines.
- **A wire-format encoder.** Define a packed struct for a small binary protocol, write it to bytes, read it back, and prove the layout is exact across two programs.
- **A field-reordering linter (toy).** For a given struct, compute the minimal-padding ordering and report the bytes saved.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* — Bryant & O'Hallaron. The chapters on data representation and memory are the gold standard for this topic.
- *What Every Programmer Should Know About Memory* — Ulrich Drepper. The definitive piece on caches, alignment, and access patterns.
- *The Lost Art of Structure Packing* — Eric S. Raymond. A clear, practical guide to padding and field ordering in C.
- *Data-Oriented Design* — Richard Fabian. The book-length argument for SoA and layout-driven thinking.
- *CPython Internals* — Anthony Shaw. How a Python object is actually laid out in memory.
- The Go blog and `go vet`'s `fieldalignment` analyzer documentation.
- *The Rust Reference* — the "Type layout" chapter, on `repr(C)`, `repr(packed)`, and default field reordering.

---

## Related Topics

- This folder, next levels: `middle.md`, `senior.md`, `professional.md`, `interview.md`, `tasks.md`.
- The next runtime topic, **method dispatch**, builds directly on the vtable pointer introduced here — how the runtime reads through a vtable to call a virtual method.
- **Data representation** (tagged vs boxed values, NaN-boxing, pointer tagging) is the sibling concept referenced throughout this page in prose.
- **Garbage collection** uses the header bits (GC age, mark state) described here.
- **Cache architecture and the memory hierarchy** explain *why* alignment, padding, and AoS/SoA matter at all.

---

## Diagrams & Visual Aids

### A Padded Struct vs a Reordered One

```text
struct Bad { char a; int b; char c; }   // sizeof = 12

offset:  0    1    2    3    4    5    6    7    8    9   10   11
        [a ][pad][pad][pad][ b  b  b  b ][c ][pad][pad][pad]
         ^use  ^---- wasted ----^   ^use     ^use  ^--- wasted ---^


struct Good { int b; char a; char c; }  // sizeof = 8

offset:  0    1    2    3    4    5    6    7
        [ b  b  b  b ][a ][c ][pad][pad]
         ^---- use ----^use ^use ^- waste -^

Same data. 12 bytes -> 8 bytes by reordering.
```

### Inline vs Boxed

```text
INLINE  ( int[] )                 BOXED  ( Integer[] )

 array
┌────┬────┬────┬────┐             array of pointers
│ 7  │ 42 │  9 │ 13 │            ┌────┬────┬────┬────┐
└────┴────┴────┴────┘            │ ●  │ ●  │ ●  │ ●  │
 4B   4B   4B   4B                └─┬──┴─┬──┴─┬──┴─┬──┘
 one tight block                    │    │    │    │
                                     ▼    ▼    ▼    ▼
                                  [hdr|7][hdr|42][hdr|9][hdr|13]
                                  scattered heap objects, each
                                  with its own ~16B header
```

### An Object With a Header

```text
       ┌──────────────── one OBJECT in memory ─────────────────┐
       │                                                       │
       │  ┌─── HEADER ───┐  ┌──────── YOUR FIELDS ────────┐    │
       │  │ refcount /   │  │  field0 │ pad │ field1 │... │    │
       │  │ mark word /  │  └─────────────────────────────┘    │
       │  │ class ptr /  │   ^ these are what you declared      │
       │  │ vtable ptr   │                                      │
       │  └──────────────┘                                      │
       │   ^ you never declared these, but you pay for them     │
       └───────────────────────────────────────────────────────┘
```

### AoS vs SoA Cache Behavior (reading only X)

```text
AoS:  [x0 y0 z0][x1 y1 z1][x2 y2 z2][x3 y3 z3] ...
       ▲           ▲           ▲           ▲
      want        want        want        want
   each fetched cache line also drags in y,z you don't need -> waste

SoA:  [x0 x1 x2 x3 x4 x5 ...][y0 y1 ...][z0 z1 ...]
       ▲  ▲  ▲  ▲  ▲  ▲
   every byte of the fetched line is an x you wanted -> full use
```
