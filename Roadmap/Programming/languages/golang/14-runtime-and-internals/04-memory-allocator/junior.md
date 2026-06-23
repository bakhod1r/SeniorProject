# Memory Allocator — Junior

## 1. What is a memory allocator?

When your program writes `x := make([]int, 1000)`, somewhere a chunk of memory has to appear. That chunk doesn't fall out of the sky. Something has to:

1. Ask the operating system for memory (via `mmap` on Unix, `VirtualAlloc` on Windows).
2. Carve that memory into pieces of the right size.
3. Hand a piece back to your code.
4. Remember where each piece is so the garbage collector can find and reclaim it later.

The thing that does all of this is the **memory allocator**. In Go, it's not `malloc` from libc — it's a custom allocator built into the runtime, tuned for Go's specific needs: tons of small objects, concurrent goroutines, and a tracing GC that needs to know where every pointer lives.

> If the scheduler is "who runs", and the GC is "what to throw away", the allocator is "where does new stuff go".

---

## 2. Why Go has its own allocator

Couldn't Go just call `malloc`? Technically yes — but it would be slow and clumsy. Go's allocator exists because:

- **GC needs metadata.** The garbage collector must know, for every byte on the heap, whether it's a pointer or just plain data. A generic `malloc` doesn't track that. Go's allocator records a "pointer/scalar" bitmap for each allocation.
- **Goroutines are cheap.** Programs make millions of tiny allocations. Locking a global heap on every `make([]byte, 8)` would be a disaster. Go gives each P its own private cache (`mcache`) so most allocations never touch a lock.
- **Size classes amortize work.** Real programs allocate the same sizes over and over (24-byte structs, 48-byte slices). Bucketing by size lets the allocator hand back a pre-split chunk in O(1).
- **Stack vs heap is a runtime decision.** Most allocations don't go through the allocator at all — they live on the goroutine's stack, which is essentially free to allocate and free.

---

## 3. Prerequisites
- You've written Go and used `make`, `new`, and `&T{}`.
- You know what a heap is, roughly (a region of memory for dynamic allocation).
- You've seen the runtime exists (`01-runtime-source-dive` covers the map).
- You've heard "Go has a garbage collector" — that's enough for now.

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **Heap** | A region of memory for dynamically allocated objects, managed by the allocator |
| **Stack** | Per-goroutine memory for local variables; grows and shrinks automatically |
| **mcache** | Per-P thread-local allocator cache — fast, lock-free |
| **mcentral** | Global per-size-class list that refills `mcache` |
| **mheap** | The global heap; owns all spans and talks to the OS |
| **Span** | A run of contiguous pages (8KB each) dedicated to one size class |
| **Size class** | A bucket size (8, 16, 24, ... bytes); Go has ~67 of them |
| **Escape analysis** | Compiler pass that decides whether a value lives on stack or heap |
| **Tiny allocator** | Special path that packs small pointer-free objects together |
| **TCMalloc** | Google's "Thread-Caching Malloc" — the design Go's allocator is based on |

---

## 5. Stack vs heap — most allocations are free

Before any allocator code runs, the Go compiler decides where each value lives. Two places:

- **Stack** — fast, automatic. Allocating is just bumping a pointer; freeing is automatic when the function returns. No GC involvement.
- **Heap** — managed by the allocator. Tracked by the GC. Slower.

A value goes on the heap only if it **escapes** the function — meaning a pointer to it could still be reachable after the function returns. Examples:

```go
func stackAllocated() int {
    x := 42      // lives on the stack
    return x     // value copied out; no escape
}

func heapAllocated() *int {
    x := 42      // escapes — pointer returned
    return &x    // forces x onto the heap
}
```

You can see the compiler's decision:

```bash
go build -gcflags="-m" ./...
# ./main.go:7:6: moved to heap: x
```

> **Common confusion:** "everything is on the heap in Go". No. Stack first, heap only if it escapes. Most short-lived locals never touch the allocator at all.

---

## 6. The big picture: a three-tier hierarchy

When a value *does* need the heap, here's the path:

```
                     +----------------+
your goroutine  -->  |    mcache      |  (per-P, no lock)
                     |  one free list |
                     |  per size class|
                     +----------------+
                              |
                       (empty? refill from)
                              v
                     +----------------+
                     |   mcentral     |  (one per size class, global)
                     |  partially-    |
                     |  used spans    |
                     +----------------+
                              |
                       (empty? grow from)
                              v
                     +----------------+
                     |    mheap       |  (single global heap)
                     |  arenas,       |
                     |  free spans    |
                     +----------------+
                              |
                       (out of space? mmap)
                              v
                     +----------------+
                     | operating sys  |
                     |  mmap / sbrk   |
                     +----------------+
```

