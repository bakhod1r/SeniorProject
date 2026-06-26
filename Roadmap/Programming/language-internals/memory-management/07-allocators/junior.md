# Allocators — Junior Level

> **Topic:** [Allocators](README.md)
> **Focus:** What a memory allocator is, why `malloc`/`free` exist, and the basic vocabulary (heap, chunk, free list) you need before anything else makes sense.

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

When your program needs memory at runtime — an array whose size you only learn from user input, a linked list that grows, a string of unknown length — it calls something like `malloc` (C), `new` (C++), or just creates an object (Java, Python, Go) and the runtime does it for you. Somewhere underneath all of those is a **memory allocator**: a piece of software whose entire job is to hand out and reclaim chunks of memory.

The key insight a junior engineer needs is this: **the operating system does not give your program memory in small pieces.** The OS deals in *pages* (typically 4 KiB) and hands them out in coarse blocks through system calls like `mmap`, `sbrk`, or `VirtualAlloc`. Asking the kernel every time you need 24 bytes for a struct would be absurdly slow — a system call is hundreds of times more expensive than a normal function call.

So the allocator sits in the middle. It asks the OS for big regions occasionally, then *retails* that memory to your program in whatever small sizes you ask for, keeping careful track of what is in use and what is free. `malloc(24)` almost never talks to the kernel; it just carves 24 bytes out of memory the allocator already owns.

This document covers the foundations: what the heap is, what a "chunk" looks like, what a "free list" is, and why `free` is harder than it sounds.

## Prerequisites

- **Pointers and addresses.** You should be comfortable that memory is a giant array of bytes, each with a numeric address, and that a pointer is just one of those addresses.
- **Stack vs. heap.** Local variables live on the *stack* and are cleaned up automatically when a function returns. The *heap* is the pool of memory the allocator manages, and you control its lifetime explicitly (or a garbage collector does).
- **What a system call is.** A request your program makes to the OS kernel. It is far more expensive than an ordinary function call.
- **Basic C `malloc`/`free`** semantics, even if your daily language is higher-level — every higher-level runtime has an allocator underneath that behaves similarly.

## Glossary

- **Heap:** The region of memory the allocator manages and hands out from. (Unrelated to the heap *data structure* in algorithms — same word, different meaning.)
- **Allocation:** A block of memory handed to your program by `malloc`/`new`. It "belongs" to you until you free it.
- **Chunk / block:** The allocator's internal unit of memory. When you ask for 24 bytes, the allocator gives you a chunk that is *at least* 24 bytes (often a bit more, for bookkeeping and alignment).
- **Free list:** A linked list of chunks that are currently *not* in use, available to be handed out again.
- **Header / metadata:** A few bytes the allocator stores *next to* (usually just before) your block to remember its size and status.
- **Fragmentation:** Wasted memory — either small unusable gaps between allocations (external) or padding inside a block you didn't ask for (internal).
- **`mmap` / `sbrk` / `VirtualAlloc`:** OS system calls the allocator uses to get raw memory from the kernel.
- **Alignment:** The requirement that certain addresses be multiples of a power of two (e.g., 8 or 16). The CPU and many types need it.

## Core Concepts

### The allocator turns coarse OS memory into fine-grained blocks

This is the one-sentence summary of the whole topic. The OS gives megabytes; your program wants bytes. The allocator bridges that gap.

```
   Your program          Allocator (malloc/free)          Operating System
  ---------------        ----------------------          -----------------
  malloc(24)    -->   carve 24B from owned memory
  malloc(100)   -->   carve 100B from owned memory
                       (no syscall needed)
  malloc(8MB)   -->   not enough owned memory   --->   mmap() one big region
                       carve 8MB from it
```

### Every allocation needs bookkeeping

When you later call `free(ptr)`, you only pass the pointer — *not* the size. So how does the allocator know how big the block was? It stored that information itself, usually in a small **header** placed just before the memory it returned to you.

