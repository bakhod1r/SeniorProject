# Memory-Safety Mechanisms — Hands-On Tasks

> **Topic:** [Memory-Safety Mechanisms](README.md)

---

## Introduction

These exercises are **defensive and observational**. You will deliberately write
buggy code, run it under a sanitizer to *see* the failure the way a tool sees it,
and then harden it. You will not build exploits — the goal is to recognise the
bug classes on sight and to know which mechanism stops each one.

Work under AddressSanitizer (`-fsanitize=address`), MemorySanitizer, and
UndefinedBehaviorSanitizer wherever possible, and reach for Valgrind when you
don't have a sanitizer. Tick a self-check box when you can name the bug class and
the defense, not merely when the program crashes.

> ⚠️ Run these only on machines and code you own. Everything here is about
> *finding and fixing* memory-safety bugs, never weaponizing them.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Read an ASan report

Compile this with `-fsanitize=address -g` and run it:

```c
#include <stdlib.h>
int main(void) {
    int *a = malloc(4 * sizeof(int));
    a[4] = 42;          // one past the end
    free(a);
    return 0;
}
```

**Self-check:**
- [ ] I can find the words `heap-buffer-overflow` and `WRITE of size 4` in the report.
- [ ] I can read the "allocated by thread" stack and the "freed by" stack.
- [ ] I can explain ASan's *redzone*: why writing one element past the array is caught at all.

<details><summary>Hint</summary>

ASan brackets every allocation with poisoned redzones in shadow memory; any access
that lands in a redzone is reported. That's spatial safety, bolted on at runtime.
</details>

### Task 2 — The three temporal bugs

Write three tiny programs that each trigger exactly one of: **use-after-free**,
**double-free**, **uninitialized read** (the last under MemorySanitizer). Run each
under the matching sanitizer.

**Self-check:**
- [ ] Each report names the bug class I intended.
- [ ] I can state, for each, what undefined behaviour the C standard assigns it.

---

## Core

### Task 3 — Same bug, rejected at compile time

Take the use-after-free from Task 2 and write the equivalent in Rust. Try to make
the borrow checker *let* you use the value after it's dropped.

**Self-check:**
- [ ] The Rust compiler refuses, citing a lifetime / "borrowed value does not live long enough" / "use of moved value" error.
- [ ] I can explain which Rust rule (ownership move, or aliasing-xor-mutability, or lifetimes) blocked each variant.
- [ ] I can articulate *why* this is a compile-time guarantee with no runtime cost, unlike ASan.

### Task 4 — GC is not full safety

In Go, use `unsafe.Pointer` (or cgo) to step outside the type system and create a
memory bug a pure-Go program could not. Separately, write a Go data race on a map
and run with `-race`.

**Self-check:**
- [ ] I can explain why a GC gives temporal safety for *managed* references but `unsafe`/cgo punches a hole in it.
- [ ] I understand that data races can violate memory safety even in "safe" managed languages.

### Task 5 — Harden a C API

Given a function `void copy_name(char *dst, const char *src)`, redesign its
signature and body to be safe: take a destination size, use a bounded copy,
return whether truncation happened. Then compile the original with
`-D_FORTIFY_SOURCE=2 -O2` and see what it catches.

**Self-check:**
- [ ] My new API makes the buffer size impossible to ignore.
- [ ] I can explain what `_FORTIFY_SOURCE` can and cannot catch (compile-time-known sizes only).

---

## Advanced

### Task 6 — Bounds-check elimination

In Rust or Java, write a hot loop indexing an array. Inspect (via `--emit=asm` /
JIT disassembly) whether the bounds check is present or was hoisted/eliminated.
Then write a version where the optimizer *cannot* prove the bound and observe the
check return.

**Self-check:**
- [ ] I can show one loop with the check eliminated and one without.
- [ ] I can explain how iterators / `for x in slice` help the compiler prove safety.

### Task 7 — A guard-page allocator

Write (or use a configurable hardened allocator like Scudo/GWP-ASan, or a simple
`mmap`+`mprotect` guard page) to place a guard page immediately after an
allocation, so an overflow faults instantly instead of corrupting silently.

**Self-check:**
- [ ] An out-of-bounds write now produces an immediate `SIGSEGV` at the exact offending access.
- [ ] I can explain the space/perf cost and why production allocators sample (GWP-ASan) rather than guarding everything.

### Task 8 — Tagged memory (conceptual)

Read about ARM MTE / CHERI and write a one-page note: how does hardware memory
tagging turn *both* spatial and temporal violations into deterministic faults,
and what does it cost?

**Self-check:**
- [ ] I can explain how a tag mismatch on a freed-then-reused region catches use-after-free.

---

## Capstone

### Task 9 — Classify, fix, verify

Take this deliberately-unsafe snippet (or one your instructor provides):

```c
char* read_record(int* out_len) {
    char buf[16];
    int len;                      // uninitialized
    gets(buf);                    // unbounded read
    char* p = malloc(len);        // wrong size, from garbage
    strcpy(p, buf);
    free(p);
    return p;                     // returns dangling pointer
}
```

1. **Classify** every memory-safety bug class present (there are at least five).
2. **Fix** each one.
3. **Verify** the fixed version is clean under `-fsanitize=address,undefined` with a fuzzing-style range of inputs.

**Self-check:**
- [ ] I found: stack overflow via `gets`, uninitialized read of `len`, wrong-size allocation, missing bounds on `strcpy`, use-after-free / returning freed pointer.
- [ ] My fixed version is clean under ASan+UBSan across short, exact-size, and oversized inputs.
- [ ] I can explain which *language choice* (Rust, a GC'd language) would have prevented each bug for free.

---

## Self-Assessment

You own this topic when you can:

- [ ] Define spatial vs temporal safety and give two bug classes for each.
- [ ] Read an ASan/MSan/UBSan report and name the bug from it.
- [ ] Explain the four safety strategies (unsafe+tooling, GC, ownership/borrowing, ARC) and their costs.
- [ ] Articulate why ~70% of severe C/C++ CVEs are memory-safety and what the industry is doing about it (memory-safe languages, MTE/CHERI, hardened allocators).
