# Memory Safety — Middle Level

> **Topic:** [Memory Safety](README.md)
> **Focus:** The mechanisms behind each violation category, how detection tooling actually works, and why some "safe" languages still have unsafe corners.

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

At the junior tier we named the two pillars — spatial and temporal safety — and the violation categories. This tier goes one level deeper: *why* each violation is dangerous at the mechanism level, *how* detection tools like AddressSanitizer find them, and *where* the supposedly safe languages have holes (Go data races, Java's `Unsafe`, Rust's `unsafe`).

The throughline: memory safety is not a single switch. It's a set of guarantees, each enforced by a specific mechanism with a specific cost, and each with specific boundaries beyond which the guarantee no longer holds.

---

## Prerequisites

- The junior tier's two pillars and violation list.
- Heap vs. stack allocation; what `malloc`/`free` (or `new`/`delete`) do conceptually.
- Pointers and references, and the idea that a pointer is just an address (a number).
- Basic understanding of what a compiler vs. a runtime does.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Type confusion** | Treating bytes of one type as if they were another, incompatible type. |
| **Integer overflow → undersized allocation** | An arithmetic overflow producing a too-small buffer that is then overflowed. |
| **Data race** | Two threads accessing the same memory concurrently, at least one writing, with no synchronization. |
| **Shadow memory** | A parallel region a sanitizer uses to record metadata about each byte of program memory. |
| **Redzone** | Poisoned padding a sanitizer places around allocations to detect overflows. |
| **Quarantine** | A sanitizer's pool of freed memory held back from reuse to catch use-after-free. |
| **Soundness** | A safety mechanism is *sound* if it admits **no** unsafe program (no false negatives in its guarantee). |
| **`unsafe` / escape hatch** | A region where the language's safety checks are suspended and the programmer asserts correctness. |
| **Sanitizer** | A compiler-instrumented runtime detector (ASan, MSan, TSan, UBSan). |

---

## Core Concepts

### The violation categories, by mechanism

**Buffer overflow (spatial).** A buffer occupies a fixed range. Writing past its end overwrites *adjacent* memory: another local variable, heap allocator metadata, or (on the stack) a saved return address. Overwriting a return address is the basis of classic "stack smashing." The read variant (over-read) leaks adjacent memory — the Heartbleed bug was a heap over-read that leaked server memory including private keys.

**Use-after-free (temporal).** After `free`, the allocator may hand that block to a different allocation. A lingering pointer now aliases *someone else's* object. If an attacker can control what gets allocated into the freed slot, a use-after-free becomes a powerful primitive — they effectively get to choose what the stale pointer points at.

**Double-free (temporal).** Allocators keep freed blocks in internal lists. Freeing twice corrupts those lists, which can later be leveraged to make the allocator return an attacker-influenced pointer.

**Uninitialized read.** Reading memory before writing it yields whatever was there before — possibly secrets from a previous allocation. This is both a correctness bug and an *information disclosure*.

**Type confusion.** If code can be tricked into treating an object of type `A` as type `B` (common in languages with downcasts, unions, or deserialization), then field offsets and vtable pointers are misinterpreted — often turning into arbitrary memory access. This is a leading bug class in browser engines.

**Integer overflow leading to undersized allocation.** Consider `malloc(count * size)`. If `count * size` overflows the integer type, the product wraps to a small number. You allocate a tiny buffer but then write `count` elements into it — a heap overflow. The root cause is integer arithmetic, but the *consequence* is a memory-safety violation. This is why safe arithmetic matters for safety.

**Data races as memory unsafety.** A data race on a non-atomic, multi-word value (like a slice header or an interface value) can produce a *torn* value: half-updated, internally inconsistent. Dereferencing a torn pointer/length pair is effectively spatial/temporal unsafety. This is the precise reason Go — garbage-collected and otherwise safe — is **not** fully memory-safe in the presence of data races.

### How languages achieve safety — the two families