```
        header              what you get back from malloc
   +-------------+----------------------------------------+
   | size: 24    |  <-- malloc returns a pointer to here  |
   | in-use flag |                                         |
   +-------------+----------------------------------------+
   ^
   allocator looks here when you call free(ptr)
```

This is why `malloc(24)` may actually consume more than 24 bytes of memory — the header is overhead.

### The free list: remembering what's available

When you `free` a block, the allocator doesn't return it to the OS (usually). It puts that block onto a **free list** — a chain of available chunks — so the next `malloc` can reuse it. This reuse is the whole point: it's why heavy allocate/free workloads stay fast.

```
free list:   [chunk A] -> [chunk C] -> [chunk F] -> NULL
             (free)        (free)       (free)

malloc(size) walks this list, finds a chunk that fits, removes it, returns it.
free(ptr)    adds the chunk back to the front of the list.
```

### Why `free` is harder than `malloc`

`malloc` just finds space. `free` has to do something subtle: if two free chunks end up *next to each other* in memory, the allocator should **coalesce** (merge) them into one bigger chunk. Otherwise you'd end up with thousands of tiny free chunks and never be able to satisfy a large request — even though plenty of total memory is free. This problem is **external fragmentation**, and fighting it is most of what makes a real allocator complicated.

## Real-World Analogies

- **A parking garage attendant.** The garage (heap) has a fixed layout. The attendant (allocator) remembers which spots are taken and which are free. When you arrive (`malloc`), they find you a free spot big enough for your car. When you leave (`free`), the spot becomes available again. If lots of cars leave but only compact cars remain parked in scattered spots, a bus might not fit *even though there's enough total empty space* — that's external fragmentation.

- **A librarian and a warehouse.** The warehouse (OS) delivers books by the pallet. The librarian (allocator) breaks pallets down and shelves individual books for readers. Asking the warehouse for one book at a time would be impossibly slow, so the librarian buffers in bulk and retails individually.

- **A buffet plate.** You take exactly the food you want (your allocation). The buffet (allocator) keeps refilling the trays from the kitchen (OS) only when they run low — not per spoonful.

## Mental Models

1. **The allocator is a wholesaler-to-retailer.** Buys memory wholesale from the OS in big lots, sells it retail to your program in small pieces. It profits by amortizing the expensive system calls.

2. **Memory has a layout, not just a quantity.** Two programs can both have "1 MB free" and yet one can satisfy a 500 KB request while the other cannot — because in the second, the free memory is shattered into tiny scattered pieces. *Where* memory is free matters as much as *how much*.

3. **`malloc` and `free` are a matched pair.** Every `malloc` must eventually be balanced by exactly one `free`. Forget the `free` and you leak; `free` twice and you corrupt the allocator's bookkeeping.

## Code Examples

### Using `malloc`/`free` correctly (C)

```c
#include <stdlib.h>
#include <string.h>

char *make_greeting(const char *name) {
    // length of "Hello, " + name + "!" + null terminator
    size_t len = strlen("Hello, ") + strlen(name) + 1 + 1;

    char *buf = malloc(len);     // ask the allocator for `len` bytes
    if (buf == NULL) {           // ALWAYS check — malloc can fail
        return NULL;
    }

    snprintf(buf, len, "Hello, %s!", name);
    return buf;                  // caller now owns this memory
}

int main(void) {
    char *msg = make_greeting("Ada");
    if (msg) {
        puts(msg);
        free(msg);               // hand the memory back to the allocator
        msg = NULL;              // avoid using a dangling pointer
    }
    return 0;
}
```

Three habits to absorb from this tiny example:

1. **Check the return value.** `malloc` returns `NULL` when it cannot satisfy the request. Dereferencing `NULL` crashes.
2. **Free exactly once.** The block belongs to whoever holds the pointer; ownership must be clear.
3. **Null the pointer after freeing.** A freed pointer that you accidentally use again is a *use-after-free* — one of the nastiest classes of bug.

