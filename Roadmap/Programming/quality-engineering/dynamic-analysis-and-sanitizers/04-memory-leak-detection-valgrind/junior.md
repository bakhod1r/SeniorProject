# Leak Detection & Valgrind — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Leak Detection & Valgrind
> *Every byte you allocate is a promise to give it back. A memory leak is a promise you forgot to keep — and a long-running program keeps a ledger of every broken one until the machine runs out of room.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Memory Leak Actually Is](#core-concept-1--what-a-memory-leak-actually-is)
5. [Core Concept 2 — Valgrind: Find Leaks Without Recompiling](#core-concept-2--valgrind-find-leaks-without-recompiling)
6. [Core Concept 3 — Reading the Leak Summary](#core-concept-3--reading-the-leak-summary)
7. [Core Concept 4 — Memcheck Catches More Than Leaks](#core-concept-4--memcheck-catches-more-than-leaks)
8. [Core Concept 5 — The Fast Alternative: LeakSanitizer](#core-concept-5--the-fast-alternative-leaksanitizer)
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

> Focus: **What is a memory leak, and how do I find one?**

In C and C++, *you* are the memory manager. When you call `malloc` (C) or `new` (C++), the operating system hands you a block of memory and says: "It's yours. Tell me when you're done with it." You tell it you're done by calling `free` (C) or `delete` (C++). That hand-back is not optional bookkeeping — it's the deal. Memory you take and never return stays taken.

A **memory leak** is exactly that broken deal: you allocate a block, then lose every pointer that could reach it, so you can never `free` it. The block isn't *gone* — it's worse than gone. It's still reserved by your program, occupying RAM, but completely unreachable and therefore unusable. The operating system thinks you're still using it. You've forgotten it exists.

For a tiny program that runs for half a second and exits, a leak is harmless — when the process dies, the OS reclaims *all* its memory anyway. But the programs that matter run for hours, days, or months: a web server, a database, a game, a background daemon. There, a small leak repeated thousands of times per hour is a slow poison. Memory usage climbs and climbs until the kernel's **OOM killer** ("Out Of Memory" killer) executes your process to save the machine. The symptom — "the server crashes every 6 hours, no error in the logs" — is one of the most baffling bugs a junior engineer will meet, precisely because the crash happens far away in time from the line that caused it.

This page teaches you to make leaks *visible*. The headline tool is **Valgrind**, a program you wrap around your own program — `valgrind ./myprogram` — that watches every allocation and, when your program exits, prints a precise list of what you allocated and never freed, with the exact line where each leak was born. No special compiler. No code changes. You'll also meet **LeakSanitizer**, the faster modern alternative for when you *can* recompile.

> **Mindset shift:** stop thinking "I called `malloc`, I got my memory, done." Start thinking "every `malloc` is a loan I must repay with a `free`, and a tool can audit my repayments." A leak isn't a crash you'll see immediately — it's a debt that accumulates silently until the program collapses. The whole skill is learning to read the audit before your users do.

---

## Prerequisites

- **Required:** You can write and compile a small C program and know what `malloc` and `free` do (you've used them, even if shakily).
- **Required:** You understand that a **pointer** is a variable holding the *address* of some memory, not the memory itself.
- **Required:** You can run a command in a terminal and read its output.
- **Helpful:** You've heard of "the heap" versus "the stack" (we'll define both below).
- **Helpful:** You've seen a long-running program slow down or get killed and wondered why.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Heap** | The pool of memory you ask for explicitly with `malloc`/`new`. It lives until you `free`/`delete` it. |
| **Stack** | Memory for local variables, freed automatically when a function returns. You never leak the stack. |
| **`malloc` / `free`** | C's "give me N bytes" and "I'm done with these bytes." |
| **`new` / `delete`** | C++'s equivalents (`new[]` / `delete[]` for arrays). |
| **Memory leak** | Allocated heap memory you can no longer reach, so you can never free it. |
| **Dangling pointer** | A pointer to memory that has already been freed. Using it is a bug. |
| **OOM killer** | The Linux kernel feature that kills a process when the machine runs out of memory. |
| **Valgrind** | A tool that runs your program on a *simulated* CPU and watches its memory use. |
| **Memcheck** | Valgrind's default tool — the one that finds leaks and memory errors. |
| **LeakSanitizer (LSan)** | A fast, compile-time leak detector built into modern compilers. |
| **AddressSanitizer (ASan)** | A broader compile-time memory-error detector that *includes* LSan. |
| **Allocation stack** | The chain of function calls that led to a particular `malloc` — your "where was this born" trail. |

---

## Core Concept 1 — What a Memory Leak Actually Is

A leak has two ingredients, and you need **both**:

1. You allocated heap memory.
2. You lost the last pointer to it *without* freeing it first.

Losing the pointer is the key. Memory is only reachable *through* a pointer. The instant the last pointer that knows the block's address disappears — overwritten, or it went out of scope — the block becomes an island with no bridge to it. It is permanently allocated and permanently unreachable.

Here is the leak in its purest form:

```c
#include <stdlib.h>

void leak(void) {
    char *buf = malloc(100);   // OS reserves 100 bytes; `buf` holds the address
    // ... we use buf ...
    // function returns here — `buf` is a LOCAL variable, so it vanishes
    // the 100 bytes are still reserved, but no pointer on Earth knows their address
}                              // ← the address is gone; the memory is leaked forever
```

When `leak()` returns, the *pointer* `buf` (which lived on the stack) is destroyed automatically. But `buf` was only a slip of paper with an address written on it. Destroying the slip does **not** return the 100 bytes — those live on the **heap**, and the heap is only freed by an explicit `free`. We never called it. The 100 bytes are now orphaned.

Call `leak()` once: you've lost 100 bytes. Boring. Call it inside a loop that runs every time a request arrives:

```c
while (server_running) {
    handle_request();   // if handle_request leaks 100 bytes per call...
}                       // ...after 10 million requests you've leaked ~1 GB
```

Now you have a program whose memory footprint only ever grows. This is the classic shape of a production memory leak: flat for a while, then a steady upward climb on the memory graph, ending in an OOM kill.

> **Key insight:** A leak is not "memory in use." It's "memory that *can never again* be used or freed because nothing points to it." The danger isn't one leak — it's a leak on a *repeated path*. Find the path that runs millions of times and leaks a little each time; that's your real enemy, not the one-off 100 bytes at startup.

Two crucial non-leaks, so you don't chase ghosts:

- **Stack memory never leaks.** Local variables (`int x;`, `char arr[50];` *without* `malloc`) are freed automatically when the function returns. You only leak the heap.
- **Memory you still have a pointer to is not leaked** — even if you forgot to free it before exit. It's "still reachable" (we'll see Valgrind's word for this). It's untidy, but it's not the slow poison, because the pointer still exists.

---

## Core Concept 2 — Valgrind: Find Leaks Without Recompiling

You cannot find a leak by reading code alone on any real project — the allocation and the lost pointer can be thousands of lines and many files apart. You need a tool that watches your program *as it runs*. That tool is **Valgrind**, and its default sub-tool, **Memcheck**, is the leak detector.

Valgrind's headline feature is what makes it special: **you do not recompile anything.** You take your existing program — even one a vendor shipped you and you *cannot* rebuild — and you run it *under* Valgrind:

```bash
valgrind ./myprogram
```

That's the whole invocation. Valgrind loads your binary, runs it on a *simulated* CPU it controls completely, and instruments every memory operation. It knows about every `malloc` (it watches the call) and every `free`. When your program exits, Memcheck cross-references the two lists: every block that was `malloc`'d but never `free`'d is a leak, and it reports each one.

You don't *need* to recompile, but one flag makes the output dramatically more useful:

```bash
gcc -g -o myprogram myprogram.c   # -g embeds debug info: file names + line numbers
valgrind ./myprogram
```

The `-g` flag adds **debug symbols** to your binary — a mapping from machine code back to source lines. Without it, Valgrind still finds the leak but can only point at memory addresses; *with* it, Valgrind names the exact file and line where the leaked block was allocated. Always compile with `-g` when hunting bugs.

Take this leaking program:

```c
// leak.c
#include <stdlib.h>
#include <string.h>

char *make_greeting(const char *name) {
    char *msg = malloc(64);        // allocated on the heap
    strcpy(msg, "Hello, ");
    strcat(msg, name);
    return msg;                    // caller is now responsible for freeing this
}

int main(void) {
    char *g = make_greeting("world");
    printf("%s\n", g);
    // BUG: we never call free(g) — the 64 bytes leak
    return 0;
}
```

Build it with debug info and run it under Valgrind, asking for full leak details:

```bash
gcc -g -o leak leak.c
valgrind --leak-check=full ./leak
```

The `--leak-check=full` flag tells Memcheck to print the **allocation stack** for every leak — the trail of function calls that led to the `malloc`. (Plain `valgrind ./leak` gives you only counts; `--leak-check=full` gives you the *where*, which is what you actually need.)

> **Key insight:** Valgrind's superpower is "no recompile required." It works on a binary you can't rebuild, on third-party libraries, on a release build a customer sent you. The price for that magic is speed — your program runs on a *simulated* CPU, so it's roughly **20–50× slower** than normal. That trade-off (covered fully in Concept 5) is the entire reason a second, faster tool exists.

---

## Core Concept 3 — Reading the Leak Summary

When the program above exits, Valgrind prints a report. Every line begins with `==NNNNN==`, where `NNNNN` is the process ID — that prefix is just Valgrind talking, so your eye learns to skim past it to the content. Here's the heart of the output:

```
==12345== HEAP SUMMARY:
==12345==     in use at exit: 64 bytes in 1 blocks
==12345==   total heap usage: 2 allocs, 1 frees, 1,088 bytes allocated
==12345==
==12345== 64 bytes in 1 blocks are definitely lost in loss record 1 of 1
==12345==    at 0x4848899: malloc (in vg_replace_malloc.c)
==12345==    by 0x109198: make_greeting (leak.c:6)
==12345==    by 0x1091D5: main (leak.c:13)
==12345==
==12345== LEAK SUMMARY:
==12345==    definitely lost: 64 bytes in 1 blocks
==12345==    indirectly lost: 0 bytes in 0 blocks
==12345==      possibly lost: 0 bytes in 0 blocks
==12345==    still reachable: 0 bytes in 0 blocks
==12345==         suppressed: 0 bytes in 0 blocks
```

Read it top to bottom, the way Valgrind intends:

- **`in use at exit: 64 bytes in 1 blocks`** — when the program ended, 64 bytes of heap were never freed. Your first signal something's wrong.
- **The leak record** — `64 bytes ... are definitely lost`, followed by the **allocation stack**. Read it **bottom to top** like a story: `main` (line 13) called `make_greeting`, and inside `make_greeting` (line 6) we called `malloc`. **Line 6 is where the leaked block was born.** That's your starting point — follow the pointer's life from there and find where you should have called `free`.
- **The `LEAK SUMMARY` table** — the five categories. They are not equally urgent, and knowing the order to care about them is the whole skill:

| Category | What it means | How much to worry |
|---|---|---|
| **definitely lost** | No pointer to this block exists anywhere. A true leak. | **Fix these first.** This is the real bug. |
| **indirectly lost** | Lost only because the thing pointing *to* it was definitely lost (e.g. a struct that owned this block leaked). | Fixes itself when you fix the "definitely lost" parent. |
| **possibly lost** | A pointer exists, but to the *middle* of the block, not its start. Often a real leak; occasionally a false alarm. | Investigate after the definite ones. |
| **still reachable** | A pointer to this block *still exists* at exit — you just didn't free it before quitting. | Usually low priority; not the slow poison. |
| **suppressed** | Known issues you (or a system library) told Valgrind to ignore. | Ignore by design. |

The fix here is one line:

```c
int main(void) {
    char *g = make_greeting("world");
    printf("%s\n", g);
    free(g);                 // ← repay the loan
    return 0;
}
```

Rebuild, rerun, and Valgrind gives you the sentence you're chasing:

```
==12345== HEAP SUMMARY:
==12345==     in use at exit: 0 bytes in 0 blocks
==12345==   total heap usage: 2 allocs, 2 frees, 1,088 bytes allocated
==12345==
==12345== All heap blocks were freed -- no leaks are possible
==12345==
==12345== ERROR SUMMARY: 0 errors from 0 contexts (suppressed: 0 from 0)
```

`All heap blocks were freed -- no leaks are possible` and `0 errors` is the green light. Note `2 allocs, 2 frees` now balance — every loan repaid.

> **Key insight:** **Read "definitely lost" first, every time.** It's the only category that is unambiguously your bug. "Indirectly lost" usually evaporates once you fix its parent. "Still reachable" is often just memory you didn't bother freeing at exit (harmless — the OS reclaims it). Junior engineers waste hours on "still reachable" noise; experienced ones go straight to "definitely lost," read the allocation stack bottom-up, and add the missing `free`.

---

## Core Concept 4 — Memcheck Catches More Than Leaks

Leaks are the headline, but Memcheck watches *every* memory access, so it catches a whole family of bugs that otherwise corrupt your program silently — bugs that might "work" on your machine and crash on someone else's. These are worth recognizing on sight, because the error messages are distinctive.

**Reading or writing memory you already freed (use-after-free):**

```c
char *p = malloc(10);
free(p);
p[0] = 'x';       // BUG: p is now a dangling pointer
```

```
==12345== Invalid write of size 1
==12345==    at 0x1091AB: main (uaf.c:5)
==12345==  Address 0x4a8b040 is 0 bytes inside a block of size 10 free'd
==12345==    at 0x484B27F: free (in vg_replace_malloc.c)
```

`Invalid write` means you wrote to memory you don't own. The message even tells you the block was already `free'd` — a textbook **use-after-free**.

**Reading or writing past the end of a block (buffer overflow):**

```c
char *buf = malloc(10);
buf[10] = '!';    // BUG: valid indices are 0..9; index 10 is out of bounds
```

```
==12345== Invalid write of size 1
==12345==    at 0x109182: main (overflow.c:4)
==12345==  Address 0x4a8b04a is 0 bytes after a block of size 10 alloc'd
```

`0 bytes after a block of size 10` is Memcheck telling you precisely *how far* off the end you went.

**Using a value you never initialized:**

```c
int x;                       // declared but never given a value — contains garbage
if (x > 5) { /* ... */ }     // BUG: branching on garbage
```

```
==12345== Conditional jump or move depends on uninitialised value(s)
==12345==    at 0x109164: main (uninit.c:4)
```

This one is **Valgrind's unique party trick**. The message `depends on uninitialised value(s)` means your program's behavior is being decided by memory that was never assigned — pure garbage left over from whatever used that address before. Such bugs produce results that change run to run and are nearly impossible to find by reading code. Most other tools can't catch this; Valgrind can.

**Freeing the same block twice, or freeing memory you didn't allocate:**

```c
char *p = malloc(10);
free(p);
free(p);          // BUG: double free
```

```
==12345== Invalid free() / delete / delete[] / realloc()
==12345==    at 0x484B27F: free (in vg_replace_malloc.c)
==12345==  Address 0x4a8b040 is 0 bytes inside a block of size 10 free'd
```

**Mismatched allocation and free (a C++ trap):**

```cpp
int *p = new int[10];   // allocated with new[]
delete p;               // BUG: should be delete[]
```

```
==12345== Mismatched free() / delete / delete []
==12345==    at 0x484BB6F: operator delete(void*)
```

C++ pairs must match: `malloc`↔`free`, `new`↔`delete`, `new[]`↔`delete[]`. Crossing them is undefined behavior, and Memcheck flags it by name.

> **Key insight:** Memcheck is really a *general memory-correctness* tool; leaks are just one of its reports. The other findings — invalid read/write, use-after-free, uninitialized values, double/mismatched free — are often *more* dangerous than leaks, because a leak merely wastes RAM while these silently corrupt your data or crash unpredictably. When Valgrind prints any of these, fix it: it found a real defect, not a style nit.

---

## Core Concept 5 — The Fast Alternative: LeakSanitizer

Valgrind's "no recompile" magic costs you speed: simulating the CPU makes your program run **20–50× slower**. A test suite that takes 1 minute normally can take 30–50 minutes under Valgrind. That's fine for a focused debugging session, but painful to run on *every* commit in continuous integration (CI). So when you *can* recompile, there's a faster way.

**LeakSanitizer (LSan)** is a leak detector built directly into modern compilers (GCC and Clang). Unlike Valgrind, it's a **compile-time** tool: you add a flag when you build, the compiler bakes lightweight leak-tracking into your binary, and at program exit it prints leaks — at a tiny fraction of Valgrind's slowdown.

You usually get LSan for free as part of **AddressSanitizer (ASan)**, the broader memory-error detector (covered in [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md)). Compile with `-fsanitize=address` and leak detection comes along automatically:

```bash
gcc -g -fsanitize=address -o leak leak.c    # ASan; includes LeakSanitizer
./leak                                       # run normally — no wrapper command
```

Or use LSan standalone, without the rest of ASan:

```bash
gcc -g -fsanitize=leak -o leak leak.c        # LeakSanitizer only
./leak
```

Either way you run the binary *directly* — there is no `valgrind` wrapper. The output for our leaking program looks like:

```
=================================================================
==12345==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 64 byte(s) in 1 object(s) allocated from:
    #0 0x... in malloc
    #1 0x... in make_greeting leak.c:6
    #2 0x... in main leak.c:13

SUMMARY: AddressSanitizer: 64 byte(s) leaked in 1 allocation(s).
```

Same information — 64 bytes, allocated at `leak.c:6` — just printed by a tool that's roughly as fast as your normal program instead of 30× slower. That speed is why **LSan/ASan is the default leak check in CI**: it's cheap enough to run on every build.

So which do you reach for? The decision is simple:

| Situation | Use |
|---|---|
| You can recompile **and** speed matters (CI, big test suite) | **ASan / LSan** (`-fsanitize=address` or `-fsanitize=leak`) |
| You **cannot** recompile (vendor binary, release build, no source) | **Valgrind** |
| You need to catch **uninitialized-value** use | **Valgrind** (LSan/ASan don't do this; you'd need [MemorySanitizer](../01-address-sanitizer-asan/junior.md)) |
| You want the absolute most thorough memory check on a small program | **Valgrind** (slow but exhaustive) |

> **Key insight:** These tools are complements, not rivals. **Recompilable + speed matters → ASan/LSan.** **Can't recompile, or need uninitialized-read detection → Valgrind.** Most teams run ASan/LSan in CI on every commit (fast feedback) and keep Valgrind in their pocket for the binary they can't rebuild or the heisenbug that only Valgrind's uninitialized-value check can explain.

---

## Real-World Examples

**1. The server that dies every six hours.** A web service handles thousands of requests per minute and crashes a few times a day with no error logged — the kernel's OOM killer leaves no message in the app's own logs. Engineers watch the memory graph: a slow, relentless climb. They run the service under Valgrind against a load test, see `definitely lost` growing inside the request handler, read the allocation stack, and find a per-request `malloc` whose matching `free` was skipped on one error path. One missing `free`, multiplied by millions of requests, was eating the machine. The fix is a single line; finding it without a leak tool is nearly impossible.

**2. The bug that only happens on the build server.** A test passes on every developer's laptop and fails randomly in CI. Under Valgrind, the cause appears: `Conditional jump or move depends on uninitialised value(s)`. A struct field was read before being set; on laptops that memory happened to contain zero, but on the CI machine it contained leftover garbage, flipping a branch. This is the class of bug *only* Valgrind reliably catches — no amount of staring at the code revealed it, because the code "looked" correct.

**3. The vendor binary you can't rebuild.** A team integrates a closed-source `.so` library shipped by a vendor; they have no source code. Their app's memory grows over time and they suspect the library. They cannot add `-fsanitize=address` because they cannot recompile the vendor code — but Valgrind doesn't care. They run their app under `valgrind --leak-check=full`, and the allocation stacks point straight into the vendor's library functions. Now they have evidence to file a bug report. This is Valgrind's "no recompile" superpower earning its keep.

**4. The CI gate that catches leaks before merge.** A C++ project builds its test suite with `-fsanitize=address` and runs it on every pull request. Because ASan (and its built-in LSan) is only modestly slower than a normal build, the whole suite still finishes in a couple of minutes, and any newly introduced leak fails the build immediately — the author sees the allocation stack in the CI log and fixes it before the code ever merges. Valgrind would be too slow to gate every PR; ASan/LSan is fast enough to make leak-checking automatic.

---

## Mental Models

- **`malloc` is a loan; `free` is repayment.** Every allocation is borrowed memory you've promised to return. A leak is an unpaid loan, and the interest is RAM that compounds until the program goes bankrupt (OOM). Valgrind is the auditor that lists every loan you never repaid, with the exact line where you took it out.

- **A leak is a balloon you can no longer reach.** The block is still inflated (allocated), but the string (the pointer) slipped from your hand. You can't pull it back down (use it) and you can't pop it (free it). It just floats, taking up room, forever. "Lose the last pointer" = "let go of the string."

- **Valgrind is a CPU simulator with a ledger; ASan is a tax baked into the building.** Valgrind runs your program on a pretend processor it fully controls, so it sees everything but runs slow (20–50×). ASan/LSan instead bakes the checks into your compiled code, so it's fast but needs a recompile. Same goal — catch the broken promise — different machinery, different price.

- **Read the allocation stack bottom-to-top, like a story.** The bottom frame is `main` (or your thread's entry); each line up is one call deeper. The *top* frame (just below `malloc`) is exactly where the leaked block was born. Start your investigation there and trace the pointer forward to where the `free` should have been.

---

## Common Mistakes

1. **Chasing "still reachable" before "definitely lost."** The leak summary lists five categories; only **definitely lost** is unambiguously your bug. "Still reachable" is usually memory you simply didn't free at exit (harmless — the OS reclaims it). Always read top-priority first.

2. **Running Valgrind without `-g`.** Without debug info, Valgrind reports leaks at raw addresses instead of file-and-line. You see *that* something leaked but not *where*. Always `gcc -g` (or `clang -g`) before a Valgrind session.

3. **Forgetting `--leak-check=full`.** Plain `valgrind ./prog` gives you only leak *counts*. You need `--leak-check=full` to get the **allocation stack** — the "where was this allocated" trail that actually lets you fix it.

4. **Assuming "no crash" means "no leak."** A leaking program runs perfectly fine — until it slowly exhausts memory hours later. Leaks are silent; the absence of a crash tells you nothing. You must *measure* with a tool.

5. **Thinking the stack can leak.** Local variables and fixed arrays (`char buf[100];` *without* `malloc`) are freed automatically when the function returns. You can only leak the **heap** — memory from `malloc`/`new`. Don't go hunting for leaks in stack variables.

6. **Mixing allocation/free families in C++.** `malloc`↔`free`, `new`↔`delete`, `new[]`↔`delete[]` must be paired correctly. `new int[10]` freed with `delete` (not `delete[]`) is a bug Memcheck flags as `Mismatched free() / delete / delete []`.

7. **Ignoring uninitialized-value warnings as "noise."** `Conditional jump or move depends on uninitialised value(s)` is a *real, serious* bug — your program's behavior depends on garbage. It's exactly the class of bug that "works on my machine" and fails elsewhere. Fix it.

8. **Running Valgrind in CI on every commit and wondering why CI is slow.** Valgrind's 20–50× slowdown makes it the wrong tool for gating every build. Use ASan/LSan for CI; keep Valgrind for targeted deep dives.

---

## Test Yourself

1. In one sentence, what are the *two* things that together make a memory leak?
2. You run `valgrind ./app` (no other flags) and `gcc` compiled `app` *without* `-g`. Name the two things missing from your output that you'd want, and the flags that fix each.
3. The leak summary shows `definitely lost: 200 bytes` and `still reachable: 5,000 bytes`. Which do you investigate first, and why?
4. You read an allocation stack: `malloc` ← `build_cache (cache.c:42)` ← `main (main.c:10)`. Which file and line is where the leaked block was *allocated*?
5. You see `Conditional jump or move depends on uninitialised value(s)`. What kind of bug is this, and why might it explain code that "works on my laptop but fails on the build server"?
6. Your team needs to leak-check a closed-source `.so` library they were shipped and cannot recompile. Valgrind or ASan/LSan? Why?
7. Your CI runs a large C++ test suite on every pull request and needs leak detection without making CI painfully slow. Valgrind or ASan/LSan? Why?

<details>
<summary>Answers</summary>

1. (a) You allocated heap memory, **and** (b) you lost the last pointer to it without freeing it first — so it's allocated forever and unreachable.
2. Missing: **(a)** the allocation stack for each leak — fixed by `--leak-check=full`; **(b)** file-and-line locations instead of raw addresses — fixed by compiling with `-g`.
3. **`definitely lost` first.** It's the only category that is unambiguously a true leak (no pointer reaches it). "Still reachable" is usually just memory not freed at exit, which the OS reclaims anyway — low priority.
4. **`cache.c:42`** — the frame directly above `malloc` is where the block was born. Read the stack bottom-to-top; the top non-`malloc` frame is the allocation site.
5. It's a **use of an uninitialized value** — the program branches on memory that was never assigned, so it holds leftover garbage. On your laptop that garbage happened to be zero (or a value that took the "right" branch); on another machine it's different garbage, so the program behaves differently. Valgrind uniquely catches this.
6. **Valgrind.** It requires no recompile and works on binaries (including third-party `.so` files) you cannot rebuild — that's its defining advantage. ASan/LSan need a compile-time flag, which you can't add to code you can't compile.
7. **ASan/LSan** (`-fsanitize=address` or `-fsanitize=leak`). It's a compile-time tool that's only modestly slower than a normal build, so it's cheap enough to run on every PR. Valgrind's 20–50× slowdown would make per-commit CI far too slow.

</details>

---

## Cheat Sheet

```
WHAT IS A LEAK?
  malloc'd (or new'd) memory + lost the last pointer to it + never freed
  → allocated forever, unreachable. Harmless once; deadly on a hot path (→ OOM).
  Only the HEAP leaks. Stack/local variables free themselves on return.

VALGRIND (no recompile needed; ~20–50× slower)
  gcc -g -o prog prog.c              # -g = file/line info (do this!)
  valgrind --leak-check=full ./prog  # --leak-check=full = show allocation stacks

LEAK SUMMARY — what to fix, in order
  definitely lost   → REAL leak. FIX THESE FIRST.
  indirectly lost   → child of a definite leak; fixes itself with the parent.
  possibly lost     → pointer into block's middle; investigate after definite.
  still reachable   → not freed at exit but pointer still exists; usually low priority.
  suppressed        → deliberately ignored.

READING THE ALLOCATION STACK
  bottom = main; top (just under malloc) = WHERE THE LEAK WAS BORN. Start there.

OTHER MEMCHECK ERRORS (all real bugs)
  Invalid read/write of size N            → out-of-bounds OR use-after-free
  ...depends on uninitialised value(s)    → branching on garbage (Valgrind-only!)
  Invalid free() / delete                 → double free or freeing non-heap
  Mismatched free() / delete / delete[]   → wrong pair (new[] needs delete[])

CLEAN RESULT YOU WANT
  "All heap blocks were freed -- no leaks are possible"   +   "0 errors"

LEAKSANITIZER (recompile needed; nearly full speed)
  gcc -g -fsanitize=address -o prog prog.c   # ASan, includes LSan
  gcc -g -fsanitize=leak    -o prog prog.c   # LSan only
  ./prog                                       # run directly, no wrapper

DECISION
  recompilable + speed matters (CI)   → ASan / LSan
  can't recompile  OR  need uninit-read detection → Valgrind
```

---

## Summary

- A **memory leak** is heap memory you allocated (`malloc`/`new`) and then lost every pointer to — so you can never `free` it. It's allocated forever and unreachable. One leak is harmless; a leak on a path that runs millions of times slowly exhausts RAM until the **OOM killer** ends your process.
- Only the **heap** leaks. Stack and local variables are freed automatically when a function returns.
- **Valgrind** (its **Memcheck** tool) finds leaks with **no recompile** — `valgrind --leak-check=full ./prog` — and at exit prints a **leak summary** plus the **allocation stack** for each leak. Compile with `-g` for file-and-line precision.
- In the summary, **read `definitely lost` first** — it's the only unambiguous true leak. Read the allocation stack **bottom-to-top**; the top frame is where the block was born. Add the missing `free`. The win is `All heap blocks were freed -- no leaks are possible`.
- Memcheck catches far more than leaks: **invalid reads/writes** (out-of-bounds, use-after-free), **uninitialized-value use** (its unique trick), and **double/mismatched free**. These are often *more* dangerous than leaks.
- Valgrind's price is speed: ~**20–50× slower** because it simulates the CPU. The fast alternative is **LeakSanitizer (LSan)** — a compile-time tool bundled into **ASan** (`-fsanitize=address`) or standalone (`-fsanitize=leak`). It's nearly full speed, so it's the default leak check in **CI**.
- **The decision:** recompilable + speed matters → **ASan/LSan**; can't recompile or need uninitialized-read detection → **Valgrind**.

The **junior recipe** is mechanical and reliable: run your program under `valgrind --leak-check=full`, read **"definitely lost"** first, follow the **allocation stack** to the line where the block was born, and add the missing `free`. Repeat until you get `no leaks are possible`.

---

## Further Reading

- [Valgrind Quick Start Guide](https://valgrind.org/docs/manual/quick-start.html) — the official five-minute "run it on your program" tutorial. Start here.
- [Valgrind Memcheck Manual](https://valgrind.org/docs/manual/mc-manual.html) — the full reference: every leak category, every error message, and the flags (`--leak-check`, `--track-origins`) explained.
- [Clang LeakSanitizer documentation](https://clang.llvm.org/docs/LeakSanitizer.html) — how to enable LSan, how it relates to AddressSanitizer, and how to suppress known leaks.
- [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) — the broader sanitizer that bundles LSan; the fast CI default.
- The [middle.md](middle.md) of this topic, which goes deeper: suppression files, `--track-origins` for uninitialized values, integrating leak checks into CI, and how Valgrind's shadow memory actually works under the hood.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) — the fast compile-time tool that *bundles* LeakSanitizer and catches buffer overflows and use-after-free.
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md) — the sanitizer for the *other* invisible bug class: data races between threads.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/junior.md) — catches integer overflow, bad casts, and other undefined behavior at runtime.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md) — fuzzing that *generates* inputs to drive these sanitizers into the code paths that leak or crash.
- [Performance](../../performance/) — leaks are a performance failure too; this section covers measuring and taming memory and CPU cost.
