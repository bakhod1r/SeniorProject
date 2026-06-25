# Memory-Safety Mechanisms — Junior Level

> **Topic:** [Memory-Safety Mechanisms](README.md)
> **Focus:** What "memory safety" actually means, the handful of bug shapes that break it, and why the language you write in decides whether those bugs are even possible.

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
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does it mean for a program to be "memory-safe"?** And **why do whole categories of catastrophic bugs simply not exist in some languages?**

**Memory safety** is the property that a program can only ever read or write memory it is *allowed* to: memory that has been allocated to it, is still alive, and is being accessed within its real bounds and with its real type. A memory-safe program never reads past the end of an array, never uses an object after it has been freed, never frees the same block twice, and never reads a variable that was never given a value.

That sounds obvious. The surprising part is that two of the most influential programming languages in history — **C** and **C++** — do *not* enforce this. In C, an array is just a pointer plus your promise that you will stay inside it. If you walk off the end, the language does not stop you. It does not even know. It happily reads or writes whatever bytes happen to sit there next in memory — another variable, a saved return address, the bookkeeping of the memory allocator. The program keeps running with corrupted state, and *that* is where security vulnerabilities are born.

There are two halves to the safety property, and it helps to name them early:

- **Spatial safety** — you stay *inside the bounds* of the thing you are pointing at. No reading or writing element `[100]` of a 10-element array.
- **Temporal safety** — you only touch memory *while it is alive*. No using a pointer after the thing it pointed to has been freed.