### Seeing the overhead

```c
#include <stdio.h>
#include <stdlib.h>
#include <malloc.h>   // glibc-specific: malloc_usable_size

int main(void) {
    void *p = malloc(1);                    // ask for just 1 byte
    printf("requested: 1, usable: %zu\n",
           malloc_usable_size(p));          // often prints 24 or more!
    free(p);
    return 0;
}
```

On glibc this typically prints something like `usable: 24`. You asked for 1 byte and the allocator reserved a whole minimum-sized chunk. That gap is **internal fragmentation** — and it's why allocating millions of tiny objects one at a time is wasteful.

## Pros & Cons

The allocator as a concept buys you a lot, but it isn't free.

**Pros**

- **Speed:** Most allocations are just pointer arithmetic on memory the allocator already owns — no system call.
- **Convenience:** You think in "give me N bytes," not "manage OS pages."
- **Reuse:** Freed memory is recycled, so a loop that allocates and frees doesn't grow without bound.

**Cons**

- **Overhead:** Each allocation carries a header and is rounded up for alignment, so small objects waste memory.
- **Fragmentation:** Over time, free memory can scatter into unusable fragments.
- **Bug surface:** Leaks, double-frees, and use-after-frees are easy to introduce and hard to debug.
- **Latency spikes:** Occasionally `malloc` *does* hit the OS (when it runs out of owned memory), causing an unpredictable slow call.

## Use Cases

You are relying on an allocator any time you:

- Create a data structure whose size isn't known at compile time (dynamic arrays, hash maps, trees).
- Return data from a function that must outlive the function's stack frame.
- Work in *any* high-level language — Python lists, Java objects, Go slices all go through an allocator beneath the runtime.

You'd want to learn about *custom* allocators (a later-tier topic) when you have extreme performance needs: games, trading systems, databases. For now, the default allocator is the right choice.

## Best Practices

- **Always pair `malloc` with `free`** (or use RAII / smart pointers in C++, or let the GC handle it in managed languages). Decide *who owns* each allocation.
- **Check `malloc` for `NULL`.** It is rare to fail on modern systems but catastrophic when unhandled.
- **Don't allocate in tight inner loops** if you can allocate once outside and reuse the buffer.
- **Prefer the stack for small, short-lived data.** Stack allocation is essentially free and auto-cleaned. Only reach for the heap when you need dynamic size or longer lifetime.
- **Set freed pointers to `NULL`** so accidental reuse fails loudly instead of silently corrupting memory.

## Edge Cases & Pitfalls

- **`malloc(0)`** is legal and may return either `NULL` or a unique non-null pointer you can safely `free`. Don't assume which.
- **Forgetting to free** → a *memory leak*. The program's memory grows until it's killed. Long-running servers are especially vulnerable.
- **Freeing twice** → *double free*. Corrupts the free list; often crashes later, far from the actual bug.
- **Using after free** → reading/writing memory that may have been handed to someone else. Silent data corruption or a security hole.
- **Off-by-one on size** → forgetting the `+1` for a string's null terminator is a classic buffer overflow.
- **Assuming `malloc` zeroes memory** → it does *not*. The bytes are garbage. Use `calloc` if you need zeroed memory.

## Summary

A memory allocator is the layer that turns the coarse, page-sized memory the OS provides into the fine-grained, byte-sized allocations your program asks for. It keeps a **header** of metadata next to each block to remember its size, maintains a **free list** of reusable chunks, and tries to **coalesce** adjacent free chunks to fight **fragmentation**. Using it correctly means: pair every allocation with exactly one free, check for failure, decide ownership clearly, and prefer the stack for small short-lived data. Everything in the higher tiers — size classes, arenas, slabs, jemalloc vs. tcmalloc — is an elaboration on this one job: hand out and reclaim memory quickly, with as little waste and contention as possible.
