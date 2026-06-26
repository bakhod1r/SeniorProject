# Memory Safety — Senior Level

> **Topic:** [Memory Safety](README.md)
> **Focus:** Language-design strategies for safety, what the guarantees precisely do and don't cover, and the formal notions (soundness, the `unsafe` contract) that make those guarantees meaningful.

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
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

A senior engineer doesn't just *use* a memory-safe language — they can reason about *what the safety guarantee actually is*, where its edges are, and what it costs. "Memory-safe" is a precise claim about the language's *safe subset*, not a vague reassurance. This tier examines the design space: how different languages draw the safety boundary, what soundness means, why Rust's affine type system buys safety without a GC, and the uncomfortable truths (safe Rust can still deadlock, leak, and panic; safety guarantees end at the FFI boundary; data races break Go's safety).

The goal is to be able to answer, for any language: *"Exactly which guarantee does this give me, under what assumptions, and at what cost?"*

---

## Prerequisites

- Middle-tier mechanisms: violation categories, ASan internals, the `unsafe` boundary.
- Familiarity with at least two of: Rust ownership, Java/Go runtime semantics, C/C++ object lifetimes.
- Comfort with type-system vocabulary (substructural types, lifetimes, variance) at a conceptual level.
- Understanding of compilation vs. runtime enforcement trade-offs.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Safe subset** | The portion of a language whose programs are guaranteed memory-safe. |
| **Affine / substructural type** | A type whose values can be used *at most once* (basis of move semantics / ownership). |
| **Lifetime** | A compile-time region during which a borrow/reference is guaranteed valid. |
| **Soundness (of a type system)** | "Well-typed programs don't go wrong" — accepted programs cannot violate the property. |
| **Aliasing XOR mutability** | The rule: a value may be aliased *or* mutated, never both simultaneously. |
| **Memory model** | The spec defining which inter-thread memory behaviors are allowed/defined. |
| **Provenance** | The notion that a pointer "comes from" a specific allocation and may only access it. |
| **Tagged / capability memory** | Hardware that attaches metadata (bounds, validity) to pointers (MTE, CHERI). |
| **Total memory safety** | Spatial + temporal + type + initialization (+ sometimes thread) safety together. |

---

## Core Concepts

### Decomposing "memory safety" into its guarantees

"Memory-safe" is shorthand for a conjunction of properties; a serious analysis names them separately:

1. **Spatial safety** — accesses stay within an object's bounds (provenance + bounds).
2. **Temporal safety** — accesses occur within an object's lifetime (no UAF/dangling).
3. **Type safety** — bytes are only interpreted as their actual type (no type confusion).
4. **Initialization safety** — no reads of uninitialized memory.
5. **Thread safety / data-race freedom** — sometimes folded in, because races can break the others.

Different languages cover different subsets:
- **Java/C#/Python/JS:** 1–4 in safe code; thread safety is *not* guaranteed (you can have races, though the managed runtime keeps individual references atomic, so races usually corrupt logic, not the heap).
- **Go:** 1–4 in race-free code, but a data race can break 1 and 2 (torn slice/interface headers). So Go's safety is *conditional on race-freedom*.
- **Rust (safe subset):** 1–5. Data-race freedom is a *first-class* guarantee enforced by the same ownership rules that give temporal safety.
- **C/C++:** none guaranteed by the language.

This decomposition is the senior's lens: when someone says "X is memory-safe," ask *which of the five, under what assumptions.*

### How the GC family enforces safety — and what it costs

Managed runtimes enforce spatial safety with **bounds checks** (sometimes elided by the JIT when it can prove the index is in range — bounds-check elimination), temporal safety with **tracing GC** (an object is freed only when unreachable, so no live reference can dangle), and type safety with **checked casts** and a verified bytecode/type system.

