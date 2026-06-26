# Manual Memory Management — Junior Level

> **Topic:** [Manual Memory Management](README.md)
> **Focus:** What it means to allocate and free memory by hand, the `malloc`/`free` contract, and the everyday bugs it creates.

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

In a language like Python, Java, or Go, you create an object and forget about it. Some runtime machinery — a **garbage collector** — figures out when nobody is using it anymore and reclaims the memory. You never think about it.

In **manual memory management**, *you* are the garbage collector. When you need memory on the heap, you ask for it explicitly. When you are done, you must give it back explicitly. If you forget to give it back, your program slowly bloats. If you give it back and keep using it anyway, your program corrupts itself or crashes — sometimes minutes later, far from the actual mistake.

This is the model used by **C** and, with safer tooling on top, by **C++** and **Rust**. It is also how the operating systems, databases, browsers, and game engines you use every day are built. Understanding it is not optional knowledge for a serious engineer — it is the foundation everything else is built on.

This page introduces the mechanics and vocabulary. The trade-offs, disciplines, and production tooling come in later tiers.

---

## Prerequisites

You should be comfortable with:

- **What a pointer is** — a variable that holds a memory address rather than a value.
- **The stack vs. the heap** — local variables live on the *stack* and are cleaned up automatically when a function returns; the *heap* is a large pool of memory you manage by hand.
- **Basic C syntax** — function calls, pointers (`*`, `&`), and `struct`.

If "the stack cleans up automatically but the heap does not" is new to you, re-read that sentence until it sticks. It is the single most important idea on this page.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Heap** | A large region of memory you allocate from and return to manually. |
| **Allocate** | Reserve a block of heap memory for your use (`malloc`). |
| **Free / deallocate** | Return a block to the allocator so it can be reused (`free`). |
| **Pointer** | A variable holding a memory address. |
| **Dangling pointer** | A pointer to memory that has already been freed. |
| **Memory leak** | Allocated memory that is never freed and never reused. |
| **Use-after-free** | Reading or writing memory after it has been freed. |
| **Double-free** | Calling `free` twice on the same block. |
| **Undefined behavior (UB)** | A program state the language spec makes no promises about — anything can happen. |
| **Allocator** | The library code behind `malloc`/`free` that hands out and tracks heap blocks. |

---

## Core Concepts

### The four primitive functions

C gives you a tiny toolkit in `<stdlib.h>`:

| Function | What it does |
|----------|--------------|
| `malloc(n)` | Reserve `n` bytes, return a pointer to them. The bytes are **uninitialized** (garbage). |
| `calloc(count, size)` | Reserve `count * size` bytes and **zero them out**. |
| `realloc(p, n)` | Resize an existing block to `n` bytes, possibly moving it to a new address. |
| `free(p)` | Return the block at `p` to the allocator. |

### The contract

Manual memory management is a *contract* between you and the allocator. The allocator promises:

- If `malloc` succeeds, you own a usable block of at least the size you asked for.
- The block stays valid and untouched until *you* call `free` on it.

In return, *you* promise:

- You will call `free` exactly **once** per successful `malloc`.
- After you call `free`, you will **never touch that pointer again**.
- You will not read or write past the end of the block.

Every bug in this topic is a broken clause of that contract.

### `malloc` can fail

`malloc` returns `NULL` when it cannot satisfy the request (out of memory). Real code checks for this:

```c
int *p = malloc(sizeof(int) * 100);
if (p == NULL) {
    // handle the failure — do NOT use p
}
```

Skipping the check means that on failure you dereference `NULL`, which crashes (or worse).

### "Freed" does not mean "erased"

A crucial mental shift: `free(p)` does **not** clear the memory or change `p`. The bytes are still there, and `p` still points at them. You have simply told the allocator *"I'm done; you may give this region to someone else."* The pointer is now a **dangling pointer** — a loaded gun pointing at memory that may belong to another part of your program at any moment.

---

## Real-World Analogies

**The library book.** `malloc` is borrowing a book. `free` is returning it. A **leak** is keeping the book forever — eventually the library runs out of copies for everyone else. A **use-after-free** is taking notes in a book *after* you returned it and someone else checked it out: you are now scribbling in a stranger's book. A **double-free** is returning the same book to the desk twice — the librarian's records are now corrupt.

**The hotel room.** Checking in is `malloc`; checking out is `free`. After checkout, the room is cleaned and given to a new guest. If you walk back in with your old key (a dangling pointer) and rearrange the furniture, you are vandalizing someone else's stay — and they have no idea why their things keep moving.

---

## Mental Models

