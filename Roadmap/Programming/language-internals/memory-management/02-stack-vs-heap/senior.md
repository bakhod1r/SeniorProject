# Stack vs Heap — Senior Level
> **Topic:** [Stack vs Heap](README.md)
> **Focus:** Cross-language design trade-offs, what each language's model buys and costs you, and how to architect for allocation.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [Where things live, language by language](#where-things-live-language-by-language)
  - [Value vs reference semantics](#value-vs-reference-semantics)
  - [Boxing and the cost of indirection](#boxing-and-the-cost-of-indirection)
  - [Growable stacks: goroutines and green threads](#growable-stacks-goroutines-and-green-threads)
  - [Fragmentation is a heap-only problem](#fragmentation-is-a-heap-only-problem)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Design Trade-offs](#design-trade-offs)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

A senior engineer does not ask "stack or heap?" in isolation; they ask "what does *this language's* allocation model commit me to, and how do I design around it?" Rust's borrow checker, Go's escape analysis, Java's everything-is-a-reference object model, and Python's everything-is-a-heap-object model are four very different answers to the same question, each with a coherent set of trade-offs.

This level is about reading those trade-offs fluently: knowing why a Go API that returns `*Foo` generates GC pressure, why a Rust `Vec<T>` is a three-word stack value pointing at heap data, why Java can't put an `ArrayList<Integer>` on the stack, and why a goroutine can start with a 2 KB stack while a C thread needs megabytes.

## Prerequisites

- Middle-level mastery: frame anatomy, the alloc cost model, and escape analysis.
- Working knowledge of at least two of: Go, C/C++, Rust, Java.
- Familiarity with garbage collection at a conceptual level (mark/sweep, generations).
- You have read an escape report and a heap profile before.

## Glossary

- **Value semantics:** assignment/passing copies the data itself.
- **Reference semantics:** assignment/passing copies a reference; both names see the same object.
- **Boxing:** wrapping a value type in a heap-allocated object so it can be treated as a reference (e.g., `int` → `Integer`).
- **Scalar replacement:** a JIT optimization that decomposes a non-escaping object into register-resident fields, eliminating the allocation.
- **Move semantics (Rust):** transferring ownership of a value without copying its heap backing.
- **Stack copying / stack growth:** runtime relocation or extension of a thread/coroutine stack when it runs low.
- **Internal fragmentation:** wasted space inside an allocated block (rounding to a size class).
- **External fragmentation:** free memory exists but is split into chunks too small to satisfy a request.
- **Arena / region allocation:** allocating many objects in one block and freeing them all at once.

## Core Concepts

### Where things live, language by language

| Language | Default location | Heap is reached via | Who decides | Safety net |
|---|---|---|---|---|
| **C** | programmer's choice | `malloc`/`calloc` | you, explicitly | none — UB on misuse |
| **C++** | automatic (stack) storage | `new`, containers, smart pointers | you, but RAII automates freeing | destructors, smart pointers |
| **Rust** | stack by default | `Box`, `Rc`, `Arc`, `Vec`, `String` | you, but ownership-checked | borrow checker (compile-time) |
| **Go** | escape analysis decides | implicit (`new`, `make`, `&T{}`, closures) | the compiler | GC + escape analysis |
| **Java** | primitives/refs on stack, objects on heap | every `new` | the JVM (with EA/scalar replacement) | GC |
| **Python** | everything is a heap object | implicit (every object) | the runtime | refcount + cycle GC |

Read across that table and a pattern emerges: as you move from C to Python, you trade *control* for *safety and convenience*, and the cost of allocation moves from "explicit and visible" to "implicit and easy to overlook."

- **C** hands you a scalpel: locals are stack, `malloc` is heap, and there is no automation. Power and footguns in equal measure.
- **C++** keeps C's model but adds **RAII**: a stack object's destructor runs deterministically at scope exit, so `std::vector` (heap-backed) is freed automatically when its owning stack variable dies. Smart pointers (`unique_ptr`, `shared_ptr`) encode ownership in the type.
- **Rust** makes the C++ idea load-bearing and *checked*: values are stack by default, the heap is opt-in (`Box<T>`, `Vec<T>`), and the borrow checker proves at compile time that no reference outlives its referent — eliminating use-after-free and double-free with *zero* runtime cost.
- **Go** removes the decision from you: write `&T{}` and the compiler's escape analysis decides stack vs heap. You get safety like Java but with stack allocation when provably safe.
- **Java** puts primitives and object *references* on the stack but every object's *body* on the heap. EA + scalar replacement can claw some of that back, but the baseline is heap-heavy.
- **Python** abandons the distinction at the language level: integers, strings, lists, everything is a heap object reached through a reference, reclaimed by reference counting plus a cycle collector.

### Value vs reference semantics

This is the lens that explains most "where does it live" questions:

- A **value type** (Go struct, Rust struct, C struct, Java primitive, C++ object) *can* live on the stack and is copied on assignment.
- A **reference type** (Go pointer/slice/map/interface, Java object, Python everything) involves an indirection; the referent typically lives on the heap.

The semantics drive the allocation. In Go, `a := b` where both are `Point` copies 16 bytes on the stack. In Java, `a = b` where both are `Point` copies a *reference*; the single `Point` object stays on the heap. Same syntax, opposite memory behavior — a frequent source of cross-language bugs (e.g., Java engineers surprised that Go structs are copied).

### Boxing and the cost of indirection

**Boxing** is wrapping a value in a heap object so it can be used where a reference is required:

- **Java:** `List<Integer>` cannot hold `int`; each element is a boxed `Integer` object on the heap. A million-element `ArrayList<Integer>` is a million tiny heap objects plus a backing array of references — vastly more memory and cache misses than an `int[]`.
- **Go:** assigning a concrete value to an `interface{}` boxes it (the interface holds a type pointer + a data pointer; non-pointer-sized values get heap-allocated).
- **C#:** the canonical boxing example; `object o = 42;` heap-allocates.

Boxing is where "I'm using a value type" silently becomes "I'm allocating on the heap per element." In hot paths and large collections, the difference is enormous: an `int[1_000_000]` is 4 MB contiguous and cache-friendly; an `ArrayList<Integer>` of the same is ~20+ MB scattered across the heap.

### Growable stacks: goroutines and green threads

A C/POSIX thread has a **fixed** stack, reserved at creation (default often 8 MB on Linux, though mostly lazily committed via guard pages). That is fine for thousands of threads but wasteful for millions of lightweight tasks.

Go's **goroutines** solve this with **growable stacks**:

- A goroutine starts with a tiny stack (~2 KB today).
- A function prologue checks whether the stack has room (a **stack-split / morestack check**). If not, the runtime allocates a **larger contiguous stack**, **copies** the old stack's contents over, fixes up all pointers into the stack, and resumes.
- Stacks can also shrink during GC.

This is why a Go program can run a million goroutines in a few GB, while a million OS threads would need terabytes of reserved address space. The historical first design used **segmented stacks** (linked stack chunks), but that caused a "hot split" performance cliff when a tight loop straddled a segment boundary; Go switched to **contiguous copying stacks** in 1.3. The trade-off: copying a stack requires the runtime to *find and rewrite every pointer that points into the stack*, which is only feasible because Go's runtime has precise knowledge of pointer locations — something C cannot do.

### Fragmentation is a heap-only problem

The stack never fragments. Because it is strictly LIFO, freeing is always "move the pointer back"; there are never holes. The heap, with its arbitrary allocation and free order, develops holes:

- **Internal fragmentation:** a 20-byte request rounded up to a 32-byte size class wastes 12 bytes per object.
- **External fragmentation:** after many alloc/free cycles, free memory is splintered; a 1 MB request fails even though 1 MB total is free, because no single contiguous run is that large.

Allocator and GC design is largely a war against fragmentation: size classes (limit internal frag, eliminate external frag within a class), compacting/copying collectors (move live objects together to defragment), and arena allocators (free everything at once, no per-object holes). None of this exists for the stack — its discipline is its superpower.

## Mental Models

- **The allocation model is a spectrum of who-decides.** C: you. Rust: you, but the compiler checks. Go/Java: the runtime, with hints from how you write code. Python: nobody decides; it's always the heap.
- **Reference types pull data onto the heap.** When you see indirection (pointer, reference, interface, boxed value), assume heap until escape analysis proves otherwise.
- **A growable stack is a heap-backed illusion of an unbounded stack** — the runtime trades pointer-rewriting work for the ability to start tasks cheaply.

## Code Examples

### Rust — stack by default, heap on request

```rust
fn main() {
    let on_stack: [i32; 3] = [1, 2, 3];     // array body lives on the stack
    let boxed: Box<i32> = Box::new(42);      // i32 lives on the heap; box is a stack pointer
    let v: Vec<i32> = vec![1, 2, 3];         // Vec = {ptr, len, cap} on stack; elements on heap

    // ownership move: no deep copy, the heap buffer is transferred
    let v2 = v;          // v is moved out; using v now is a compile error
    println!("{} {} {:?}", on_stack[0], *boxed, v2);
}   // boxed and v2 dropped here: their heap memory freed deterministically, no GC
```

A `Vec<T>` is the cleanest illustration of the split: a 3-word *handle* (pointer, length, capacity) lives on the stack; the element buffer lives on the heap; and `drop` frees the buffer at scope exit with no garbage collector.

### Go — API shape drives allocation

```go
// Returning a pointer forces the value to the heap (it escapes).
func NewBufferPtr() *bytes.Buffer { return &bytes.Buffer{} } // escapes → heap

// Returning by value can keep it on the caller's stack.
func NewBufferVal() bytes.Buffer { return bytes.Buffer{} }   // may stay on stack

// Storing into an interface boxes — heap allocation per call in a hot loop.
func emit(vals []int) []interface{} {
    out := make([]interface{}, len(vals))
    for i, v := range vals {
        out[i] = v // each int boxed onto the heap
    }
    return out
}
```

API design *is* allocation design in Go. A constructor returning `*T` is idiomatic but commits callers to a heap object and GC tracking.

### Java — boxing cost made concrete

```java
// 4 MB, contiguous, cache-friendly
int[] primitives = new int[1_000_000];

// ~20+ MB: a million boxed Integer objects + a reference array,
// scattered across the heap → many more cache misses on iteration.
List<Integer> boxed = new ArrayList<>(1_000_000);
for (int i = 0; i < 1_000_000; i++) boxed.add(i);
```

## Design Trade-offs

- **Control vs safety:** C/Rust give you stack-by-default control; Go/Java/Python trade some control for memory safety and developer speed. Rust uniquely keeps both via compile-time checking — paying in language complexity (the borrow checker learning curve).
- **Determinism vs convenience:** RAII (C++/Rust) frees heap memory at a *deterministic* point (scope exit); GC (Go/Java/Python) frees at an *unpredictable* later time, trading latency spikes and memory headroom for not having to think about it.
- **Cheap tasks vs cheap calls:** Go's growable stacks make a million concurrent tasks cheap but add a per-call stack-check and require a precise runtime; C's fixed stacks make calls maximally cheap but make millions of threads infeasible.
- **Throughput vs footprint:** boxing/heaping everything (Python, Java collections) is simple and uniform but burns memory and cache; value-type-heavy designs (Go structs, Rust) are leaner but demand more care about copying and escapes.

## Pros & Cons

**Designing toward the stack**

- Pros: speed, locality, no GC pressure, deterministic cleanup.
- Cons: lifetime constraints, copy costs for large values, API rigidity (can't freely return references).

**Designing toward the heap**

- Pros: flexible lifetimes and sharing, dynamic sizing, simpler APIs.
- Cons: allocation/GC cost, fragmentation, cache-cold access, more failure modes.

## Use Cases

- **Stack-leaning design:** numeric kernels, hot loops, small value objects (coordinates, IDs), parsers building bounded temporaries.
- **Heap-leaning design:** long-lived caches, graphs and trees with shared nodes, concurrent shared state, anything sized at runtime or returned across API boundaries.

## Coding Patterns

- **Arena / region allocation** for batches with a common lifetime (parse a request, free the whole arena at the end) — sidesteps per-object free cost and fragmentation.
- **Object pools** (`sync.Pool`, JVM object reuse) to amortize allocation in steady-state hot paths.
- **Value-type collections** (`int[]` over `List<Integer>`, slices of structs over slices of pointers) to keep data contiguous and stack/array-friendly.
- **Ownership-encoding types** (Rust `Box`/`Rc`/`Arc`, C++ `unique_ptr`/`shared_ptr`) to make heap lifetimes explicit and checked.

## Best Practices

- Choose return-by-value vs return-by-pointer deliberately in Go; know it sets your callers' allocation behavior.
- In Java, prefer primitive arrays and `IntStream`/specialized collections over boxed generics in hot, large-N code.
- Lean on RAII/ownership (C++/Rust) instead of GC-style "free it later" habits; it gives deterministic, leak-resistant cleanup.
- Profile the *aggregate* allocation rate, not just individual sites — death-by-a-thousand-small-allocs is the common production pattern.

## Edge Cases & Pitfalls

- **Hidden escapes from abstraction:** interfaces, closures, generics-over-references, and reflection routinely force heap allocation that the source doesn't make obvious.
- **Large value copies:** passing a big struct by value (Go/C++/Rust) copies it on every call — sometimes the heap pointer is actually cheaper.
- **`Rc`/`Arc` cycles in Rust** leak memory; the borrow checker does not catch reference cycles (use `Weak`).
- **Goroutine stack thrash:** pathological recursion or alternating call depths can cause repeated grow/shrink copies; rare, but visible in profiles.
- **RAII vs GC mental-model clash:** engineers moving from C++/Rust to Go/Java expect deterministic frees and are surprised by GC latency; the reverse direction surprises with manual lifetime obligations.

## Summary

- Each language encodes a different point on the **control-vs-safety** spectrum: C (manual), C++ (manual + RAII), Rust (stack-default + compile-time ownership), Go (escape analysis + GC), Java (objects-on-heap + GC + EA), Python (everything-on-heap + refcount/cycle GC).
- **Value vs reference semantics** drives where data lives; **boxing** is the trap where value types silently become per-element heap objects, devastating cache behavior for large collections.
- **Growable stacks** (goroutines) make millions of concurrent tasks affordable by trading per-call checks and pointer-rewriting for tiny starting stacks — feasible only with a precise runtime.
- **Fragmentation** is a heap-only problem; the stack's strict LIFO discipline makes it fragmentation-free, which is the root of much of its speed advantage.
- Senior-level allocation design is API design: how you return, share, and abstract data determines your program's stack/heap balance, and therefore its speed, footprint, and GC behavior.