Three observations:

1. **The fast path is local.** Most allocations land in `mcache` and never see a lock.
2. **Each tier is a fallback.** Empty `mcache` asks `mcentral`. Empty `mcentral` asks `mheap`. Empty `mheap` asks the OS.
3. **Going down a tier is expensive.** Touching `mcentral` requires a lock. Touching `mheap` requires more locking. Hitting the OS is the slowest path.

This is the same shape as Google's TCMalloc, with Go-specific tweaks (size classes, pointer bitmaps, GC integration).

---

## 7. Size classes

Small objects in Go aren't allocated at exactly the size you asked for. They're rounded up to the nearest **size class**. There are ~67 of them, defined in `runtime/sizeclasses.go`. A few:

| Asked for | Size class | Wasted |
|-----------|-----------|--------|
| 1 byte    | 8         | 7 bytes |
| 9 bytes   | 16        | 7 bytes |
| 17 bytes  | 24        | 7 bytes |
| 33 bytes  | 48        | 15 bytes |
| 100 bytes | 112       | 12 bytes |
| 300 bytes | 320       | 20 bytes |

Why round? Because each size class has its own free list. Hand back a chunk from the free list in O(1). The downside is **internal fragmentation** — a 9-byte allocation eats a 16-byte slot. In practice that's a fine trade for the speed.

The biggest small-object class is **32 KB**. Anything larger skips the size-class machinery entirely.

---

## 8. Where allocations route

| Size | Route |
|------|-------|
| ≤ 16 B, no pointers | Tiny allocator — pack into a 16 B block |
| > 16 B and ≤ 32 KB | Size-class path: `mcache` → `mcentral` → `mheap` |
| > 32 KB | Large object — straight to `mheap`, its own span |

**Tiny allocator** is a clever optimization. If you allocate ten 4-byte values with no pointers (say, ten `int32`s captured by pointer), the runtime packs them into a single 16-byte block instead of giving each one a full 16-byte slot. That cuts waste roughly 4×. The constraint is "no pointers" because the GC's pointer bitmap can only track per-block, not per-subregion.

**Large objects** skip `mcache`/`mcentral` because cache slots are sized for small things. A 1 MB slice doesn't fit in any size class; it gets its own dedicated span allocated by `mheap`.

---

## 9. The three keywords that allocate

Three Go expressions can trigger a heap allocation:

```go
// 1. make — slices, maps, channels
s := make([]int, 1000)         // backing array allocation
m := make(map[string]int)      // hash table struct + buckets
c := make(chan int, 8)         // channel struct + buffer

// 2. new — zeroed memory for a type
p := new(MyStruct)             // *MyStruct, zero value

// 3. & on a composite literal — same as new, with values
p := &MyStruct{Name: "Bob"}
```

All three go through the **same** runtime function: `runtime.mallocgc(size, type, needzero)` in `runtime/malloc.go`. There is no special "new path". The compiler picks the size and type info; `mallocgc` does the work.

> **Common confusion:** "`new` is on the heap, `make` is on the stack." False. Either one can be either, depending on escape analysis. `new(int)` whose pointer never leaves the function lives on the stack.

---

## 10. A peek inside `mallocgc`

`runtime/malloc.go` has the master function. Roughly:

```go
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
    // 1. assists GC if we're behind on collection work
    // 2. decide path:
    if size <= maxTinySize && noPointers {
        // tiny path: append into the per-P tiny block
    } else if size <= maxSmallSize {
        // small path: pick size class, pull from mcache
    } else {
        // large path: allocate a span directly from mheap
    }
    // 3. record pointer-or-scalar bitmap so GC can scan it
    // 4. return pointer
}
```

You don't call this function. The compiler inserts a call for every `make` / `new` / `&T{}` that escapes to the heap.

---

## 11. The four files that own all of this

| File | What it owns |
|------|--------------|
| `runtime/malloc.go` | `mallocgc` — the entry point, decides the path |
| `runtime/mcache.go` | Per-P cache, the fast-path data structure |
| `runtime/mcentral.go` | One per size class; refills `mcache` |
| `runtime/mheap.go` | Global heap; owns arenas, talks to the OS |
| `runtime/sizeclasses.go` | The size-class table (generated, not hand-written) |
| `runtime/mbitmap.go` | Pointer/scalar metadata for the GC |