- **Every `malloc` needs exactly one `free`.** Picture a balance sheet. Allocations on one side, frees on the other. They must match — no more, no less.
- **A pointer is a claim ticket, not the coat.** Copying a pointer copies the ticket, not the coat. Two tickets to one coat means two people might try to free it.
- **`free` is a promise, not an eraser.** It says "I'm done," it does not wipe anything. *You* must stop using the pointer.

---

## Code Examples

### The happy path

```c
#include <stdlib.h>
#include <string.h>

void example(void) {
    // 1. Allocate room for 10 integers.
    int *numbers = malloc(10 * sizeof(int));
    if (numbers == NULL) {
        return;  // allocation failed — bail out
    }

    // 2. Use the memory.
    for (int i = 0; i < 10; i++) {
        numbers[i] = i * i;
    }

    // 3. Free it exactly once when done.
    free(numbers);

    // 4. numbers is now dangling. Do not touch it.
    // Defensive habit: null it so accidental use crashes loudly.
    numbers = NULL;
}
```

### `calloc` vs `malloc`

```c
int *a = malloc(4 * sizeof(int));  // contents: GARBAGE
int *b = calloc(4, sizeof(int));   // contents: 0, 0, 0, 0

// Reading a[0] before writing it is an UNINITIALIZED READ — a bug.
// b[0] is guaranteed to be 0.
```

### Growing a buffer with `realloc`

```c
int *buf = malloc(4 * sizeof(int));
// ... later we need more room ...
int *bigger = realloc(buf, 8 * sizeof(int));
if (bigger == NULL) {
    free(buf);   // realloc failed; original buf is STILL valid, free it
    return;
}
buf = bigger;    // realloc may have moved the block — always reassign
```

Note the careful pattern: **never write `buf = realloc(buf, ...)` directly.** If `realloc` returns `NULL`, you would overwrite your only pointer to the original block and leak it.

---

## Pros & Cons

**Pros**

- **Predictable** — memory is reclaimed exactly when you say, with no surprise pauses.
- **Lean** — no garbage collector overhead; tiny memory footprint.
- **Total control** — essential for operating systems, drivers, and embedded chips with kilobytes of RAM.

**Cons**

- **Error-prone** — the bugs are easy to write, hard to find, and often catastrophic.
- **Mental overhead** — you must track ownership of every block in your head.
- **Late, confusing failures** — a mistake here often crashes somewhere else entirely.

---

## Use Cases

You are doing manual memory management whenever you work in:

- **C** — the default, fully manual.
- **C++** — manual underneath, but with safety tools layered on top (covered in later tiers).
- **Rust** — the compiler checks your ownership at compile time.
- **Embedded / kernel / real-time systems** — where a garbage collector is unacceptable.

---

## Best Practices

1. **Always check `malloc`'s return for `NULL`** before using the pointer.
2. **Match every `malloc` with exactly one `free`** — make it a reflex.
3. **Set pointers to `NULL` after freeing** so accidental reuse crashes immediately instead of silently corrupting.
4. **Free in the reverse order you allocated** when blocks depend on each other.
5. **Allocate and free in the same "owner."** If function A allocates, prefer that function A (or its clear successor) frees. Don't scatter ownership.
6. **Prefer `calloc` when you need zeroed memory** instead of `malloc` + a manual loop.

---

## Edge Cases & Pitfalls

- **Forgetting to free → memory leak.** The program runs fine, then slowly grows until the machine runs out of memory hours later.
- **Using after free → use-after-free.** The classic source of crashes and security holes. The bug may not show up where you wrote it.
- **Freeing twice → double-free.** Corrupts the allocator's internal bookkeeping; usually crashes.
- **Forgetting `malloc` can return `NULL`.** On failure you dereference a null pointer.
- **`realloc` may move your block.** Any old pointers into the original block are now dangling. Always use the returned pointer.
- **Uninitialized read.** `malloc` gives you garbage bytes; reading them before writing is a bug. Use `calloc` or initialize first.
- **Off-by-one writes.** `malloc(10 * sizeof(int))` gives indices `0..9`. Writing to index `10` is a **buffer overflow** — it scribbles on memory you don't own.

---

## Summary

- The heap is yours to manage by hand: `malloc` to take memory, `free` to give it back.
- The contract is strict: **free each block exactly once, and never touch it afterward.**
- `malloc` can fail (returns `NULL`) and hands back uninitialized bytes; `calloc` zeroes them; `realloc` resizes and may move the block.
- The signature bugs — leaks, use-after-free, double-free, dangling pointers, buffer overflows, uninitialized reads — all come from breaking the contract, and they fail in confusing, delayed ways.
- This model trades safety for control and predictability, which is why it powers the systems everything else runs on.

The next tier digs into *how* the allocator works underneath and the deeper mechanics of each failure mode.
