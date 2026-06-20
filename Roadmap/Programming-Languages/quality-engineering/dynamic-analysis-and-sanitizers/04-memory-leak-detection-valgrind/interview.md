# Leak Detection & Valgrind — Interview Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Leak Detection & Valgrind
> *A leak interview rarely asks "what is a memory leak." It asks "Valgrind says `definitely lost: 1,024 bytes in 1 blocks` — what do you do," and then watches whether you can separate a real leak from a benign one, name why the uninitialized-value report points at the wrong line, and explain why you'd reach for ASan in CI but Valgrind at 3 a.m. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Leak Categories](#leak-categories)
5. [Mechanism](#mechanism)
6. [Comparisons](#comparisons)
7. [Practice at Scale](#practice-at-scale)
8. [Scenario & Debugging](#scenario--debugging)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Memory-tool questions are a favourite because they separate people who have *read* about Valgrind from people who have *spent a night* with it. The shallow candidate knows "Valgrind finds leaks." The strong candidate knows that the most useful thing Valgrind does is *not* leak detection — it's catching invalid reads and use-after-free on every load and store — and that for a modern C/C++ shop the *default* leak gate is LSan-inside-ASan, with Valgrind as the heavier, recompile-free fallback.

Each question below carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). The distinctions worth internalizing, because nearly every question wears one of them as a costume:

- **leak vs corruption** (you forgot to free vs you scribbled out of bounds — different tools win each)
- **the four leak categories** (definitely / indirectly / possibly / still-reachable — different urgency each)
- **use site vs origin** (where an uninitialized value is *consumed* vs where it was *born*)
- **exit-time accounting vs steady-state growth** (Valgrind's model vs a long-running daemon's reality)

The candidates who do well name the distinction *before* reaching for a flag.

---

## Prerequisites

To answer these well you should be comfortable with:

- **The C/C++ heap** — `malloc`/`free`, `new`/`delete`, and what a "block" of allocated memory is.
- **Pointers and ownership** — who is responsible for freeing an allocation, and what a dangling pointer is.
- **Stack vs heap** — leaks are a heap phenomenon; stack frames clean themselves up.
- **Compiling and linking C/C++** — enough to know what "recompile with `-fsanitize=address`" actually costs.
- **The basics of the sanitizer family** — that ASan, TSan, UBSan, and MSan are *compile-time* instrumentation, in contrast to Valgrind's runtime approach. See [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md).

---

## Fundamentals

### Q: What *is* a memory leak, precisely? Is it the same as "high memory usage"?

> **Testing:** Whether you have a precise definition or a vibe.

**A.** A memory leak is heap memory that is **still allocated but no longer reachable** — the program has lost every pointer to a block it never freed, so it can neither use it nor release it. That's the strict definition, and it's narrower than "high memory usage." A program can use a lot of memory with zero leaks (a big cache you still hold a pointer to), and a program can leak steadily while using little memory at any instant. The reason the strict definition matters: a leak is *unrecoverable* growth — the memory is gone for the process lifetime — whereas high usage you still have a handle on is a *policy* question (evict the cache, cap the pool). Conflating the two sends you optimizing the wrong thing.

### Q: What does Valgrind — specifically Memcheck — actually do?

> **Testing:** Whether you know Valgrind is a framework and Memcheck is one tool on it.

**A.** **Valgrind** is a dynamic binary instrumentation *framework*; **Memcheck** is its default and most-used tool (others are Massif, Helgrind, DRD, Cachegrind, Callgrind). Memcheck runs your unmodified binary on a synthetic CPU and intercepts every memory operation and every heap call. With that, it detects: **leaks** at exit, **invalid reads/writes** (out-of-bounds, reads of freed memory), **use-after-free** and **use-after-return** (partially), **uninitialized-value use** (a branch or syscall that depends on memory you never wrote), **mismatched alloc/free** (`malloc` freed with `delete[]`), and **double frees / invalid frees**. The headline most people remember is leak detection, but in practice the invalid-read/write and uninitialized-value checks catch more *bugs* — leaks are often the least dangerous thing Memcheck reports.

### Q: How do you run Memcheck on a program, and what's special about *not* needing to recompile?

> **Testing:** Practical fluency, and whether you grasp the no-recompile property as a real advantage.

**A.** You prefix the command:

```bash
valgrind --leak-check=full --show-leak-kinds=all \
         --track-origins=yes --error-exitcode=1 ./myprog arg1 arg2
```

The point most people undervalue: Valgrind needs **no recompilation and no source changes** — it instruments the *binary* at runtime. That's why it's the tool you can run against a release build, a third-party binary you don't have source for, or a vendored `.so`, and the reason it's the fallback when ASan isn't an option (no toolchain access, can't rebuild the dependency, reproducing a bug in a shipped artifact). One caveat for accuracy: build with `-g` so you get file/line in the stacks, and avoid `-O2` stripping frames you need — debug info makes the reports actionable, but it's not *required* for Valgrind to function.

### Q: Besides leaks, name the bug classes Memcheck catches, and which one tends to matter most.

> **Testing:** Whether you see Memcheck as a general memory-error detector, not a leak tool.

**A.** Invalid read/write (out-of-bounds, `Invalid read of size 4`), use-after-free (`Invalid read ... inside a block that was freed`), uninitialized-value use (`Conditional jump or move depends on uninitialised value(s)`), mismatched/double/invalid free, and overlapping `memcpy`. The one that matters most operationally is usually the **invalid read/write and use-after-free** class — those are *memory-safety* bugs that cause crashes, corruption, and CVEs. A leak slowly costs you RAM; an out-of-bounds write silently corrupts an unrelated object and surfaces as an impossible bug three functions away. So when an interviewer frames Valgrind as "the leak tool," a good answer gently corrects: it's a memory-error detector that *also* reports leaks at exit.

---

## Leak Categories

### Q: Define "definitely lost," "indirectly lost," "possibly lost," and "still reachable." Which do you fix first?

> **Testing:** The single most important distinction in this topic — do you triage by category?

**A.** At exit, Memcheck classifies every still-allocated block by *how reachable it is from your root pointers* (registers, stack, globals):

- **Definitely lost** — no pointer anywhere reaches the block. A genuine leak; you've lost the only handle. **Fix these first.**
- **Indirectly lost** — the block is only reachable *through* a definitely-lost block. Classic case: a leaked linked-list head whose nodes are all indirectly lost. Fixing the root (the definitely-lost head) usually makes these disappear, so they're a *consequence*, not a separate hunt.
- **Possibly lost** — the only pointer to the block points into its *interior*, not its start. Memcheck can't tell whether that's a deliberate interior pointer (an offset into an allocation) or a corrupted/lost pointer. Often real, sometimes a false alarm from custom allocators or aligned data — investigate, but after the definitely-lost.
- **Still reachable** — a pointer still reaches the block at exit; you simply never freed it before the program ended. Usually benign (the OS reclaims it on exit), often global singletons or one-time allocations.

Triage order: **definitely lost → indirectly lost (often auto-resolved) → possibly lost → still reachable (usually ignore).**

### Q: Is "still reachable" a leak? Should you care about it?

> **Testing:** Judgment — whether you reflexively chase every number or reason about impact.

**A.** Technically it's *not* a leak by the strict definition — the memory is still reachable, you just chose not to free it before exit, and the OS frees the whole address space on process teardown anyway. So for a short-lived program (a CLI tool, a one-shot build step) "still reachable" is almost always **fine to ignore**. *But* it matters in two cases: (1) a **long-running service** where "still reachable but growing every request" is the signature of an unbounded cache or a container you keep appending to — reachable, not freed, growing without limit is a real problem even though Memcheck files it under "still reachable"; and (2) when you want **clean teardown** to make *real* leaks visible (libraries with `LeakSanitizer` clients, or running under tools that flag any unfreed memory). So: ignore it for tools, scrutinize the *growth* of it for daemons.

### Q: You see "indirectly lost: 4,096 bytes in 128 blocks" alongside one definitely-lost block. Where do you focus?

> **Testing:** Whether you understand the dependency between categories.

**A.** Focus on the **definitely-lost block** — it's almost certainly the root of those 128 indirectly-lost ones. The pattern is a container (list, tree, vector-of-pointers) whose head you leaked: the head is *definitely* lost (no pointer reaches it), and every element hanging off it is *indirectly* lost (reachable only through the lost head). Fix the one `free`/`delete` of the root and re-run — typically all 128 indirectly-lost blocks vanish because freeing the container frees the chain. Chasing the 128 individually is wasted effort; they're symptoms of the single missing root free.

---

## Mechanism

### Q: Why is Valgrind ~20-50× slower than native, and why doesn't it need a recompile? Tie those together.

> **Testing:** Whether you understand DBI on a synthetic CPU — the *cause* of both properties.

**A.** They're the same fact from two angles. Valgrind is **dynamic binary instrumentation**: it doesn't run your machine code on the real CPU. It JIT-translates your binary into an intermediate representation (VEX), *instruments* every memory access and branch with checks, and runs the result on a **synthetic CPU** Valgrind emulates. Because it works on the *binary* and translates it at runtime, you need **no recompilation** — there's nothing to instrument at build time. And because every load, store, and branch now executes extra checking code on an emulated processor, you pay **~20-50× slowdown** (sometimes more for Memcheck specifically). One property *causes* the other: the runtime translation that frees you from recompiling is exactly what makes it slow. Contrast ASan, which inserts checks at *compile* time and runs on the real CPU, so it's ~2× but requires a rebuild.

### Q: What are Memcheck's A-bits and V-bits, and what does each track?

> **Testing:** Senior-level understanding of *how* Memcheck knows what it knows.

**A.** Memcheck shadows your process's memory with two pieces of metadata:

- **A-bits (addressability)** — one bit per *byte* of address space: "is this byte legal to access right now?" Allocating sets the block's A-bits to valid; freeing clears them; the redzones around allocations stay invalid. An access to a byte whose A-bit says invalid is an **invalid read/write** (out-of-bounds, use-after-free).
- **V-bits (validity / definedness)** — one bit per *bit* of register and memory: "has this bit been initialized with a defined value?" `malloc`'d memory starts **undefined** (V-bits say "not yet defined"); writing a value marks it defined. V-bits **propagate** through arithmetic and copies, so an undefined byte stays undefined as it flows through the program — until it's *used in a way that matters* (a conditional branch, a syscall argument), at which point Memcheck reports it.

A-bits answer "*may* I touch this address?"; V-bits answer "is the *value* here meaningful?" Together they give Memcheck its two big checks: addressability errors and definedness errors.

### Q: Why does "Conditional jump or move depends on uninitialised value(s)" point at the *use*, not where the value came from? What fixes that?

> **Testing:** The use-vs-origin distinction, and knowledge of `--track-origins`.

**A.** Because of how **V-bits propagate**. Reading uninitialized memory isn't itself an error in Memcheck's model — copying an undefined byte around is fine. The error fires only when an undefined value **affects observable behaviour**: a branch decision or a syscall. By then the value may have flowed through several copies and assignments, so the *stack trace points at the consumption site* (the `if`, the `write()`), which is often far from where the memory was first allocated-but-not-written. That's why the report feels like it's blaming the wrong line.

The fix is **`--track-origins=yes`**: Memcheck then carries extra shadow metadata recording *where* the undefined value originated (which heap allocation or stack slot), and adds an "Uninitialised value was created by a heap allocation at …" section pointing at the **origin**. It roughly doubles the slowdown and memory, so it's off by default — you turn it on once you've got an uninitialized-value report and need to find the birthplace.

### Q: Memcheck reports an uninitialized value but you've "clearly initialized everything." What are the usual real causes?

> **Testing:** Whether you can reason about the actual mechanism behind false-feeling reports.

**A.** Usual real causes, in rough order: (1) a struct with **padding bytes** that you `memcpy`/`write` wholesale — the named fields are set but the compiler-inserted padding is never written, so the padding's V-bits stay undefined; (2) a **partially-initialized struct** (you set `.a` and `.b`, then read `.c`); (3) reading past the **length you actually populated** in a buffer; (4) a code path where a variable is conditionally assigned and then read on the path that skipped the assignment; (5) genuinely uninitialized `malloc`'d memory used before being written. The padding case is the famous false-*feeling* one — it's a real undefined read, just one that's usually harmless. The move is `--track-origins=yes` to confirm the birthplace, then decide: fix it (`memset`/`{}`-initialize, or write the whole struct field-by-field) or, if it's truly benign padding in a hot path, suppress it deliberately.

---

## Comparisons

### Q: Valgrind/Memcheck vs ASan + LSan — when do you reach for each? (The senior differentiator.)

> **Testing:** The comparison every memory-tools interview pivots on.

**A.** They overlap but trade differently:

| Axis | Memcheck (Valgrind) | ASan + LSan |
| --- | --- | --- |
| Recompile? | **No** — runs the binary | **Yes** — `-fsanitize=address` |
| Slowdown | ~20-50× | ~2× |
| Memory overhead | High (shadow A/V-bits) | ~3× (shadow + redzones) |
| Uninitialized reads | **Yes** (V-bits) | **No** (that's MSan) |
| Leak detection | Yes (at exit) | Yes (LSan, on by default in ASan) |
| Out-of-bounds / UAF | Yes | Yes (often *better* messages) |
| Third-party binary | **Yes** | No (needs rebuild of the code under test) |

**Reach for ASan+LSan** as the *default*: it's an order of magnitude faster, so it goes in CI and you can even run it under load; the diagnostics are excellent. **Reach for Valgrind** when you **can't recompile** (release artifact, vendored binary, no toolchain), when you need **uninitialized-value detection** without bringing in MSan's heavy requirements, or when ASan and the target are incompatible. The crisp framing: *ASan is the fast CI gate; Valgrind is the recompile-free, catches-uninitialized-reads heavyweight you keep for the cases ASan can't reach.*

### Q: What is MSan's niche, and why isn't it just "use it instead of Valgrind for uninitialized reads"?

> **Testing:** Whether you know MSan's *deployment* cost, not just its purpose.

**A.** **MemorySanitizer** is the specialist for **uninitialized-value reads** — the same class Memcheck catches via V-bits, but at ASan-like speed (~3×) with origin tracking built in. Its niche is exactly that one bug class. The catch — and why you can't casually swap it for Valgrind — is that MSan requires **every piece of code in the process to be instrumented**, *including all dependencies and libc*. If any library isn't MSan-built, its writes look "uninitialized" to MSan and you drown in false positives. In practice that means building an MSan-instrumented libc++/libc (the documented `-stdlib=libc++` + instrumented-libc setup), which is a real toolchain project. So: MSan is the right tool when you can afford to instrument the whole world (often big monorepos with a hermetic toolchain); Valgrind catches the same class with **zero** build setup but at 20-50×. You trade build effort for runtime speed.

### Q: Helgrind/DRD vs ThreadSanitizer — same comparison for *concurrency* bugs?

> **Testing:** Whether the Valgrind-vs-sanitizer reasoning generalizes to data races.

**A.** Same shape as Memcheck-vs-ASan. **Helgrind** and **DRD** are Valgrind tools that detect data races and lock-ordering problems with **no recompile**, at the usual heavy Valgrind slowdown. **ThreadSanitizer (TSan)** detects data races at compile-time instrumentation, ~5-15×, with generally sharper reports and lower noise. So for a codebase you can rebuild, **TSan is the default** for race detection (it goes in CI). **Helgrind/DRD** earn their place when you can't recompile, or to cross-check a suspected race against a different detection algorithm. The principle is consistent across the whole family: *sanitizers are the faster, recompile-required default; Valgrind tools are the slower, recompile-free fallback that also work on binaries you don't own.* See [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md).

### Q: Given all that, when is Valgrind still the *right* — or the *only* — tool?

> **Testing:** Whether you can defend Valgrind's continued relevance instead of treating it as legacy.

**A.** Valgrind is the right or only tool when:

1. **You can't recompile** — a release binary, a closed-source third-party executable, or a `.so` you don't have source for. Sanitizers need to rebuild the code under test; Valgrind doesn't.
2. **You need uninitialized-read detection with no toolchain project** — MSan would be faster but demands instrumenting all deps; Valgrind catches it out of the box.
3. **The toolchain or platform can't do sanitizers** — older compilers, exotic targets, or a build you can't modify.
4. **You want a second, independent opinion** — Valgrind's emulation-based detection sometimes catches things instrumentation misses, and vice versa; running both narrows down ambiguous bugs.
5. **Deeper analyses** — Massif (heap profiling over time), Cachegrind/Callgrind (cache and call-graph profiling) have no direct sanitizer equivalent.

The honest summary: for *new* C/C++ you can rebuild, sanitizers win on speed and ergonomics, but Valgrind's recompile-free reach keeps it indispensable for shipped artifacts, third-party code, and the 3-a.m. "I only have this binary" situation.

---

## Practice at Scale

### Q: How do you structure memory checking in CI for a large C/C++ codebase?

> **Testing:** Whether you know the standard layered strategy, not just "run Valgrind."

**A.** Layered by cost:

- **Per-PR / per-commit:** build the test suite with **ASan (which includes LSan)** and **UBSan**, run it, and **fail the build on any finding** (`ASAN_OPTIONS=detect_leaks=1`, `halt_on_error=1` for UBSan). This is the fast gate — ~2× is cheap enough to run on every change. LSan-inside-ASan is your everyday leak gate.
- **Nightly / scheduled:** run the suite (or the slow integration tests) under **Valgrind Memcheck** with `--error-exitcode=1`. The 20-50× cost is fine overnight, and it catches the uninitialized-value and recompile-free cases ASan can't. Also a good place for TSan and MSan runs if you have them.
- **Pre-release:** Valgrind against the actual **release artifact** (no recompile needed — that's the point), plus a Massif run to sanity-check the heap profile.

The discipline: the gate is *automatic and blocking*. "We run Valgrind sometimes manually" means leaks ship. See [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md) for combining these with fuzzing.

### Q: What are suppressions, and how do you avoid them rotting into a way to hide real bugs?

> **Testing:** Operational maturity — suppressions are necessary but dangerous.

**A.** A **suppression** is a rule that tells Memcheck (or a sanitizer) to *ignore* a specific error matched by its stack signature — used for known-benign reports you can't fix: a leak inside a third-party library, a deliberate one-time global allocation, a benign padding read. You generate them with `--gen-suppressions=all` and load them with `--suppressions=foo.supp`. The danger is they're matched by **stack pattern**, so an over-broad suppression can silently swallow *new, real* bugs that happen to share frames. Discipline: keep them **narrow** (match as many frames as needed to be specific), **comment every one** with *why* it's benign and a ticket link, **review them in code review** like any other code, and **audit periodically** — a growing suppression file is a smell. A suppression should be a documented exception, never a way to make the build green.

### Q: A daemon's RSS grows over days. Why is Valgrind's exit-time leak check the *wrong* primary tool, and what do you use instead?

> **Testing:** The exit-time-vs-steady-state distinction — the senior insight of this topic.

**A.** Memcheck's leak check fires **at process exit**, classifying what's *unreachable* then. A long-running daemon (1) may not exit for days, and (2) its growth is often **still-reachable** memory — caches, pools, containers you keep appending to — which is *not* a "leak" by Memcheck's definition even though RSS climbs without bound. So exit-time leak accounting can report "no leaks" while the service slowly OOMs. The right tools target **steady-state growth, not exit-time reachability**:

- **Massif** (Valgrind's heap profiler) — snapshots the heap over time and shows *which call sites' allocations grow*, so you see the trend, not just the end state.
- **Heap profilers** — `jemalloc`/`tcmalloc` heap profiling, or `heaptrack` — lower overhead, designed for long runs, give allocation-site growth over time.
- **RSS / memory metrics over time** — plot the process's memory in your monitoring; a steady upward slope under steady load is the signal, and correlating it with deploys/load tells you where to look.

The framing that lands: *Valgrind answers "what's unreachable at exit?"; a growing daemon needs "what's growing at steady state?" — different question, different tool.*

### Q: What are Valgrind client requests, and when would you use them with a custom allocator?

> **Testing:** Deep knowledge — making Memcheck understand a non-standard allocator or pool.

**A.** **Client requests** are macros from `valgrind/memcheck.h` you compile into your program that talk to Memcheck directly — they're no-ops when not running under Valgrind. The main use is teaching Memcheck about a **custom allocator or memory pool** that doesn't go through `malloc`/`free`, which Memcheck otherwise can't track. You annotate your pool with `VALGRIND_CREATE_MEMPOOL`, then `VALGRIND_MEMPOOL_ALLOC` / `VALGRIND_MEMPOOL_FREE` on each sub-allocation, so Memcheck applies the same A-bit/redzone/use-after-free machinery to pool blocks as it does to real `malloc`. Other useful ones: `VALGRIND_MAKE_MEM_UNDEFINED` / `_DEFINED` / `_NOACCESS` to manually set V-bits and A-bits (e.g. mark freed-to-pool memory as inaccessible so use-after-pool-free is caught), and `VALGRIND_CHECK_MEM_IS_DEFINED` to assert definedness at a point. Without these, a slab/arena allocator is a blind spot — Memcheck sees one big `malloc` and misses every overrun and use-after-free *within* it.

---

## Scenario & Debugging

### Q: Memcheck reports `definitely lost: 1,024 bytes in 1 blocks` with a stack trace. Walk me through fixing it.

> **Testing:** Calm, methodical triage instead of guessing.

**A.** Step by step:

1. **Read the stack — it points at the *allocation*.** The "definitely lost" block's stack trace shows where the memory was `malloc`'d/`new`'d, e.g. `parse_config (config.c:88)`. That's the birthplace, not necessarily the bug, but it's the anchor.
2. **Confirm it's real, not still-reachable.** "Definitely lost" means *no* pointer reaches it — a genuine leak, so it's worth fixing (unlike "still reachable").
3. **Trace ownership from the allocation site.** Who was supposed to free this? Follow the pointer's lifetime: is it stored in a struct that's later freed *without* freeing this member? Returned and then dropped by the caller? Overwritten by a second allocation before the first was freed (a classic: `p = malloc(); ... p = malloc();`)?
4. **Apply the matching `free`/`delete`** on every path, *including* early-return and error paths — leaks love error paths (`goto fail;` ladders, exceptions). Match the form: `free` for `malloc`, `delete`/`delete[]` for `new`/`new[]`.
5. **Re-run Memcheck and confirm the block — and any indirectly-lost children — are gone.**

The instinct to demonstrate: the stack is the *start* of the investigation (where it was born), and the fix is about *ownership and every exit path*, not just dropping a `free` after the allocation line.

### Q: You get `Conditional jump or move depends on uninitialised value(s)`. What's wrong, and how do you find the origin?

> **Testing:** Applying the use-vs-origin mechanism to a real workflow.

**A.** Something **read a value that was never initialized**, and that value then drove a **branch** (or a syscall). What's wrong is *not* at the line in the trace — that's the *consumption* site (the `if`/the `write()`); the bug is wherever the memory was allocated-but-never-written. Workflow:

1. **Re-run with `--track-origins=yes`.** The report gains an "Uninitialised value was created by a heap allocation at …" (or "by a stack allocation in function …") block pointing at the **origin**.
2. **Inspect the origin.** Common findings: a struct field never set; **padding bytes** written wholesale via `memcpy`/`write` (benign but real); a buffer read beyond the populated length; a conditionally-assigned variable read on the unassigned path.
3. **Fix at the origin** — zero-initialize (`= {}`, `memset`), set the missing field, or correct the length. For genuinely-benign padding in a hot path, suppress *deliberately* with a commented suppression rather than masking it blindly.

The key sentence: *the trace blames the use; `--track-origins=yes` reveals the birth; you fix the birth.*

### Q: A daemon's RSS climbs steadily but Memcheck reports **no leaks**. What's happening?

> **Testing:** The capstone — exit-time semantics vs steady-state growth.

**A.** The growth is almost certainly **still-reachable** memory, not a leak. Memcheck only flags memory that's *unreachable at exit*; memory you're still holding a pointer to — an **unbounded cache**, a connection or buffer **pool that never shrinks**, a global list/map you keep `push_back`-ing to, a logger buffering forever — is fully reachable, so Memcheck (correctly, by its definition) says "no leak" even as RSS climbs. Possibilities to distinguish:

- **Unbounded reachable growth** (most common): a cache/container with no eviction. Reachable but growing without limit.
- **Allocator retention / fragmentation:** memory *is* freed back to the allocator but not returned to the OS, so RSS stays high while the heap has free holes — not a leak at all.
- **Memory outside Memcheck's view:** `mmap`'d regions, GPU memory, or a custom allocator Memcheck doesn't track (absent client requests).

How to actually find it: stop asking "what's unreachable at exit?" and ask "**what's growing over time?**" — run **Massif** or **heaptrack** to see which allocation sites grow across the run, and watch the allocator's own stats (`malloc_stats`, jemalloc profiling). The fix is usually a **bound**: cap the cache, add eviction, shrink the pool — not a missing `free`. This is the scenario that most cleanly separates someone who's only memorized "Valgrind finds leaks" from someone who understands what its leak check actually measures.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One sentence — what is a memory leak?** A: Heap memory still allocated but no longer reachable, so it can't be used or freed.
- **Q: Does Valgrind need a recompile?** A: No — it instruments the binary at runtime; `-g` just makes the stacks readable.
- **Q: Typical Memcheck slowdown?** A: ~20-50× — it runs your code on an emulated CPU with checks on every access.
- **Q: A-bits vs V-bits?** A: A-bits = is this *address* legal to touch (per byte); V-bits = is this *value* defined (per bit).
- **Q: Which leak category do you fix first?** A: Definitely lost.
- **Q: Is "still reachable" a leak?** A: Not by the strict definition — usually benign on exit, but watch its *growth* in a daemon.
- **Q: Why does the uninitialized-value report point at the wrong line?** A: It fires at the *use* (a branch/syscall); the origin is elsewhere — `--track-origins=yes` finds it.
- **Q: What does `--track-origins=yes` cost?** A: Roughly doubles time and memory; that's why it's off by default.
- **Q: ASan vs Valgrind in one line?** A: ASan = ~2×, needs recompile, no uninitialized-read detection; Valgrind = ~20-50×, no recompile, catches uninitialized reads.
- **Q: What does LSan do, and where does it live?** A: Leak detection; it ships inside ASan and is on by default there.
- **Q: MSan's one big requirement?** A: All code in the process — including deps and libc — must be MSan-instrumented, or you get false positives.
- **Q: Helgrind/DRD vs TSan?** A: Same as Memcheck vs ASan but for data races — Valgrind tools are recompile-free and slower; TSan needs a rebuild and is faster.
- **Q: What's a suppression?** A: A stack-signature rule to ignore a known-benign error; keep it narrow and commented or it hides real bugs.
- **Q: Right tool for a long-running daemon's growth?** A: Massif / heaptrack / RSS trends — not Valgrind's exit-time leak check.
- **Q: When is Valgrind the *only* option?** A: When you can't recompile — a release binary or third-party `.so` you don't have source for.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Thinking Valgrind only finds leaks (missing invalid read/write, use-after-free, uninitialized values).
- Treating all four leak categories as equally urgent, or not knowing them.
- Chasing "still reachable" in a short-lived tool, or calling it a definite leak.
- "Fix" the uninitialized-value report by editing the line in the trace (the *use*), not the origin.
- Not knowing why Valgrind is slow (and therefore not connecting it to "no recompile").
- "Just run Valgrind in CI on every PR" — ignoring that 20-50× makes ASan the right per-PR gate.
- Believing Valgrind will catch a daemon's still-reachable RSS growth.
- Sprinkling suppressions to make the build green with no comments or review.

**Green flags:**

- Correcting "the leak tool" to "a memory-error detector that also reports leaks at exit."
- Triaging by leak category (definitely → indirectly → possibly → still reachable).
- Naming the use-vs-origin distinction and reaching for `--track-origins=yes`.
- Explaining the ~20-50× as a *consequence* of DBI on a synthetic CPU, tied to the no-recompile property.
- Framing the strategy as **LSan-in-ASan per-PR, Valgrind nightly / on release artifacts**.
- Knowing exit-time leak checks are the wrong tool for steady-state daemon growth, and naming Massif/heaptrack/RSS-trends.
- Caveating MSan ("faster, *but* you must instrument all deps and libc").
- Treating suppressions as documented, reviewed exceptions, not a green-build hack.

---

## Cheat Sheet

| Concept | One-liner |
| --- | --- |
| Memory leak | Allocated heap memory that's no longer reachable. |
| Memcheck | Valgrind's default tool: leaks + invalid R/W + UAF + uninitialized values + bad frees. |
| Definitely lost | No pointer reaches it — **fix first**. |
| Indirectly lost | Reachable only via a definitely-lost block — fix the root, these vanish. |
| Possibly lost | Only an interior pointer reaches it — investigate, often real. |
| Still reachable | Reachable at exit, just unfreed — usually benign; watch its *growth*. |
| A-bits | Per-byte addressability ("may I touch this address?"). |
| V-bits | Per-bit definedness ("is this value initialized?"). |
| `--track-origins=yes` | Reports where an uninitialized value was *born* (~2× cost). |
| Slowdown cause | DBI on a synthetic CPU → ~20-50× *and* no recompile needed. |
| ASan+LSan | ~2×, needs recompile, no uninitialized-read detection — the per-PR gate. |
| MSan | Uninitialized reads, fast — but must instrument all deps + libc. |
| Massif / heaptrack | Heap growth *over time* — the right tool for daemon RSS climb. |
| Client requests | `memcheck.h` macros to teach Memcheck about a custom allocator/pool. |
| Suppressions | Narrow, commented, reviewed rules to ignore known-benign errors. |

**Default invocation:**

```bash
valgrind --leak-check=full --show-leak-kinds=all \
         --track-origins=yes --error-exitcode=1 \
         --suppressions=known.supp ./myprog
```

---

## Summary

- A **memory leak** is heap memory that's allocated but unreachable — narrower than "high memory usage." **Memcheck** finds leaks *and* (more importantly) invalid reads/writes, use-after-free, uninitialized-value use, and bad frees. It needs **no recompile** because it instruments the binary at runtime.
- The **four leak categories** are the core triage tool: **definitely lost** (fix first) → **indirectly lost** (usually auto-resolved by fixing the root) → **possibly lost** (interior pointer, investigate) → **still reachable** (usually benign on exit, but watch its growth in daemons).
- **Mechanism:** Valgrind is **DBI on a synthetic CPU**, which simultaneously explains the ~20-50× slowdown *and* the no-recompile property. **A-bits** track addressability, **V-bits** track definedness; V-bit propagation is why uninitialized-value reports point at the **use**, and **`--track-origins=yes`** reveals the **origin**.
- **Comparisons (the differentiator):** ASan+LSan is the fast, recompile-required **per-PR gate** (no uninitialized-read detection); MSan catches uninitialized reads fast but must instrument **all deps + libc**; Helgrind/DRD are to TSan what Memcheck is to ASan. **Valgrind stays essential** when you can't recompile — release artifacts, third-party binaries.
- **At scale:** LSan-in-ASan per-PR, **Valgrind nightly and on release artifacts**, narrow reviewed **suppressions**, and for long-running services **Massif/heaptrack/RSS-trends** instead of exit-time checks. Teach custom allocators with **client requests**.
- **Debugging signatures:** "definitely lost" → trace ownership and every exit path; "Conditional jump … uninitialised value" → `--track-origins=yes`, fix the origin; **daemon RSS grows but Memcheck says no leak** → still-reachable growth or allocator retention, hunt it with heap profilers, not the leak check.

---

## Further Reading

- **Valgrind User Manual** — the Memcheck chapter (leak categories, A/V-bits, `--track-origins`) and the Massif chapter are the primary sources for everything here.
- **`man valgrind`** — the option reference for `--leak-check`, `--show-leak-kinds`, `--gen-suppressions`, and friends.
- **Clang LeakSanitizer documentation** — LSan standalone and inside ASan, plus `LSAN_OPTIONS` and suppression format.
- **Clang MemorySanitizer documentation** — the "instrument all dependencies" requirement and the instrumented-libc++ setup, in the library's own words.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those, from first principles up to scaled practice.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/interview.md) — the fast, recompile-required leak-and-corruption gate that LSan ships inside.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/interview.md) — the data-race counterpart, in the same sanitizer-vs-Valgrind tradeoff as Memcheck vs Helgrind/DRD.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/interview.md) — the UB detector that rounds out the per-PR sanitizer suite.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/interview.md) — combining leak/memory checks with fuzzing for deeper coverage.
- [Performance](../../performance/) — heap profiling, RSS trends, and allocator behaviour for the steady-state-growth side of memory work.
