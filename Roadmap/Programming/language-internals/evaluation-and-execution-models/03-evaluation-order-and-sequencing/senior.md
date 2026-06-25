# Evaluation Order & Sequencing — Senior Level

> **Topic:** [Evaluation Order & Sequencing](README.md)
> **Focus:** Initialization order (static-init-order fiasco, member-init order), the bridge from single-thread sequencing to the concurrency memory model, and how the optimizer's freedom intersects with all of it.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **Sequencing is not just an in-expression concern. It governs how objects come into existence (initialization order) and it is the single-thread half of the relation that becomes the multi-thread memory model.**

By now the in-expression rules — sequence points, sequenced-before, the `i = i++` trap — are second nature. The senior level zooms out to two larger questions where the same sequencing concept reappears with much higher stakes:

1. **Initialization order.** When a program starts, *in what order do global and static objects get constructed*? When a class instance is built, *in what order do its members initialize*? These are sequencing questions, and getting them wrong produces the **static initialization order fiasco** and the member-init-order bug — failures that are non-local, intermittent, and brutal to debug.

2. **The leap to concurrency.** The single-thread relation "A is sequenced-before B" is *the base case* of the multi-thread relation "A happens-before B." Program order within a thread is exactly the sequenced-before chain; cross-thread visibility is the additional structure the memory model adds on top. Understanding sequencing is therefore the on-ramp to understanding why threads see writes out of order, what the compiler is allowed to reorder, and what `volatile`/atomics actually buy you.

> 🎓 **Why this matters at the senior level:** The bugs that survive to production and cost the most are rarely a stray `i++`. They are an init-order fiasco that only triggers when the linker happens to order translation units a certain way, or a "thread-unsafe but looks fine" publication that a reviewer waved through because they reasoned in *program order* while the CPU and compiler reasoned in a weaker order. Senior engineers are the ones expected to catch these, and that requires seeing sequencing as a unifying concept across construction, expressions, and threads.

This page covers: C++ static-init-order across translation units (and the "construct on first use" cure), member-init order = declaration order, the program-order ↔ sequenced-before equivalence, how sequenced-before feeds into happens-before, the as-if rule's permission for reordering, what `volatile` does and does *not* promise about ordering, and language contrasts (Java/Go/Rust memory models). The optimizer-centric, performance-and-tooling view lives in `professional.md`.

---

## Prerequisites

- **Required:** The middle-level formalism — sequence points, sequenced-before / unsequenced / indeterminately-sequenced.
- **Required:** C++ class basics (constructors, members, static members) and translation-unit / linker model.
- **Required:** Basic threading vocabulary — race, data race, visibility.
- **Helpful:** Prior exposure to a memory model (Java's JMM, C++11, or Go's) at the level of "happens-before."
- **Helpful:** Having debugged at least one init-order or publication bug.