The costs are structural, not incidental:
- **Throughput/latency:** GC consumes CPU; collection introduces pauses (mitigated by concurrent/low-latency collectors like ZGC, Shenandoah, Go's collector, but never eliminated).
- **Memory headroom:** tracing GCs need slack (often 2–5x live-set) to amortize collection cost.
- **No deterministic destruction:** you can't rely on memory being reclaimed at a precise point, which complicates resource management (hence `try-with-resources`, `defer`, `using`).
- **Bounds checks** add per-access overhead the JIT can only sometimes remove.

These costs are why GC is unacceptable for some domains (hard real-time, kernels, tiny embedded) — and why Rust matters.

### Rust: total memory safety without a GC

Rust's central design bet: enforce temporal safety **statically** using an *affine* (substructural) type discipline, so you need neither a GC nor per-access lifetime checks.

- **Ownership (affine types):** a value has one owner; moving it invalidates the source. When the owner's scope ends, the value is dropped deterministically (RAII). This gives temporal safety *and* deterministic destruction.
- **Borrowing + lifetimes:** references carry *lifetimes* — compile-time regions during which they're valid. The borrow checker proves no reference outlives its referent. No dangling, ever, in safe code.
- **Aliasing XOR mutability:** `&T` (shared, many, read-only) versus `&mut T` (unique, one, writable), never overlapping. This single invariant simultaneously yields temporal safety *and* data-race freedom — a race requires aliased mutation, which the rule forbids.
- **`Send`/`Sync` marker traits** lift this to threads: the type system tracks which types may cross thread boundaries or be shared, making data races a *compile error* for safe code.

The price: the borrow checker is *conservative* — it rejects some sound programs it can't prove safe (the classic example is certain self-referential or graph structures), pushing you toward `Rc`/`RefCell` (runtime checks), arena allocators, or `unsafe`. The learning curve is real and is a legitimate engineering cost.

### Soundness and the `unsafe` contract — precisely

A type system is **sound** if every program it accepts satisfies the safety property — "well-typed programs don't go wrong." Rust's *safe* subset is designed to be sound: if your program contains no `unsafe` and it compiles, it is memory-safe (modulo compiler bugs).

`unsafe` doesn't disable the type system; it *adds* a handful of capabilities (dereference raw pointers, call `unsafe` functions, access `union` fields, implement `unsafe` traits) and shifts a *proof obligation* onto the author. The contract is subtle and important:

- **`unsafe` code must uphold the invariants that *safe* code relies on.** A function with a safe signature must be sound *for all inputs* — you cannot publish a safe API that can be driven into UB by safe callers. This is "soundness encapsulation."
- **The blast radius is not the block.** Because safe code trusts the invariants, a bug in an `unsafe` block can manifest as corruption far away, in code that contains no `unsafe`. This is why "it's only 3 lines of `unsafe`" is not reassuring on its own.

This same structure exists wherever there's an escape hatch: `sun.misc.Unsafe`, C interop, `reinterpret_cast`. The senior skill is recognizing that *the soundness of the whole program rests on the correctness of its unsafe islands.*

### The FFI / boundary problem

Every safety guarantee is relative to a *trusted computing base*. The moment safe code calls into C via FFI, the guarantee is suspended for that call and for any memory the C side touches. A safe-looking Rust/Java wrapper around a C library is only as safe as (a) the C library and (b) the correctness of the marshalling at the boundary. This is why "rewrite in a safe language" often means *rewrite the C*, not just wrap it — wrapping moves the bug, it doesn't remove it.

### What safety does NOT cover

A precise senior must state the negatives:
- **Memory leaks are safe.** Leaking is not a memory-safety violation — `Rc` cycles in Rust, lingering references in Java, `mem::forget` all leak without UB. (`std::mem::forget` is even a *safe* function.)
- **Deadlocks are safe.** No memory rule prevents two threads waiting on each other.
- **Panics/exceptions are safe.** A panic is the *defined* behavior on a bounds violation — that's the safety mechanism working, not failing.
- **Logic bugs are safe.** Computing the wrong answer is not a memory-safety issue.
- **Data races are safe in Rust's safe subset only because they're prevented;** in Go they're *possible* and can break safety. Different languages, different lines.

Confusing "safe" with "correct" or "robust" is a category error. Memory safety eliminates a *specific, severe, exploitable* class — nothing more, but that's plenty.

---

## Real-World Analogies

- **The safe subset = a fenced playground.** Inside the fence, the rules guarantee no one falls off the cliff. `unsafe` is a gate to the cliffside path — sometimes you must take it, and whoever opens it is responsible for not falling *and* for not leaving the gate open so the children inside wander out.

- **Soundness = a bank's accounting invariant.** "Money is never created or destroyed by a transfer." Every *safe* operation preserves it. An `unsafe` operation is a manual ledger entry: if the teller gets it wrong, the books are corrupt even though every automated transaction afterward was "correct."

- **Affine types = a single physical key.** Ownership means there's exactly one key to the house. Hand it to someone (move) and you no longer have it. You can lend copies that only open the door for reading (shared borrows) *or* lend the single master that lets you remodel (mutable borrow) — never both at once.

- **GC vs. ownership = janitor vs. checkout discipline.** GC is a janitor who periodically sweeps unreachable trash (works, but on its own schedule). Ownership is a checkout policy where you clean your room the instant you leave — deterministic, no janitor needed, but you must follow the policy strictly.

---

## Mental Models

**Model 1: Safety is a property of a *subset*, with a *boundary*.** Always identify the safe subset and its boundary (`unsafe`, FFI, races). The guarantee is "no UB *as long as you stay in the subset and the islands are correct*."

**Model 2: Move the cost, don't remove it.** GC pays at runtime; Rust pays at compile-time and in cognitive load; sanitizers pay in test-time slowdown. There's no free safety — choose *where* you want to pay.

**Model 3: Safety guarantees compose like a chain.** A safe app over a safe stdlib over a sound compiler over correct `unsafe` over a trusted C FFI — the whole is only as safe as its weakest link. Audit the links, especially the human-verified ones.

**Model 4: Aliasing XOR mutability is the keystone.** It's astonishing how much falls out of one rule: temporal safety, data-race freedom, and even some optimization freedoms (the compiler can assume `&mut` is unique). Recognizing this rule clarifies most of Rust's design.

---

## Code Examples

### The same logic, three safety philosophies

```java
// Java — GC + bounds checks. Temporal safety via reachability; you never free.
int[] a = new int[10];
a[3] = 7;          // bounds-checked at runtime
// object freed by GC only when unreachable — no dangling possible
```

```rust
// Rust — ownership. Deterministic drop, no GC, compile-time temporal safety.
fn demo() {
    let mut a = vec![0; 10];
    a[3] = 7;                 // bounds-checked; out-of-range -> panic (still safe)
}   // `a` dropped here, deterministically; no reference can outlive this scope
```

```c
// C — neither. The programmer is the only safety mechanism.
int *a = malloc(10 * sizeof(int));
a[3] = 7;          // no bounds check
free(a);
// a is now dangling; any further *a is UB
```

### A *sound* safe API wrapping an `unsafe` core

```rust
/// Returns the element at `i`, or None. SAFE signature: cannot be driven to UB.
pub fn get_checked(v: &[i32], i: usize) -> Option<i32> {
    if i < v.len() {
        // SAFETY: bounds verified immediately above; index is in range.
        Some(unsafe { *v.get_unchecked(i) })
    } else {
        None
    }
}
```

The `unsafe` is encapsulated: every safe caller is fine *for all inputs*. That is what "sound" means in practice.

### A subtle unsoundness — the lesson, not the exploit

```rust
// ANTI-PATTERN (conceptual): a function with a SAFE signature that can be
// driven to UB by a safe caller. This is the cardinal sin.
pub fn bad_get(v: &[i32], i: usize) -> i32 {
    unsafe { *v.get_unchecked(i) }   // UNSOUND: caller can pass i out of range
}
// Because the signature is safe, *safe* code anywhere can now cause UB.
// The fix is the bounds check shown above. Soundness lives at the API boundary.
```

### Leaking is safe — the negative case

```rust
let data = Box::new([0u8; 1024]);
std::mem::forget(data);   // leaks 1KB. This is a SAFE function. Not a safety bug.
```

---

## Pros & Cons

**Static ownership (Rust):**
- ✅ Total memory safety (incl. data-race freedom) with no GC; deterministic destruction; zero-cost where checks can be elided.
- ❌ Conservative borrow checker rejects some sound programs; steep learning curve; `unsafe` still required at the edges and must be audited.

**Tracing GC (managed runtimes):**
- ✅ Simple model, high productivity, no lifetime reasoning.
- ❌ Pauses, memory overhead, non-deterministic finalization; doesn't guarantee data-race freedom.

**Choosing the boundary:**
- ✅ Drawing a small, explicit unsafe boundary concentrates audit effort.
- ❌ A boundary drawn carelessly (large `unsafe`, sprawling FFI) silently erases the guarantee.

---

## Use Cases

- **Designing a new systems component** (kernel module, hypervisor, browser sandbox): Rust's static safety is the reason it's now in the Linux kernel, Android, and Windows.
- **Evaluating a dependency's safety claim:** a Rust crate advertising a safe API is only sound if its internal `unsafe` upholds its invariants — review the `unsafe` blocks and their `// SAFETY:` justifications.
- **Latency-critical services:** weighing a low-pause GC (ZGC) against Rust's deterministic, GC-free model.

---

## Coding Patterns

- **Soundness encapsulation:** never expose a safe function that can be driven to UB; the bounds/validity check belongs *inside* the safe boundary.
- **`// SAFETY:` comments:** every `unsafe` block states the invariant it relies on, reviewable in isolation.
- **Newtype + smart constructors:** validate once at construction so downstream code can assume validity (e.g., a `NonEmpty<T>` or a validated index type).
- **Prefer RAII / deterministic destruction** for resources; don't lean on the GC/finalizers for correctness-critical cleanup.
- **Isolate FFI behind a thin, audited shim** with explicit invariants on both sides of the boundary.

---

## Best Practices

1. **State the guarantee precisely.** When you call a system "memory-safe," be ready to name which of the five properties hold and under what assumptions.
2. **Minimize and centralize the unsafe surface;** make it grep-able and review-mandatory.
3. **Don't conflate safety with correctness.** Add tests, fuzzing, and property checks for the bugs safety *doesn't* catch (leaks, logic, deadlocks).
4. **Audit FFI as the trust boundary it is;** a safe wrapper does not make unsafe C safe.
5. **Respect the borrow checker's rejections as information** — a rejected pattern usually signals a real lifetime/aliasing question worth resolving cleanly rather than `unsafe`-ing past.

---

## Edge Cases & Pitfalls

- **A safe signature over unsound internals is the worst failure mode** — it tells safe callers they're safe when they aren't. Catching these is the core of Rust security review.
- **`mem::forget`, `Rc` cycles, and lingering references leak without any UB** — safety and leak-freedom are orthogonal.
- **Go's safety is conditional on race-freedom;** a single unsynchronized write to a slice/interface header can break spatial/temporal safety. Treat `-race` findings as safety bugs.
- **GC does not give deterministic resource cleanup;** relying on finalizers for closing files/sockets is a known anti-pattern.
- **Bounds-check elimination can be defeated** by code the JIT can't analyze, silently reintroducing per-access cost — a performance, not safety, concern, but worth knowing.
- **`unsafe` interacts with compiler assumptions:** violating aliasing rules in `unsafe` code can miscompile *safe* code, because the optimizer trusted `&mut` uniqueness.

---

## Summary

- "Memory-safe" decomposes into **spatial, temporal, type, initialization, and (sometimes) thread** safety; different languages guarantee different subsets under different assumptions.
- **GC runtimes** enforce safety via bounds checks + tracing collection + checked casts, paying at runtime (pauses, headroom, non-deterministic destruction) and *not* guaranteeing data-race freedom.
- **Rust** achieves *total* memory safety without a GC via **affine ownership, lifetimes, and aliasing-XOR-mutability**, paying at compile-time and in learning curve, with a conservative borrow checker.
- **Soundness** means accepted programs can't go wrong; the **`unsafe` contract** shifts a proof obligation onto the author, and its blast radius extends into safe code — so the program is only as safe as its unsafe islands and FFI boundaries.
- Safety is **not** correctness: leaks, deadlocks, panics, and logic bugs are all "safe." Know exactly what the guarantee buys you — and what it doesn't.
