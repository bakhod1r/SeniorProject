# Manual Memory Management — Middle Level

> **Topic:** [Manual Memory Management](README.md)
> **Focus:** How the allocator actually works, what each failure mode does under the hood, and ownership conventions in real APIs.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level, `malloc` and `free` were a black box governed by a contract. Now we open the box. Understanding *what the allocator stores*, *how a block is laid out*, and *what actually happens during a use-after-free* is what separates "I follow the rules" from "I understand why the rules exist." It also explains the otherwise baffling crashes: why a double-free corrupts unrelated data, why writing one byte past a buffer can hijack control flow, why a leak in C is invisible until the machine dies.

This tier also introduces the central discipline of manual memory: **ownership conventions**. The hardest question in C is not "how do I free this?" but "*whose job is it* to free this?" — and how an API communicates that answer.

---

## Prerequisites

- The `malloc`/`calloc`/`realloc`/`free` contract from the junior tier.
- Comfort reading C with `struct`, pointers, and pointer arithmetic.
- A rough idea of virtual memory: your process sees a flat address space; the OS maps it to physical RAM in pages (typically 4 KiB).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Chunk / block** | A unit of heap memory the allocator hands out, usually larger than you asked for. |
| **Header / metadata** | Bookkeeping bytes the allocator stores alongside (often just before) your block. |
| **Alignment** | The requirement that an address be a multiple of some power of two (e.g. 8 or 16). |
| **Free list** | The allocator's internal list of available blocks. |
| **Fragmentation** | Wasted heap space: many small free gaps that can't satisfy a large request. |
| **Ownership** | The convention naming exactly one party responsible for freeing a block. |
| **Transfer of ownership** | Handing the free-responsibility to another function or component. |
| **Heap spraying** | An exploit technique that fills the heap with attacker-controlled data. |

---

## Core Concepts

### What the allocator stores

When you call `malloc(24)`, the allocator does **not** hand you exactly 24 bytes from nowhere. It:

1. **Rounds the size up** for alignment and minimum block size. On a 64-bit system, blocks are typically aligned to 16 bytes, and there's a minimum size (often 32 bytes) because each block needs room for bookkeeping when free.
2. **Stores a header** — commonly in the bytes *immediately before* the pointer it returns. A typical glibc header holds the chunk size and a few status flags (e.g. "is the previous chunk in use?").
3. **Returns a pointer** to the usable region, just after the header.

```
            header        usable region you get a pointer to
          ┌─────────┐ ┌──────────────────────────────────┐
   ... ── │  size+  │ │  your 24 bytes (rounded to 32)    │ ── next chunk ...
          │  flags  │ │                                   │
          └─────────┘ └──────────────────────────────────┘
                      ^
                      malloc returns this address
```

Two consequences fall out of this picture:

- **`free(p)` knows the size without you telling it.** It reads the header just before `p`. That's why `free` takes only a pointer.
- **Writing one byte before your block (`p[-1]`) or past its end corrupts the allocator's metadata**, not just your data. This is why overflows are catastrophic, not merely wrong.

### Alignment

The CPU requires (or strongly prefers) that certain types live at aligned addresses. A `double` or a pointer typically must sit at an 8- or 16-byte boundary. `malloc` guarantees its returned pointer is suitably aligned for *any* type — that's why it over-allocates and rounds up. When you write your own allocator, honoring alignment is non-negotiable; a misaligned access is a crash on some architectures and a silent slowdown on others.

### The failure modes, under the hood

Now the bugs make sense:

- **Use-after-free.** After `free(p)`, the allocator may put `p`'s chunk on a free list, writing free-list pointers *into the body of your old block*. If you then read it, you see allocator internals; if you write it, you corrupt the free list. Worse, the allocator may hand the same chunk to a *different* `malloc`, so two parts of your program now alias the same memory. This is the #1 exploit primitive in modern attacks.

- **Double-free.** Calling `free(p)` twice puts the same chunk on the free list twice. A later allocation can return it while it's *also* still queued, letting an attacker arrange for `malloc` to return an arbitrary address. glibc has hardening (tcache double-free detection) but it is not a guarantee.

- **Buffer overflow.** Writing past your block tramples the *next* chunk's header. The next `free` or `malloc` then operates on corrupt metadata — the foundation of decades of exploits.

- **Memory leak.** Nothing crashes. The chunk stays marked "in use" forever. The process's resident memory climbs until the OOM killer (Linux) terminates you or the allocator fails. In a long-running server, a 40-byte leak per request is a guaranteed outage on a timer.

- **Mismatched alloc/free.** In C++, memory from `new` must be released with `delete`, `new[]` with `delete[]`, and `malloc` with `free`. Mixing them is undefined behavior, because `new[]` may store an element count in a header that `delete` (singular) doesn't know about.

- **Invalid free.** Calling `free` on a pointer that didn't come from `malloc` (a stack address, an interior pointer, an already-freed pointer) reads garbage as a header and corrupts the heap.

### Ownership conventions

The contract says "free each block once." The hard part is deciding *who*. APIs answer this with conventions:

- **Caller allocates, caller frees.** The function fills a buffer the caller provides. Common and safe:
  ```c
  // Caller owns `out`. snprintf never allocates.
  int snprintf(char *out, size_t n, const char *fmt, ...);
  ```
- **Callee allocates, caller frees (ownership transfer).** The function `malloc`s and returns; the caller must `free`. This *must* be documented:
  ```c
  // strdup allocates; the CALLER must free the result.
  char *strdup(const char *s);
  ```
- **Callee allocates, callee frees (opaque handle).** The library owns the memory; you get a handle and call a matching destructor:
  ```c
  FILE *f = fopen("x", "r");   // library owns it
  fclose(f);                   // matching teardown, never free(f)
  ```

