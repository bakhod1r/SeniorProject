# Manual Memory Management — Interview Questions

> **Topic:** [Manual Memory Management](README.md)

A curated set of interview questions on manual memory management, spanning fundamentals, tooling, classic traps, and design judgment. Each answer reflects what a strong senior candidate should articulate — not just *what* the rule is, but *why* it exists.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Why does `free` take only a pointer and not a size, when the OS clearly needs to know how much to reclaim?**

Because the allocator stored the size itself when it handed you the block. Most allocators (e.g. glibc's) place a small **header** in the bytes immediately *before* the pointer they return, recording the chunk's size and status flags. `free(p)` reads `p[-header]` to recover the size. This is also why writing before your block or past its end is catastrophic: you corrupt the allocator's bookkeeping, not just your own data. A direct corollary — you must pass `free` the *exact* pointer `malloc` returned, never an interior pointer, because only there does a valid header precede it.

## Question 2

**Explain the difference between `malloc`, `calloc`, and `realloc`.**

`malloc(n)` reserves `n` bytes of *uninitialized* memory (reading it before writing is an uninitialized-read bug). `calloc(count, size)` reserves `count * size` bytes and *zeroes* them, and critically it **checks the multiplication for overflow** — making it the safe choice for size arithmetic. `realloc(p, n)` resizes an existing block to `n` bytes; it may grow in place or **move the block to a new address**, copying the contents, so you must always assign from its return value and never do `p = realloc(p, n)` directly (a `NULL` return would leak the original). `realloc(NULL, n)` behaves like `malloc(n)`; `realloc(p, 0)` is implementation-defined and best avoided.

## Question 3

**What is the difference between the stack and the heap, and why does it matter for manual memory management?**

The stack holds function-local data and is managed automatically: a function's frame is pushed on entry and popped on return, so locals are reclaimed for free in LIFO order. The heap is a general pool you manage explicitly with `malloc`/`free`; allocations outlive the function that created them and must be released by hand. Manual memory management is fundamentally about the *heap*, because that's where lifetime is decoupled from scope. The danger zone is returning a pointer to a stack local — it dangles the instant the function returns — versus a heap allocation, which survives but obligates someone to free it.

## Question 4

**What is RAII and what problem does it solve?**

RAII — Resource Acquisition Is Initialization — binds a resource's lifetime to an object's lifetime: acquire in the constructor, release in the destructor. When the object leaves scope — by normal flow, early `return`, or a thrown exception — the destructor runs automatically. It solves the problem that manual cleanup is easy to forget and nearly impossible to get right on every path, *especially* exception paths. In C you simulate it with `goto`-cleanup ladders; in C++ it's structural via smart pointers (`unique_ptr`) and standard containers; in Rust it's mandatory and enforced via `Drop`. RAII generalizes beyond memory to locks, files, sockets, and transactions.

## Question 5

**When would you choose `unique_ptr` versus `shared_ptr`?**

`unique_ptr` models *exclusive* ownership: exactly one owner, move-only, and zero overhead versus a raw pointer. It should be your **default** for owning a heap object. `shared_ptr` models *shared* ownership via atomic reference counting; the object dies when the last owner does. Use it only when ownership is *genuinely* shared with an indeterminate lifetime — and be aware it costs atomic operations on every copy/destroy and **leaks on reference cycles** (break those with `weak_ptr`). Reaching for `shared_ptr` by default reintroduces GC-like costs and hides ownership; it is not a garbage collector.

---

## Tool-Specific

## Question 6

**How does AddressSanitizer detect a use-after-free, and why can't you just run it in production?**

ASan instruments the binary at compile time, maintaining **shadow memory** that records the state of every application byte and surrounding allocations with poisoned **redzones**. On `free`, it poisons the chunk and routes it through a **quarantine** so the same address isn't immediately reused. Every load/store is then checked against shadow memory; touching quarantined (freed) memory triggers an abort with three stack traces — where the memory was allocated, where it was freed, and where the bad access happened. You can't ship it because it imposes roughly 2× CPU and 3× memory overhead — fine for CI/fuzzing, far too costly for the latency-critical paths where C/C++ is usually chosen. In production you instead use hardened allocators and sampling tools like GWP-ASan.

## Question 7

**ASan vs Valgrind/memcheck — when do you reach for each?**

ASan requires recompiling with instrumentation but is fast (~2×), catches stack and global overflows, and gives precise allocation/free/use traces — making it the right default for CI and fuzzing. Valgrind needs **no recompilation** and runs on release binaries, so it's invaluable for third-party code you can't rebuild or for ad-hoc local debugging, but it's slow (~20–50×) and doesn't catch stack-buffer overflows the way ASan does. Rule of thumb: ASan in CI on your own code; Valgrind when you can't recompile or need to inspect an existing binary.

## Question 8

**Sanitizers catch bugs, but how do you find the inputs that trigger them?**

Through **coverage-guided fuzzing** (libFuzzer, AFL++): the fuzzer mutates inputs to maximize code coverage and runs each one under ASan/UBSan/MSan, reporting any sanitizer abort. Sanitizers are detectors; fuzzers are the explorers that drive code paths a hand-written test suite never reaches. This combination — fuzzing under sanitizers, run continuously (e.g. Google's OSS-Fuzz) — is the highest-leverage memory-safety practice for any code consuming untrusted input. Every parser and trust boundary should have a fuzz harness.

---

## Tricky / Trap

## Question 9

**What's wrong with `p = realloc(p, new_size);`?**

If `realloc` fails it returns `NULL` *without freeing the original block* — and you've just overwritten your only pointer to that block with `NULL`, leaking it permanently (and likely crashing when you next use `p`). The correct idiom uses a temporary: `void *tmp = realloc(p, n); if (!tmp) { /* handle, p still valid */ } else { p = tmp; }`. This is a favorite trap because the buggy version looks natural and works in every test where allocation succeeds.

## Question 10

**This code "works" in testing but is a bug. Why? `free(p); ... ; printf("%d", *p);`**

It's a use-after-free, and it "works" only because the freed chunk hasn't been reused yet — the bytes still hold the old value. The instant another allocation reclaims that chunk (which is timing- and load-dependent), `*p` reads whatever now lives there: another object's data, allocator free-list pointers, or garbage. This is exactly why manual-memory bugs are so dangerous — they're non-deterministic and surface under production load, not in tests. The only reliable way to catch it is instrumentation (ASan), which poisons freed memory so the read aborts immediately. Defensive habit: set `p = NULL` right after `free` so accidental reuse crashes loudly instead of silently.

## Question 11

**In C++, what's the difference between `delete` and `delete[]`, and what happens if you mix them up with `new`/`new[]`?**

`new` allocates a single object and pairs with `delete`; `new[]` allocates an array and pairs with `delete[]`. They differ because `new[]` often stores an element count in a header so `delete[]` knows how many destructors to run. Mixing them — `delete` on a `new[]` array, or `delete[]` on a `new` object, or `free` on `new` memory — is **undefined behavior**: you may skip destructors, free from the wrong offset, or corrupt the heap. The modern answer is to avoid raw `new`/`delete` entirely: use `make_unique<T[]>` / `vector` / `unique_ptr`, which always pair the right allocation and deallocation for you (Rule of Zero).

## Question 12

**Why is a double-free dangerous beyond "it's wrong" — what can an attacker do with it?**

A double-free puts the same chunk on the allocator's free list twice. A subsequent `malloc` can hand that chunk to one part of the program while it's *still queued* for another allocation, letting an attacker who controls the allocation pattern arrange for `malloc` to return an **arbitrary, attacker-chosen address**. Writing through that pointer becomes a write-what-where primitive, a foundation for control-flow hijacking. Modern allocators add detection (glibc tcache checks, safe-linking) but these are mitigations, not guarantees. This is why double-free sits in the same severity bucket as use-after-free: both are exploitable heap-corruption primitives.

## Question 13

**A `shared_ptr`-based parent/child structure never frees its memory even though all external references are gone. Why?**

A reference cycle. If `Parent` holds a `shared_ptr<Child>` and `Child` holds a `shared_ptr<Parent>`, each keeps the other's refcount at ≥1 forever, so neither is ever destroyed even when nothing else references them — a leak. `shared_ptr` is reference counting, *not* tracing garbage collection, so it cannot reclaim cycles. The fix is to make one direction a **non-owning `weak_ptr`** (typically the back-reference, e.g. child→parent), breaking the cycle while still allowing safe observation via `lock()`.

---

## Design

## Question 14

**Your service leaks 40 bytes per request and crashes after a few days. Walk me through diagnosing and preventing this.**

First, confirm the pattern: monitor RSS over time — a linear climb correlated with request volume points to a per-request leak. To locate it, run **LeakSanitizer** on a long soak test (unit tests are too short to expose slow leaks) or use a heap profiler (`jemalloc`/`tcmalloc` profiling, Valgrind `massif`) in staging to see which call site's allocations grow unboundedly. Leaks almost always live on **error/early-return paths** where cleanup is skipped, so audit those specifically. Prevention: adopt RAII / `unique_ptr` so cleanup is structural rather than manual, add a LSan job to CI that runs a soak workload, and treat every pointer-returning function's ownership contract as something to document and test.

## Question 15

**You're starting a new latency-critical networking daemon. Argue for C, C++, or Rust, and justify the memory-management trade-off.**

All three avoid GC pauses, which is why the daemon isn't in Go/Java. The axis is *where the safety proof lives*. **C** gives total control and minimal footprint but pushes the entire correctness proof onto the programmer — given ~70% of severe C/C++ CVEs are memory-safety bugs, that's a heavy security liability for network-facing code. **C++** with strict RAII (`unique_ptr`, Rule of Zero, banned raw `new`) eliminates most of those bugs at zero runtime cost while staying in a mature ecosystem, but the safety is by discipline and still has trap doors. **Rust** moves the proof to the compiler: use-after-free and double-free become compile errors, with zero-cost safe abstractions and `unsafe` confined to audited modules. For *new* security-sensitive, network-facing code, I'd argue strongly for Rust precisely because the threat surface is untrusted input — the exact case where compile-time guarantees pay for their learning curve. If the team's expertise or a vast existing C++ codebase dominates, disciplined modern C++ is a defensible second choice.

## Question 16

**Describe arena allocation and when you'd use it over per-object `malloc`/`free`.**

An arena (region) allocator carves objects out of a large block by bumping a pointer; individual objects are never freed — instead you **reset the whole arena at once**, reclaiming everything in O(1). You use it when many objects share a single lifetime: per-request memory in a server, per-frame allocations in a game engine, per-AST nodes in a compiler. The wins are threefold: allocation is just a pointer bump (far faster than `malloc`), there are no per-object lifetime bugs (no use-after-free or double-free within the arena because you never free individually), and teardown is one operation. The cost is you can't release individual objects early, so it only fits clustered-lifetime workloads — and if lifetimes don't actually match, you leak the whole region. A related pattern, **generational handles** (`{index, generation}` instead of raw pointers), gives you *detectable* stale references on top of pool/arena storage.

---

These questions probe the full arc: the allocator's mechanics, the discipline of ownership, the tooling that makes manual memory survivable in production, and the design judgment to pick the right model. Strong answers always connect a rule back to *why* — the header before your block, the cost that moves rather than vanishes, the bug that's silent until an attacker finds it.
