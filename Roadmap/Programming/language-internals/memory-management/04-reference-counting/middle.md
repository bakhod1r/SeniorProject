# Reference Counting — Middle Level

> **Topic:** [Reference Counting](README.md)
> **Focus:** The mechanics and cost of counting — inline vs side-table, atomic vs non-atomic, weak references, and the cycle collector.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [The Cost Model](#the-cost-model)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level the rule was "increment on share, decrement on drop, free at zero." That rule is correct but it hides almost every interesting engineering decision. This page opens the box:

- **Where** does the count physically live, and why does that matter for performance?
- **What does each count update actually cost** — and why is a thread-safe count an order of magnitude more expensive than a single-threaded one?
- **How do real systems break cycles** so the headline weakness doesn't sink the whole scheme?

If you understand these three things, you understand why `Rc` exists *and* `Arc` exists in Rust, why CPython has both a refcount *and* a separate garbage collector, and why "just add a thread" can quietly destroy the performance of a reference-counted program.

## Prerequisites

- The junior-tier model: increment, decrement, free at zero, and the cycle problem.
- Basic awareness of **CPU caches** — that memory access is fast when data is in cache and slow when it isn't, and that caches work in fixed-size lines.
- Basic awareness of **threads** — multiple execution streams that can touch the same memory at the same time.
- What a **destructor / finalizer** is — code that runs when an object is about to be freed.

## Glossary

- **Inline count** — the refcount stored inside the object's own memory block.
- **Side-table count** — the refcount stored in a separate map keyed by object address.
- **Strong reference** — a reference that *counts*; it keeps the object alive.
- **Weak reference** — a reference that does *not* count; it points at an object without keeping it alive, and becomes `nil`/`None` when the object is freed.
- **Atomic operation** — a read-modify-write that completes indivisibly even under concurrent access, implemented with special CPU instructions and memory barriers.
- **Memory barrier (fence)** — an instruction restricting how the CPU/compiler may reorder memory operations; required for correct atomic counting.
- **Cache-line contention / false sharing** — slowdown when multiple cores fight over the same cache line, e.g. the same refcount.
- **Cycle collector** — an auxiliary garbage collector that finds and frees reference cycles the counter cannot.
- **Finalizer / destructor** — user code run at deallocation (`__del__`, `Drop`, `deinit`, `~T()`).

## Core Concepts

### Inline vs. side-table counts

**Inline** is the default and the fast path. The integer sits in the object header, the few bytes immediately before or at the start of the object's data. Touching the object brings the count into cache "for free," and updating the count is just a load/add/store on memory you were already near.

**Side-table** stores counts in a separate hash-map-like structure indexed by the object's address. You reach for this when:

- You cannot enlarge the object (it has a fixed, externally-defined layout), or
- The count is rarely needed, so paying header space on *every* object is wasteful.

Swift is the textbook example of a hybrid: an object normally uses **inline** bits in its header for the strong count, but if it ever needs weak references or the inline bits overflow, Swift migrates it to a **side table** entry. CPython is pure inline: every `PyObject` begins with an `ob_refcnt` field.

The trade-off: inline is faster and simpler but costs header space on every object and forces all objects to carry a count even if they're never shared; side tables save header space and add indirection but cost a lookup on every count change.

### Strong vs. weak references

A **strong** reference is an ordinary counted one — it keeps the object alive. A **weak** reference points at an object *without* incrementing the count. It says "show me this object *if it still exists*, but don't keep it alive on my account."

This is the standard cure for cycles. In a parent/child tree, the parent owns its children with **strong** references (down the tree), and each child refers back to its parent with a **weak** reference (up the tree). Now the upward links don't contribute to the count, so when the external owner drops the tree, the strong counts collapse to zero and everything frees.

Weak references need bookkeeping: when an object is finally freed, every weak reference to it must be made to report "gone" (`None`, `nil`, or a failed `upgrade()`). Systems implement this either through the side table or through a per-object list of weak referrers.

### Cycle collectors

Weak references are a *manual* fix — they require the programmer to identify the cycle and mark one side weak. When that's impractical (arbitrary object graphs, data-structure libraries), a language can add an **automatic cycle collector**: a tracing garbage collector that runs occasionally, but *only* to find cycles the reference counter can't reclaim.

CPython is the canonical example. Its primary mechanism is reference counting; on top of that sits a **generational cyclic garbage collector** that periodically inspects container objects (those that can hold references — lists, dicts, instances) looking for groups whose references all point *within the group*. It uses a clever trick: temporarily subtract internal references from each object's count; anything still above zero is reachable from outside; anything that hits zero is reachable *only* through the cycle and can be collected.

So CPython is a **hybrid**: refcounting does ~99% of the work promptly, and the cycle collector mops up the cyclic garbage that refcounting structurally cannot.

## Mental Models

- **"The count is hot memory."** Because the count changes on essentially every reference operation, it is among the most frequently written memory in the program. Anything that makes writing it expensive — atomics, cache contention — taxes the whole program.
- **"Weak = look but don't hold."** A weak reference is a question ("are you still there?"), not a claim ("you belong to me").
- **"Refcounting and tracing GC are not rivals; they're roles."** Refcounting handles the common, acyclic, prompt case; a tracing collector handles cycles. CPython runs both, by design.
- **"Each thread that shares an object turns a cheap counter into an expensive one."** The moment a counted object can be touched concurrently, every increment must become atomic.

## Code Examples

### Rust: `Rc` (non-atomic) vs `Arc` (atomic), and `Weak` for cycles

```rust
use std::rc::{Rc, Weak};
use std::cell::RefCell;

// Rc<T>: single-threaded, non-atomic refcount — cheap.
let a = Rc::new(5);
let b = Rc::clone(&a);              // strong_count = 2, just a normal +1
println!("{}", Rc::strong_count(&a)); // 2
drop(b);                            // strong_count = 1
// a dropped at end of scope -> count 0 -> freed

// Breaking a parent/child cycle with Weak:
struct Node {
    parent: RefCell<Weak<Node>>,    // weak: does NOT keep parent alive
    children: RefCell<Vec<Rc<Node>>>, // strong: parent owns children
}
```

`Arc<T>` has the same API but uses **atomic** increments/decrements so it can be shared across threads — and pays for it (see the cost model).

### Python: refcount + the cyclic collector

```python
import gc

class Node:
    def __init__(self):
        self.ref = None

a, b = Node(), Node()
a.ref = b
b.ref = a          # cycle
del a, b           # refcounts stay at 1 each — NOT freed by refcounting

gc.collect()       # the cyclic collector reclaims the cycle
```

You can even *watch* the cycle collector make decisions with `gc.get_objects()` and `gc.garbage`.

### Swift: ARC inserts retain/release; `weak`/`unowned` break cycles

```swift
class Person { var card: Card? }
class Card { weak var owner: Person? }   // weak avoids a Person<->Card cycle

// The compiler inserts retain() when a strong reference is created
// and release() when it ends. You write none of it by hand.
```

### C++: `shared_ptr` (counted) and `weak_ptr` (non-owning)

```cpp
#include <memory>
auto sp = std::make_shared<int>(42);   // strong count = 1
auto sp2 = sp;                         // atomic increment -> 2
std::weak_ptr<int> wp = sp;            // does not change strong count
if (auto locked = wp.lock()) { /* still alive */ }  // upgrade to shared_ptr
```

## The Cost Model

This is the heart of the middle tier. **Every reference assignment touches a count.** Whether that is cheap or ruinous depends on one question: *can the object be shared across threads?*

### Non-atomic counting (cheap)

If the object is confined to one thread — Rust's `Rc`, CPython under the Global Interpreter Lock (GIL) — the count is an ordinary integer. Incrementing is a plain `add`. The CPU can keep the count in cache, reorder freely, and never coordinate with other cores. Cost: a few cycles, often hidden by other work.

### Atomic counting (expensive)

If the object *can* be touched by multiple threads — Rust's `Arc`, C++ `shared_ptr`, Swift, Objective-C — every increment and decrement must be **atomic**, so two threads adjusting the count simultaneously don't corrupt it or double-free. Atomic operations are far costlier because:

1. **They use special instructions** (`lock`-prefixed on x86, `ldxr`/`stxr` loops on ARM) that are slower than a plain add.
2. **They impose memory barriers**, limiting the reordering the CPU loves to do for speed.
3. **They cause cache-line contention.** When several cores increment the *same* count, the cache line holding it ping-pongs between cores' caches. Each core must take exclusive ownership of the line to write, invalidating the others. A hot shared object can become a serialization point even if the threads aren't logically contending on anything but the bookkeeping.

A rough mental figure: a non-atomic increment can be effectively free; a contended atomic one can cost tens to hundreds of cycles. That gap is *the* reason languages offer two flavors (`Rc`/`Arc`, single-threaded vs free-threaded Python).

### Why this shapes language design

- Rust forces you to choose `Rc` (no thread-sharing, cheap) or `Arc` (thread-sharing, atomic) at the type level — you pay for atomicity only when you ask for it.
- CPython historically used a **non-atomic** count and protected it with the GIL, which lets only one thread run Python at a time. That makes counting cheap but means Python cannot run threads in parallel — and it's a major reason free-threaded ("no-GIL") Python is hard: removing the GIL means making millions of refcount updates atomic or otherwise thread-safe, which is slow.

## Pros & Cons

**Pros**

- Prompt, deterministic deallocation; finalizers run right at last use.
- Memory pressure smoothed out over time instead of in pause spikes.
- Weak references give a precise, programmer-controlled tool for breaking cycles.

**Cons**

- A per-reference cost that scales with how often you assign references.
- Atomic counting under threading is dramatically more expensive than non-atomic.
- Cycles need either manual weak references or an entire auxiliary collector.
- Header space (inline) or lookup overhead (side table) on every object.

## Use Cases

- **Single-threaded, latency-sensitive code** where pauses are unacceptable and cycles are rare or easily made weak: `Rc`, single-threaded Python, UI object graphs.
- **Shared ownership across threads**: `Arc`, `shared_ptr` — accept the atomic cost for the convenience of "anyone can hold it, last holder frees it."
- **Resource handles** where the destructor must run promptly (closing files, flushing buffers).

## Coding Patterns

- **Strong down, weak up.** Owners hold children strongly; back-references (child→parent, observer→subject) are weak. This is the universal cycle-avoidance pattern.
- **Upgrade-and-check.** A weak reference must be *upgraded* to a strong one before use (`Weak::upgrade`, `weak_ptr::lock`), and the upgrade can fail if the object is gone. Always handle the "gone" branch.
- **Prefer non-atomic when single-threaded.** Reach for `Arc`/`shared_ptr` only when you genuinely share across threads; default to `Rc`/single-thread ownership otherwise.

## Best Practices

- **Choose atomicity deliberately.** Don't reach for the thread-safe pointer "to be safe" — you pay on every operation. Use the cheap one until you actually cross a thread boundary.
- **Make exactly one side of a cycle weak.** Decide which object *owns* which; the non-owning back-link is weak.
- **Don't fight the cycle collector — feed it.** In Python, let `gc` handle incidental cycles; only intervene (weakrefs, `__del__` care) where cycles are frequent or finalization order matters.
- **Keep hot shared counts off the fast path.** If a single `Arc` is cloned by many threads in a tight loop, that count is a contention hotspot — consider passing references instead of cloning.

## Edge Cases & Pitfalls

- **Finalizer ordering and resurrection.** A destructor running at count-zero can create a new reference to the dying object ("resurrection"), or rely on other objects already freed. CPython's `__del__` and C++ destructors both have subtle rules here.
- **Deep recursive frees.** Freeing the head of a long linked list drops its count, which frees the next node, which frees the next... potentially a deep recursion that can overflow the stack. Real implementations sometimes flatten this into a loop.
- **Weak reference without strong owner.** If you hold only weak references to an object, it's freed immediately — the weak reference was never going to keep it alive.
- **Atomic count, non-atomic data.** The count being thread-safe does *not* make the *contents* thread-safe. `Arc<T>` shares ownership safely but you still need a lock (`Mutex`) or atomics to mutate `T` concurrently.
- **GIL false comfort.** Python's per-object refcount is safe only because the GIL serializes bytecode. Code that assumes "Python refcounting is thread-safe" breaks under free-threaded builds.

## Summary

- The count can live **inline** (fast, costs header space — CPython, default Swift) or in a **side table** (indirection, saves space — Swift weak/overflow case).
- **Weak references** point without counting; making one side of a relationship weak is the standard manual cure for cycles.
- A **cycle collector** (CPython's generational cyclic GC) is the automatic cure, complementing refcounting rather than replacing it.
- **Cost is dominated by atomicity.** Non-atomic counts (`Rc`, GIL-protected CPython) are nearly free; **atomic** counts (`Arc`, `shared_ptr`, Swift, Obj-C) are far costlier due to special instructions, memory barriers, and cache-line contention.
- These costs explain real design choices: Rust's `Rc`/`Arc` split, the GIL, and the difficulty of free-threaded Python.
