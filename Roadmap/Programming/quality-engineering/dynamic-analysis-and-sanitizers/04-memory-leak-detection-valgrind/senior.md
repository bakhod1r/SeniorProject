# Leak Detection & Valgrind — Senior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Leak Detection & Valgrind
> *The middle page showed you `valgrind --leak-check=full` and how to read a "definitely lost" stack. This page is about the machine underneath: how Valgrind disassembles your binary into VEX IR, instruments it, recompiles it, and runs it on a synthetic CPU; how Memcheck tracks every byte and every bit of definedness; what the leak check actually does at exit (a conservative garbage collector you never asked for); and when a 20–50× tool is still the right — sometimes the only — choice over a sanitizer that needs your source.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The DBI Core: VEX, Instrumentation, the Synthetic CPU](#core-concept-1--the-dbi-core-vex-instrumentation-the-synthetic-cpu)
5. [Core Concept 2 — Memcheck's Shadow State: A-bits and V-bits](#core-concept-2--memchecks-shadow-state-a-bits-and-v-bits)
6. [Core Concept 3 — Why an Uninitialised Value Is Reported Late, and `--track-origins`](#core-concept-3--why-an-uninitialised-value-is-reported-late-and---track-origins)
7. [Core Concept 4 — The Leak-Detection Algorithm: A Conservative GC at Exit](#core-concept-4--the-leak-detection-algorithm-a-conservative-gc-at-exit)
8. [Core Concept 5 — The Limits of Conservative Scanning, and Client Requests](#core-concept-5--the-limits-of-conservative-scanning-and-client-requests)
9. [Core Concept 6 — LeakSanitizer Internals: The Same Idea at Native Speed](#core-concept-6--leaksanitizer-internals-the-same-idea-at-native-speed)
10. [Core Concept 7 — Valgrind vs ASan vs MSan vs Helgrind/TSan: Hard Numbers](#core-concept-7--valgrind-vs-asan-vs-msan-vs-helgrinddrd-vs-tsan-hard-numbers)
11. [Core Concept 8 — Performance Tuning and the Flags That Matter](#core-concept-8--performance-tuning-and-the-flags-that-matter)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How Valgrind actually works, and the trade-offs a senior reasons about when choosing between a binary-instrumenting tool and a compile-time sanitizer.**

By the middle level you can run Memcheck, read an `Invalid read of size 4`, and chase a "definitely lost" block to its allocation stack. That makes you effective in a debugging session. The senior jump is mechanistic and strategic. You now know that *no instruction of your program ever runs natively* under Valgrind — every basic block is disassembled into VEX intermediate representation, instrumented, recompiled to host code, and executed on a synthetic CPU. That single fact explains the 20–50× slowdown, the serialized threads, and the superpower: it needs **no recompile** and sees **every instruction**, including code inside opaque third-party `.so`s you have no source for.

You also know what Memcheck is really tracking: a per-byte **A-bit** (is this address valid to touch?) and a per-bit **V-bit** (is this bit defined?), propagated through every arithmetic op and copy, so an uninitialised value is reported only when it finally *affects observable behaviour* — a branch, a syscall argument, an address computation. And you know the leak check is a **conservative garbage collector** that scans from roots at exit and classifies each block as definitely / indirectly / possibly / still reachable.

Each of these is a decision with second-order effects: test wall-time, what bug classes you catch, whether you need to recompile the world, and whether you can run on a binary you didn't build. To choose well you have to understand the machine, because that is where both the power and the cost physically live. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — running Memcheck, the leak categories, reading an invalid-access and a leak report.
- **Required:** A working memory of virtual memory and the heap: `malloc`/`free`, pages, the stack, what a "root" is in GC terms.
- **Helpful:** You can read a disassembly and picture "the tool inserts a check before this load/store/branch."
- **Helpful:** You've shipped C/C++ and felt the gap between "passes tests" and "leak-free and defined under real input."
- **Helpful:** Familiarity with [01 — AddressSanitizer](../01-address-sanitizer-asan/senior.md) and [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md) so the comparisons land.

---

## Glossary

| Term | Meaning |
|---|---|
| **DBI** | Dynamic Binary Instrumentation — analyzing/modifying a program's machine code as it runs, with no source or recompile. |
| **VEX** | Valgrind's RISC-like, architecture-neutral intermediate representation. All guest code is lifted to VEX, instrumented, and recompiled. |
| **Guest / host** | *Guest* = the program being analyzed (its registers/state are simulated). *Host* = the real CPU Valgrind's recompiled code runs on. |
| **Tool / core** | Valgrind = a core (the DBI engine) + a *tool* plugin (Memcheck, Helgrind, DRD, Massif, Callgrind…). The tool decides what to instrument. |
| **A-bit (addressability)** | One shadow bit per application byte: may the program legally read/write this byte? |
| **V-bit (validity/definedness)** | One shadow bit per application *bit*: has this bit been initialised with a real value? |
| **Origin tracking** | `--track-origins=yes`: extra shadow state recording *where* an undefined value came from, so reports name the source. |
| **Definitely lost** | A heap block with no pointer to it anywhere reachable — a true leak. |
| **Indirectly lost** | A block reachable only through a definitely-lost block (e.g., a child node hanging off a leaked tree root). |
| **Possibly lost** | A block reachable only via an *interior* pointer (points into the middle, not the start) — could be a leak or a legitimate pattern. |
| **Still reachable** | A block with a live start-pointer at exit — not freed, but not lost; usually a "didn't bother to free at shutdown." |
| **Client request** | A magic no-op macro (`VALGRIND_*`) the program embeds to talk to the tool — e.g., to register a custom allocator's blocks. |
| **Quarantine / freelist** | Freed blocks Valgrind holds back from reuse (`--freelist-vol`) so use-after-free has a window to be caught. |

---

## Core Concept 1 — The DBI Core: VEX, Instrumentation, the Synthetic CPU

Valgrind is not a debugger and not a `LD_PRELOAD` shim. It is a **dynamic binary instrumentation** framework: a just-in-time recompiler that takes your already-compiled machine code and runs a *rewritten* version of it on a simulated CPU. The pipeline, per basic block, is **disassemble → IR → instrument → IR → recompile**:

1. **Disassemble to VEX.** When control reaches a block of guest code Valgrind hasn't seen, the core lifts that x86-64/ARM/… machine code into **VEX**, a small, RISC-like, architecture-neutral IR. A messy `lock add` with implicit flag side effects becomes explicit IR operations on explicit temporaries.
2. **Instrument the IR.** The *tool* (Memcheck, Helgrind, …) walks the VEX and inserts its own IR — for Memcheck, a definedness/addressability check around every load, store, and conditional. The core itself is tool-agnostic; the plugin decides what to add.
3. **Recompile to host code.** The instrumented VEX is compiled back down to real host instructions and cached in a *translation cache* (keyed by guest address), so a hot loop is lifted once and reused.
4. **Run on the synthetic CPU.** Guest registers, the program counter, condition flags — all live in a simulated CPU state in memory, not in the real hardware registers. The recompiled, instrumented code runs and updates that simulated state.

> **Key insight:** Under Valgrind, *not one instruction of your program executes natively.* Everything is recompiled and runs on a synthetic CPU. That is the root cause of every Valgrind property — good and bad — and the single most important thing to understand about the tool.

Three consequences fall directly out of that:

- **~20–50× slowdown.** Each guest instruction becomes many host instructions, plus per-memory-access shadow work. Memcheck (the default and heaviest common tool) is typically toward the high end; bare `--tool=none` (Nulgrind, no instrumentation) is still several × because everything is still recompiled and simulated.
- **Threads are serialized.** Valgrind runs guest threads on a single host thread, switching between them at a coarse granularity. A bug that needs true parallelism may not reproduce; conversely, the serialization is *why* race-detection (Helgrind/DRD) must reconstruct the happens-before order rather than observe real contention.
- **No recompile, sees everything.** Because it instruments *machine code*, it needs no source, no special build flags, and works on stripped third-party binaries. And it sees *every* instruction your process executes, including inside `libc`, plugins, and dlopen'd modules — code a compile-time sanitizer never instrumented.

```bash
valgrind --tool=none ./app          # Nulgrind: DBI overhead only, no checks (~3-5x)
valgrind --tool=memcheck ./app      # default; full A-bit/V-bit + leak check (~20-50x)
valgrind -v ./app 2>&1 | grep -i 'translat'   # see translation-cache activity
```

This is the fundamental architectural fork versus the sanitizers: ASan/MSan/TSan are **compile-time** — the *compiler* injects checks into your code, so they need source and a rebuild but run at native-ish speed. Valgrind is **run-time** — it injects checks into the *binary*, so it needs neither but pays the recompilation tax forever.

---

## Core Concept 2 — Memcheck's Shadow State: A-bits and V-bits

Memcheck maintains two parallel shadow descriptions of memory, at two different granularities, and the distinction is the heart of the tool.

**A-bits — addressability, one bit per application byte.** For every byte of the address space, an A-bit records "is the program allowed to access this byte right now?" A `malloc(40)` makes 40 bytes addressable; the bytes immediately around it (Memcheck's red-zones, default 16 bytes each side via `--redzone-size`) stay unaddressable. `free()` flips the block back to unaddressable. The stack pointer moving sets/clears A-bits for the freshly (de)allocated frame. Any load or store whose target byte has A=invalid is an **Invalid read/write** — that's how Memcheck catches heap-buffer-overflow, use-after-free, and reads off the end of the stack.

**V-bits — validity/definedness, one bit per application *bit*.** This is the finer and subtler shadow. For every *bit* the program can hold (in memory *and* in the guest's simulated registers), Memcheck tracks "has this bit been given a defined value, or is it still the garbage `malloc` returned?" `malloc` returns memory marked **undefined** (V=undefined); `calloc` returns it **defined** (zeroed). Writing a defined value defines those bits; copying propagates the source's V-bits to the destination.

The expensive, clever part is **V-bit propagation through computation**. Memcheck doesn't just track which *bytes* are uninitialised; it models how definedness flows through arithmetic and logic, bit by bit, with shadow operations that mirror the real ones:

- `defined + defined → defined`; `undefined + anything → (largely) undefined`, with carry modelled so the affected high bits become undefined too.
- `x & 0 → defined` (the result is provably 0 regardless of `x`'s garbage); `x | 0xFF…F → defined`. Memcheck is precise enough that masking *off* the undefined bits yields a defined result — which is exactly why bitfield code that reads-modifies-writes a partially-defined word doesn't drown you in false positives.
- A copy (`memcpy`, struct assignment, register move) copies V-bits verbatim, so an uninitialised field stays uninitialised through arbitrary plumbing until something *consumes* it.

```c
int x;                 // V = all-undefined
int y = x & 0;         // V = defined  (& 0 ⇒ provably 0)  → NO report
int z = x + 1;         // V = undefined (carry from undefined low bit)
if (z == 7) { ... }    // ← HERE the undefined value reaches a branch → REPORT
```

> **Key insight:** A-bits answer *"may I touch this address?"* (one bit per byte). V-bits answer *"is this value real?"* (one bit per bit, even in registers). Invalid-access bugs are A-bit failures; uninitialised-value bugs are V-bit failures. They are different shadow machines with different granularities, and conflating them is the most common Memcheck misunderstanding.

---

## Core Concept 3 — Why an Uninitialised Value Is Reported Late, and `--track-origins`

A naive checker would warn the instant you *read* an uninitialised variable. Memcheck deliberately does not. It propagates V-bits through copies and arithmetic silently, and emits **"Conditional jump or move depends on uninitialised value(s)"** (or "Use of uninitialised value", or "Syscall param … points to uninitialised byte(s)") only when an undefined value finally **affects observable behaviour**:

- it controls a **branch** (`if`, `switch`, `cmov`), or
- it's used as an **address** (dereference, indexing), or
- it's passed to a **syscall** (e.g., `write(2)`'ing undefined bytes).

This is a principled choice, not laziness. Copying garbage around is harmless and ubiquitous (padding bytes in structs, over-read buffers that are masked later); reporting every such copy would bury the real bug under noise. By waiting until the value *matters*, Memcheck reports only consequential uses — but at a cost:

- **The report is at the consumption site, not the origin.** "Conditional jump depends on uninitialised value" tells you *where it bit you* (the `if`), which can be thousands of instructions and several functions away from the `malloc` that returned the garbage. The default report can't tell you where the undefinedness was *born*.

`--track-origins=yes` fixes the locality problem by maintaining *additional* shadow state: alongside the V-bits, it records a compact **origin** for undefined data — which heap allocation, which stack frame, or which client request created it — and carries that origin through propagation. When the value is finally consumed, the report names the source:

```
==12345== Conditional jump or move depends on uninitialised value(s)
==12345==    at 0x40070C: main (leak.c:18)
==12345==  Uninitialised value was created by a heap allocation
==12345==    at 0x4C2FB0F: malloc (vg_replace_malloc.c:299)
==12345==    by 0x4006E2: main (leak.c:14)
```

That second stanza is the payoff: *created by a heap allocation … at malloc … by main (leak.c:14)*. Without origins you'd see only the first stanza and have to reason backward by hand.

> **Key insight:** Origin tracking is a memory/CPU trade, not free truth. The Valgrind manual quotes roughly **+50% runtime and a substantial memory increase** for `--track-origins=yes`. Run *without* it to triage fast and confirm a bug exists; switch it *on* for the specific repro once you need to know *where the garbage came from*. Don't leave it on for an entire CI suite by reflex.

---

## Core Concept 4 — The Leak-Detection Algorithm: A Conservative GC at Exit

When the program exits (or when you trigger a check via `VALGRIND_DO_LEAK_CHECK`), Memcheck runs a **conservative, garbage-collector-style scan** over the heap. It is not magic and not tracing-as-you-go; it's a mark phase:

1. **Identify roots.** The static data segments, the stacks of all threads, and the simulated registers — anything that could legitimately hold a live pointer.
2. **Scan roots for plausible pointers.** Walk those root regions word by word; any word whose value falls inside a known heap block is treated as a pointer to it. (This is "conservative" because Memcheck can't know an `int` that happens to equal a heap address isn't a pointer — it assumes it might be.)
3. **Transitively mark.** From each reached block, scan *its* bytes for more plausible pointers, marking what they reach — a standard mark-sweep reachability closure.
4. **Classify every still-allocated block** by *whether* and *how* it's reachable:

| Category | Reached by… | Meaning |
|---|---|---|
| **Still reachable** | a pointer to the **start** of the block, from a root chain | Not freed, but you *could* free it — pointer still live at exit. |
| **Definitely lost** | nothing | True leak. No pointer anywhere reachable points to it. |
| **Indirectly lost** | only via a **definitely-lost** block | Child of a leaked structure (free the root and these go too). |
| **Possibly lost** | only via an **interior** pointer (into the middle, not the start) | Ambiguous — could be a leak, could be a legitimate interior-pointer design. |

The **interior-pointer** rule is the subtle one. If the only thing pointing at a 100-byte block is a pointer to byte +8 of it, Memcheck can't be sure that's a real reference to the block or a coincidence/`std::vector`-internals/tagged-pointer artifact — so it hedges with **"possibly lost"**. `--show-possibly-lost=no` suppresses that category when you've decided it's noise; `--show-reachable=yes` (now spelled `--leak-check-heuristics` plus `--show-reachable`) adds the still-reachable blocks, which you usually *don't* want unless you're hunting "we never free at shutdown" issues.

```bash
valgrind --leak-check=full --show-leak-kinds=all --errors-for-leak-kinds=definite ./app
# definitely + indirectly + possibly + still-reachable shown; only DEFINITE fails the exit code
```

```
==9001== 40 bytes in 1 blocks are definitely lost in loss record 1 of 2
==9001==    at 0x4C2FB0F: malloc (vg_replace_malloc.c:299)
==9001==    by 0x40060B: make_node (leak.c:7)
==9001==    by 0x400651: main (leak.c:21)
==9001==
==9001== LEAK SUMMARY:
==9001==    definitely lost: 40 bytes in 1 blocks
==9001==    indirectly lost: 0 bytes in 0 blocks
==9001==      possibly lost: 0 bytes in 0 blocks
==9001==    still reachable: 1,024 bytes in 1 blocks
```

> **Key insight:** Memcheck's leak check is the *same algorithm* a tracing GC's mark phase uses — reachability from roots — run once at exit by reading raw memory rather than by understanding your types. That's why it's powerful (works on any program, no annotations) and why it's *conservative* (a non-pointer that looks like a pointer keeps a dead block "alive"; a real pointer in disguise makes a live block look "lost").

---

## Core Concept 5 — The Limits of Conservative Scanning, and Client Requests

Conservative pointer scanning is robust but defeatable, and a senior must recognize the failure modes:

- **Pointers in disguise.** If a pointer is stored *encoded* — XORed, offset, tagged in its low bits, packed into a non-pointer-sized field — the word-by-word scan won't recognize it as pointing into the block. The classic case is an **XOR-linked list**, where each node stores `prev XOR next`; neither stored word is a valid address on its own, so the whole list looks **definitely lost** even though it's perfectly live and traversable. Tagged pointers (low bits used as flags) can also dodge the scan if the tag pushes the value outside the block's range.
- **False positives from value collisions.** Conversely, a plain `size_t` that happens to equal a heap address makes a genuinely-dead block report as **still reachable** — a *missed* leak. Conservative scanning errs toward "reachable," so it under-reports rather than over-reports leaks.
- **Custom allocators defeat per-block tracking.** Memcheck knows about `malloc`/`free`/`new`/`delete` because it *replaces* them (`vg_replace_malloc.c`). A program that `mmap`s one big arena and hands out chunks from it with its own allocator is, to Memcheck, holding *one* giant still-reachable block — it has no idea about the sub-allocations, so it can neither detect a sub-block leak nor an intra-arena overflow.

The escape hatch is the **client request API**: magic macros (defined in `valgrind/valgrind.h` and `valgrind/memcheck.h`) that compile to near-no-op instruction sequences the core recognizes. They let the program *teach* the tool about memory it manages itself:

```c
#include <valgrind/memcheck.h>

// Teach Memcheck about a custom allocator so per-chunk tracking + leak detection work:
VALGRIND_MALLOCLIKE_BLOCK(ptr, user_size, redzone, /*is_zeroed=*/0);
VALGRIND_FREELIKE_BLOCK(ptr, redzone);

// Resize an existing tracked block:
VALGRIND_RESIZEINPLACE_BLOCK(ptr, old_size, new_size, redzone);

// Manually set definedness (e.g., a value you KNOW is initialised by inline asm / hardware):
VALGRIND_MAKE_MEM_DEFINED(buf, n);
VALGRIND_MAKE_MEM_UNDEFINED(buf, n);     // re-poison after recycling a slab slot
VALGRIND_MAKE_MEM_NOACCESS(guard, n);    // make a guard region unaddressable

// Trigger a leak check mid-run (e.g., end of a request, to find per-request leaks):
VALGRIND_DO_LEAK_CHECK;
int still = VALGRIND_COUNT_LEAKS(leaked, dubious, reachable, suppressed);
```

`MALLOCLIKE_BLOCK`/`FREELIKE_BLOCK` are the canonical fix for pooled/slab allocators: you call them at the boundaries where *your* allocator hands out and reclaims memory, and Memcheck regains per-object A-bit red-zones and per-object leak tracking *inside* your arena. The macros expand to nothing when not running under Valgrind (`RUNNING_ON_VALGRIND` is 0), so they're safe to leave in production builds.

> **Key insight:** Conservative scanning needs pointers to *look like* pointers and allocators to *look like* `malloc`. When your code encodes pointers or pools memory, you must meet Memcheck halfway with client requests — otherwise it lies in both directions (live data reported lost, dead data reported reachable).

---

## Core Concept 6 — LeakSanitizer Internals: The Same Idea at Native Speed

**LeakSanitizer (LSan)** is the leak-detection answer that doesn't pay Valgrind's recompilation tax. It is *compile-time*: it ships inside the ASan runtime (and as a standalone runtime), hooks `malloc`/`free` at link time to record live allocations, and at process exit runs a **mark-sweep from roots** — the *same conceptual algorithm* as Memcheck's leak scan, but executing as native code in the process rather than under a simulator.

```bash
clang -fsanitize=address  -g leak.c -o app && ./app   # LSan rides along with ASan (default on Linux x86-64)
clang -fsanitize=leak     -g leak.c -o app && ./app   # standalone LSan: leak detection only, no ASan overhead
```

Mechanically at exit, LSan: stops the world, treats registers + stacks + globals + TLS as roots, scans them (and transitively the reachable heap) for pointers into its table of live chunks, and reports every chunk it *couldn't* reach as a leak — with the allocation stack it recorded at `malloc` time:

```
=================================================================
==4242==ERROR: LeakSanitizer: detected memory leaks
Direct leak of 40 byte(s) in 1 object(s) allocated from:
    #0 0x49a2b7 in malloc (/app+0x49a2b7)
    #1 0x4b1c2e in make_node leak.c:7:16
    #2 0x4b1d40 in main leak.c:21:5
SUMMARY: AddressSanitizer: 40 byte(s) leaked in 1 allocation(s).
```

Key differences from Memcheck's leak check that drive real decisions:

- **Speed.** LSan adds essentially *nothing* on top of ASan (and standalone LSan is near-free) because it only does work at allocation and at the single exit-time scan — no per-instruction simulation. Memcheck's leak check is cheap in itself, but you pay Memcheck's whole 20–50× *to get there*.
- **"Still reachable" handling.** LSan, by default, **does not report still-reachable** blocks — its job is leaks (unreachable), not "you didn't free at shutdown." Memcheck shows them by request. This makes LSan quieter on programs that intentionally leak-at-exit (common, and fine).
- **Ignoring and suppressing.** `__lsan_ignore_object(ptr)` (from `<sanitizer/lsan_interface.h>`) tells LSan "this allocation and its transitive children are not a leak" — the native analog of a Memcheck suppression for a *specific* allocation. Broad suppression is via a file: `LSAN_OPTIONS=suppressions=lsan.supp` with `leak:pattern` lines matching function/file substrings. You can also disable scanning around a region with `__lsan_disable()` / `__lsan_enable()`.

```
# lsan.supp
leak:libfontconfig          # known one-time leaks in a third-party lib
leak:MyPool::reserve        # intentional pooled-arena allocation
```

> **Key insight:** LSan is "Memcheck's leak scan, recompiled into your binary." Same mark-sweep-from-roots idea, but it requires source + a rebuild and runs at native speed. If you *can* recompile, LSan (or ASan-with-LSan) gives you leak detection at a fraction of Memcheck's cost; you reach for Memcheck's leak check specifically when you *can't* recompile.

---

## Core Concept 7 — Valgrind vs ASan vs MSan vs Helgrind/DRD vs TSan: Hard Numbers

Each tool is a point in a space of *(needs recompile? speed? what it detects? false-positive profile?)*. Choosing well means knowing the trades concretely.

| Tool | Needs recompile? | Slowdown | Catches | Misses / cost |
|---|---|---|---|---|
| **Memcheck** | **No** | ~20–50× | invalid R/W, use-after-free, uninitialised reads, leaks, bad `free`, overlap | slow; serializes threads; intra-struct overflow; no stack-redzone for locals by default |
| **ASan** | Yes | ~2× (10–25× *faster* than Memcheck) | heap/stack/global overflow, use-after-free/return/scope, leaks (via LSan) | **no uninitialised-read detection**; ~3× memory; intra-object overflow |
| **MSan** | Yes (**all deps too**) | ~3× | uninitialised reads (the MSan specialty) | **false positives unless *every* dependency is instrumented**, libc included |
| **Helgrind** | No | very high (Valgrind-class) | data races, lock-order (deadlock potential), bad pthread use | slow; can be noisy on lock-free/atomics code |
| **DRD** | No | very high | data races, lock contention, threading API misuse | lower memory than Helgrind; different heuristics |
| **TSan** | Yes | ~5–15× | data races (happens-before) | huge virtual memory; needs recompile; not for non-pthread sync it can't model |

Reading the table as decisions:

- **ASan vs Memcheck for memory-safety + leaks.** If you can rebuild, ASan is the default: ~10–25× faster, with stronger stack/global overflow detection (red-zones around *locals* and *globals*, which Memcheck doesn't instrument). The price: ASan **cannot find uninitialised-value reads** — that's the one big class Memcheck has and ASan doesn't.
- **MSan is the recompile-based uninitialised-read tool.** It's much faster than Memcheck for that specific job — *but* its defining constraint is that **all code in the process must be MSan-instrumented**, libc and every dependency included, or you get false positives the moment uninstrumented code touches memory MSan is tracking. In practice that means an instrumented libc++/libc (Clang ships recipes) and rebuilding your dependency tree. Memcheck needs none of that, which is exactly why Memcheck survives where MSan's instrument-everything burden is impractical.
- **Helgrind/DRD vs TSan.** Same split as memory tools: TSan (recompile, ~5–15×) is the default race detector when you own the source; Helgrind/DRD (no recompile, Valgrind-class slow) is what you use on a binary you can't rebuild. See [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md).

> **Key insight:** The whole comparison collapses to one axis — *can you recompile?* If yes, the compile-time sanitizers (ASan/MSan/TSan) win on speed for their respective bug classes. If no — opaque third-party binary, a vendored `.so` with no source, a build where MSan's instrument-the-world cost is prohibitive — Valgrind is the only tool that works at all, *and* it's the gateway to **Massif** (heap profiling) and **Callgrind** (call-graph/cache profiling), which the sanitizers don't provide. See [Performance](../../performance/) for those profiling angles.

When Memcheck is still the right or only choice: a stripped vendor binary; "we cannot change the build"; MSan's all-dependencies-instrumented requirement is too costly; or you want one tool that does invalid-access + uninitialised + leaks + (with sibling tools) heap and cache profiling without ever rebuilding.

---

## Core Concept 8 — Performance Tuning and the Flags That Matter

Valgrind is slow by construction, but the flags meaningfully shape *how* slow and *what* you catch. The ones a senior reaches for:

**Leak detection scope.**
```bash
--leak-check=summary        # counts only (cheapest)
--leak-check=full           # per-leak allocation stacks (the working default)
--show-leak-kinds=all       # definite,indirect,possible,reachable
--errors-for-leak-kinds=definite   # which kinds make the exit code non-zero (CI gate)
```

**Origins — the expensive, locating option.**
```bash
--track-origins=yes         # name where undefined values came from; ~+50% time + memory
```
Triage without it; enable it for the one repro where you need the birthplace of the garbage.

**Stack depth in reports.**
```bash
--num-callers=40            # default 12; deeper frames cost memory but disambiguate deep call trees
```

**Use-after-free window — the freelist quarantine.** Freed blocks aren't returned to the allocator immediately; Memcheck holds them in a quarantine so accesses after `free` still land in tracked-as-freed memory and get caught:
```bash
--freelist-vol=200000000        # bytes of freed blocks kept quarantined (default 20,000,000)
--freelist-big-blocks=1000000   # always quarantine blocks at least this big first
```
Raising `--freelist-vol` widens the use-after-free detection window (the freed block stays poisoned-and-watched longer before reuse) at the cost of memory. Lower it on memory-tight runs; raise it when a UAF only manifests after a lot of intervening allocation churns the freelist.

**Fills — make uninitialised/freed memory obvious.**
```bash
--malloc-fill=0xAB          # paint freshly malloc'd bytes (helps spot use-before-init in a debugger)
--free-fill=0xDE            # paint freed bytes (a deref of 0xDEDEDEDE screams use-after-free)
```

**Suppressions — taming libc/optimized-code noise.** Optimized libc routines (vectorized `strlen`/`memcmp`) legitimately read past the logical end of a buffer in word-sized chunks, and some libraries leak intentionally once. Generate and curate a suppression file rather than chasing known-benign reports:
```bash
valgrind --gen-suppressions=all --leak-check=full ./app 2> sup.log   # emit ready-to-paste blocks
valgrind --suppressions=project.supp ./app                            # apply curated suppressions
```
```
{
   libc_optimized_strlen_overread
   Memcheck:Cond
   fun:__strlen_avx2
   ...
}
```

> **Key insight:** The two knobs with the biggest *behavioural* (not just speed) effect are `--track-origins` (locates uninitialised-value origins, +50%) and `--freelist-vol` (widens the use-after-free detection window). Everything else trades report richness or noise for time/memory. Tune for the *question you're asking*, not a one-size-fits-all command line.

**Determinism, ASLR, reproducibility.** Valgrind disables ASLR for the guest by default (it controls the address space), which makes addresses far more stable run-to-run than a native execution — a quiet benefit for reproducing pointer-dependent bugs. It still depends on input, thread scheduling (serialized but order-sensitive), and environment, so it's *more* reproducible than native but not perfectly deterministic. Pair a Valgrind run with the same fixed seed/input you'd use for any flaky-bug hunt.

---

## Real-World Examples

**1. A "definitely lost" leak in a request handler.**
A long-running service slowly grows RSS. Native tools show *that* it leaks; Memcheck shows *where*. Because the process is a daemon, you don't wait for exit — you wire a `VALGRIND_DO_LEAK_CHECK` at the end of each request (guarded by `RUNNING_ON_VALGRIND`) and run one request under `--leak-check=full`. The report fingers `make_node (leak.c:7)` reached from the handler with no matching `free` on an error path. One missing `free` in the early-return branch; the leak summary's *indirectly lost* count also drops to zero once you free the root, confirming the children were hanging off it.

**2. An uninitialised value that only bites under one input.**
A parser passes tests but occasionally takes a wrong branch. Memcheck (no origins) reports `Conditional jump or move depends on uninitialised value(s) at parse.c:142` — the *branch*, not the cause. Re-running that single input with `--track-origins=yes` adds *"Uninitialised value was created by a heap allocation … by alloc_token (parse.c:88)"*: a `malloc`'d token struct whose `flags` field is read before any code path sets it. The fix is a `calloc` (or an explicit init); the origin stanza turned a 30-minute backward trace into a 30-second one.

**3. A custom slab allocator hiding everything.**
A subsystem `mmap`s a 16 MB arena and sub-allocates from it. Memcheck reports one big *still reachable* block and finds neither the sub-block leak you're hunting nor the off-by-one inside a slot. You annotate the allocator's hand-out/reclaim points with `VALGRIND_MALLOCLIKE_BLOCK`/`FREELIKE_BLOCK` and add `VALGRIND_MAKE_MEM_UNDEFINED` when a slot is recycled. Now Memcheck red-zones each slot, catches the overflow as an *Invalid write*, and reports the per-slot leak — detection it physically could not do before you taught it the allocator.

**4. Opaque vendor binary, no source.**
A closed-source plugin (`.so`, stripped) is suspected of a use-after-free. There's no build to add ASan to, and MSan/TSan are off the table for the same reason. Valgrind runs the host process and the plugin *unchanged*, and Memcheck reports `Invalid read of size 8 … Address 0x… is 0 bytes inside a block of size 64 free'd` with the free stack inside the vendor code. This is the case ASan/MSan/TSan simply cannot serve — and the canonical reason Valgrind still earns its place.

---

## Mental Models

- **Your program runs on a simulated CPU, not the real one.** Disassemble → VEX → instrument → recompile → run on a synthetic CPU. Every Valgrind property (slow, serial-threaded, no-recompile, sees-everything) is a corollary of that one sentence.

- **Two shadow machines at two granularities.** A-bits (one per byte) answer "may I touch this address?" and catch invalid access / UAF / overflow. V-bits (one per bit, even in registers) answer "is this value real?" and catch uninitialised reads. Don't conflate them.

- **Uninitialised reports are "where it bit you," not "where it was born."** V-bits flow silently until a value reaches a branch/address/syscall. `--track-origins=yes` reconstructs the birthplace, for a price.

- **The leak check is a conservative GC mark phase at exit.** Reachability from roots, by reading raw memory rather than understanding types. Powerful and annotation-free; conservative and foolable (disguised pointers, value collisions, pooled allocators).

- **LSan is that same mark-sweep, recompiled into your binary.** Same idea, native speed, needs source. ASan/MSan/TSan are the recompile-based specialists; Valgrind is the no-recompile generalist that also gives you Massif/Callgrind.

- **The decision axis is "can you recompile?"** Yes → sanitizers win on speed. No → Valgrind is the only tool that runs at all.

---

## Common Mistakes

1. **Leaving `--track-origins=yes` on for the whole CI suite.** It's ~+50% time and substantial memory. Triage without it; enable it only for the specific repro where you need the origin of an undefined value.

2. **Treating "still reachable" as a leak to fix.** Still-reachable means a live pointer exists at exit — usually "didn't bother to free at shutdown," which is harmless. Gate CI on **definitely lost** (`--errors-for-leak-kinds=definite`), not on still-reachable.

3. **Trusting the leak check on code that encodes pointers.** XOR-linked lists, tagged/offset pointers, and packed handles defeat conservative scanning — live data is reported "definitely lost." Recognize the pattern and either undisguise for the run or use client requests.

4. **Running a custom/pool allocator without `MALLOCLIKE_BLOCK`.** Memcheck sees one giant block and finds neither sub-block leaks nor intra-arena overflows. Annotate the allocator's boundaries to restore per-object tracking.

5. **Expecting MSan-style cheap uninitialised detection from ASan.** ASan does *not* detect uninitialised reads — that's MSan (recompile, instrument-everything) or Memcheck (no recompile). Don't conclude "ASan is clean ⇒ no uninitialised-value bugs."

6. **Forgetting MSan needs *every* dependency instrumented.** An uninstrumented libc/dep makes MSan false-positive. If you can't rebuild the whole tree, Memcheck is the pragmatic uninitialised-read tool despite being slower.

7. **Chasing benign libc/optimized-code reports.** Vectorized `strlen`/`memcmp` over-read by design; some libs leak once intentionally. Curate a suppression file (`--gen-suppressions=all`) instead of "fixing" code that isn't broken.

8. **Assuming Valgrind reproduces threading bugs.** It serializes threads onto one host thread. A race that needs true parallelism may never fire under Memcheck; use Helgrind/DRD (or TSan) for races, not Memcheck.

---

## Test Yourself

1. Describe Valgrind's per-basic-block pipeline. Why does "no instruction runs natively" simultaneously explain the 20–50× slowdown *and* the ability to analyze a stripped third-party binary?
2. Distinguish A-bits from V-bits — granularity, the question each answers, and the bug class each detects.
3. Why does Memcheck report an uninitialised value at a branch rather than at the read that loaded it? What does `--track-origins=yes` add, and what does it cost?
4. Outline the leak-detection algorithm at exit. What distinguishes *definitely lost*, *indirectly lost*, *possibly lost*, and *still reachable* — and what specifically triggers "possibly lost"?
5. Give two ways conservative pointer scanning produces a *wrong* answer (one in each direction), and the client-request mechanism that fixes the custom-allocator case.
6. How is LeakSanitizer's algorithm related to Memcheck's leak check, and what are the three practical differences (speed, still-reachable, ignore/suppress)?
7. ASan vs Memcheck vs MSan: which needs a recompile, which finds uninitialised reads, and what is MSan's defining operational constraint?
8. Name the flag that *widens the use-after-free detection window* and explain mechanically why it works.

<details>
<summary>Answers</summary>

1. Per block: **disassemble guest machine code → VEX IR → tool instruments the IR → recompile to host code (cached) → run on a simulated CPU.** Because the program is recompiled and executed on a synthetic CPU rather than the real one, every guest instruction becomes many host instructions plus shadow work (→ 20–50×); and because instrumentation happens on the *machine code*, no source or rebuild is needed and it works on stripped binaries.
2. **A-bits:** one bit per *byte*, "may the program access this address?" — catches invalid read/write, use-after-free, heap overflow. **V-bits:** one bit per *bit* (including simulated registers), "is this value initialised?" — catches uninitialised-value use. Different granularities, different shadow machines.
3. V-bits propagate through copies/arithmetic *silently*; copying garbage is harmless and ubiquitous, so reporting it would be pure noise. Memcheck reports only when the undefined value **affects observable behaviour** — a branch, an address, or a syscall. `--track-origins=yes` adds shadow state recording *where* the undefinedness was created (heap alloc / stack frame / client request) and carries it through, so the report names the source — at roughly +50% time and significant extra memory.
4. At exit, a **conservative GC mark phase**: roots = static data + thread stacks + registers; scan them word-by-word for values that fall inside known heap blocks; transitively mark. Classify: **definitely lost** = unreachable; **indirectly lost** = reachable only via a definitely-lost block; **possibly lost** = reachable only via an **interior** pointer (into the middle, not the start); **still reachable** = a start-pointer is live at exit.
5. (a) A disguised pointer (XOR-linked list, tagged/offset pointer) isn't recognized → live data reported **definitely lost** (false positive). (b) A non-pointer value that coincidentally equals a heap address keeps a dead block **still reachable** → a *missed* leak (false negative). Custom-allocator fix: `VALGRIND_MALLOCLIKE_BLOCK` / `VALGRIND_FREELIKE_BLOCK` at the allocator's hand-out/reclaim points restore per-object red-zones and leak tracking inside the arena.
6. LSan runs the **same mark-sweep-from-roots** algorithm as Memcheck's leak check, but compiled into the binary and executed natively. Differences: (a) **speed** — near-free on top of ASan vs Memcheck's full 20–50×; (b) **still-reachable** — LSan ignores it by default, Memcheck shows it on request; (c) **ignore/suppress** — `__lsan_ignore_object` per allocation + `LSAN_OPTIONS=suppressions=` file vs Memcheck suppression blocks.
7. **ASan** needs a recompile, ~2× (10–25× faster than Memcheck), but **does not find uninitialised reads**. **Memcheck** needs no recompile and *does* find them, slowly. **MSan** needs a recompile *and* its defining constraint: **every dependency, libc included, must be MSan-instrumented**, or it false-positives.
8. **`--freelist-vol`** (raise it). Freed blocks are held in a quarantine instead of being returned to the allocator immediately; while quarantined they stay tracked-as-freed, so a post-`free` access still lands in watched memory and is reported. A bigger quarantine keeps freed blocks poisoned-and-watched longer before reuse, widening the window in which a use-after-free can be caught (at the cost of memory).

</details>

---

## Cheat Sheet

```
THE MACHINE (DBI core)
  disassemble guest code → VEX IR → tool instruments → recompile to host → run on synthetic CPU
  no instruction runs natively  ⇒  ~20-50x, threads serialized, NO recompile, sees EVERY instruction
  valgrind --tool=none ./app    Nulgrind: DBI overhead only (~3-5x)

SHADOW STATE (Memcheck)
  A-bits  1 per BYTE   "may I touch this address?"   → invalid R/W, use-after-free, overflow
  V-bits  1 per BIT    "is this value defined?"        → uninitialised-value use (reported at branch/addr/syscall)
  x & 0 ⇒ defined;  malloc ⇒ undefined;  calloc ⇒ defined;  copies propagate V-bits

LEAK CHECK (conservative GC at exit)
  roots = static data + stacks + registers → scan for plausible pointers → mark transitively
  definitely lost   no pointer anywhere            ← TRUE LEAK (gate CI on this)
  indirectly lost   only via a definitely-lost blk  ← child of a leaked structure
  possibly lost     only via an INTERIOR pointer    ← ambiguous
  still reachable   live start-pointer at exit      ← usually fine (didn't free at shutdown)

KEY FLAGS
  --leak-check=full --show-leak-kinds=all --errors-for-leak-kinds=definite
  --track-origins=yes        name where undefined values came from (~+50% time + memory)
  --num-callers=40           deeper stacks (default 12)
  --freelist-vol=N           bytes of freed blocks quarantined → WIDER use-after-free window
  --malloc-fill=0xAB --free-fill=0xDE     paint memory (0xDEDEDEDE deref ⇒ UAF)
  --gen-suppressions=all     emit ready-to-paste suppression blocks for libc noise

CLIENT REQUESTS (valgrind/memcheck.h)  — teach the tool about YOUR memory
  VALGRIND_MALLOCLIKE_BLOCK / FREELIKE_BLOCK     custom/pool allocators
  VALGRIND_MAKE_MEM_DEFINED / _UNDEFINED / _NOACCESS
  VALGRIND_DO_LEAK_CHECK                          mid-run leak check (per-request daemons)

LeakSanitizer (compile-time, native speed)  — same mark-sweep, recompiled in
  clang -fsanitize=address ...    (LSan rides ASan)   |   -fsanitize=leak (standalone)
  __lsan_ignore_object(p);   LSAN_OPTIONS=suppressions=lsan.supp (leak:pattern)

DECISION AXIS:  can you recompile?
  YES → ASan(~2x, no uninit) / MSan(uninit, instrument EVERYTHING) / TSan(races)
  NO  → Valgrind: Memcheck (mem+uninit+leaks) / Helgrind|DRD (races) / Massif|Callgrind (profiling)
```

---

## Summary

- **Valgrind is dynamic binary instrumentation.** It disassembles guest code into **VEX IR**, lets a *tool* (Memcheck, Helgrind…) instrument the IR, recompiles to host code, and runs it on a **synthetic CPU**. No instruction runs natively — the source of the ~20–50× slowdown, the serialized threads, and the superpower of needing **no recompile** while seeing **every instruction**, including in opaque binaries.
- **Memcheck keeps two shadow descriptions.** Per-byte **A-bits** (addressability → invalid access / UAF / overflow) and per-bit **V-bits** (definedness → uninitialised use), with V-bits propagated through arithmetic and copies so a value is reported only when it **affects observable behaviour** (branch / address / syscall). `--track-origins=yes` reconstructs *where* the garbage came from, at ~+50% cost.
- **The leak check is a conservative GC mark phase at exit** — reachability from roots by reading raw memory — classifying blocks as **definitely / indirectly / possibly / still reachable**, with *interior* pointers driving "possibly." It's annotation-free but foolable by disguised pointers, value collisions, and pooled allocators; **client requests** (`MALLOCLIKE_BLOCK`, `MAKE_MEM_*`, `DO_LEAK_CHECK`) let you teach it about memory it can't see.
- **LeakSanitizer is that same mark-sweep recompiled into your binary** — native speed, needs source, ignores still-reachable by default, with `__lsan_ignore_object`/`LSAN_OPTIONS` for control.
- **The comparison reduces to one axis — can you recompile?** If yes, the compile-time sanitizers win on speed for their classes (**ASan** ~2× but no uninitialised-read detection; **MSan** for uninitialised reads but must instrument *everything*; **TSan** for races). If no — stripped vendor binaries, prohibitive instrument-the-world cost — **Valgrind** is the only tool that runs at all, and the gateway to **Massif**/**Callgrind** profiling.

You now reason about Valgrind as a machine with predictable costs and a precise place in the toolbox. The next layer — [professional.md](professional.md) — is about operating these tools across an organization: CI gating, suppression governance, daemon/long-run strategies, and combining Valgrind with the sanitizers under real failure.

---

## Further Reading

- *Valgrind: A Framework for Heavyweight Dynamic Binary Instrumentation* — Nethercote & Seward, PLDI 2007. The core paper: VEX, the recompilation pipeline, the synthetic CPU.
- *How to Shadow Every Byte of Memory Used by a Program* — Nethercote & Seward, VEE 2007. The definitive treatment of Memcheck's A-bit/V-bit shadow machine and its propagation rules.
- [The Valgrind User Manual](https://valgrind.org/docs/manual/manual.html) — Memcheck options, the leak-check algorithm, `--track-origins`, freelist tuning, and the full client-request API (`memcheck.h`, `valgrind.h`).
- [Clang LeakSanitizer documentation](https://clang.llvm.org/docs/LeakSanitizer.html) and [MemorySanitizer documentation](https://clang.llvm.org/docs/MemorySanitizer.html) — the compile-time alternatives, including MSan's instrument-everything requirement and the standalone-LSan mode.
- `man valgrind`, and the sibling tool docs for **Massif** (heap profiling) and **Callgrind** (call-graph/cache profiling) — the profiling capabilities the sanitizers don't provide.
- For the operational layer — CI integration, suppression management at scale, long-running-service strategy — see [professional.md](professional.md).

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/senior.md) — the compile-time, ~2× alternative for invalid-access and leaks; what it catches that Memcheck doesn't (stack/global red-zones) and what it can't (uninitialised reads).
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/senior.md) — the recompile-based race detector; the TSan-vs-Helgrind/DRD split mirrors the ASan-vs-Memcheck one.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/senior.md) — the complementary compile-time tool for UB classes (overflow, alignment, bad casts) Memcheck doesn't target.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/senior.md) — fuzzing that uses a sanitizer (often ASan/LSan, sometimes Valgrind) as its bug oracle to *reach* the inputs that trip these detectors.
- [Performance](../../performance/) — where Valgrind's Massif and Callgrind tools live as profiling instruments, beyond bug detection.