The cardinal rule: **every API that returns or accepts a pointer must document its ownership.** "Who frees this?" should never require reading the implementation.

---

## Mental Models

- **The header is the allocator's memory of you.** Your block is sandwiched in metadata. Step outside your lines and you erase the allocator's notes.
- **Freed memory is reused, not destroyed.** Think of a freed chunk as a hotel room immediately resold. Use-after-free is two guests in one room.
- **Ownership is a baton in a relay race.** At every moment exactly one runner holds it. Drop it (leak) or have two runners think they hold it (double-free) and the race ends in a crash.

---

## Code Examples

### Ownership transfer, documented

```c
// OWNERSHIP: returns a heap-allocated string; CALLER must free().
// Returns NULL on allocation failure.
char *join_path(const char *dir, const char *file) {
    size_t n = strlen(dir) + 1 + strlen(file) + 1;  // +1 sep, +1 NUL
    char *out = malloc(n);
    if (!out) return NULL;
    snprintf(out, n, "%s/%s", dir, file);
    return out;
}

void caller(void) {
    char *p = join_path("/etc", "hosts");
    if (!p) return;
    // ... use p ...
    free(p);          // caller honors the transfer
}
```

### The interior-pointer trap (invalid free)

```c
char *buf = malloc(100);
char *cursor = buf + 10;   // interior pointer
// ... work via cursor ...
free(cursor);              // BUG: UB — must free `buf`, the original
```

`free` reads the header just before `cursor`, which is in the middle of *your* data, not a real header. Heap corruption.

### Double-free across two owners

```c
void process(char *data) {
    // ... uses data ...
    free(data);            // process thinks it owns data
}

void caller(void) {
    char *d = malloc(64);
    process(d);
    free(d);               // BUG: double-free — process already freed it
}
```

This is an *ownership* bug, not a typo. The fix is a documented convention: either `process` borrows (never frees) or it consumes (caller never frees).

---

## Coding Patterns

### Single-exit cleanup (the C `goto` idiom)

C has no destructors, so resource cleanup on every error path is verbose and bug-prone. The idiomatic answer is a cleanup ladder:

```c
int load(const char *path, Result *out) {
    int rc = -1;
    char *buf = NULL;
    FILE *f = NULL;

    f = fopen(path, "rb");
    if (!f) goto done;

    buf = malloc(SIZE);
    if (!buf) goto done;

    if (read_into(f, buf) != 0) goto done;

    out->data = buf;
    buf = NULL;            // ownership transferred to out — don't free below
    rc = 0;

done:
    free(buf);             // free(NULL) is a safe no-op
    if (f) fclose(f);
    return rc;
}
```

Two things make this robust: `free(NULL)` is a guaranteed no-op (so the ladder is uniform), and setting `buf = NULL` after transfer prevents a double-free.

---

## Pros & Cons

**Pros**

- **Zero hidden cost.** No GC threads, no write barriers, no pauses.
- **Cache-friendly layouts.** You decide exactly where data lives, enabling tight, contiguous structures.
- **Deterministic teardown.** Resources release at a known point, not "eventually."

**Cons**

- **Ownership is a manual proof.** Nothing checks your reasoning; mistakes compile cleanly.
- **Fragmentation.** Long-running programs can waste significant memory to free gaps.
- **Metadata is fragile.** One overflow corrupts the allocator, turning a local bug into global chaos.

---

## Use Cases

- **Library APIs** where you must define and document ownership across a boundary.
- **Parsers and protocol handlers** that build and tear down trees of allocations per message.
- **Systems where GC is banned**: kernels, drivers, real-time control loops, microcontrollers.

---

## Best Practices

1. **Document ownership at every pointer-passing boundary.** A one-line comment ("CALLER frees") prevents a class of bugs.
2. **Free in reverse construction order** for dependent resources.
3. **Use the `goto`-cleanup or single-exit pattern** so every error path runs the same teardown.
4. **Null after free, and rely on `free(NULL)` being safe** to keep cleanup uniform.
5. **Never free an interior pointer.** Keep the original allocation pointer until teardown.
6. **In C++, match the allocator**: `new`↔`delete`, `new[]`↔`delete[]`, `malloc`↔`free`. Better: stop using raw `new`/`delete` (next tier).

---

## Edge Cases & Pitfalls

- **`realloc(p, 0)`** is implementation-defined: it may free `p` and return `NULL`, or return a minimal block. Don't rely on either; avoid it.
- **`realloc` shrinking** can still move the block. Always reassign from the return value.
- **Zero-size `malloc(0)`** may return `NULL` *or* a unique freeable pointer — both are conforming. Don't treat `NULL` from `malloc(0)` as failure.
- **Integer overflow in size math**: `malloc(count * size)` can overflow and under-allocate, then you write past the (tiny) block. Use `calloc(count, size)`, which checks the multiplication.
- **Freeing memory you don't own** (a string literal, a stack array, library-owned memory) corrupts the heap.
- **Aliasing after transfer**: keeping a copy of a pointer you handed off leads to use-after-free when the new owner frees it.

---

## Summary

- The allocator stores a **header** (size + flags) next to your block and **rounds up for alignment**; that's why `free` needs only a pointer and why overflows corrupt allocator metadata.
- Each failure mode has a concrete mechanism: freed chunks go on free lists and get reused (use-after-free, double-free), overflows trample neighboring headers, leaks keep chunks marked in-use forever.
- The defining discipline is **ownership**: exactly one party frees each block, and APIs must *document* who.
- Patterns like the **`goto`-cleanup ladder**, **null-after-free**, and **`calloc` for size math** tame manual memory in plain C.
- The next tier compares how C, C++ (RAII), and Rust (compile-time ownership) each attack this problem from a design standpoint.