A language is fully memory-safe only if it guarantees **both**. Most safe languages buy spatial safety with **bounds checks** (the runtime verifies every index) and temporal safety with **automatic memory management** (you never call `free` by hand, so you can't free at the wrong time).

> 🎓 **Why this matters for a junior:** Memory-safety bugs are not exotic. They are the single largest source of severe, exploitable security holes in software. Microsoft reported that **~70% of the serious security vulnerabilities** it patches are memory-safety issues. The Chromium (Chrome) team reported the same ~70% figure for their high-severity bugs. These are not bugs that crash sometimes — they are the bugs attackers turn into "run my code on your machine." Understanding the bug shapes, even before you can fix every one, makes you a meaningfully safer engineer.

This page covers what each bug shape *is*, what spatial and temporal safety mean, the four big language strategies for getting safety (C's "discipline + tools," garbage collection, Rust's ownership, Swift's reference counting), and what tools like AddressSanitizer do to catch the bugs C lets through. The deeper levels go further: `middle.md` into allocators and sanitizer internals, `senior.md` into Rust's borrow checker and the managed-runtime guarantees, `professional.md` into hardware mechanisms like memory tagging and CHERI, and the industry-wide migration to memory-safe languages.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a variable, an array, and a function are in some language.
- **Required:** The vague idea that data lives "in memory" at numbered locations (addresses).
- **Helpful but not required:** Some exposure to **pointers** — a value that *is* an address. C, C++, Go, and Rust all have them in some form.
- **Helpful but not required:** The idea of the **heap** (long-lived memory you ask for explicitly) versus the **stack** (short-lived memory for the current function call).
- **Helpful but not required:** Having seen a program crash with `Segmentation fault` — that message is the operating system catching *one specific kind* of memory misuse.

You do **not** need to know:

- How a garbage collector is implemented (later levels).
- The Rust borrow checker's rules in detail (`senior.md`).
- How sanitizers lay out shadow memory (`middle.md`).
- Any assembly or CPU architecture.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Memory safety** | The guarantee that a program only accesses memory that is allocated, alive, and within bounds (and of the right type). |
| **Spatial safety** | Staying within the *bounds* of an allocation. Violations: out-of-bounds (OOB) read/write, buffer overflow. |
| **Temporal safety** | Only accessing memory *while it is alive*. Violations: use-after-free, double-free, dangling pointer. |
| **Buffer** | A contiguous block of memory, e.g. an array or a region you allocated. |
| **Buffer overflow** | Writing past the end (or before the start) of a buffer, corrupting neighbouring memory. |
| **Out-of-bounds (OOB)** | Any access outside an allocation's real range. OOB **read** leaks data; OOB **write** corrupts data. |
| **Use-after-free (UAF)** | Using a pointer to memory that has already been freed. The memory may have been reused for something else. |
| **Double-free** | Calling `free` twice on the same pointer. Corrupts the allocator's internal bookkeeping. |
| **Dangling pointer** | A pointer that still holds an address, but the thing at that address is gone (freed or out of scope). |
| **Uninitialized read** | Reading a variable or buffer before any value was written into it. You get leftover garbage. |
| **Null dereference** | Following a pointer whose value is `NULL` (address 0). Usually crashes; on its own usually not exploitable, but a reliable bug. |
| **Type confusion** | Treating memory as one type when it is really another. Common with unions and bad casts. |
| **Bounds check** | A runtime test the language inserts: "is this index inside the array?" If not, it stops the program safely. |
| **Garbage collection (GC)** | Automatic reclamation of memory the program can no longer reach, so you never call `free` yourself. |
| **Undefined behavior (UB)** | In C/C++, the spec says the program's behavior is *completely unconstrained* if you do certain illegal things. The compiler may do anything. |
| **Sanitizer** | A compiler/runtime tool (e.g. AddressSanitizer) that instruments your program to *detect* memory bugs at runtime during testing. |
| **CVE** | "Common Vulnerabilities and Exposures" — a public catalog entry for a specific security flaw. Many are memory-safety bugs. |
| **Segmentation fault (segfault)** | The OS stopping a process that touched a page of memory it has no right to. The OS's coarse last-resort safety net. |

---

## Core Concepts

### 1. The Two Halves: Spatial and Temporal Safety

Everything in memory safety reduces to two questions about any memory access:

1. **Am I inside the bounds of the thing I'm pointing at?** (Spatial.)
2. **Is the thing I'm pointing at still alive?** (Temporal.)

If a language can answer *yes* to both for **every** access, the program is memory-safe. If even one access can sneak through with *no* on either, the door is open.

Think of an allocation as a numbered hotel room block. Spatial safety is "don't enter rooms 200–210 if you booked 100–110." Temporal safety is "don't enter your room after you've checked out and the cleaners (the allocator) have given it to someone else."

### 2. The Bug Taxonomy

There is a small, finite, well-understood list of ways memory safety breaks. Learn these shapes and you can recognize almost every memory bug:

**Spatial bugs (bounds):**

- **Stack buffer overflow** — writing past a fixed-size array that lives on the stack. Dangerous because the stack also holds the *return address* — where the function will jump back to when it finishes. Corrupt that and you can hijack control flow.
- **Heap buffer overflow** — writing past a block you got from the allocator. Corrupts neighbouring heap data or the allocator's metadata.
- **Out-of-bounds read** — reading past the end. Often "just" a crash, but it can *leak* secret data (the classic Heartbleed bug was an OOB read that leaked private keys).

**Temporal bugs (lifetime):**

- **Use-after-free (UAF)** — you `free(p)`, then later read or write `*p`. Meanwhile the allocator handed that memory to a different part of the program. Now two pieces of code think they own the same bytes.
- **Double-free** — `free(p); free(p);`. The allocator's internal free-list gets corrupted, which an attacker can steer.
- **Dangling pointer** — keeping (and using) a pointer to a stack variable after the function returned, or to a heap block after it was freed.

**Other safety holes:**

- **Uninitialized read** — using memory before writing it. You read whatever bytes were left there. Non-deterministic bugs and information leaks.
- **Type confusion** — bytes are valid as type A but you access them as type B (e.g. a bad `union` access or downcast). Pointers inside become wild.
- **Null dereference** — `*p` when `p == NULL`. Usually a clean crash, but still a defect (and a denial-of-service vector).

### 3. Why C and C++ Let These Happen

C was designed in the 1970s to be a thin, fast layer over the hardware. A C array doesn't carry its length around. When you write `arr[i]`, the compiler emits "take the address of `arr`, add `i × element_size`, access that." There is **no check** that `i` is in range — that would cost a comparison and a branch on every access, and 1970s machines were slow. The *programmer* is responsible for never going out of bounds.

Similarly, C makes you call `malloc` to get heap memory and `free` to give it back. The language does not track whether you still have other pointers to that block when you free it. If you do, those pointers are now dangling, and using them is **undefined behavior**.

**Undefined behavior** is the crucial idea. The C standard says: if your program does something illegal (OOB access, UAF, etc.), the standard imposes *no requirements at all* on what happens. It might crash, might silently corrupt data, might appear to work, and crucially the *optimizer* is allowed to assume UB never happens — which can make the bug behave even more strangely. This is why memory bugs in C are so insidious: they often don't crash where the mistake is.

### 4. The Safe-Language Strategies (Overview)

There are four broad ways the industry buys memory safety. You'll meet all of them:

1. **Unsafe by default + discipline + tooling (C/C++).** The language gives no guarantees; you stay safe through care, conventions (always track sizes, always null pointers after freeing), and *tools* that catch mistakes — sanitizers in testing, hardened allocators in production. This is the legacy mountain the industry is trying to climb down from.

2. **Garbage collection (Java, Go, C#, JavaScript, Python).** The runtime inserts **bounds checks** on array access (spatial safety) and manages memory for you with a **garbage collector**, so you never `free` and therefore can't UAF or double-free (temporal safety). This is the most common form of safety today. (Caveat: GC languages still have escape hatches like Java's `sun.misc.Unsafe` and Go's `unsafe`/cgo, and concurrency data races can still break their safety — more on this at higher levels.)

3. **Ownership and borrowing, checked at compile time (Rust).** Rust enforces, *at compile time with zero runtime cost*, that there is a clear owner of every value, and that you can't use a value after it's gone or alias it mutably. Memory bugs become *compile errors*. You opt out only inside explicit `unsafe` blocks. (`senior.md` covers the borrow checker.)

4. **Automatic reference counting (Swift, Objective-C).** Each object carries a count of how many references point to it; when the count hits zero, the object is freed immediately. Safety from never-manually-freeing, like GC, but deterministic. (Its weakness is *reference cycles* — covered later.)

### 5. Bounds Checks: The Workhorse of Spatial Safety

The single most common safety mechanism you'll rely on is the **bounds check**. In Java, Go, C#, Python, Rust — when you index an array, the runtime (or compiled code) first checks `0 <= index < length`. If not, it throws/panics with a clear error (`ArrayIndexOutOfBoundsException`, `index out of range`, a Rust panic) *instead of* silently reading neighbouring memory.

This turns a *silent, exploitable corruption* into a *loud, contained crash*. That trade — a tiny per-access cost for converting catastrophe into a clean failure — is the foundation of safe languages. And modern compilers are clever: when they can *prove* an index is always in range (e.g. a `for i in 0..len` loop), they **eliminate the check** entirely, so you often pay nothing.

### 6. Garbage Collection: The Workhorse of Temporal Safety

If you never call `free`, you can never call it at the *wrong* time. That's the core insight behind garbage collection. The runtime periodically figures out which objects are still **reachable** (something can still get to them by following references from live variables) and reclaims the rest. An object that's still reachable is never freed, so a pointer to it can never dangle.

This eliminates use-after-free, double-free, and most dangling-pointer bugs by construction. The cost is *runtime overhead* (the GC has to run) and *less predictable timing* (pauses). For most applications that's a great trade; for hard-real-time or tiny embedded systems it can be unacceptable, which is part of why C/C++ and Rust still matter.

---

## Real-World Analogies

- **The hotel room block (bounds).** You booked rooms 100–110. Walking into room 150 is an out-of-bounds access. A bounds check is the key-card reader that beeps red and won't let you in. C is a hotel with no locks on any door — you *can* walk into 150, and you might find another guest's belongings (data leak) or wreck the room (corruption).

- **The library book (use-after-free).** You return a book (free), then someone else borrows it. If you'd scribbled the page number on a sticky note and later go pull "your" book off the new borrower's desk and start editing it, you're editing *their* book now. That's use-after-free: the resource was reassigned, but you kept acting like it was yours.

- **Returning a borrowed key twice (double-free).** You hand the front desk a room key (free). Then you hand them the same key again — but they already gave it to a new guest. Now their key-tracking ledger is confused about who has what. That confusion is the corrupted allocator state a double-free creates.

- **Uninitialized = a notepad someone else used.** You grab a notepad off a shared shelf and read the top page expecting your notes. Instead you find whatever the last person scribbled. Reading uninitialized memory gives you *leftover garbage*, not a clean zero (unless the language promises to clear it).

- **The garbage collector = the building's cleaning crew.** They only throw out things nobody can reach anymore. You never personally take out the trash, so you can never throw out something still in use. That's GC's safety guarantee.

---

## Mental Models

**Model 1: Every pointer access asks two questions.** Before *any* memory access, mentally ask: "Is this in bounds?" and "Is this still alive?" Safe languages answer these *for you* (bounds checks + GC/ownership). In C, *you* are the answer, on every single line, forever. That asymmetry is the whole story.

**Model 2: Safety converts silent corruption into a loud crash.** Unsafe code that goes wrong keeps running with broken state — the worst outcome, because the damage spreads and the symptom appears far from the cause. Safety mechanisms *fail fast*: a bounds violation becomes an immediate exception/panic at the exact bad access. Loud-and-early beats silent-and-late.

**Model 3: "It worked on my machine" is the signature of a memory bug.** Because out-of-bounds and use-after-free in C are *undefined behavior*, the program may appear to work — until the memory layout shifts (a new compiler, an added field, a different input) and the same bug suddenly corrupts something important. Intermittent, layout-sensitive, "Heisenbug" behavior is the fingerprint of unsafe memory access.

**Model 4: Safety is a property of the *language*, not your carefulness.** You cannot make C memory-safe by being careful — the entire C/C++ ecosystem of expert programmers has produced the ~70% CVE statistic *while trying very hard*. Safety as a guarantee comes from the language or runtime *making the bug impossible or detectable*, not from human vigilance.

---

## Code Examples

> ⚠️ These examples *demonstrate the bugs so you can recognize them*. They are deliberately small and defensive — there are no exploits here, just "here is the broken access, here is why a safe language stops it, here is how you'd write it correctly."

### Spatial bug: out-of-bounds write in C

```c
#include <stdio.h>

int main(void) {
    int arr[5];                 // valid indices: 0..4
    for (int i = 0; i <= 5; i++) {   // BUG: <= goes to index 5
        arr[i] = i * i;         // arr[5] writes one int PAST the array
    }
    // The write to arr[5] lands on whatever memory follows `arr`.
    // C does NOT stop you. No error. Maybe a crash, maybe silent corruption.
    return 0;
}
```

The classic "off-by-one." `i <= 5` writes to `arr[0..5]` — six elements into a five-element array. C emits no check. The result is undefined behavior.

### The same logic in Go — caught at runtime

```go
package main

func main() {
    arr := [5]int{}
    for i := 0; i <= 5; i++ {
        arr[i] = i * i // panics at i==5: "index out of range [5] with length 5"
    }
}
```

Go inserts a bounds check. At `i == 5` the program *panics immediately* with a precise message, instead of silently corrupting memory. Same bug, but now it's a loud, debuggable crash at the exact bad line.

### Use-after-free in C

```c
#include <stdlib.h>
#include <string.h>

char *make_greeting(void) {
    char *buf = malloc(16);
    strcpy(buf, "hello");
    return buf;
}

int main(void) {
    char *g = make_greeting();
    free(g);          // memory returned to the allocator
    // ... later, by mistake ...
    g[0] = 'H';       // BUG: use-after-free. `g` is dangling.
    return 0;
}
```

After `free(g)`, the bytes `g` points at may be reused for something else. Writing through `g` now corrupts whatever lives there. Defensive habit: set `g = NULL;` right after freeing so a later use crashes cleanly instead of corrupting.

### Why GC languages can't have this bug

```java
String makeGreeting() {
    return "hello"; // allocated on the GC heap
}

void demo() {
    String g = makeGreeting();
    g = null;        // we drop our reference...
    // There is NO `free`. We cannot free `g` at the wrong time,
    // because we cannot free at all. The GC reclaims it ONLY when
    // nothing can reach it. Use-after-free is impossible by construction.
}
```

### Uninitialized read in C vs. zero-init in Go

```c
int x;            // C: uninitialized, value is garbage (leftover bytes)
printf("%d\n", x); // reads whatever was on the stack. UB to use it.
```

```go
var x int          // Go: ALWAYS zero-initialized to 0
fmt.Println(x)     // prints 0 deterministically. No garbage reads.
```

Many safe languages zero-initialize memory, closing the uninitialized-read hole entirely.

### Catching a C bug with AddressSanitizer (the workflow you'll actually use)

```bash
# Compile the buggy program with AddressSanitizer instrumentation:
clang -fsanitize=address -g overflow.c -o overflow

# Run it. ASan detects the bad access and prints a precise report:
./overflow
# =================================================================
# ==12345==ERROR: AddressSanitizer: stack-buffer-overflow ...
#   WRITE of size 4 at 0x... thread T0
#     #0 0x... in main overflow.c:6:9   <-- exact file and line
```

You don't have to *prevent* every bug by hand. You compile with `-fsanitize=address` during testing, and ASan turns the silent corruption into a precise, instant report naming the exact line. This is the single most important tool a C/C++ junior can adopt.

---

## Pros & Cons

**Safe-by-default languages (GC: Java/Go/C#/JS; or Rust/Swift):**

- ✅ Whole classes of severe, exploitable bugs are *impossible* (or caught instantly).
- ✅ You spend zero mental budget on "did I free this correctly?"
- ✅ Crashes are loud and precise, not silent and delayed.
- ❌ GC languages add runtime overhead and pause timing you don't fully control.
- ❌ Less direct control over memory layout; sometimes higher memory use.

**Unsafe-by-default languages (C/C++):**

- ✅ Maximum control and predictability over memory and timing — essential for kernels, drivers, embedded, hard-real-time.
- ✅ No runtime, tiny footprint, runs anywhere.
- ❌ You carry the *entire* burden of safety, forever, on every line.
- ❌ Bugs are undefined behavior: silent, layout-sensitive, and the dominant source of severe CVEs (~70%).

---

## Use Cases

- **Web/backend services, apps, scripts** → safe GC languages (Go, Java, C#, Python, JS). The safety/productivity trade is overwhelmingly worth it.
- **Systems where you can't afford a GC pause or runtime** (OS kernels, embedded, real-time, game engines) → C, C++, or increasingly **Rust** (safety *without* a GC).
- **Security-critical native code** (browsers, crypto, parsers handling untrusted input) → moving aggressively to Rust; if staying in C/C++, mandatory sanitizers + hardened allocators + fuzzing.
- **Existing C/C++ codebases that can't be rewritten** → harden in place: `_FORTIFY_SOURCE`, sanitizers in CI, hardened allocators, and new components in a safe language.

---

## Coding Patterns

These are habits that make a difference even as a junior.

```c
// 1. Always track sizes alongside buffers (never trust a bare pointer).
void process(const char *data, size_t len) {   // len travels WITH data
    for (size_t i = 0; i < len; i++) { /* ... */ }
}

// 2. Null after free so a later use crashes loudly, not silently.
free(p);
p = NULL;

// 3. Prefer the size-bounded function (snprintf) over the unbounded one (sprintf).
char buf[32];
snprintf(buf, sizeof(buf), "%d", value);  // never overflows buf
```

```go
// 4. In Go/Java/Rust, lean on the language: range loops can't go out of bounds.
for i, v := range items { // i is always valid; no manual index arithmetic
    _ = v
    _ = i
}
```

---

## Best Practices

- **Default to a memory-safe language** for new code unless you have a hard reason not to. This is now official guidance from security agencies (CISA/NSA).
- **In C/C++, always compile your tests with AddressSanitizer** (`-fsanitize=address`). It is nearly free to adopt and catches most of the bugs you'd otherwise ship.
- **Track the length of every buffer** explicitly. A pointer without a known length is an accident waiting to happen.
- **Prefer bounded library functions** (`snprintf`, `strncpy` used carefully, `memcpy` with checked sizes) over unbounded ones (`sprintf`, `strcpy`, `gets` — never use `gets`).
- **Initialize variables when you declare them.** Don't leave a variable to be filled in "later."
- **Set freed pointers to `NULL`** so a later accidental use fails fast.
- **Never disable bounds checks** in safe languages to "go faster" until you've measured that they actually matter (they usually don't — the optimizer removed most).

---

## Edge Cases & Pitfalls

- **A program that "works" is not proof of safety.** Memory bugs in C are undefined behavior; they can be present and dormant. Run sanitizers to find them.
- **Off-by-one is the most common spatial bug.** `<=` instead of `<`, or `len` instead of `len - 1`, walks exactly one element past the end. Watch loop bounds like a hawk.
- **`strcpy`/`sprintf`/`gets` have no idea how big your buffer is.** They write until they hit a terminator, overflowing happily. Treat them as hazards.
- **A null check is not a bounds check.** A pointer can be non-null and still point out of bounds or to freed memory.
- **GC does not mean "no memory bugs."** It means no *use-after-free* from manual frees. You can still leak (keep references you don't need) and still have data races corrupt memory in some runtimes. (More at higher levels.)
- **Sanitizers slow your program down** (ASan ~2×) and use more memory. They're for *testing*, not production.

---

## Common Mistakes

- Assuming "I'm careful" makes C memory-safe. The whole industry is careful and still produces the CVE statistics.
- Using `strcpy`/`sprintf` because the example you copied did.
- Forgetting that an array index can come from *untrusted input* — that's exactly how an OOB bug becomes a security hole.
- Reading a `malloc`'d buffer before writing it (`malloc` does *not* zero memory; `calloc` does).
- Thinking a `Segmentation fault` is the *only* symptom of a memory bug. Many memory bugs never segfault — they silently corrupt.

---

## Tricky Points

- **Why doesn't C just add bounds checks?** Because a C array is *just a pointer* — at the point of access, the length isn't even available. The language threw it away. Safe languages keep arrays as "pointer **+ length**" (a "fat" representation) so the check is *possible*.
- **Why is an out-of-bounds *read* dangerous if it doesn't corrupt anything?** It can *leak secrets*. Heartbleed read past a buffer and returned server memory — including private keys — to attackers.
- **Why is use-after-free worse than a simple crash?** Because the freed memory often gets *reused* for a different object. An attacker who can control *what* gets placed there can make your dangling pointer operate on attacker-chosen data. That's how UAF becomes code execution.

---

## Test Yourself

1. Define spatial safety and temporal safety, and give one bug that violates each.
2. Why is `arr[i]` with no check unsafe in C but safe in Go?
3. What does `free(p); free(p);` corrupt, and why does that matter for security?
4. Why can a garbage-collected language *not* have a use-after-free from your own code?
5. What does AddressSanitizer give you that a plain crash does not?
6. Roughly what fraction of severe CVEs in C/C++ codebases are memory-safety bugs, per Microsoft and Chromium?
7. Why is "it works on my machine" a warning sign for memory bugs specifically?

---

## Cheat Sheet

```text
MEMORY SAFETY = spatial safety (in bounds) + temporal safety (still alive)

BUG TAXONOMY
  Spatial:  stack overflow | heap overflow | OOB read | OOB write
  Temporal: use-after-free | double-free | dangling pointer
  Other:    uninitialized read | type confusion | null deref

WHY IT MATTERS
  ~70% of severe CVEs in C/C++ are memory-safety bugs (Microsoft, Chromium)

LANGUAGE STRATEGIES
  C/C++   : unsafe by default -> discipline + tools (sanitizers, hardened alloc)
  GC langs: bounds checks (spatial) + GC, no manual free (temporal)
  Rust    : ownership + borrow checker, compile-time, unsafe blocks audited
  Swift   : automatic reference counting (ARC), deterministic frees

THE WORKHORSES
  bounds check  -> spatial safety  (optimizer removes provable ones)
  GC / ownership-> temporal safety

TOOLING (C/C++)
  compile tests with -fsanitize=address  (AddressSanitizer)
  track sizes, snprintf not sprintf, NULL after free, init on declare
```

---

## Summary

Memory safety means a program only touches memory that is **in bounds** (spatial) and **still alive** (temporal). When that breaks, you get a small, well-known family of bugs: buffer overflows, out-of-bounds reads/writes, use-after-free, double-free, uninitialized reads, type confusion, and null dereferences. These are not rare — they are the dominant source of severe security vulnerabilities, about **70%** in major C/C++ codebases.

C and C++ are *unsafe by default*: arrays carry no length, you free memory by hand, and mistakes are undefined behavior — silent and layout-sensitive. Safe languages eliminate these bugs structurally: **bounds checks** give spatial safety, and **garbage collection** (Java/Go/C#/JS), **ownership** (Rust), or **reference counting** (Swift) give temporal safety. In C/C++ you can't be careful enough by hand, so you lean on **tools** — AddressSanitizer in testing above all — to convert silent corruption into loud, precise reports. The whole industry is now moving toward memory-safe languages for exactly this reason.

---

## What You Can Build

- A small C program that demonstrates each bug shape, compiled both normally and under `-fsanitize=address`, so you can *see* the difference between silent corruption and a precise report.
- The same array-indexing logic in C, Go, and Java side by side, showing where the bounds check fires.
- A "size-tracking" string library in C that always carries a length, never overflows, and refuses unbounded copies — your first taste of writing defensively.

---

## Further Reading

- *Microsoft Security Response Center — "A proactive approach to more secure code"* (the ~70% memory-safety statistic). https://msrc.microsoft.com/blog/2019/07/a-proactive-approach-to-more-secure-code/
- *Chromium Security — "Memory safety"* (Chrome's ~70% high-severity figure). https://www.chromium.org/Home/chromium-security/memory-safety/
- *AddressSanitizer documentation* — https://clang.llvm.org/docs/AddressSanitizer.html
- *The Heartbleed bug* — an out-of-bounds read explained for non-specialists. https://heartbleed.com/
- *CISA/NSA — "The Case for Memory Safe Roadmaps"* — government guidance on migrating to memory-safe languages.
- *Effective C* — Robert Seacord. A modern, security-aware C book.

---

## Related Topics

This topic sits inside the language-security-internals area. The natural next reads from here are the deeper levels of this same topic — `middle.md` for allocators and sanitizer internals, `senior.md` for the Rust borrow checker and managed-runtime guarantees, `professional.md` for hardware mechanisms (memory tagging, CHERI) and the industry migration, `interview.md` for question practice, and `tasks.md` for hands-on exercises. Conceptually adjacent areas covered elsewhere in the roadmap include undefined behavior and the compilation pipeline, garbage-collection internals, and exploit-mitigation defenses — explored in their own folders.

---

## Diagrams & Visual Aids

### The Two Halves of Safety

```text
            SPATIAL SAFETY                 TEMPORAL SAFETY
      "Am I inside the bounds?"       "Is the memory still alive?"

      [ alloc: 5 ints           ]      time ─►
      idx:  0   1   2   3   4          alloc ──────── free ──────── (reused)
            ^^^^^^^^^^^^^^^^^^^^                ^ valid       ^ DANGLING
              valid range                       use here OK    use here = UAF
      idx 5  ──► OUT OF BOUNDS
```

### One Bug, Two Languages

```text
  arr[5] on a length-5 array
  ┌──────────────────────────┬──────────────────────────────┐
  │  C (unsafe by default)   │  Go / Java / Rust (safe)      │
  ├──────────────────────────┼──────────────────────────────┤
  │  no check                │  bounds check fires           │
  │  writes neighbouring mem │  panic / exception, no write  │
  │  silent corruption (UB)  │  loud crash at exact line     │
  └──────────────────────────┴──────────────────────────────┘
```

### The Four Safety Strategies

```text
  UNSAFE + TOOLS        GARBAGE COLLECTION     OWNERSHIP            REF COUNTING
  (C, C++)              (Java, Go, C#, JS)     (Rust)               (Swift, ObjC)
  ──────────────        ──────────────────     ─────────────        ─────────────
  discipline +          bounds checks +        compile-time         deterministic
  sanitizers +          no manual free         borrow checker,      free at count 0
  hardened alloc        (GC reclaims)          unsafe blocks        (cycles = leak)
        │                     │                     │                    │
        ▼                     ▼                     ▼                    ▼
   safe IF you          safe (modulo           safe with zero       safe, predictable
   never slip           Unsafe/races)          runtime cost         timing
```
