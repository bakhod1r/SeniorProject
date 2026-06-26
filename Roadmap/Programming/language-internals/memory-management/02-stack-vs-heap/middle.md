# Stack vs Heap — Middle Level
> **Topic:** [Stack vs Heap](README.md)
> **Focus:** The machine-level mechanics of frames and allocation, and a quantitative cost model for choosing between them.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [Anatomy of a stack frame](#anatomy-of-a-stack-frame)
  - [Calling conventions](#calling-conventions)
  - [Why stack allocation is one instruction](#why-stack-allocation-is-one-instruction)
  - [Why heap allocation costs more](#why-heap-allocation-costs-more)
  - [Escape analysis](#escape-analysis)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Cost Model](#cost-model)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level "stack vs heap" is a story about lifetime. At the middle level it becomes a story about *machine instructions and cost*. You now need to know what a frame actually contains byte-for-byte, why bumping the stack pointer costs roughly one cycle while a heap allocation can cost dozens to thousands, and how a modern compiler can quietly turn a heap allocation into a stack allocation behind your back.

This is the level where you start reading allocation profiles and asking "why is this on the heap?" — and getting answers from tools instead of guessing.

## Prerequisites

- Junior-level grasp: stack = call frames, heap = arbitrary-lifetime data, lifetime is the deciding factor.
- Comfort reading a little pseudo-assembly (`push`, `pop`, register names).
- You know what a CPU **register** and a **cache line** are, at least roughly.
- You can run a compiler with flags (e.g., `go build -gcflags=-m`, `gcc -O2 -S`).

## Glossary

- **Frame pointer (FP / RBP):** A register pointing at a fixed spot in the current frame, used as a stable base to address locals and parameters.
- **Stack pointer (SP / RSP):** Points at the current top of the stack.
- **Return address:** The instruction address to resume at after the callee returns. Pushed by the `call` instruction.
- **Calling convention (ABI):** The agreed rules for how arguments are passed, who saves which registers, and how results are returned.
- **Prologue / epilogue:** The instructions at a function's start/end that set up and tear down its frame.
- **Bump allocation:** Allocating by simply advancing a pointer past the requested size.
- **Free list:** A data structure tracking reusable freed heap blocks, grouped by size.
- **Escape analysis:** A compiler pass that decides whether a value can stay on the stack or must move ("escape") to the heap.
- **Size class:** A bucket of allocation sizes (e.g., 16, 32, 48 bytes) used by modern allocators to avoid per-request bookkeeping.

## Core Concepts

### Anatomy of a stack frame

When a function runs, its frame on x86-64 typically looks like this (addresses increasing upward, stack growing downward):

```
higher addresses
┌─────────────────────────────┐
│  caller's frame …           │
├─────────────────────────────┤
│  argument 8, 9, … (if any)  │  ← extra args spilled to stack
│  return address             │  ← pushed by `call`
│  saved RBP (caller's FP)    │  ← pushed by prologue
├─────────────────────────────┤ ← RBP points here
│  local variable a           │
│  local variable b           │
│  saved callee-saved regs    │
│  spilled temporaries        │
├─────────────────────────────┤ ← RSP points here (top)
│  (red zone, 128 bytes)      │  ← scratch below RSP on System V
└─────────────────────────────┘
lower addresses
```

The first several arguments are passed in **registers** (on System V x86-64: RDI, RSI, RDX, RCX, R8, R9 for integers/pointers; XMM0–XMM7 for floats). Only when you run out of registers do arguments spill onto the stack. So a typical small call touches the stack mostly for the return address and a few locals.

A function's **prologue** and **epilogue** manage the frame:

```asm
push rbp          ; save caller's frame pointer
mov  rbp, rsp     ; establish our frame pointer
sub  rsp, 32      ; reserve 32 bytes for locals  ← THE allocation
...               ; function body
leave             ; mov rsp, rbp ; pop rbp  (tear down)
ret               ; pop return address, jump to it
```

That single `sub rsp, 32` *is* the allocation of every local in the function at once. With frame-pointer omission (`-fomit-frame-pointer`, on by default at `-O2`), even the `push rbp`/`mov rbp,rsp` pair disappears and locals are addressed off RSP directly.

### Calling conventions

A calling convention (part of the platform **ABI**) pins down the contract between caller and callee so code compiled separately can interoperate:

- **Argument passing:** which registers, in what order, and how the rest spill to the stack.
- **Return values:** where results go (RAX/RDX for integers, XMM0 for floats; large structs returned via a hidden pointer).
- **Caller-saved vs callee-saved registers:** the callee may freely clobber caller-saved registers (RAX, RCX, RDX, RSI, RDI, R8–R11); it must preserve callee-saved ones (RBX, RBP, R12–R15) by saving and restoring them in its frame.
- **Stack alignment:** System V requires RSP to be 16-byte aligned at each `call`. Violating it crashes SSE code.

Go does *not* use the C ABI; it has its own register-based convention (since Go 1.17) and its goroutine stacks differ fundamentally, which matters when you call into C via cgo and pay a transition cost.

### Why stack allocation is one instruction

Reserving stack space is `sub rsp, N`. Releasing it is `leave` (or `add rsp, N`). There is:

- **No search** for a suitable block.
- **No metadata** written per object.
- **No free list** to update.
- **No synchronization** — the stack is thread-private.

And it is **cache-hot**: the top of the stack was touched on the previous call and is almost certainly already in L1. Bumping the pointer and writing a local is among the cheapest things a CPU does — call it ~1 cycle of overhead.

### Why heap allocation costs more

A heap allocator (`malloc`, Go's `mallocgc`, the JVM's TLAB path) must do real work:

1. **Round the request up to a size class** (e.g., a 20-byte request becomes a 32-byte slot).
2. **Find a free slot** of that class — pop from a per-thread/per-CPU free list in the fast path.
3. **Update bookkeeping** so the slot is marked used.
4. On the **slow path**, when the local cache is empty, grab a fresh run of memory from a central pool, possibly under a lock, possibly via an `mmap`/`sbrk` syscall to the OS.
5. For GC'd heaps, **record the object** for the collector (write barriers, span metadata), and later the GC must *scan and reclaim* it — a cost paid at collection time, not allocation time.

The fast path of a good allocator is tens of instructions — still ~10–100× a stack bump. The slow path (syscall, lock contention, GC trigger) can be thousands of cycles. And freeing is its own cost: returning a block to a free list, or, for GC, the mark/sweep work that scales with live-object count.

There is also a *second-order* cost: heap objects are scattered across address space, so chasing pointers between them causes **cache misses** (a miss to DRAM is ~100+ ns, ~hundreds of cycles). Stack data is dense and hot; heap data is sparse and cold.

### Escape analysis

Managed and systems compilers run **escape analysis**: a static pass that asks "could a reference to this value outlive the current function?" If the answer is provably *no*, the value can be stack-allocated even if you wrote it like a heap object.

A value **escapes** when:

- Its address is returned to the caller.
- It is stored into something that outlives the function (a global, a heap object, a channel).
- It is captured by a closure that escapes.
- It is passed to a function the compiler cannot see through (an interface method, an indirect call), so the compiler must assume the worst.

In Go, `go build -gcflags=-m` prints these decisions. In the JVM, escape analysis enables **scalar replacement** (exploding an object into its fields, held in registers — no allocation at all) and lock elision. Escape analysis is *conservative*: if it cannot prove safety, it heap-allocates. So the way you write code (returning pointers, using interfaces) directly changes where data lands.

## Mental Models

- **The stack pointer is a high-water mark.** Allocation lowers it; deallocation raises it. The "freed" memory is not zeroed — it is simply abandoned and overwritten by the next call. This is why uninitialized locals contain garbage.
- **Heap allocation is a transaction; stack allocation is a register write.** One involves a bookkeeper (the allocator); the other does not.
- **Escape analysis is the compiler doing your lifetime reasoning for you.** When you "shouldn't" allocate but can't prove it, the compiler can — or can't, and then you pay.

## Code Examples

### Go — seeing escape analysis decisions

```go
package main

type Point struct{ X, Y int }

//go:noinline
func stackPoint() int {
    p := Point{1, 2} // does NOT escape — stays on the stack
    return p.X + p.Y
}

//go:noinline
func heapPoint() *Point {
    p := Point{3, 4} // escapes — address returned
    return &p
}

func main() {
    _ = stackPoint()
    _ = heapPoint()
}
```

```
$ go build -gcflags='-m' ./...
./main.go:12:2: moved to heap: p
./main.go:6:2: p does not escape
```

The compiler tells you in plain words: `heapPoint`'s `p` is `moved to heap`; `stackPoint`'s is not.

### C — explicit stack vs heap

```c
#include <stdlib.h>
#include <string.h>

// stack: lifetime ends at return; cheap; cannot be returned
void process_local(void) {
    char buf[256];          // sub rsp, 256 — basically free
    memset(buf, 0, sizeof buf);
}

// heap: lifetime controlled by caller; costs an allocator round-trip
char *make_buffer(size_t n) {
    char *buf = malloc(n);  // allocator finds a slot, bookkeeps
    if (buf) memset(buf, 0, n);
    return buf;             // safe: heap data outlives the function
    // caller MUST free(buf)
}
```

### Java — escape analysis and scalar replacement

```java
// With -XX:+DoEscapeAnalysis (default in HotSpot), this allocation
// is often eliminated entirely: the Point's fields become locals/registers.
static long sumDistances(int n) {
    long total = 0;
    for (int i = 0; i < n; i++) {
        Point p = new Point(i, i);  // "new" — but may never hit the heap
        total += p.x + p.y;          // p doesn't escape the loop body
    }
    return total;
}
```

Here `new Point(...)` reads as a heap allocation, but because `p` never escapes, HotSpot's JIT can apply **scalar replacement** and allocate nothing — a striking example of "the source says heap, the machine says stack (or registers)."

## Cost Model

Rough orders of magnitude on a modern x86-64 core (your mileage varies):

| Operation | Approx. cost | Why |
|---|---|---|
| Stack allocation (reserve N bytes) | ~1 cycle | `sub rsp, N`; cache-hot |
| Heap alloc, fast path (TLAB / per-P cache) | ~20–100 cycles | size-class lookup, free-list pop |
| Heap alloc, slow path (refill / syscall) | ~1,000–10,000+ cycles | central pool, lock, `mmap`/`sbrk` |
| Access to cache-hot stack data | ~1–4 cycles (L1) | dense, recently touched |
| Access to cache-cold heap data | ~100–300 cycles | likely DRAM miss |
| GC scan per live object | small but cumulative | paid at collection, scales with live set |

The practical takeaway: a tight loop that heap-allocates per iteration can be 10–100× slower than one that doesn't — not because the *allocation* is huge, but because of allocation *plus* cache misses *plus* the GC pressure it creates downstream.

## Pros & Cons

**Stack**

- Pros: ~1-cycle alloc/free; automatic, leak-proof cleanup; cache-hot; no fragmentation; lock-free (thread-private).
- Cons: bounded size; scope-bound lifetime; cannot return references to locals (in unmanaged languages); large locals risk overflow.

**Heap**

- Pros: arbitrary lifetime and sharing; large objects; dynamically sized structures.
- Cons: alloc/free cost; allocator metadata and contention; fragmentation; GC pressure or manual-free bugs; cache-cold access.

## Use Cases

- **Stack:** hot-loop temporaries, small fixed structs, function parameters, recursion state of bounded depth.
- **Heap:** returned objects, runtime-sized buffers and collections, shared state across goroutines/threads, anything large enough to threaten the stack limit.

## Coding Patterns

- **Pre-allocate and reuse** heap buffers outside hot loops instead of allocating per iteration (e.g., a reused `[]byte` or a `sync.Pool` in Go).
- **Pass small structs by value** to keep them on the stack; pass large ones by pointer — but know that taking the address may cause an escape.
- **Avoid interface boxing in hot paths.** Storing a concrete value in an interface (Go) or autoboxing a primitive (Java) forces a heap allocation.
- **Read the escape report before micro-optimizing.** Let the tool, not intuition, tell you what escapes.

## Best Practices

- Measure allocations, don't guess: `go test -bench -benchmem`, `pprof` alloc profiles, JFR/async-profiler for the JVM.
- Keep frames modest; move large buffers to the heap so you don't overflow the stack.
- In C, document ownership: every function that returns heap memory should state who frees it.
- Treat per-iteration heap allocation in a hot loop as a smell worth profiling.

## Edge Cases & Pitfalls

- **Surprise escapes:** taking `&local`, capturing a variable in an escaping closure, or putting a value in an `interface{}` can silently move it to the heap. The escape report is the ground truth.
- **Stack overflow from large locals:** `int big[1<<20]` on the stack (4 MB) blows past typical limits instantly.
- **Frame-pointer omission breaks naive stack walkers:** profilers may need `-fno-omit-frame-pointer` or DWARF unwinding to produce correct stacks.
- **Misreading "new" as always-heap:** with escape analysis, `new`/`make` may allocate nothing. The source is not the final word; the compiler is.

## Summary

- A **stack frame** holds a call's return address, saved frame pointer, saved registers, and locals; the prologue's `sub rsp, N` allocates them all in one instruction.
- **Calling conventions** dictate register usage, caller/callee-saved registers, and stack alignment — the contract that lets separately compiled code interoperate.
- **Stack allocation is ~1 cycle** and cache-hot; **heap allocation** costs tens of cycles on the fast path, thousands on the slow path, plus cache-miss and GC costs downstream.
- **Escape analysis** lets compilers stack-allocate values you wrote as heap objects (and JVM **scalar replacement** can eliminate the allocation entirely). The way you write code — returning pointers, using interfaces, capturing in closures — determines what escapes.
- Profile allocations; never optimize stack-vs-heap from intuition alone.
