# AddressSanitizer (ASan) — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → AddressSanitizer (ASan)
> *A memory bug in C usually crashes you three hours later, in a function that has nothing to do with the real mistake. ASan crashes you instantly, on the exact line, and hands you a map back to where the memory came from.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What ASan Actually Catches](#core-concept-1--what-asan-actually-catches)
5. [Core Concept 2 — How You Turn It On](#core-concept-2--how-you-turn-it-on)
6. [Core Concept 3 — Reading an ASan Report Top-Down](#core-concept-3--reading-an-asan-report-top-down)
7. [Core Concept 4 — The Cost, and Why It's Fine](#core-concept-4--the-cost-and-why-its-fine)
8. [Core Concept 5 — The Big Limitation: It Only Sees What Runs](#core-concept-5--the-big-limitation-it-only-sees-what-runs)
9. [Core Concept 6 — ASan and Its Siblings](#core-concept-6--asan-and-its-siblings)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a sanitizer, and why does it find bugs your eyes can't?**

Here is a C program that is broken, but looks fine and usually "works":

```c
int main(void) {
    int a[5];
    a[5] = 42;   // a[0]..a[4] are valid; a[5] is one past the end
    return 0;
}
```

`a[5]` writes to memory just past the array. C does not stop you. There is no bounds check. Most of the time this program prints nothing, exits `0`, and you walk away believing it's correct. Then one day it overwrites a byte that *mattered* — a return address, a loop counter, a pointer — and the program crashes somewhere completely unrelated, hours of "debugging" later. This is the defining misery of C and C++: **the symptom shows up far from the cause.**

**AddressSanitizer** — almost always called **ASan** — fixes that. It is a tool built into the compiler (Clang and GCC) that watches your program's memory accesses *while the program runs* and stops it the instant it touches memory it has no right to touch. You don't rewrite your code. You add one flag when you compile, run the program normally, and if there's a memory bug on a line that executes, ASan halts and prints a precise report: the kind of bug, the exact address, whether it was a read or a write, and the line of code that did it.

That `a[5] = 42` above, compiled with ASan, doesn't silently corrupt anything. It stops dead and says `stack-buffer-overflow ... WRITE of size 4`, pointing at the exact line. The mystery is gone.

> **Mindset shift:** stop trusting that "it ran and didn't crash" means "it's correct." In C and C++, a program can be thoroughly broken and still appear to work — the corruption is just silent. ASan's whole job is to make silent memory corruption *loud and immediate*. Treat a clean ASan run as the real bar for "this code touched memory legally," not the absence of a crash.

These memory bugs are not a rare edge case. They are behind roughly **70% of serious security vulnerabilities** in C/C++ software (a figure Microsoft and Google have independently reported). Learning ASan early is one of the highest-leverage habits a systems programmer can build.

---

## Prerequisites

- **Required:** You can write, compile, and run a small C program, and you know what a pointer is.
- **Required:** You know what `malloc` and `free` do — `malloc` asks for a block of heap memory, `free` gives it back.
- **Required:** You've used a terminal to run a compiler like `gcc` or `clang`.
- **Helpful:** You've experienced a C bug that crashed "in the wrong place" or behaved differently every run. (ASan is the cure.)
- **Helpful:** You know the difference between the **stack** (local variables, automatic) and the **heap** (`malloc`'d memory, manual). We'll use both terms a lot.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Sanitizer** | A tool the compiler bakes into your program to detect a class of bugs *at runtime*. |
| **AddressSanitizer (ASan)** | The sanitizer that finds memory-safety bugs (overflows, use-after-free, leaks). |
| **Memory-safety bug** | Touching memory you're not allowed to — past an array, after freeing it, etc. |
| **Heap** | Memory you request manually with `malloc` and return with `free`. |
| **Stack** | Memory for local variables; freed automatically when a function returns. |
| **Buffer overflow** | Reading or writing past the end (or before the start) of an array/block. |
| **Use-after-free** | Using a pointer to memory that has already been `free`d. |
| **Double-free** | Calling `free` twice on the same pointer. |
| **Dangling pointer** | A pointer that still holds an address, but the memory there is gone. |
| **Undefined behavior (UB)** | C operations with no defined result — the compiler may do *anything*. |
| **Stack trace** | The chain of function calls that led to a point — the "how did we get here." |
| **Instrumentation** | Extra checking code the compiler inserts into your program. |
| **LeakSanitizer (LSan)** | A leak detector bundled inside ASan; reports memory you allocated but never freed. |

---

## Core Concept 1 — What ASan Actually Catches

ASan watches for a specific family of memory-safety bugs. Each one is "you touched memory you weren't entitled to," but in a different way. Knowing the names matters, because ASan's report *names the category for you*, and the category tells you what kind of mistake to look for.

- **Heap buffer overflow** — reading or writing past a block you got from `malloc`. You asked for 5 ints; you touched the 6th.
- **Stack buffer overflow** — reading or writing past a local array (one that lives on the stack). The `a[5]` example above.
- **Global buffer overflow** — same idea, but for a global/static array.
- **Use-after-free** — you `free`d a block, then used a pointer that still pointed at it.
- **Use-after-return / use-after-scope** — you kept a pointer to a local variable, but the function returned (or the `{ }` block ended), so that variable no longer exists.
- **Double-free** — you called `free` on the same pointer twice.
- **Invalid free** — you called `free` on something that didn't come from `malloc` (e.g., a stack address, or a pointer into the *middle* of a block).
- **Memory leak** — you `malloc`'d and never `free`d; the memory is lost until the program exits. Caught by the bundled **LeakSanitizer**.

Here's the canonical "looks harmless, is a time bomb" bug — **use-after-free**:

```c
#include <stdlib.h>

int main(void) {
    int *p = malloc(sizeof(int));  // get 4 bytes on the heap
    *p = 7;
    free(p);                       // give them back...
    return *p;                     // ...then read them anyway. UB.
}
```

After `free(p)`, the pointer `p` is **dangling** — it still holds an address, but that memory is no longer yours. Reading `*p` might give `7`, might give garbage, might crash — *whatever the program happens to do at that moment*. Without ASan, this often appears to work, which is the worst outcome: a latent bug that bites in production.

> **Key insight:** every bug in this list is the compiler *letting you do something illegal silently*. C has no runtime guardrails by default — that's the price of its speed. ASan adds the guardrails back, but only while you're testing. It doesn't change what your code *does*; it changes whether illegal memory access gets *noticed*.

---

## Core Concept 2 — How You Turn It On

This is the part that surprises people: ASan is almost free to use. You don't install a separate program or change your source. You add a flag when you **compile**, then run normally.

The one flag that matters is `-fsanitize=address`. Two more flags make the reports readable:

```bash
clang -fsanitize=address -g -fno-omit-frame-pointer bug.c -o bug
```

- `-fsanitize=address` — turn ASan on. This is the whole feature.
- `-g` — include **debug info** so the report shows *file names and line numbers* instead of raw addresses. Without it you get a stack trace of hex; with it you get `bug.c:6`.
- `-fno-omit-frame-pointer` — keep the stack-frame pointer so the stack traces are complete and accurate. (Compilers sometimes drop it for speed; you want it back here.)

`gcc` uses the exact same flags:

```bash
gcc -fsanitize=address -g -fno-omit-frame-pointer bug.c -o bug
```

Then just run it like any other program:

```bash
./bug
```

If the code that executes is clean, the program behaves exactly as normal (just slower). If it hits a memory bug, ASan prints a report and the program exits with a failure code.

There is no separate "run ASan" command. **The check is built into your binary.** Your `./bug` *is* the instrumented program. This is why ASan fits so naturally into test suites: you compile your tests with the flag and run them the way you always do.

> **Key insight:** ASan is a *compile-time decision with a runtime effect*. You build a special version of your program for testing — the same source, instrumented. You ship the normal (non-ASan) build. Many projects keep a dedicated "asan build" of their test suite for exactly this reason.

A junior tip you'll appreciate: by default ASan stops at the **first** error it finds. If you'd rather it report a bug and keep going to find more, set an environment variable before running:

```bash
ASAN_OPTIONS=halt_on_error=0 ./bug
```

---

## Core Concept 3 — Reading an ASan Report Top-Down

The report looks intimidating the first time. It isn't — it has a fixed shape, and you read it **top-down**. Let's run the use-after-free from Concept 1:

```bash
clang -fsanitize=address -g -fno-omit-frame-pointer uaf.c -o uaf
./uaf
```

ASan prints something like this (abbreviated, but real in shape):

```
==12345==ERROR: AddressSanitizer: heap-use-after-free on address 0x602000000010
READ of size 4 at 0x602000000010 thread T0
    #0 0x4f8a3c in main uaf.c:7
    #1 0x7f2b1c in __libc_start_main

0x602000000010 is located 0 bytes inside of 4-byte region [0x602000000010,0x602000000014)
freed by thread T0 here:
    #0 0x4f7b10 in free
    #1 0x4f8a2d in main uaf.c:6

previously allocated by thread T0 here:
    #0 0x4f7c40 in malloc
    #1 0x4f8a18 in main uaf.c:4

SUMMARY: AddressSanitizer: heap-use-after-free uaf.c:7 in main
```

Read it in this order, and it tells a complete story:

1. **The bug type** — `heap-use-after-free`. The category from Concept 1. You instantly know what *kind* of mistake to hunt for.
2. **Read or write, and the size** — `READ of size 4`. You were *reading* 4 bytes (one `int`) from freed memory. "Write" bugs corrupt; "read" bugs leak garbage — knowing which narrows your thinking.
3. **The faulting stack trace** — `#0 ... main uaf.c:7`. *This is the line that did the illegal thing.* Line 7, the `return *p;`. Start here.
4. **"freed by thread T0 here"** — `main uaf.c:6`. *Where the memory was freed.* Line 6, the `free(p);`. This is the other half of the bug.
5. **"previously allocated by thread T0 here"** — `main uaf.c:4`. *Where the memory was born* (`malloc`). Now you have the full lifetime: allocated at line 4, freed at line 6, illegally used at line 7.
6. **SUMMARY** — a one-line recap with the file and line. If you read nothing else, read this.

That is the superpower. A normal C crash gives you *one* location — usually the wrong one. ASan gives you the **whole life story of the memory**: where it was created, where it was destroyed, and where you touched it after it was gone. The bug isn't a mystery anymore; it's three line numbers.

> **Key insight:** the two stack traces (`freed ... here` and `previously allocated ... here`) are what make ASan feel like magic. The bug is rarely on a single line — it's a *relationship* between an allocation, a free, and a use. ASan reconstructs that relationship for you, which is exactly the information a plain crash throws away.

---

## Core Concept 4 — The Cost, and Why It's Fine

ASan isn't free at runtime — it adds checks around memory operations and keeps extra bookkeeping. The rules of thumb, from the ASan authors, are easy to remember:

- **~2× slower** — your program runs about twice as slow.
- **~3× more memory** — it uses roughly three times the RAM (it keeps "shadow memory" describing which bytes are valid).

For a *debugging and testing* tool, this is a bargain. A test suite that took 30 seconds now takes about a minute — nobody cares. In exchange you get instant, located detection of the worst class of bugs. That trade is overwhelmingly worth it.

What this cost *does* mean: **you don't ship an ASan build to production.** The slowdown and memory blow-up are unacceptable for real workloads, and ASan is a bug-*finding* tool, not a defense. The standard pattern is:

- **Development & CI:** build with `-fsanitize=address`, run tests. Catch bugs here.
- **Production:** build without it. Normal speed, normal memory.

| | Normal build | ASan build |
|---|---|---|
| Speed | Baseline | ~2× slower |
| Memory | Baseline | ~3× more |
| Finds memory bugs? | No (silent) | Yes (instant, located) |
| Where it belongs | Production / shipping | Tests / CI / local debugging |

> **Key insight:** ASan is a *testing* tool, not a *runtime shield*. Its cost is acceptable precisely because you only pay it while finding bugs, not while serving users. Think of it like a smoke detector you run during a fire drill, not a sprinkler you leave on permanently.

---

## Core Concept 5 — The Big Limitation: It Only Sees What Runs

This is the single most important thing for a junior to internalize, because misunderstanding it leads to false confidence.

**ASan only catches bugs on the lines of code that actually execute during a given run.** It is a *dynamic* analysis tool — it watches a running program. If a buggy line never runs because your test didn't take that path, ASan never sees the bug. It cannot find what doesn't execute.

Concretely:

```c
void handle(int kind, char *buf) {
    if (kind == 99) {
        buf[1000000] = 0;   // a brutal overflow — but ONLY if kind == 99
    }
    // normal handling...
}
```

If your tests only ever call `handle` with `kind` of `0`, `1`, or `2`, ASan will run happily and report *nothing*. The overflow at `kind == 99` is real and dangerous, but that branch never executed, so ASan had nothing to watch. A clean ASan run on a weak test suite proves only that *the paths you tested* are clean — not that the program is.

This leads to the central law of using ASan well:

> **Key insight:** ASan is only as good as the inputs and tests you feed it. It turns "this code path has a memory bug" into a guaranteed, located report — but *only for the paths you exercise*. The way you exercise *more* paths automatically is **fuzzing**: feeding the program a flood of generated inputs to drive execution into corners your hand-written tests never reach. ASan + a fuzzer is the standard pairing, and it's why coverage-guided fuzzing exists — see [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md).

So: write good tests, feed diverse inputs, and eventually pair ASan with a fuzzer. ASan is a flawless *detector* of bugs it witnesses; making sure it witnesses them is *your* job.

---

## Core Concept 6 — ASan and Its Siblings

ASan is one of a family of sanitizers, each specialized for a different class of bug. You don't need to master the others yet, but you should know they exist and what each is *for* — so you reach for the right one.

- **ASan (AddressSanitizer)** — *memory-safety* bugs: overflows, use-after-free, double-free, leaks. **This page.**
- **TSan (ThreadSanitizer)** — *data races*: two threads touching the same memory at the same time without synchronization. A completely different, equally nasty bug class. See [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md).
- **UBSan (UndefinedBehaviorSanitizer)** — *undefined behavior* that isn't about memory addresses: signed integer overflow, dividing by zero, shifting by too many bits, misaligned pointers. See [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/junior.md).
- **Valgrind (Memcheck)** — finds many of the same memory bugs as ASan, but works on an *already-compiled* binary with no recompilation needed. The trade-off: it's much slower (often 10–50×). See [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/junior.md).

The quick decision guide:

| Bug you're chasing | Reach for |
|---|---|
| "Memory corruption, use-after-free, leak" | **ASan** |
| "Threads, random behavior, race condition" | **TSan** |
| "Integer overflow, weird UB, not address-related" | **UBSan** |
| "Can't recompile, need to check a binary as-is" | **Valgrind** |

A practical note: **ASan and UBSan can run together** (`-fsanitize=address,undefined`) — a common, powerful combo. **ASan and TSan cannot** be combined in one build; they conflict, so you build separately for each.

> **Key insight:** these tools are *complementary, not competing*. They each illuminate a different blind spot of C/C++. A mature project runs several of them in CI. As a junior, start with ASan — it catches the highest-impact, most common class of bug — and add the others as you meet their kinds of failure.

---

## Real-World Examples

**1. The crash that "moved around."** A junior engineer has a parser that crashes intermittently — sometimes in `parse()`, sometimes in an unrelated `print()`, sometimes not at all. Classic symptom of memory corruption: a write past a buffer is clobbering whatever happens to sit next to it, and that neighbor changes between runs. They recompile with `-fsanitize=address`, run once, and ASan reports `heap-buffer-overflow ... WRITE of size 1` pointing at a single `buf[len] = '\0'` line — an off-by-one where `buf` was `malloc(len)` instead of `malloc(len + 1)`. A bug that ate two days of "it's haunted" becomes a one-line fix in thirty seconds.

**2. The leak that crept up over a weekend.** A long-running service slowly grows its memory until the OS kills it days later. The team builds the test suite with ASan (which includes LeakSanitizer) and runs it. On exit, LSan prints `Direct leak of 4096 byte(s)` with the allocation stack trace, pinpointing a `malloc` in an error-handling path whose matching `free` was missing. The leak only triggered on the error path — which their tests *did* exercise, so ASan caught it.

**3. Why "passes all tests" wasn't enough.** A library passes its full ASan-instrumented test suite cleanly. The maintainers add a fuzzer (libFuzzer) on top of the same ASan build. Within minutes the fuzzer feeds a malformed input that no human test had tried, driving execution into a rarely-hit branch — and ASan immediately flags a `stack-buffer-overflow` there. The bug existed all along; ASan simply needed an input that *reached* it. This is Core Concept 5 in action, and the reason ASan and fuzzing are inseparable in serious projects.

---

## Mental Models

- **ASan is a bouncer for memory.** Every time your program tries to touch a byte, the bouncer checks a guest list (the shadow memory: "is this byte yours right now?"). Past the end of an array? Freed already? Not on the list — the bouncer stops you at the door and writes down exactly who tried and where they came from.

- **Poisoned redzones around your blocks.** ASan surrounds every allocation with off-limits "redzones" and marks freed memory as poisoned. An overflow steps into a redzone; a use-after-free touches poison. Either way, an instant, deliberate trip-wire instead of silent corruption.

- **The report is a crime scene reconstruction.** A plain crash shows you only the body (where the program died). ASan shows you the *body, the time of death (where it was freed), and the birth certificate (where it was allocated)*. Three facts instead of one — usually enough to solve the case immediately.

- **Dynamic = "I only see the movie that played."** ASan watches the actual execution. If a scene (code path) never plays, ASan never reviews it. To review more scenes, you must make them play — better tests, more inputs, fuzzing.

- **Compile-time switch, run-time guard.** Flipping `-fsanitize=address` builds a *different* program — your code plus guardrails. You test with the guarded build and ship the plain one.

---

## Common Mistakes

1. **Forgetting `-g`, then complaining the report is unreadable.** Without `-g`, stack traces are raw hex addresses, not `file.c:42`. Always compile ASan builds with `-g`. (For a still-readable trace without full debug info, `-g1` is enough.)

2. **Putting `-fsanitize=address` only at compile or only at link, not both.** ASan must be present when you *compile* each file **and** when you *link* the final binary. The simplest safe habit: pass it in your one `clang ... bug.c -o bug` command, which does both. With separate steps, add it to both.

3. **Shipping an ASan build to production.** It's ~2× slower and ~3× more memory, and it's a *detector*, not a shield. ASan belongs in dev/CI; ship the normal build.

4. **Believing a clean ASan run means "no memory bugs."** It means *no memory bugs on the paths you ran*. Untested branches are invisible to ASan. Pair it with strong tests and, eventually, fuzzing.

5. **Expecting ASan to find data races or integer overflow.** Wrong tool. Races → TSan. Non-address UB like signed overflow → UBSan. ASan is *memory addresses* only.

6. **Trying to combine ASan and TSan in one build.** They conflict; the build will refuse or misbehave. Build separately for each. (ASan + UBSan *do* combine, via `-fsanitize=address,undefined`.)

7. **Ignoring leak reports because they print "at the end."** LeakSanitizer reports leaks on program *exit*, after your output — easy to scroll past. They're still real bugs; read to the bottom.

---

## Test Yourself

1. In one sentence, what kind of bugs does ASan find, and *when* does it find them (compile time or run time)?
2. What is the single compiler flag that enables ASan, and why do you also add `-g`?
3. You get `heap-use-after-free`. Name the three pieces of location information ASan gives you, and what each one means.
4. Your colleague says "I ran my program with ASan and it found nothing, so my code is memory-safe." What's the flaw in that conclusion?
5. Why don't we ship ASan-instrumented binaries to production? Give the rough cost in speed and memory.
6. You suspect a *data race* between two threads. Is ASan the right tool? If not, which sibling is?
7. A program writes to `a[5]` where `a` is declared `int a[5];` and `a` is a local variable. What ASan error category will you most likely see?

<details>
<summary>Answers</summary>

1. ASan finds **memory-safety bugs** (buffer overflows, use-after-free, double-free, leaks) **at run time** — it watches the program execute. (You enable it at compile time, but the detection happens while running.)
2. `-fsanitize=address` enables ASan. You add `-g` so the report shows **file names and line numbers** instead of raw hex addresses, making it readable.
3. (a) **The faulting access** — the line that illegally used the memory; (b) **"freed ... here"** — the line where the memory was `free`d; (c) **"previously allocated ... here"** — the line where it was `malloc`'d. Together they give the memory's full lifetime.
4. ASan is **dynamic** — it only sees bugs on lines that *actually executed*. A clean run proves the *tested paths* are clean, not the whole program. Untested branches could still contain memory bugs; that's why you pair ASan with good tests and fuzzing.
5. ASan is a *bug detector*, not a runtime defense, and it costs roughly **~2× slower and ~3× more memory** — unacceptable for production workloads. Ship the normal build; use ASan in dev/CI.
6. **No** — ASan is for memory-safety bugs, not concurrency. For data races, use **TSan (ThreadSanitizer)**.
7. **stack-buffer-overflow** — `a` is a local array (lives on the stack), and `a[5]` is one element past its end (valid indices are `a[0]`–`a[4]`).

</details>

---

## Cheat Sheet

```
WHAT ASAN CATCHES (memory-safety bugs, at RUN time)
  heap-buffer-overflow     past a malloc'd block
  stack-buffer-overflow    past a local array
  global-buffer-overflow   past a global/static array
  heap-use-after-free      using memory after free()
  use-after-return/scope   using a local after its function/block ended
  double-free / invalid free   bad free() calls
  memory leak              malloc with no free (via LeakSanitizer)

TURN IT ON (compile, then run normally)
  clang -fsanitize=address -g -fno-omit-frame-pointer bug.c -o bug
  ./bug
  # -fsanitize=address  → enable ASan
  # -g                  → file:line in reports
  # -fno-omit-frame-pointer → complete stack traces

READ THE REPORT TOP-DOWN
  1. bug TYPE              (heap-use-after-free, ...)
  2. READ or WRITE + size  (what you did, how many bytes)
  3. faulting stack trace  ← the line that did it
  4. "freed by ... here"   ← where memory was freed
  5. "allocated ... here"  ← where memory was malloc'd
  6. SUMMARY               (file:line recap)

COST  ~2x slower, ~3x more RAM → tests/CI/debug only, NOT production

LIMITATION  only finds bugs on lines that ACTUALLY RUN
            → only as good as your tests/inputs → pair with fuzzing

SIBLINGS
  memory bugs        → ASan   (this)
  data races         → TSan
  integer overflow / non-address UB → UBSan
  no recompile needed → Valgrind
  ASan + UBSan combine: -fsanitize=address,undefined
  ASan + TSan do NOT combine

HANDY
  ASAN_OPTIONS=halt_on_error=0 ./bug   # report and keep going
```

---

## Summary

- **ASan finds memory-safety bugs while your program runs** — heap/stack/global buffer overflows, use-after-free, use-after-return, double-free, invalid free, and (via bundled LeakSanitizer) memory leaks. These are exactly the silent, "crashes in the wrong place" bugs that plague C and C++.
- **You enable it with one flag at compile time** — `-fsanitize=address`, plus `-g` for readable file:line and `-fno-omit-frame-pointer` for complete traces — then run the program normally. The check is built into the binary; there's no separate tool to invoke.
- **The report reads top-down** and gives the memory's whole life story: the bug *type*, *read vs write* and size, the *faulting* line, where it was *freed*, and where it was *allocated*. That's three locations instead of the one a plain crash gives — usually enough to fix the bug on the spot.
- **It costs ~2× speed and ~3× memory**, which is fine for tests and CI but means you *don't ship ASan builds to production* — it's a bug-*finder*, not a runtime shield.
- **Its big limitation is that it's dynamic**: it only catches bugs on lines that actually execute, so it's only as good as your tests and inputs. Strong tests plus fuzzing are how you make ASan see more.
- **It has siblings for other bug classes** — TSan (data races), UBSan (other undefined behavior), Valgrind (no recompile needed). Start with ASan; it catches the most common and most dangerous class.

Memory-safety bugs cause roughly 70% of serious security vulnerabilities. ASan turns the worst category of C/C++ bug — silent corruption that strikes far from its cause — into an instant, located, readable error. Building the habit of "compile with `-fsanitize=address`, run your tests" is one of the cheapest, highest-return moves a systems programmer can make.

---

## Further Reading

- [Clang AddressSanitizer documentation](https://clang.llvm.org/docs/AddressSanitizer.html) — the official reference: flags, supported platforms, `ASAN_OPTIONS`, and what each error means. Read this first.
- [Google Sanitizers wiki — AddressSanitizer](https://github.com/google/sanitizers/wiki/AddressSanitizer) — the project home, including the algorithm, examples, and the bundled LeakSanitizer.
- *AddressSanitizer: A Fast Address Sanity Checker* — Serebryany, Bruening, Potapenko, Vyukov (USENIX ATC 2012). The original paper; surprisingly readable, and explains the shadow-memory/redzone trick that makes ASan fast.
- The [middle.md](middle.md) of this topic, which goes under the hood: shadow memory, redzones, how the instrumentation works, `ASAN_OPTIONS` tuning, suppressions, and integrating ASan into CI.

---

## Related Topics

- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md) — ASan's sibling for *data races*, the other great class of nasty C/C++ bugs.
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/junior.md) — catches non-address undefined behavior (integer overflow, bad shifts); combines with ASan.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/junior.md) — finds similar memory bugs *without recompiling*, at the cost of much higher slowdown.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/junior.md) — fuzzing: how to drive execution into the paths ASan can't see on its own.
- [Static Analysis & Linting](../../static-analysis/) — the complementary approach: finding bugs *without running* the program.
- [Security](../../../../Security/) — why memory-safety bugs are the root of most serious vulnerabilities.