If you remember just one: **`malloc.go` is the entry point.** Everything else fans out from it.

---

## 12. Reading `runtime.MemStats`

The Go standard library exposes allocator statistics:

```go
var m runtime.MemStats
runtime.ReadMemStats(&m)

fmt.Println("HeapAlloc:    ", m.HeapAlloc)    // bytes currently allocated and in use
fmt.Println("HeapSys:      ", m.HeapSys)      // bytes mapped from the OS for the heap
fmt.Println("HeapInuse:    ", m.HeapInuse)    // bytes in non-empty spans
fmt.Println("HeapReleased: ", m.HeapReleased) // bytes returned to the OS
fmt.Println("HeapObjects:  ", m.HeapObjects)  // count of live allocated objects
```

Four numbers, three meanings:

- `HeapAlloc` is what your live program is using *right now*.
- `HeapSys - HeapReleased` is what Go has asked from the OS and not given back.
- `HeapInuse` is the slice of `HeapSys` actively serving allocations (the rest is free spans waiting).

If `HeapAlloc` is small but `HeapSys` is huge, your program had a memory spike that hasn't yet been returned to the OS. That's normal — Go keeps memory around for a few minutes before releasing.

---

## 13. A small experiment

```go
package main

import (
    "fmt"
    "runtime"
)

type Point struct{ X, Y int }

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    before := m.HeapAlloc

    pts := make([]*Point, 100_000)
    for i := range pts {
        pts[i] = &Point{X: i, Y: i}
    }

    runtime.ReadMemStats(&m)
    fmt.Printf("allocated ~%d KB for 100k Points\n", (m.HeapAlloc-before)/1024)
    _ = pts
}
```

Run it. You'll see roughly `100_000 * 16 / 1024 ≈ 1562 KB` — each `Point` is 16 bytes, neatly matching size class 2. Try changing `Point` to have a third `int` field. The struct grows to 24 bytes, exactly size class 3. The allocator is *that* predictable.

Then run with escape analysis:

```bash
go build -gcflags="-m" main.go
# main.go:13:18: &Point{...} escapes to heap
```

Each `&Point{...}` is heap-allocated because its address is stored in the slice and outlives the loop iteration.

---

## 14. Common confusions at this level

- **"Everything is on the heap."** No. Stack first; heap only if the compiler proves a value escapes.
- **"`new` always heap-allocates."** No. `new` is a syntactic helper. Whether it ends up on the heap is up to escape analysis.
- **"Size doesn't matter."** It does. ≤ 16 B with no pointers → tiny path. 17 B – 32 KB → size class. > 32 KB → straight to `mheap`. Three completely different cost profiles.
- **"Free memory goes back to the OS instantly."** No. Go keeps freed spans for a while; `HeapReleased` lags `HeapAlloc`.
- **"The allocator and the GC are the same thing."** Cousins, not twins. The allocator hands out memory; the GC reclaims it. They share metadata (the pointer bitmap) but live in different files.

---

## 15. Summary

Go has a custom memory allocator built into the runtime, modeled on TCMalloc. The path is three tiers: per-P `mcache` (no lock) → per-size-class `mcentral` (locked) → global `mheap` (locked, talks to OS via `mmap`). Small objects are bucketed into ~67 size classes; tiny pointer-free objects are packed; large objects (> 32 KB) get their own span. Most Go values aren't on the heap at all — escape analysis keeps them on the stack. The entry point is `runtime.mallocgc` in `runtime/malloc.go`; everything else (`mcache.go`, `mcentral.go`, `mheap.go`, `sizeclasses.go`) is a layer below it. At this level, the goal is the shape of the system: where memory comes from, why size classes exist, and the difference between stack and heap.

---

## Further reading
- Go source: `runtime/malloc.go`, `runtime/mheap.go`, `runtime/mcache.go`, `runtime/mcentral.go`, `runtime/sizeclasses.go`
- "TCMalloc: Thread-Caching Malloc" — Sanjay Ghemawat, Google — the design Go borrows from
- "Allocator Wrestling" — Rhys Hiltner, GopherCon 2018
- "A visual guide to Go memory allocator's design" — Andrei Avram
- `go tool compile -m` — see escape analysis decisions on your own code
- `pprof` heap profiles: `go test -memprofile=mem.out`, `go tool pprof mem.out`