You do **not** need: the full optimizer/as-if performance treatment (`professional.md`) or interview drilling (`interview.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Static initialization order fiasco** | UB/bug when one static object's constructor uses another static defined in a different translation unit, and the cross-TU init order is unspecified. |
| **Translation unit (TU)** | A single `.cpp` file after preprocessing. The unit of separate compilation; cross-TU static init order is not specified. |
| **Dynamic initialization** | Initialization of a static/global that requires running code (a constructor or non-constant expression) at startup. |
| **Construct-on-first-use** | Idiom that defers a static's construction to its first access, sidestepping cross-TU ordering. |
| **Member-init order** | The order in which a class's data members are constructed: **declaration order**, regardless of initializer-list order. |
| **Program order** | The order of operations as written in the source for a single thread; equals the sequenced-before chain within a thread. |
| **Sequenced-before** | Single-thread intra-thread ordering (from `middle.md`). The base of happens-before. |
| **Happens-before** | The cross-thread partial order; if A happens-before B, B sees A's effects. Built from sequenced-before + synchronization edges. |
| **As-if rule** | The compiler may transform a program any way it likes as long as observable behavior is preserved. Permits reordering. |
| **Observable behavior** | I/O, `volatile` accesses, and (since C++11) atomic/synchronization effects — what the as-if rule must preserve. |
| **`volatile`** | (C/C++) Suppresses optimization of accesses to the abstract machine; orders `volatile` accesses among themselves; gives *no* inter-thread synchronization. |
| **Synchronizes-with** | A memory-model edge (e.g. release store paired with acquire load) that links two threads' sequenced-before chains into happens-before. |

---

## Core Concepts

### 1. The static initialization order fiasco

Within a single translation unit, static/global objects are dynamically initialized **top to bottom** in declaration order. *Across* translation units, the order is **unspecified** — the linker and runtime may construct `.cpp` files' statics in any order. So:

```cpp
// file_a.cpp
extern Logger logger;          // defined in file_b.cpp
Config config = load(logger);  // uses logger during ITS OWN construction
```

```cpp
// file_b.cpp
Logger logger;                 // may or may not be constructed before config
```

If `config`'s constructor runs before `logger` is constructed, it uses a not-yet-built object — undefined behavior, and the bug appears or vanishes depending on link order, compiler, or even the order of object files on the command line. This is the **static initialization order fiasco**.

**The cure — construct on first use.** Replace the eagerly-constructed global with a function that holds a function-local static, whose initialization is guaranteed to happen on first call (and, since C++11, is thread-safe):

```cpp
Logger& logger() {
    static Logger instance;   // constructed on first call; order is now demand-driven
    return instance;
}
```

Now `config`'s construction *calls* `logger()`, which forces `logger` to exist first. The dependency, not the link order, decides the sequence. (Beware the symmetric "static *de*-initialization" order fiasco at shutdown; function-local statics also help here, often via leak-on-purpose or Nifty-Counter idioms.)

### 2. Member initialization order = declaration order

A subtle, frequently-misunderstood rule: a class's members are initialized in the order they are **declared**, *not* the order they appear in the constructor's initializer list.

```cpp
struct Buffer {
    size_t size;
    char*  data;
    Buffer(size_t n) : data(new char[n]), size(n) {}  // looks like data first...
    // ...but 'size' is declared first, so 'size' initializes FIRST, then 'data'.
};
```

This usually doesn't matter — until one member's initializer reads another:

```cpp
struct Bad {
    int b;
    int a;
    Bad(int x) : a(x), b(a + 1) {}   // b is declared first -> b initializes using
                                     // a, which is NOT YET constructed. UB / garbage.
};
```

Compilers warn (`-Wreorder`), but the discipline is: **order your initializer list to match declaration order, and never let one member's initializer depend on a later-declared member.**

### 3. Program order *is* the sequenced-before chain

Here is the unifying insight. The single-thread relation from `middle.md` — *sequenced-before* — is precisely what we informally call **program order**: the order operations would execute if you ran the abstract machine straight down the source. For one thread in isolation, that's the whole story; the compiler/CPU may reorder underneath as long as the *observable* result matches (the as-if rule), so a single thread can never catch itself out of order.

Threads change everything. *Another* thread can observe your operations in an order inconsistent with your program order, because:

- Your **compiler** reordered independent operations (legal under as-if for a single thread).
- The **CPU** executed or retired them out of order, or buffered stores.
- There is no synchronization edge forcing a consistent view.

So: **sequenced-before is per-thread program order; it does not, by itself, order anything between threads.** To get cross-thread ordering you need a *synchronizes-with* edge (release/acquire, lock/unlock, atomic with the right memory order, thread start/join, channel send/receive), which splices two threads' sequenced-before chains into a single **happens-before** order.

### 4. Sequenced-before → happens-before

The memory model defines, roughly:

```
A happens-before B  if:
    A is sequenced-before B (same thread), OR
    A synchronizes-with B (cross-thread sync edge), OR
    transitively via a chain of the above.
```

The first clause is *exactly* the in-expression / in-statement ordering we have been studying. The second is what concurrency adds. The data-race definition then falls out: if two accesses to the same location conflict (one writes) and **neither happens-before the other**, it's a **data race** → undefined behavior in C++/C, "no guarantees" in Java/Go. Evaluation-order sequencing is thus the single-thread foundation that the entire concurrency edifice is built on.

### 5. The as-if rule licenses reordering

The compiler is permitted to do *anything* to your program as long as **observable behavior** is preserved (the **as-if rule**). Observable behavior is: the sequence of I/O, accesses to `volatile` objects, and (C++11+) the synchronization/atomic ordering. Everything else — the order of two independent additions, whether a temporary is materialized, whether a redundant load is elided — is fair game.

Consequences:

- Within one thread, reordering you can't observe is invisible and harmless.
- Across threads, the *same* reordering becomes observable — and is *still legal* unless you established happens-before. That's why "it looked sequential in the source" is not a correctness argument in concurrent code.

### 6. What `volatile` does and does not do

`volatile` is widely misunderstood, so be precise:

**`volatile` DOES:**
- Force each access to actually happen at the abstract-machine level (no eliding repeated reads, no caching the value in a register across a `volatile` read).
- Preserve the *relative order of `volatile` accesses* among themselves (the compiler won't reorder one `volatile` access past another).
- Make sense for memory-mapped I/O registers and `sig_atomic_t` flags touched by signal handlers.

**`volatile` does NOT:**
- Provide atomicity (`volatile int x; x++;` is still a non-atomic read-modify-write).
- Establish happens-before / synchronizes-with between threads. A `volatile` write in one thread does **not** publish your other writes to another thread (this is the *Java* `volatile`, which is a *different* keyword with acquire/release semantics — do not transfer the intuition).
- Emit CPU memory fences in C/C++. It does not stop the *hardware* from reordering relative to *non-volatile* accesses.

So for cross-thread ordering in C/C++, use `std::atomic` (or mutexes), **not** `volatile`. The only correct uses of C/C++ `volatile` are hardware registers and signal flags.

---

## Real-World Analogies

**The relay team and the baton (happens-before).** Within one runner's leg, steps happen in order — that's sequenced-before. But runner B's view of runner A's progress is *only* synchronized at the baton handoff. The handoff is the synchronizes-with edge; without it, B has no guaranteed knowledge of where A got to. `volatile` is like a runner who runs visibly but *never hands off the baton* — you can watch them, but nothing they did is officially transferred to the next runner.

**Building a house's rooms in blueprint order, not work-order order.** Member-init order is like a contractor who *always* builds rooms in the blueprint's listed order, no matter what sequence you wrote on the work order. If your work order says "wire room B using room A's panel" but the blueprint lists B before A, the wiring references a room that doesn't exist yet.

**Two factories with no agreed startup sequence.** Two translation units are two factories that both must be running before the company operates, but no one scheduled which boots first. If factory A's startup needs a part only factory B produces, and B isn't up yet, A's startup fails — intermittently, depending on who flips the switch first. Construct-on-first-use replaces "boot everything at dawn" with "boot a factory the first time someone needs its parts."

---

## Mental Models

### Model 1: The ordering stack

```
[expression sequencing]  sequenced-before        — within a full expression
        ⊆
[statement/program order] sequenced-before chain  — within one thread
        ⊆ (+ synchronization edges)
[concurrency]             happens-before           — across threads
```

Each layer *contains* the one below as its single-thread special case. The same word — sequencing — runs through all three.

### Model 2: "What forces this order?"

For any pair of operations, ask what edge orders them:
- Same thread, separated by a sequence point / sequenced-before → ordered by **program order**.
- Different threads → ordered **only** if a synchronization edge (lock, atomic, join, channel) creates happens-before. Otherwise *unordered* → potential data race.

### Model 3: Initialization as a dependency graph

Treat static/member initialization as a DAG of "X must exist before Y." Eager global init walks the graph in an *unspecified* topological-ish order (within-TU only). Construct-on-first-use makes the *access pattern* drive the order, guaranteeing dependencies resolve correctly. If you can't express the dependency, you have a latent fiasco.

---

## Code Examples

### Example 1 — The fiasco and its cure

```cpp
// PROBLEM (cross-TU eager statics):
// registry.cpp:  Registry g_registry;
// plugin.cpp:    Plugin g_plugin(g_registry);   // g_registry may not exist yet -> UB

// CURE (construct on first use):
Registry& registry() {
    static Registry instance;   // thread-safe, lazy init since C++11
    return instance;
}
// plugin.cpp:  Plugin g_plugin(registry());   // forces registry() before use
```

### Example 2 — Member-init order bug, caught by reordering the list

```cpp
struct View {
    int width;
    int height;
    int area;
    // BUG: area declared last but if it were declared first and read width/height...
    View(int w, int h) : width(w), height(h), area(w * h) {}  // OK: matches decl order
};
```

If you reorder the list to `: area(width*height), width(w), height(h)`, the compiler warns (`-Wreorder`) because `area` (declared last) *appears* first in the list but actually initializes last — and if `area` read `width`/`height` it would read uninitialized members. Keep list order = declaration order.

### Example 3 — Sequenced-before is NOT cross-thread ordering

```cpp
// Thread 1:
data = 42;          // (1)
ready = true;       // (2)  -- sequenced-before nothing across threads!

// Thread 2:
if (ready)          // (3)
    use(data);      // (4)  -- may read data == 0!
```

Although (1) is sequenced-before (2) in thread 1's program order, thread 2 has **no happens-before edge** to (1) or (2). The compiler or CPU may publish `ready` before `data`, or thread 2 may see them out of order. The fix is a synchronization edge:

```cpp
std::atomic<bool> ready{false};
// Thread 1: data = 42; ready.store(true, std::memory_order_release);
// Thread 2: if (ready.load(std::memory_order_acquire)) use(data);  // now ordered
```

### Example 4 — `volatile` does not fix the above

```cpp
volatile bool ready = false;   // STILL WRONG for thread publication.
// volatile orders volatile-vs-volatile accesses and prevents the compiler from
// caching 'ready' in a register, but it does NOT publish 'data' (non-volatile) and
// emits no hardware fence. Thread 2 may still see data == 0. Use std::atomic.
```

### Example 5 — Java/Go/Rust contrasts

```java
// Java: 'volatile' HAS acquire/release semantics — different keyword, different meaning.
volatile boolean ready = false;   // a volatile write publishes prior writes (JMM)
```

```go
// Go: no volatile; use channels or sync/atomic. Channel send/receive create happens-before.
// done <- struct{}{}  pairs with  <-done  to order writes before/after.
```

```rust
// Rust: data races are prevented at compile time by the borrow checker for safe code;
// cross-thread sharing requires Send/Sync, and ordering uses std::sync::atomic with Ordering.
```

---

## Pros & Cons

| Concern | Pros | Cons |
|---------|------|------|
| **Eager global init** | Simple to write; everything ready at `main`. | Cross-TU order unspecified → fiasco; hard, intermittent bugs. |
| **Construct-on-first-use** | Order driven by dependency; thread-safe since C++11. | Slight first-call cost; lifetime extends to program end (intentional leak at shutdown). |
| **As-if reordering freedom** | Big performance wins; compiler can schedule freely. | Single-thread reasoning is unsafe across threads. |
| **`volatile` for threads** | (none for threading) | Looks like a fix, isn't one — gives no inter-thread ordering. |

---

## Use Cases

- **Library singletons / registries:** construct-on-first-use to avoid init-order coupling between TUs.
- **Embedded / driver code:** `volatile` for memory-mapped hardware registers — its one legitimate ordering role.
- **Lock-free publication:** release/acquire atomics to turn per-thread sequenced-before into cross-thread happens-before.
- **Code review of "is this thread-safe?":** trace happens-before edges; reject "it's sequential in the source" as a justification.
- **Diagnosing intermittent startup crashes:** suspect static-init-order fiasco when failure depends on link/build order.

---

## Coding Patterns

**Pattern: Construct-on-first-use (Meyers singleton).**

```cpp
T& get() { static T instance; return instance; }
```

**Pattern: Match initializer list to declaration order.** Always write the list in the same order members are declared; enable `-Wreorder -Werror`.

**Pattern: Publish with release, consume with acquire.**

```cpp
payload = build();                 // ordinary writes
flag.store(true, std::memory_order_release);   // publish
// reader:
if (flag.load(std::memory_order_acquire)) use(payload);   // consume
```

**Pattern: Reserve `volatile` for hardware/signals only.** Never use it as a threading primitive in C/C++.

---

## Best Practices

1. **Never let one static depend on another across TUs eagerly** — use construct-on-first-use.
2. **Keep initializer-list order identical to declaration order**, and never read a later-declared member in an earlier one's initializer.
3. **Treat single-thread program order as worthless evidence of cross-thread ordering.** Always identify the synchronization edge.
4. **Use `std::atomic` or mutexes — not `volatile` — for inter-thread ordering** in C/C++.
5. **Remember Java/Go/Rust differ:** Java `volatile` *is* a sync primitive; Go uses channels/atomics; Rust enforces it at compile time.
6. **Lean on tooling:** `-Wreorder`, ThreadSanitizer, and static analyzers catch init-order and race issues you can't eyeball.

---

## Edge Cases & Pitfalls

- **Static *de*-initialization order** at shutdown is the mirror fiasco — a destructor using an already-destroyed static. Function-local statics destruct in reverse construction order, which usually (not always) helps.
- **`-Wreorder` is only a warning** — a wrong initializer list compiles silently if warnings are off.
- **`volatile` + multithreading** is the single most common false-fix in legacy C++.
- **`std::memory_order_relaxed`** gives atomicity but *no* ordering — using it where you needed release/acquire reintroduces the publication bug.
- **Const-initialized statics** (constant expressions) are *not* subject to the fiasco — they're statically initialized before dynamic init runs. Only *dynamic* init has the ordering problem.
- **Inline variables / templates** can change which TU "owns" a static and surprise your mental order.

---

## Common Mistakes

| Mistake | Reality |
|---------|---------|
| "Members init in initializer-list order" | They init in *declaration* order. |
| "`volatile` makes my flag thread-safe in C++" | It does not; use `std::atomic`. |
| "If it's sequential in the source, threads see it sequentially" | Only with a happens-before edge. |
| "Cross-TU global init order is left-to-right by file" | It is *unspecified*. |
| "Java `volatile` == C++ `volatile`" | Different semantics; Java's is a real sync primitive. |
| "relaxed atomics order my data writes" | Relaxed gives no ordering; you need release/acquire. |

---

## Cheat Sheet

```
INIT ORDER
  Within a TU:  static dynamic-init runs top-to-bottom (declaration order).
  Across TUs:   UNSPECIFIED  -> static init order fiasco.  Fix: construct-on-first-use.
  Members:      DECLARATION order, not initializer-list order.  (-Wreorder)

SEQUENCING -> CONCURRENCY
  sequenced-before  = single-thread program order  (the base case)
  happens-before    = sequenced-before  +  synchronizes-with (cross-thread)
  data race         = conflicting access, neither happens-before the other -> UB

AS-IF RULE: compiler may reorder anything that preserves observable behavior
            (I/O, volatile, atomics). Single-thread reorders are invisible;
            across threads they become visible and are still legal w/o sync.

volatile (C/C++):  orders volatile-vs-volatile, no caching of the value,
                   NO atomicity, NO inter-thread ordering, NO fence.
                   Use for HW registers / signal flags ONLY.
For threads:       std::atomic (release/acquire) or a mutex.
Java volatile:     DIFFERENT — has acquire/release; is a real sync primitive.
```

---

## Summary

At the senior level, sequencing stops being an in-expression curiosity and reveals itself as a concept that governs object construction and underpins concurrency. **Initialization order** is a sequencing problem: within a translation unit statics initialize in declaration order, but *across* translation units the order is unspecified — the **static initialization order fiasco**, cured by the construct-on-first-use idiom. Inside a class, **members initialize in declaration order, not initializer-list order**, a quiet trap when one member's initializer reads a later-declared member. The deeper unification is that **single-thread `sequenced-before` is exactly program order, and it is the base case of the cross-thread `happens-before` relation**; without an added synchronization edge (release/acquire, lock, channel, join), one thread's program order tells another thread *nothing*, which is precisely why "it's sequential in the source" is never a valid concurrency-correctness argument. The **as-if rule** grants the compiler liberty to reorder anything that preserves observable behavior, harmless within a thread but observable — and still legal — across threads. Finally, **`volatile` in C/C++ orders volatile accesses among themselves and prevents value caching but provides no atomicity and no inter-thread ordering** — it is for hardware registers and signal flags, not threading; for that you use `std::atomic` or a mutex (and note that Java's identically-named `volatile` is an entirely different, acquire/release primitive). The professional level turns to the optimizer's mechanics and the performance and tooling consequences of all this freedom.
