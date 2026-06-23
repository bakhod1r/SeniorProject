# Leak Detection & Valgrind — Middle Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Leak Detection & Valgrind
> *The junior page told you Valgrind finds leaks. This page opens the box: how Memcheck shadows every byte with two kinds of metadata, what the four leak categories actually mean (and which one to fix first), the rest of the toolsuite hiding behind the `valgrind` command, and when to reach for LeakSanitizer instead because Valgrind's 20–50× slowdown is too steep.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — How Memcheck Works: DBI, A-bits, and V-bits](#core-concept-1--how-memcheck-works-dbi-a-bits-and-v-bits)
5. [Core Concept 2 — The Four Leak Categories, Precisely](#core-concept-2--the-four-leak-categories-precisely)
6. [Core Concept 3 — The Valgrind Toolsuite (It's Not Just Memcheck)](#core-concept-3--the-valgrind-toolsuite-its-not-just-memcheck)
7. [Core Concept 4 — LeakSanitizer: The Fast Alternative](#core-concept-4--leaksanitizer-the-fast-alternative)
8. [Core Concept 5 — The Workflow: Flags, Suppressions, and Reading Output](#core-concept-5--the-workflow-flags-suppressions-and-reading-output)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is Memcheck actually doing to my program, what do its verdicts mean, and when should I use something faster?**

At the junior level, "run it under Valgrind, fix the leaks" is a fine habit. But it leaves three things unexplained: *how* an unmodified binary suddenly knows that byte 12 of a buffer was never initialized; *why* the report splits leaks into "definitely lost," "indirectly lost," "possibly lost," and "still reachable" instead of one number; and *why* the same program that runs in 0.4 s runs in 15 s under Valgrind.

The answers are concrete. Memcheck is a **dynamic binary instrumentation** tool: it doesn't run your program on the real CPU at all — it JIT-translates it onto a synthetic one, inserting a check around every memory access. To do that it keeps two bits of shadow metadata per byte (**A-bits** for addressability, **V-bits** for definedness), and that single design decision explains everything: the leak categories, the uninitialized-value detection that ASan *cannot* do, and the brutal slowdown. This page makes that machinery visible, then shows when [LeakSanitizer](#core-concept-4--leaksanitizer-the-fast-alternative) — near-free leak detection bundled into ASan — is the better tool.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say what a heap leak is and roughly what `valgrind ./prog` reports.
- **Required:** Comfortable in C/C++ with `malloc`/`free` (or `new`/`delete`) and the command line.
- **Helpful:** You've used [AddressSanitizer](../01-address-sanitizer-asan/middle.md) and seen its leak report at exit.
- **Helpful:** A rough sense of "stack vs heap" and what a pointer holds.

---

## Glossary

| Term | Meaning |
|---|---|
| **DBI** | Dynamic Binary Instrumentation — rewriting a program's machine code *as it runs* to insert extra checks, no source or recompile needed. |
| **Memcheck** | Valgrind's default tool: detects memory errors (OOB, use-after-free, uninitialized reads) and leaks. |
| **A-bits** | Addressability bits — 1 bit/byte: "is this address legal for the program to access right now?" |
| **V-bits** | Validity/definedness bits — 1 bit/byte: "has this byte been written with a defined value, or is it still garbage?" |
| **Shadow memory** | The parallel metadata store holding A-bits and V-bits for every byte of the program. |
| **Reachable block** | A heap block to which a pointer still exists somewhere among the roots (registers, stack, globals) or other reachable blocks. |
| **LSan (LeakSanitizer)** | A fast, compile-time leak detector that does a mark-and-sweep from roots at exit; bundled in ASan or standalone via `-fsanitize=leak`. |
| **Suppression** | A rule telling the tool to ignore a known, accepted finding (e.g., a leak inside a third-party library). |
| **Roots** | The starting points of reachability analysis: CPU registers, thread stacks, and global/static data. |

---

## Core Concept 1 — How Memcheck Works: DBI, A-bits, and V-bits

Memcheck is not a wrapper that watches `malloc`. It is a **virtual machine**. Valgrind's core JIT-translates your program's machine code, basic block by basic block, into an intermediate representation, lets Memcheck *instrument* that IR (insert checks), then JIT-compiles it back to native code and runs *that* on a synthetic CPU. Your binary never touches the real instruction stream directly. This is **dynamic binary instrumentation (DBI)**, and it's why Valgrind needs no recompilation, no source, not even debug symbols to function (symbols just make the reports readable).

The instrumentation maintains **shadow memory**: a second, hidden copy of the address space storing metadata. Memcheck keeps two pieces of metadata per byte:

- **A-bits — addressability** (1 bit/byte): *Is the program allowed to touch this byte at all?* A byte becomes addressable when allocated (heap block from `malloc`, stack frame on entry) and *unaddressable* when freed or when the frame is left. Every load and store is checked against the A-bit.
- **V-bits — validity/definedness** (1 bit/byte, *per bit* actually tracked): *Has this byte been given a defined value?* Fresh `malloc` memory is addressable but **undefined** (V-bits say "garbage"). Writing a value sets the V-bits to "defined." Reading is fine; the complaint only fires when an **undefined value affects observable behaviour** — a branch, a syscall argument, a printed value.

This two-axis design is the whole engine:

```c
char *p = malloc(10);   // A-bits: 10 bytes addressable;  V-bits: all UNDEFINED
p[10] = 'x';            // A-bit check FAILS → "Invalid write of size 1"  (OOB)
free(p);                // those 10 bytes now UNADDRESSABLE
p[0] = 'y';             // A-bit check FAILS → "Invalid write" (use-after-free)

char *q = malloc(4);
if (q[0] == 0) { ... }  // V-bit check FAILS → "Conditional jump depends on
                        //   uninitialised value(s)"
```

> **Key insight:** A-bits catch *spatial and temporal* errors (out-of-bounds, use-after-free, double-free) — the same class ASan catches. **V-bits catch the use of uninitialized values**, and this is Memcheck's unique superpower. AddressSanitizer *cannot* do this — it has no definedness metadata. Detecting uninitialized reads is exactly what a *separate* tool, MemorySanitizer (MSan), exists for. So when someone says "Valgrind found a bug ASan missed," it is almost always a V-bit (uninitialized-value) finding.

A crucial subtlety of V-bits: Memcheck does **not** complain the instant you read uninitialized memory. It propagates "undefinedness" through arithmetic (an undefined byte plus a defined byte is undefined) and only errors when that undefined value reaches a decision point — a conditional jump, an address computation, or a syscall. This avoids floods of false positives from, e.g., copying a partially-initialized struct, while still catching the moment garbage actually *influences* the program.

---

## Core Concept 2 — The Four Leak Categories, Precisely

At program exit (with `--leak-check=full`), Memcheck does a **reachability scan**: starting from the roots (registers, stacks, globals), it follows pointers and marks every heap block it can reach. Then it classifies each still-allocated block. The four categories are not bureaucracy — they are a triage order.

| Category | Definition | Severity |
|---|---|---|
| **definitely lost** | No pointer to the block exists *anywhere*. The address is gone. | **Real leak — fix first.** |
| **indirectly lost** | Only reachable *through* a definitely-lost block (e.g., children of a leaked tree node). | Symptom — vanishes when you fix the parent. |
| **possibly lost** | Only an **interior pointer** points into the block (mid-block, not to its start). | Investigate — often real, sometimes legitimate. |
| **still reachable** | A valid pointer to the block exists at exit. | Often fine — but can hide unbounded growth. |

The relationships matter:

- **definitely lost** is the unambiguous bug. You allocated, you dropped every reference, the memory is orphaned for the rest of the process. Fix these first; nothing else is worth attention until they're zero.
- **indirectly lost** is *downstream* of a definitely-lost block. Leak a linked list's head and its 999 nodes become indirectly lost. The fix is to free the head correctly; the indirect count then collapses to zero on its own. Chasing indirect leaks individually is wasted effort.
- **possibly lost** means the only surviving pointer points *into the middle* of the block, not to the address `malloc` returned. This happens legitimately (a pointer to a struct member, some `std::string` small-buffer layouts) but also flags real leaks where you've smashed the original pointer. Worth a look, not an automatic alarm.
- **still reachable** means a live pointer exists at exit — a global cache, a singleton, a buffer you simply never freed because the OS reclaims it at exit anyway. This is frequently **acceptable**. But it is the category that hides a slow leak: a cache that grows every request stays "still reachable" the whole time, so a one-shot run shows a clean "no definite leaks" while the long-running server bloats. To catch that, you compare reachable totals across runs of increasing workload, not a single exit snapshot.

```c
struct Node { struct Node *next; int v; };

struct Node *head = malloc(sizeof *head);   // (A)
head->next = malloc(sizeof *head);          // (B), reachable via A
head = NULL;                                // drop the only pointer to A
// At exit:
//   (A) → definitely lost   (no pointer anywhere)
//   (B) → indirectly lost   (only reachable through the lost A)
```

> **Key insight:** Read the report as a tree, not a flat list. **definitely lost** is the root cause; **indirectly lost** is its fallout; **still reachable** is usually noise *unless it's growing*. Fixing the definite leaks typically zeroes out the indirect ones for free. The single most common triage mistake is treating "still reachable" bytes as urgent — they often aren't, and chasing them buries the one or two definite leaks that actually matter.

---

## Core Concept 3 — The Valgrind Toolsuite (It's Not Just Memcheck)

People say "Valgrind" and mean Memcheck, but Valgrind is a **framework** for DBI tools; Memcheck is merely the default (`--tool=memcheck`). The same instrumentation engine powers a family of analyzers, each keeping different shadow state:

| Tool | What it does | When to reach for it |
|---|---|---|
| **Memcheck** (default) | Memory errors + leaks (A-bits/V-bits). | The everyday correctness tool. |
| **Massif** | Heap profiler — peak usage, *who* allocated it, over time. | "Why is RSS so high?" / capacity planning. See [Performance](../../performance/). |
| **DHAT** | Dynamic Heap Analysis Tool — allocation lifetimes, access patterns, short-lived/never-read blocks. | Finding wasteful or unused allocations. |
| **Cachegrind** | Simulates the cache hierarchy + branch predictor; per-line miss counts. | Cache-miss hotspots. → [Performance](../../performance/). |
| **Callgrind** | Cachegrind plus a full **call graph** (view with KCachegrind). | Where time goes, call-path costs. → [Performance](../../performance/). |
| **Helgrind** | Data-race + lock-ordering detector (happens-before + lockset). | Threading bugs without recompiling. |
| **DRD** | Alternative data-race detector, lighter on memory than Helgrind. | Race detection on large multithreaded apps. |
| **SGCheck** | (Experimental) stack/global array overruns Memcheck can't see. | Niche: overflows into adjacent globals. |

Two things to internalize here:

1. **Massif and Callgrind are *performance* tools, not correctness tools.** Massif answers "what is my peak heap and which call site is responsible?" — it draws a time-vs-bytes graph and attributes every byte to an allocation stack. Callgrind answers "where does CPU time go, along which call paths?" If your problem is *speed* or *memory footprint* rather than *bugs*, you are in the Performance domain — see [Performance](../../performance/) — and these are the Valgrind tools that live there.

2. **For data races, prefer ThreadSanitizer.** Helgrind and DRD *work*, but they inherit Valgrind's serialize-all-threads model and 20×+ slowdown. [ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) is a compile-time tool with ~5–15× overhead and genuine parallelism — dramatically more practical. Use Helgrind/DRD only when you cannot recompile.

> **Key insight:** "Run it under Valgrind" is ambiguous. `valgrind ./prog` runs *Memcheck*. The toolsuite splits cleanly along the correctness/performance line: Memcheck/Helgrind/DRD find **bugs**; Massif/Cachegrind/Callgrind/DHAT measure **cost**. Picking the right `--tool=` is the difference between a leak report and a heap profile.

---

## Core Concept 4 — LeakSanitizer: The Fast Alternative

Valgrind's leak detection is excellent and needs no recompile — but you pay **20–50× CPU slowdown** and a large memory blowup for it, because *every* instruction runs on the synthetic CPU. If you *can* recompile, there is a far cheaper option for the specific job of finding leaks.

**LeakSanitizer (LSan)** is a compile-time leak detector. It ships two ways:

- **Bundled inside AddressSanitizer** — when you build with `-fsanitize=address`, LSan runs automatically at process exit (on Linux x86-64) and reports leaks as part of the ASan run, *for free*.
- **Standalone** — `-fsanitize=leak` gives you leak detection *without* ASan's full memory-error instrumentation, so it's even cheaper.

Mechanically, LSan does a **mark-and-sweep at exit**: it scans the **roots** — CPU registers, thread stacks, and global/static memory — treats any word that looks like a heap pointer as a reference, transitively marks all reachable blocks, then reports every *unreachable* allocated block as a leak. This is conceptually the same reachability analysis Memcheck does, but it runs natively in the instrumented process rather than under a synthetic CPU.

The cost difference is the whole point:

| | LeakSanitizer | Valgrind (Memcheck) |
|---|---|---|
| **Requires recompile?** | Yes (`-fsanitize=address`/`leak`) | No — runs any binary |
| **CPU overhead** | ~2× (ASan) / near-zero standalone | **~20–50×** |
| **Memory overhead** | Moderate (ASan redzones) | Large (shadow + JIT) |
| **Uninitialized reads?** | **No** (that's MSan) | **Yes** (V-bits) |
| **Thread model** | Parallel | Serializes all threads |
| **Leak categories** | "directly/indirectly leaked" | 4 categories incl. "still reachable" |

```bash
# LSan via ASan — usually you already have this build for free
clang -fsanitize=address -g leak.c -o leak
./leak
# ==1234==ERROR: LeakSanitizer: detected memory leaks
# Direct leak of 100 byte(s) in 1 object(s) allocated from:
#     #0 0x... in malloc
#     #1 0x... in main leak.c:5
```

> **Key insight:** **ASan/LSan first when you can recompile; Valgrind when you can't** — or when you need something LSan lacks. The three reasons to still reach for Valgrind: (1) you only have the binary (no source, no rebuild — a third-party blob, a customer's program); (2) you need **uninitialized-read** detection and don't have an MSan build (V-bits do it; LSan can't); (3) you want **Massif/Callgrind/Cachegrind** for profiling. For the everyday "did I leak?" question on code you control, LSan is ~10–25× faster and the obvious default.

---

## Core Concept 5 — The Workflow: Flags, Suppressions, and Reading Output

The canonical Memcheck invocation for CI-grade leak hunting:

```bash
valgrind \
  --leak-check=full \          # full per-leak stack traces, not just a summary
  --show-leak-kinds=all \      # report all 4 categories (incl. still-reachable)
  --track-origins=yes \        # for uninit values: WHERE did the garbage come from?
  --error-exitcode=1 \         # exit non-zero on any error → fails the CI job
  ./prog arg1 arg2
```

Each flag earns its place:

- **`--leak-check=full`** — without it you get only a one-line summary. With it, every leak gets the allocation stack trace pointing at the exact `malloc` call site. This is the flag that turns "you leaked 400 bytes" into "you leaked 400 bytes *here*."
- **`--show-leak-kinds=all`** — by default Memcheck shows definite + possible. `all` adds **still reachable** and **indirect**, which you want when hunting growth.
- **`--track-origins=yes`** — for *uninitialized-value* errors, this traces the value back to where the undefined memory was born (the `malloc` or the unwritten stack slot). It roughly **doubles** the slowdown, so enable it only when chasing a "Conditional jump depends on uninitialised value(s)" report — not by default.
- **`--error-exitcode=1`** — makes Valgrind return a failing exit code on *any* error so a CI step fails loudly instead of passing with a clean-looking log.

**Suppressions** handle the unavoidable noise — a leak deep inside a library you don't control, or a known one-time allocation. You generate suppression stanzas from a run and feed them back:

```bash
# 1. Generate ready-to-paste suppression rules for everything found:
valgrind --leak-check=full --gen-suppressions=all ./prog
# 2. Save the relevant stanzas into a file, then suppress on later runs:
valgrind --leak-check=full --suppressions=project.supp ./prog
```

A suppression names the error kind and a stack-frame pattern; matching errors are silently dropped. The discipline is to suppress *only* third-party or genuinely-accepted findings — never your own leaks.

**Reading the output.** A definite leak looks like this:

```
==4242== HEAP SUMMARY:
==4242==     in use at exit: 100 bytes in 1 blocks
==4242==   total heap usage: 3 allocs, 2 frees, 1,124 bytes allocated
==4242==
==4242== 100 bytes in 1 blocks are definitely lost in loss record 1 of 1
==4242==    at 0x4848899: malloc (vg_replace_malloc.c:393)
==4242==    by 0x109165: make_buffer (leak.c:7)      ← allocated HERE
==4242==    by 0x1091A2: main (leak.c:14)
==4242==
==4242== LEAK SUMMARY:
==4242==    definitely lost: 100 bytes in 1 blocks
==4242==    indirectly lost: 0 bytes in 0 blocks
==4242==      possibly lost: 0 bytes in 0 blocks
==4242==    still reachable: 0 bytes in 0 blocks
```

The stack trace is the **allocation** stack — where the leaked block was born — read top-down: `malloc` was called by `make_buffer` at line 7, called by `main` at line 14. That's your fix site.

> **Key insight:** The leak stack trace points at the **allocation**, not where you should have freed. Memcheck can't know where the `free` *should* have gone — only where the block came from. Your job is to trace that allocation's intended lifetime and find the path that drops the pointer without freeing. `--track-origins=yes` is the equivalent service for uninitialized values: it names the *birthplace* of the garbage so you can find the missing initialization.

---

## Real-World Examples

**1. Server "leak" that's actually a growing cache.** A long-running daemon's RSS climbs over days. A single Memcheck run reports `definitely lost: 0` and a big `still reachable` — looks clean. The catch: the cache is *still reachable* (a global holds it) but unbounded. The fix isn't in the leak report at all; it's an eviction policy. Lesson: a single-exit leak check can't see growth in reachable memory. Confirm with **Massif** (`--tool=massif`) to graph heap-over-time and pin the growing allocation site, or compare reachable totals across runs of increasing load.

**2. The bug ASan swore wasn't there.** A test passes clean under ASan but produces nondeterministic results. Under Memcheck: `Conditional jump or move depends on uninitialised value(s)`, and with `--track-origins=yes`, the origin is an uninitialized struct field read before assignment. ASan has no V-bits, so it never saw it. This is the textbook case for keeping Valgrind in the toolkit even when you have ASan — or building a MemorySanitizer job for the same coverage at ASan-like speed.

**3. The unrecompilable binary.** A vendor ships a closed-source `.so` and a CLI that segfaults on certain inputs. You can't add `-fsanitize=address`. `valgrind --leak-check=full ./vendor-cli badinput.dat` reports an `Invalid read of size 8 ... 16 bytes after a block of size 240 alloc'd` deep in the vendor code — a heap overflow you could *never* have found with a compile-time sanitizer. DBI's no-recompile property is the entire reason Valgrind still earns its slot.

**4. CI split: LSan everywhere, Valgrind nightly.** The team runs the **ASan job on every PR** (LSan rides along, catching leaks at ~2× cost in minutes). A separate **nightly Valgrind run** covers what ASan/LSan miss — chiefly uninitialized-value reads — accepting the 20–50× slowdown because it's off the critical path. This is the standard division of labour: fast leak + memory-error coverage in the PR gate, slow-but-unique Memcheck coverage on a schedule.

---

## Mental Models

- **Memcheck is a CPU emulator with two sticky notes per byte.** One note (A-bit) says "you may touch me"; the other (V-bit) says "I hold a real value." Every memory access reads the notes; every bug is a note that said "no." The 20–50× cost is the price of consulting two notes on every single access.

- **The leak report is a tree, not a list.** `definitely lost` is the trunk; `indirectly lost` are branches that fall when you cut the trunk; `still reachable` is usually the standing forest you can ignore — unless it's *growing*. Cut trunks first.

- **A-bits = ASan's job; V-bits = MSan's job; Memcheck does both.** That one sentence places every tool: ASan and Memcheck overlap on out-of-bounds/use-after-free (A-bits); only Memcheck and MSan see uninitialized reads (V-bits). When ASan and Valgrind disagree, the disagreement is almost always a V-bit finding.

- **"Reachable at exit" ≠ "not a leak."** It means "the OS will reclaim it anyway." A cache that grows forever is reachable the whole time and still a defect. Reachability is about *correctness of cleanup*, not about *bounded growth*.

- **Recompile? → LSan. Can't? → Valgrind.** The single decision that picks your tool. Compile-time instrumentation is ~10–25× faster but needs source; DBI needs nothing but the binary.

---

## Common Mistakes

1. **Treating "still reachable" as an emergency.** It's usually memory the OS reclaims at exit (globals, singletons, one-time caches). Fix `definitely lost` first; only chase reachable bytes when you've confirmed they *grow* over a run.

2. **Chasing indirectly-lost blocks one by one.** They're downstream of a definite leak. Fix the parent (the `definitely lost` root) and the indirect count collapses to zero on its own.

3. **Leaving `--track-origins=yes` on by default.** It roughly doubles an already-20-to-50× slowdown. Turn it on only when you're actively chasing an *uninitialized value* report; leave it off for plain leak hunts.

4. **Expecting Memcheck to find uninitialized-value bugs in optimized builds reliably.** Aggressive optimization can fold or eliminate the very reads Memcheck would flag, and inlining mangles stacks. Build with `-O0 -g` (or `-O1 -g`) for the clearest Memcheck reports.

5. **Reading the leak stack as "where to free."** It's the **allocation** stack — where the block was born. Memcheck cannot know where the `free` belonged; you must trace the intended lifetime yourself.

6. **Suppressing your own leaks.** Suppression files are for third-party/accepted noise. Adding your own leak's stack to the `.supp` file makes the bug invisible forever — the worst possible "fix."

7. **Using Helgrind/DRD when you could use TSan.** For data races on code you can recompile, [ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) is far faster and actually runs threads in parallel. Reserve Helgrind for binaries you can't rebuild.

---

## Test Yourself

1. What are A-bits and V-bits, and which class of bug does each catch?
2. Which kind of bug can Memcheck find that AddressSanitizer fundamentally cannot, and why?
3. A block is "indirectly lost." What does that mean, and what's the right fix?
4. You can recompile the target and just want to know if it leaks. Which tool, and roughly how much faster is it than Valgrind?
5. Name three situations where you'd still choose Valgrind over ASan/LSan even though it's slower.
6. The leak report's stack trace points at line 7 — `malloc` inside `make_buffer`. Does that tell you where to add the `free`? Why or why not?
7. Why does Memcheck not complain the instant you *read* uninitialized memory, but only later?

<details>
<summary>Answers</summary>

1. **A-bits** (addressability) track whether a byte is legal to access — they catch out-of-bounds, use-after-free, and double-free. **V-bits** (validity/definedness) track whether a byte holds a defined value — they catch the use of uninitialized values.
2. **Use of uninitialized values** (e.g., branching on garbage). ASan has no definedness metadata — it only tracks addressability (redzones, freed memory). Catching uninitialized reads is the job of V-bits (Memcheck) or MemorySanitizer.
3. The block is only reachable *through* a block that is itself **definitely lost** (e.g., children of a leaked tree node). The fix is to correctly free the definitely-lost parent; the indirect count then drops to zero automatically.
4. **LeakSanitizer** — bundled in ASan (`-fsanitize=address`) or standalone (`-fsanitize=leak`). It's roughly **~2× overhead vs Valgrind's ~20–50×**, so on the order of 10–25× faster.
5. (a) You can't recompile — only a binary, no source. (b) You need **uninitialized-read** detection and have no MSan build (V-bits do it; LSan can't). (c) You want the profiling tools — **Massif** (heap/peak) or **Callgrind/Cachegrind** (CPU/cache).
6. **No** — it tells you where the block was *allocated*, not where the `free` belongs. Memcheck can't know the intended lifetime; you trace from the allocation to find the path that drops the pointer without freeing.
7. Memcheck propagates "undefinedness" through copies and arithmetic and only errors when an undefined value reaches an **observable decision** — a conditional branch, an address computation, or a syscall argument. This avoids false positives from merely copying partially-initialized data while still catching garbage that actually influences behaviour.

</details>

---

## Cheat Sheet

```
HOW MEMCHECK WORKS  (DBI = no recompile needed)
  A-bits  addressability  → OOB, use-after-free, double-free   (== ASan's job)
  V-bits  definedness      → uninitialised-value use            (== MSan's job)
  Memcheck does BOTH; ASan can't do V-bits.

LEAK CATEGORIES  (triage order)
  definitely lost   no pointer anywhere        → REAL LEAK, fix first
  indirectly lost   only via a lost block       → fixes itself when parent freed
  possibly lost     only an interior pointer    → investigate (sometimes legit)
  still reachable   pointer exists at exit       → often fine; watch for GROWTH

CANONICAL COMMAND
  valgrind --leak-check=full --show-leak-kinds=all \
           --track-origins=yes --error-exitcode=1 ./prog
  --track-origins=yes  → doubles slowdown; only for uninit-value hunts
  --gen-suppressions=all   then   --suppressions=project.supp

TOOLSUITE  (--tool=)
  memcheck   memory errors + leaks     (default)        BUGS
  massif     heap profiler / peak usage                 COST → Performance
  cachegrind cache + branch-pred misses                 COST → Performance
  callgrind  call graph (KCachegrind)                   COST → Performance
  dhat       alloc lifetimes/access patterns            COST
  helgrind   data races + lock order   (prefer TSan)    BUGS
  drd        data races, lighter mem   (prefer TSan)    BUGS

DECISION
  can recompile + just leaks?   → LSan  (-fsanitize=address/leak)  ~2x
  can't recompile / uninit / profiling? → Valgrind                 ~20-50x

CI PATTERN
  every PR : ASan job  (LSan rides along, ~2x)
  nightly  : Valgrind  (uninit-read coverage, 20-50x, off critical path)
```

---

## Summary

- **Memcheck is dynamic binary instrumentation**: it JIT-translates your program onto a synthetic CPU and checks every memory access — no recompile, no source required. It keeps **A-bits** (addressability) and **V-bits** (definedness) per byte. A-bits catch OOB/use-after-free; **V-bits catch uninitialized-value use, which ASan cannot do** (that's MSan's territory).
- Leaks come in **four categories**: *definitely lost* (real bug — fix first), *indirectly lost* (downstream of a definite leak — self-resolves), *possibly lost* (only an interior pointer — investigate), *still reachable* (pointer exists at exit — often fine, but can hide growth). Read the report as a tree and cut the trunks.
- **Valgrind is a toolsuite, not one tool.** Memcheck/Helgrind/DRD find *bugs*; Massif/Cachegrind/Callgrind/DHAT measure *cost* and belong to the [Performance](../../performance/) domain. `valgrind ./prog` defaults to Memcheck; pick `--tool=` deliberately.
- **LeakSanitizer** is the fast alternative: a mark-and-sweep from roots at exit, bundled in ASan or standalone, at ~2× cost vs Valgrind's ~20–50×. **Recompile? → LSan. Can't, or need uninit-reads / profiling? → Valgrind.**
- The workflow: `--leak-check=full --show-leak-kinds=all --track-origins=yes --error-exitcode=1`, suppressions for third-party noise only, and remember the leak stack points at the **allocation**, not the missing `free`.
- The standard **CI split**: LSan in the ASan job on every PR (fast), a nightly Valgrind run for the uninitialized-read coverage that nothing else provides.

---

## Further Reading

- *Valgrind User Manual* — the Memcheck chapter (leak categories, flags) and the tool chapters (Massif, Callgrind, Helgrind). The primary source: `valgrind.org/docs/manual`.
- Nethercote & Seward, *"Valgrind: A Framework for Heavyweight Dynamic Binary Instrumentation"* (PLDI 2007) — the paper that explains the JIT/IR/shadow-memory architecture underneath everything on this page.
- *Clang LeakSanitizer documentation* — how LSan rides along with ASan, the standalone `-fsanitize=leak` mode, and root-based mark-and-sweep.
- `man valgrind` and `valgrind --tool=memcheck --help` — the authoritative flag reference.
- [senior.md](senior.md) — shadow-memory layout internals, suppression-file engineering at scale, ASan-vs-Valgrind-vs-MSan trade-offs, and wiring leak detection into CI gates without flakiness.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/middle.md) — the compile-time tool that bundles LSan and overlaps Memcheck on A-bit bugs (but has no V-bits).
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/middle.md) — the fast data-race detector to prefer over Valgrind's Helgrind/DRD.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/middle.md) — the complementary sanitizer for UB that neither leaks nor races cover.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/middle.md) — driving these detectors with fuzz inputs to reach the buggy paths.
- [Performance](../../performance/) — where Massif, Cachegrind, and Callgrind actually belong: heap and CPU profiling, not bug-finding.