**Family 1: Managed runtimes (Java, Go, C#, Python, JavaScript).**
- Bounds checks on every indexed access.
- No raw pointer arithmetic — references are opaque handles.
- A garbage collector that frees memory only when unreachable, eliminating UAF and double-free in safe code.
- Type safety enforced by the runtime (casts are checked).

The cost is runtime overhead (checks + GC pauses + memory headroom).

**Family 2: Compile-time ownership (Rust).**
Rust gets the same guarantees with *no* GC and *no* per-access bounds-check overhead beyond what's strictly needed, by enforcing rules at compile time:
- **Ownership:** every value has exactly one owner; when the owner goes out of scope, the value is dropped (freed) deterministically.
- **Borrowing:** you may have *either* one mutable reference *or* any number of immutable references, never both at once. This single rule prevents use-after-free (you can't hold a reference past the owner's lifetime) and data races (no aliased mutation).
- The **borrow checker** rejects code that could violate these rules — before it ever runs.

The cost moves to *compile time* and *learning curve*: the borrow checker rejects some correct-looking programs because it can't prove them safe.

### Soundness and the `unsafe` boundary

A safety system is **sound** if no program it accepts can violate safety. Rust's safe subset is designed to be sound. But there's a catch: low-level work (calling C, building data structures the borrow checker can't model, talking to hardware) sometimes *requires* operations the checker can't verify. Languages provide an **escape hatch**:

- **Rust:** `unsafe { ... }` blocks let you dereference raw pointers and call unsafe functions. The compiler trusts you. The *soundness contract* is that the author must uphold the invariants the safe code relies on; a bug in `unsafe` can corrupt safe code elsewhere. The discipline: keep `unsafe` small, wrap it in a safe API, and audit it heavily.
- **Java:** `sun.misc.Unsafe` exposes raw memory operations used by high-performance libraries; misuse breaks the JVM's guarantees.
- **Go:** the `unsafe` package and, more subtly, *data races* (no `unsafe` keyword needed) can break safety.

The key insight: **safe languages are safe because of what their safe subset forbids; the escape hatch is where you take responsibility back.**

### Dynamic detection: how AddressSanitizer works

When you can't switch languages (legacy C/C++), you detect bugs at runtime. **AddressSanitizer (ASan)** is the workhorse. Its mechanism:

- **Shadow memory.** ASan reserves a parallel region where each 8 bytes of program memory maps to 1 byte of shadow, recording whether those bytes are "addressable" (valid) or "poisoned" (invalid).
- **Redzones.** Around every allocation, ASan inserts poisoned padding. An overflow lands in a redzone, and the instrumented load/store checks the shadow byte first — detecting the overflow *at the moment it happens*, with a precise stack trace.
- **Quarantine.** Freed memory is poisoned and held in quarantine (not immediately reused), so a use-after-free hits poisoned shadow instead of someone else's live object.

ASan typically slows programs ~2x and roughly doubles memory — fine for testing, not for production. Its companions:

- **MemorySanitizer (MSan):** detects reads of *uninitialized* memory by tracking the initialized-ness of every bit.
- **UndefinedBehaviorSanitizer (UBSan):** catches integer overflow, misaligned access, invalid casts, and other UB.
- **ThreadSanitizer (TSan):** detects data races by tracking a happens-before relation between memory accesses across threads.

These are *dynamic* — they only catch bugs on code paths your tests actually execute. That's why they're paired with **fuzzing**.

---

## Real-World Analogies

- **Redzones = wet paint barriers.** ASan paints a poisoned strip around each allocation. The instant a write strays into the strip, you know — and you know exactly where, because the alarm fires immediately, not three corruptions later.

- **Quarantine = not re-renting a hotel room the instant a guest checks out.** Hold the room empty for a while. If the old guest's keycard (stale pointer) tries the door, it opens onto a *known-empty, alarmed* room instead of a new guest's occupied one.

- **The borrow checker = a strict lab safety officer.** They won't let you run an experiment until you *prove* on paper that no two people will touch the same sample while one is modifying it. Sometimes they reject a perfectly fine experiment because your proof was incomplete — annoying, but no accidents ever happen.

- **`unsafe` = a signed waiver at the door.** Inside, the safety rails are off and you've taken personal responsibility. The smaller the room behind that door, the easier it is to be sure nothing escapes to hurt others.

---

## Mental Models

**Model 1: Detection vs. prevention.** Safe languages *prevent* (the bug can't exist). Sanitizers *detect* (the bug exists, but you find it when it triggers). Prevention is strictly better; detection is what you use when prevention isn't available.

**Model 2: The unsafe surface is the real attack surface.** In a mostly-safe codebase, vulnerabilities cluster at the boundaries: `unsafe` blocks, FFI calls, deserialization, data races. Audit effort should follow the unsafe surface, not be spread uniformly.

**Model 3: Integer math is part of memory safety.** A buffer size is computed by arithmetic. If the arithmetic can overflow, the buffer can be undersized. Treat size calculations as safety-critical.

**Model 4: A data race is undefined behavior, not "just" a race.** In C/C++ and even partly in Go, a race isn't merely nondeterministic output — it can produce torn values that break spatial/temporal invariants.

---

## Code Examples

### Integer overflow producing an undersized allocation

```c
// C — classic undersized-allocation pattern.
void *make(size_t count, size_t size) {
    // If count * size overflows size_t, this wraps to a small number.
    void *buf = malloc(count * size);   // BUG: unchecked multiply
    // ... caller then writes `count` elements -> heap overflow
    return buf;
}
```

```rust
// Rust — checked arithmetic makes the overflow explicit and catchable.
fn make(count: usize, size: usize) -> Option<Vec<u8>> {
    let total = count.checked_mul(size)?; // None on overflow, no silent wrap
    Some(vec![0u8; total])
}
```

### Safe vs. `unsafe` in Rust — the boundary made visible

```rust
let v = vec![1, 2, 3];

// Safe: bounds-checked. Out-of-range -> panic, never memory corruption.
let x = v[1];                 // fine
// let y = v[5];              // would panic: index out of bounds

// Unsafe: you assert the index is valid; the compiler does NOT check.
let z = unsafe { *v.get_unchecked(1) };   // fast, but YOU own correctness
// unsafe { v.get_unchecked(5) };          // UB if reached — your responsibility
```

The `unsafe` block is a contract: *"I, the author, guarantee this index is in range."* If you're wrong, you've reintroduced a C-style bug into a Rust program.

### A bug ASan would catch

```c
// Heap buffer overflow — silent in plain C, caught precisely under ASan.
char *p = malloc(8);
p[8] = 'x';   // writes into the redzone -> ASan reports
              //   "heap-buffer-overflow ... 0 bytes to the right of 8-byte region"
free(p);
```

### Data race that breaks Go's safety

```go
// Two goroutines writing a shared slice header without synchronization
// can tear the (ptr, len, cap) triple, producing an inconsistent slice.
var shared []int
go func() { shared = make([]int, 10) }()
go func() { shared = make([]int, 1000000) }()
// A reader may observe a new ptr with the old len -> out-of-bounds access.
// This is why `go test -race` exists.
```

---

## Pros & Cons

**Managed-runtime safety (GC family):**
- ✅ Simple mental model, no lifetimes to reason about, very productive.
- ❌ GC pauses and memory overhead; less predictable latency; bounds-check cost.

**Compile-time ownership (Rust):**
- ✅ Safety with no GC, predictable performance, data-race freedom in safe code.
- ❌ Steeper learning curve; borrow checker rejects some valid programs; `unsafe` still needed at the edges.

**Sanitizers (for unsafe languages):**
- ✅ Find real bugs precisely, with stack traces; near-zero false positives (ASan).
- ❌ Only catch executed paths; significant runtime/memory cost; not a production safeguard.

---

## Use Cases

- **Choosing between Go and Rust** for a new service: Go for fastest delivery and simplest concurrency story (mind the race detector); Rust where you need predictable latency, no GC, or are writing systems/security-critical code.
- **Hardening an existing C/C++ codebase:** run the test suite and fuzzers under ASan/MSan/UBSan/TSan in CI.
- **Reviewing a Rust PR:** scrutinize every `unsafe` block and every `unsafe`-adjacent invariant; the safe parts are guaranteed by the compiler.

---

## Coding Patterns

- **Wrap `unsafe` in a safe API.** The pattern is "small audited `unsafe` core, large safe surface." Callers never see the unsafe operations.
- **Use checked/saturating arithmetic for sizes.** `checked_mul`, `checked_add` (Rust); explicit overflow checks before allocation in C.
- **Prefer length-carrying types over raw pointers.** Slices, spans, and `std::span`/`gsl::span` carry their bounds so the bounds check is possible.
- **Run the race detector in CI for Go.** `go test -race`; treat any reported race as a release blocker.
- **Make freed pointers unusable.** In C, set pointers to `NULL` after `free` to turn use-after-free into a (catchable) null deref rather than silent corruption.

---

## Best Practices

1. **Enable sanitizers in test/CI builds for any C/C++ project.** ASan + UBSan at minimum; MSan and TSan where applicable.
2. **Keep the unsafe surface minimal and documented.** Every `unsafe` block should have a comment stating the invariant it relies on.
3. **Never `unsafe`-optimize away bounds checks without a measured reason.** The bounds check is usually cheap; the bug it prevents is not.
4. **Fuzz the code paths that handle untrusted input,** with sanitizers enabled, so detection meets coverage.
5. **Treat data races as memory-safety bugs,** not performance curiosities.

---

## Edge Cases & Pitfalls

- **Sanitizers don't compose for free.** ASan and MSan generally can't run in the same build; TSan is separate. You run multiple configurations.
- **MSan needs the whole program instrumented,** including libraries, or it reports false uninitialized reads from uninstrumented code.
- **`unsafe` Rust can break *safe* Rust.** A soundness bug in an `unsafe` block can corrupt invariants that safe code downstream relies on — the blast radius isn't contained to the block.
- **Go's race detector only finds races it observes at runtime.** A clean `-race` run is evidence, not proof.
- **Type confusion often hides in deserialization.** Decoding untrusted bytes into typed objects is a prime spot for it; validate aggressively.
- **A double-free can look fine in testing** and only corrupt the heap under specific allocation patterns in production.

---

## Summary

- Each violation category has a concrete mechanism: overflows hit adjacent memory; UAF aliases reused memory; integer overflow produces undersized buffers; data races tear multi-word values.
- Two families achieve safety: **managed runtimes** (bounds checks + GC + no pointer arithmetic) and **compile-time ownership** (Rust's borrow checker), each with different costs.
- **Soundness** means the safe subset admits no unsafe program; the **`unsafe`/FFI escape hatch** is where that guarantee is handed back to the programmer — and where bugs concentrate.
- **Sanitizers** (ASan via shadow memory + redzones + quarantine; MSan, UBSan, TSan) *detect* bugs at runtime with precision but only on executed paths — pair them with **fuzzing**.
- "Safe" languages still have unsafe corners: Go data races, Java's `Unsafe`, Rust's `unsafe`. Audit effort should follow the unsafe surface.
