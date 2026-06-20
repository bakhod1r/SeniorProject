# UndefinedBehaviorSanitizer (UBSan) — Junior Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → UndefinedBehaviorSanitizer (UBSan)
> *In C and C++ some operations aren't just bugs — the language declares them "undefined," which means the compiler is allowed to assume you'd never do them and to optimize as if they're impossible. UBSan is the tool that catches you in the act, at runtime, and tells you exactly which line did the forbidden thing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "Undefined Behavior" Actually Means](#core-concept-1--what-undefined-behavior-actually-means)
5. [Core Concept 2 — A Tour of Common UB](#core-concept-2--a-tour-of-common-ub)
6. [Core Concept 3 — UBSan: Turn UB Into a Loud Error](#core-concept-3--ubsan-turn-ub-into-a-loud-error)
7. [Core Concept 4 — Reading and Fixing a UBSan Report](#core-concept-4--reading-and-fixing-a-ubsan-report)
8. [Core Concept 5 — Recover, Halt, or Trap](#core-concept-5--recover-halt-or-trap)
9. [Core Concept 6 — UBSan vs Its Sibling Sanitizers](#core-concept-6--ubsan-vs-its-sibling-sanitizers)
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

> Focus: **What is undefined behavior, and how does UBSan catch it?**

Most languages, when you do something nonsensical, give you a defined answer or a clean crash. Divide by zero in Python? You get a `ZeroDivisionError`. Index past the end of a list in Java? `ArrayIndexOutOfBoundsException`. The behavior is *specified* — the language promises what happens.

C and C++ are different, and the difference catches every newcomer off guard. The language specification carves out a category of operations it calls **undefined behavior (UB)**: signed integer overflow, dividing by zero, dereferencing a null pointer, shifting a number too far, reading past the end of an array. For these, the spec says nothing about what happens. Not "it returns garbage." Not "it crashes." It says the behavior is **undefined** — which, in practice, means the compiler is permitted to assume you *never do it*, and to optimize your program on that assumption.

That sounds abstract until it bites you. A program with UB might work perfectly for a year, then silently produce wrong numbers after you upgrade your compiler — because the new compiler optimized harder, leaning on an assumption your buggy code violated. UB bugs are the ones that "can't possibly be happening," the ones that vanish when you add a `printf`, the ones that work in a debug build and break in release.

**UndefinedBehaviorSanitizer (UBSan)** is the cure for this whole category of pain. It's built into `clang` and `gcc`. You add one flag at compile time — `-fsanitize=undefined` — and your program gains a set of tiny runtime checks. The instant it does something undefined, UBSan stops and prints a precise, human-readable message: *what* rule was broken, *where* (file and line), and *which values* were involved. The mystery becomes a one-line diagnosis.

> **Mindset shift:** Stop reading "undefined behavior" as "does something weird or random." Read it as **"the compiler is allowed to do literally anything — including silently deleting your code, your `if` checks, or your security guards — because it's allowed to assume this line is unreachable."** UB isn't a roll of the dice at runtime; it's a license the compiler holds at *compile* time. Once that clicks, you stop tolerating "harmless" UB, and UBSan becomes the tool that hunts it down before it hunts you.

---

## Prerequisites

- **Required:** You can write, compile, and run a basic C program (variables, functions, `if`, arrays, pointers, `printf`).
- **Required:** You've used a terminal to run a compiler — `gcc file.c -o app` or `clang file.c -o app` — and run the result with `./app`.
- **Helpful:** You know roughly what a pointer is and that `NULL` means "points at nothing."
- **Helpful:** You've been bitten by a bug that behaved differently in debug vs release, or after a compiler upgrade. (UB is often the culprit.)
- **Not required:** Any prior knowledge of sanitizers, undefined behavior, or the C standard. We define every term.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Undefined behavior (UB)** | An operation the C/C++ spec leaves *undefined* — the compiler may assume it never happens and optimize accordingly. |
| **The standard / the spec** | The official document defining the C (or C++) language. It says which operations are UB. |
| **Sanitizer** | A compiler feature that injects runtime checks into your program to catch a class of bugs. |
| **UBSan** | UndefinedBehaviorSanitizer — the sanitizer that catches undefined behavior. |
| **`-fsanitize=undefined`** | The compiler flag that turns UBSan on. |
| **Signed integer overflow** | A signed `int` going past its maximum (or below its minimum). This is UB. |
| **Instrumentation** | The extra checking code the compiler weaves into your program so the sanitizer can watch it run. |
| **Runtime error** | An error detected *while the program runs* (UBSan's reports), as opposed to a compile error. |
| **Trap** | To abort the program immediately and cheaply, with no diagnostic message. |
| **ASan / TSan** | AddressSanitizer (memory bugs) and ThreadSanitizer (data races) — UBSan's sibling tools. |

---

## Core Concept 1 — What "Undefined Behavior" Actually Means

The C standard sorts every operation into a few buckets. The one that matters here is **undefined behavior**: operations for which "this International Standard imposes no requirements." Read that literally — *no requirements*. The compiler owes you nothing.

The crucial consequence is not at runtime. It's at *compile* time. Because the compiler may assume UB never occurs, it treats any code path that *would* cause UB as **unreachable**, and it optimizes around that assumption. Look at this real example:

```c
int contains_overflow(int x) {
    return x + 100 > x;   // "is x + 100 bigger than x?"
}
```

You might think: "if `x` is near `INT_MAX`, `x + 100` overflows and wraps around to a negative number, so this could return `false`." But signed overflow is **UB**, so the compiler is allowed to assume it *never happens*. Under that assumption, `x + 100 > x` is *always true* — so the optimizer deletes the comparison entirely and compiles the function to:

```c
int contains_overflow(int x) {
    return 1;   // the compiler is allowed to do this
}
```

Your overflow check is gone. Not because the compiler is buggy — because *you* invoked UB, and the compiler legally optimized on the assumption that you wouldn't.

This is why UB is so dangerous and so confusing:

- It doesn't mean "produces a weird value." It means **the compiler can do anything** — return a constant, delete a branch, remove a bounds check, reorder code, or (sometimes) crash.
- It can be **invisible**: the program works today, then breaks after a compiler upgrade or a flag change, because a *different* legal optimization kicked in.
- It can **silently disable safety**. A real, famous bug pattern: a null-check that the compiler *removes* because earlier code already dereferenced the pointer (dereferencing null is UB, so the compiler assumes the pointer was non-null, so it deletes your `if (p == NULL)`).

> **Key insight:** UB is a *compile-time license*, not a *runtime dice roll*. The compiler optimizes as if UB is impossible, so "it worked when I tested it" proves nothing — the next build, with one more optimization enabled, can behave completely differently. This is exactly why you need a tool that catches UB *as it happens at runtime*, instead of hoping you'll notice the symptoms later.

---

## Core Concept 2 — A Tour of Common UB

You don't need to memorize the spec. You need to recognize the handful of UB operations that junior C code hits constantly. Here are the big ones, each a one-liner you might write without realizing it's forbidden:

**Signed integer overflow** — pushing a signed `int` past its limit:

```c
#include <limits.h>
int x = INT_MAX;     // the largest int, e.g. 2147483647
int y = x + 1;       // UB: there is no representable "INT_MAX + 1"
```

(Unsigned overflow is *defined* — it wraps around cleanly. Only **signed** overflow is UB. That distinction will matter when we fix bugs.)

**Division by zero** — including the integer remainder operator `%`:

```c
int a = 10, b = 0;
int c = a / b;       // UB: integer divide by zero
int d = a % b;       // UB: same problem with modulo
```

**Dereferencing a null (or dangling) pointer** — reading or writing through a pointer that points at nothing:

```c
int *p = NULL;
int v = *p;          // UB: reading through a null pointer
```

**Shifting by too much** — shifting an integer by a count greater than or equal to its bit-width:

```c
int n = 1;
int big = n << 32;   // UB: int is 32 bits, so shifting by 32 is out of range
int neg = 1 << 31;   // UB: this shifts a 1 into the sign bit of a signed int
```

**Reading or writing past the end of an array** — going out of bounds:

```c
int arr[3] = {10, 20, 30};
int oops = arr[3];   // UB: valid indices are 0, 1, 2 — index 3 is one past the end
```

**Misaligned pointer access** — treating a byte address as a wider type that requires alignment:

```c
char buf[8];
int *ip = (int *)(buf + 1);   // address not aligned for int
int v = *ip;                  // UB: misaligned load on many platforms
```

Other classics include using a variable before it's initialized, passing a null pointer to a function that requires non-null (like `memcpy`), and returning from a non-`void` function without a value. The list is long, but notice the theme: **every one of these is something the language forbids, yet nothing in plain C++ stops you from typing it.** The compiler won't reliably warn you, and the program might *appear* to work. That's the gap UBSan fills.

> **Key insight:** UB hides inside ordinary-looking arithmetic and pointer code. You will write `x + 1`, `a / b`, `arr[i]`, and `1 << k` thousands of times. Most are fine; a few aren't, and you can't tell by reading. The skill isn't avoiding these operations — it's running UBSan so you find out *immediately* when one of them crosses the line.

---

## Core Concept 3 — UBSan: Turn UB Into a Loud Error

UBSan's promise is simple: take the silent, invisible UB from Concept 2 and make it **loud and located**. You opt in at compile time with one flag, and the compiler weaves a small check around each risky operation.

The recipe is one extra flag (`-g` adds line numbers so reports name the exact line):

```bash
clang -fsanitize=undefined -g bug.c -o bug    # clang
gcc   -fsanitize=undefined -g bug.c -o bug    # gcc works identically
./bug
```

That's the whole setup. Now let's run it against real bugs.

**Example A — signed overflow.** Save this as `overflow.c`:

```c
#include <limits.h>
#include <stdio.h>

int main(void) {
    int x = INT_MAX;
    int y = x + 1;          // UB
    printf("%d\n", y);
    return 0;
}
```

Build and run:

```bash
clang -fsanitize=undefined -g overflow.c -o overflow
./overflow
```

UBSan prints:

```
overflow.c:6:15: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
```

It told you the file (`overflow.c`), the line (`6`), the *rule* (signed integer overflow), and the *actual values* (`2147483647 + 1`). No guessing.

**Example B — division by zero.** Save as `divzero.c`:

```c
#include <stdio.h>

int main(void) {
    int a = 42;
    int b = 0;
    printf("%d\n", a / b);   // UB
    return 0;
}
```

```bash
clang -fsanitize=undefined -g divzero.c -o divzero
./divzero
```

```
divzero.c:6:22: runtime error: division by zero
```

**Example C — shift out of range.** Save as `shift.c`:

```c
#include <stdio.h>

int main(void) {
    int n = 1;
    int k = 32;
    printf("%d\n", n << k);  // UB: int is 32 bits
    return 0;
}
```

```bash
clang -fsanitize=undefined -g shift.c -o shift
./shift
```

```
shift.c:6:22: runtime error: shift exponent 32 is too large for 32-bit type 'int'
```

Three bugs, three precise reports, each pointing at the exact operation and the exact values. Compare that to the *symptom* you'd otherwise chase: a function quietly returning the wrong number, or a crash with no explanation three function calls later.

Here's the part that makes UBSan a daily tool rather than a special-occasion one: **it's cheap.** Most UBSan checks add only a few percent to your runtime — a small price compared to AddressSanitizer, which typically makes programs about **2× slower** and uses far more memory. Because UBSan is so light, you can leave it on in your test suite, in CI, in debug builds — anywhere your code runs. Some teams even enable carefully chosen UBSan checks in *production* using trap mode (Concept 5), so an unexpected overflow aborts safely instead of corrupting data.

> **Key insight:** UBSan converts a *silent compile-time assumption* into a *visible runtime error*. The compiler was already assuming "this overflow never happens"; UBSan inserts the check that says "...and if it *does*, here's exactly where, and these are the values." You're not adding new bugs — you're forcing the existing, hidden ones to announce themselves.

---

## Core Concept 4 — Reading and Fixing a UBSan Report

A UBSan report follows a consistent shape. Once you can parse it, fixing the bug is usually obvious. Take this line apart:

```
overflow.c:6:15: runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
└── file ──┘ │ │  └──────────┘  └──── what rule ────┘  └──────── the offending values ────────┘
            line col
```

- **`overflow.c:6:15`** — file, line, and column. Go straight there.
- **`runtime error:`** — UBSan's signature. Searching your build logs for this exact string finds every UB it caught.
- **The rule** (`signed integer overflow`) — tells you the *category*, which tells you the *fix family*.
- **The values** (`2147483647 + 1`) — the concrete inputs that broke it, which is gold for understanding *why* it happened.

The **junior fix recipe** is the same every time:

1. Read the `runtime error:` line.
2. Jump to the file:line it names.
3. Identify the offending operation (the overflow, the divide, the deref, the shift, the index).
4. Make that operation legal.

How you make it legal depends on the category. The common fixes:

| UBSan says | Likely fix |
|---|---|
| `signed integer overflow` | Use a wider type (`long long`), or use an **unsigned** type if wrap-around is what you actually want, or check the range before computing. |
| `division by zero` | Guard the divisor: `if (b != 0) result = a / b;` |
| `null pointer ... load/store` | Check before dereferencing: `if (p != NULL) v = *p;` |
| `shift exponent N is too large` | Ensure the shift count is `< bit-width`; check or mask `k`. |
| `index N out of bounds` | Fix the loop bound or index so it stays within the array. |
| `load of misaligned address` | Don't cast `char*` to a wider pointer and deref; copy bytes with `memcpy` instead. |

Worked fix for Example A — signed overflow, where the intent was to add safely:

```c
// BEFORE (UB when x is near the max):
int y = x + 1;

// FIX 1 — if you expect large sums, use a wider type:
long long y = (long long)x + 1;   // long long holds far bigger values

// FIX 2 — if wrap-around is actually desired, say so explicitly with unsigned:
unsigned int y = (unsigned int)x + 1u;   // unsigned overflow is DEFINED (wraps)
```

Worked fix for Example B — division by zero:

```c
// BEFORE:
int q = a / b;

// FIX — guard the divisor:
if (b != 0) {
    int q = a / b;
    // ... use q
} else {
    // handle the "no valid result" case
}
```

Notice that fixing UB is rarely about "making the warning go away" — it's about deciding *what you actually meant* when the operation hits its edge case. UBSan forces that decision instead of letting the compiler make it for you (silently, and possibly differently next release).

> **Key insight:** The `runtime error:` line is a diagnosis, not just an alarm. The **rule** names the disease and the **values** explain the case. Don't suppress it — read it, then fix the *operation* so it can never be undefined for the inputs it'll actually see.

---

## Core Concept 5 — Recover, Halt, or Trap

By default, UBSan is *polite*: when it catches UB, it **prints the report and keeps running**. That's called **recovery**, and it's useful because one run can surface many bugs at once instead of stopping at the first. But it has a downside — a long log might bury the report among other output, and the program continues in a technically-broken state.

You control this with three modes:

**1. Default — report and continue (recover).** One run reveals multiple issues:

```bash
clang -fsanitize=undefined -g app.c -o app
./app
# prints a "runtime error:" line for each UB it hits, then keeps going
```

**2. Stop on the first error — `-fno-sanitize-recover`.** The program prints the report and then **exits with a failure status**. This is what you want in **CI and test suites**: any UB fails the build loudly, with a non-zero exit code your test runner notices.

```bash
clang -fsanitize=undefined -fno-sanitize-recover=undefined -g app.c -o app
./app
# prints the first "runtime error:" then aborts with a non-zero exit code
```

(You'll also often see `UBSAN_OPTIONS=halt_on_error=1` as an environment-variable way to get the same "stop immediately" behavior at run time.)

**3. Trap — `-fsanitize-trap`.** Instead of printing a nice message, UBSan executes a single CPU **trap** instruction that aborts the program instantly. There's **no diagnostic text** (so you'll need a debugger to see where it stopped), but it's extremely cheap and adds almost no code size. That makes trap mode the choice for **shipping UBSan checks in production**: an unexpected overflow makes the program die safely rather than silently corrupt data or skip a security check.

```bash
clang -fsanitize=undefined -fsanitize-trap=undefined -g app.c -o app
./app
# no message — the process just aborts at the point of UB
```

A simple way to remember the three:

| Mode | Flag | On UB it... | Use it for |
|---|---|---|---|
| Recover (default) | *(none)* | prints a report, keeps going | local debugging — see many bugs per run |
| Halt | `-fno-sanitize-recover` | prints a report, then exits non-zero | CI / tests — fail the build on any UB |
| Trap | `-fsanitize-trap` | aborts instantly, no message | production — die safely, near-zero overhead |

> **Key insight:** Default UBSan is for *exploring* (many reports per run); `-fno-sanitize-recover` is for *gatekeeping* (one strike and the build fails); `-fsanitize-trap` is for *shipping* (cheap, message-less safety). Pick the mode that matches where the code is running.

---

## Core Concept 6 — UBSan vs Its Sibling Sanitizers

UBSan is one of a family of sanitizers, and a frequent source of confusion is *which tool catches which kind of bug*. They don't overlap much — each watches a different category — so knowing the division of labor tells you which flag to reach for.

| Sanitizer | Flag | Catches | Typical example | Rough overhead |
|---|---|---|---|---|
| **ASan** (Address) | `-fsanitize=address` | **Memory** errors | buffer overflow, use-after-free, heap overflow | ~2× slower, ~3× memory |
| **TSan** (Thread) | `-fsanitize=thread` | **Data races** | two threads touching the same variable unsynchronized | ~5–15× slower |
| **UBSan** (Undefined Behavior) | `-fsanitize=undefined` | **Undefined behavior** | signed overflow, divide-by-zero, bad shift, null deref | usually a few % |

They are **complementary**, not competing: a real program can have all three kinds of bug, and each tool is blind to the others' specialty. UBSan won't catch a use-after-free (that's ASan's job); ASan won't flag a signed overflow that doesn't touch memory (that's UBSan's job).

Because UBSan is so cheap and ASan covers the memory category, **ASan + UBSan together** is the most common pairing — you get memory-safety *and* undefined-behavior coverage from one build:

```bash
clang -fsanitize=address,undefined -g app.c -o app
./app
```

(TSan can't be combined with ASan, so race-hunting is usually a separate build.)

One limitation applies to **all** of them, UBSan included, and you must internalize it early: **a sanitizer only catches problems on lines that actually execute.** UBSan is a *dynamic* (runtime) tool — it watches your program as it runs. If a buggy branch never runs during your test, UBSan never sees the bug. This is exactly why you run sanitizers *together with good tests*: the better your tests exercise real code paths, the more UB UBSan can find. For bugs the compiler can spot just by *reading* the code (no execution needed), you complement sanitizers with [Static Analysis & Linting](../../static-analysis/).

> **Key insight:** Memory = ASan, races = TSan, undefined behavior = UBSan. They're a toolkit, not rivals; `address,undefined` together is the everyday default. And remember the shared blind spot — **dynamic tools only see code that runs**, so your coverage is only as good as your tests.

---

## Real-World Examples

**1. The overflow that only broke in release.** A junior writes a size calculation `int total = count * item_size;`. With small inputs it's fine; in tests it passes. In production, a large `count` overflows `int` (UB), and because the optimizer assumed overflow couldn't happen, the resulting `total` is a small or negative number — and the code allocates far too little memory. The debug build "worked" only because it optimized less aggressively. Running the test suite with `-fsanitize=undefined` would have printed `runtime error: signed integer overflow: ... cannot be represented in type 'int'` on the very first large-input test, naming the exact multiplication. Fix: compute in a wider or unsigned type.

**2. The disappearing null check.** Code reads `int x = *p;` and *then*, a few lines later, checks `if (p != NULL) { ... }`. Because dereferencing null is UB, the compiler reasons "`*p` already ran, so `p` must be non-null," and it *deletes the `if`*. The safety check silently vanishes from the binary. UBSan catches the real culprit at the dereference: `runtime error: load of null pointer of type 'int'`, pointing at the `*p` line — telling you to check *before* you dereference, not after.

**3. The cheap production guard.** A team ships a parser written in C that handles untrusted input. They build the release with `-fsanitize=undefined -fsanitize-trap=undefined` so that any signed overflow or out-of-bounds shift triggered by a malicious input **aborts the process instantly** instead of becoming exploitable UB. The overhead is small enough to accept in production, and "crash safely" beats "behave unpredictably on attacker-controlled input." This is UBSan used not as a debugging aid but as a runtime safety net.

---

## Mental Models

- **UB is a contract you signed without reading.** By writing C, you promised the compiler you'd never overflow a signed int, divide by zero, or deref null. The compiler optimizes assuming you keep the promise. UBSan is the auditor who checks, at runtime, whether you actually did.

- **The compiler is a ruthless lawyer, not a helpful friend.** It won't gently warn "hey, this might overflow." If the standard says an operation is UB, the compiler may exploit that to your detriment — deleting checks, folding branches. UBSan is the only party in the room arguing on *your* behalf.

- **"Works on my machine / in debug" is meaningless for UB.** UB's behavior can change with optimization level, compiler version, or target CPU. A passing debug build doesn't prove the absence of UB — it proves only that *this* build's chosen behavior happened to be acceptable. UBSan tests the operation itself, not one accidental outcome.

- **`runtime error:` is a smoke detector with GPS.** It doesn't just say "something's burning" — it gives the room (file), the seat (line), the cause (the rule), and the spark (the values). Treat every one as a real fire to put out, not an alarm to silence.

- **Sanitizers are flashlights, not X-rays.** They illuminate only the paths your program actually walks. Dark corners (un-run branches) stay hidden. More tests = more illuminated corners.

---

## Common Mistakes

1. **Thinking UB means "produces a random value."** It means the *compiler can do anything*, including deleting code and safety checks at compile time. The danger is the optimizer, not a runtime dice roll. Treat all UB as serious, even when "it seems to work."

2. **Forgetting `-g`.** Without `-g`, UBSan still detects the bug but may not show the file and line — you get the rule and values but not the *where*. Always add `-g` so reports point at the exact source line.

3. **Confusing signed and unsigned overflow.** **Signed** overflow is UB (UBSan flags it). **Unsigned** overflow is *defined* (it wraps cleanly and is *not* a bug). If wrap-around is what you want, use an unsigned type — don't "fix" it by suppressing the warning on a signed type.

4. **Expecting UBSan to find every bug.** It only catches UB on lines that *run*. A bug in an untested branch is invisible to UBSan. It's not a proof of correctness; it's a powerful check on the paths your tests exercise.

5. **Expecting UBSan to catch memory leaks or races.** Wrong tool. Leaks and out-of-bounds heap access are ASan/Valgrind territory; races are TSan's. UBSan is *undefined behavior* — overflow, division, shifts, null deref, alignment. Use the others alongside it.

6. **Silencing the report instead of fixing the operation.** Casting to dodge the warning, or disabling a check, hides the symptom while the UB remains for the optimizer to exploit. Fix the *operation* (wider type, guard the divisor, check the pointer) so it's genuinely defined for its real inputs.

7. **Only running it once.** UBSan's value comes from running it *continuously* — in your test suite and CI with `-fno-sanitize-recover` — so new UB fails the build the day it's introduced, not months later in production.

---

## Test Yourself

1. In your own words, what does "undefined behavior" permit the compiler to do — and at which time (compile or run)?
2. Which of these is UB: (a) `INT_MAX + 1`, (b) an `unsigned int` wrapping past its max, (c) `10 / 0`, (d) `arr[3]` on `int arr[3]`?
3. What two flags do you add to a `clang`/`gcc` command to get UBSan with line numbers in the reports?
4. You see `runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'`. What three pieces of information is UBSan handing you, and what's a reasonable fix?
5. What's the difference between the default UBSan behavior, `-fno-sanitize-recover`, and `-fsanitize-trap`? Match each to a setting (local debugging, CI, production).
6. A use-after-free bug exists in your program. Will UBSan catch it? Which sanitizer should you reach for instead?
7. Your tests pass under UBSan with zero reports. Does that prove your program is free of undefined behavior? Why or why not?

<details>
<summary>Answers</summary>

1. UB permits the compiler to do **anything** — return a constant, delete branches, remove your checks, reorder or crash — and crucially it acts on this at **compile time**, by assuming the UB never happens and optimizing on that assumption. It is not merely a strange value at runtime.
2. **(a)**, **(c)**, and **(d)** are UB. (a) signed overflow, (c) integer divide by zero, (d) reading one past the end of a 3-element array. **(b)** is **not** UB — *unsigned* overflow is defined and wraps cleanly.
3. `-fsanitize=undefined` (turns UBSan on) and `-g` (adds debug info so reports show file and line).
4. The **file:line:col** location, the **rule broken** (signed integer overflow), and the **actual values** (`2147483647 + 1`). Fix: compute in a wider type (`long long`), use `unsigned` if wrap-around is intended, or range-check before adding.
5. **Default** = print a report and keep running (local debugging — see many bugs per run). **`-fno-sanitize-recover`** = print, then exit with a failure status (CI — fail the build on any UB). **`-fsanitize-trap`** = abort instantly with no message, near-zero overhead (production — die safely).
6. **No** — use-after-free is a *memory* bug, outside UBSan's scope. Reach for **AddressSanitizer** (`-fsanitize=address`), or Valgrind.
7. **No.** UBSan is a dynamic tool; it only catches UB on lines that actually **ran** during the tests. UB in an unexecuted branch is invisible. It proves the *exercised paths* were UB-free, not the whole program — better test coverage finds more.

</details>

---

## Cheat Sheet

```
WHAT IS UB?
  Operations the C/C++ spec leaves "undefined."
  The compiler may ASSUME they never happen and optimize accordingly
  → it can DELETE code, branches, and safety checks. (Compile-time license.)

COMMON UB (junior hit-list)
  signed integer overflow      INT_MAX + 1
  integer divide / modulo by 0 a / 0,  a % 0
  null pointer dereference     *p   when p == NULL
  shift >= bit-width           1 << 32   (on 32-bit int)
  array out of bounds          arr[3]    on int arr[3]
  misaligned pointer load      *(int*)(charbuf + 1)
  (unsigned overflow is DEFINED — wraps — NOT a bug)

TURN ON UBSAN
  clang -fsanitize=undefined -g bug.c -o bug     # gcc identical
  ./bug

READ THE REPORT
  file.c:LINE:COL: runtime error: <rule>: <values>
  → go to file:LINE, find the operation, make it legal

MODES
  (default)                 print + keep going   → local debugging
  -fno-sanitize-recover     print + exit nonzero → CI / tests
  -fsanitize-trap           abort, no message    → production (cheap)

FIX FAMILIES
  overflow   → wider type (long long), or unsigned if wrap intended, or range-check
  div by 0   → if (b != 0) ...
  null deref → if (p != NULL) ...   (check BEFORE deref)
  bad shift  → ensure shift count < bit-width

SIBLINGS (complementary, not rivals)
  -fsanitize=address     ASan  → memory bugs (~2x slower)
  -fsanitize=thread      TSan  → data races
  -fsanitize=undefined   UBSan → undefined behavior (few % overhead)
  COMBO: -fsanitize=address,undefined   (everyday default)

LIMITATION
  Dynamic tool → only catches UB on lines that ACTUALLY RUN.
  Pair with good tests; pair with static analysis for read-only checks.
```

---

## Summary

- **Undefined behavior (UB)** is a category of operations the C/C++ spec leaves undefined. The key consequence is at **compile time**: the compiler may assume UB never happens and optimize on that assumption — deleting branches, checks, and code. UB is a *license the compiler holds*, not a runtime accident.
- The junior **UB hit-list** is small and shows up in ordinary code: signed integer overflow, divide/modulo by zero, null-pointer dereference, shifting by ≥ the type's bit-width, out-of-bounds array access, and misaligned pointer reads. (Unsigned overflow is *defined* and not a bug.)
- **UBSan** turns silent UB into a loud, located runtime error. Add `-fsanitize=undefined -g`, run, and read the `runtime error:` line — it names the **file:line**, the **rule**, and the **values**. It's **cheap** (often a few percent), so you can run it everywhere.
- Three **modes** match three settings: default *recover* (report and continue) for local debugging; `-fno-sanitize-recover` (report and fail) for CI; `-fsanitize-trap` (abort cheaply, no message) for production.
- UBSan's **siblings** are complementary: ASan for memory bugs, TSan for races, UBSan for undefined behavior — and `address,undefined` together is the common default. Like all dynamic tools, **UBSan only catches UB on code that runs**, so pair it with strong tests (and with [Static Analysis & Linting](../../static-analysis/) for what can be caught by reading the code).
- The **junior recipe** never changes: add the flag, run, read the `runtime error:` line, jump to the file:line, and fix the *operation* — widen the type, guard the divisor, check the pointer — so it's genuinely defined for the inputs it will actually see.

You now know what UB is, why it's dangerous, and how one flag makes it visible. The [middle.md](middle.md) of this topic goes deeper: selecting individual UBSan checks, suppression files, combining sanitizers in CI, and how UBSan instruments your code under the hood.

---

## Further Reading

- [Clang UBSan documentation](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) — the authoritative reference: every check name, every flag, and how to enable subsets.
- John Regehr, *A Guide to Undefined Behavior in C and C++* — a three-part blog series and the clearest explanation anywhere of *why* UB exists and how compilers exploit it. Essential reading.
- [GCC instrumentation options](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html) — GCC's `-fsanitize=undefined` and the related `-fsanitize-trap` / `-fno-sanitize-recover` flags.
- The [middle.md](middle.md) of this topic — per-check control, suppressions, CI integration, and combining UBSan with ASan in real projects.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/junior.md) — the sibling tool for *memory* bugs; the natural partner to combine with UBSan (`-fsanitize=address,undefined`).
- [02 — ThreadSanitizer](../02-thread-sanitizer-tsan/junior.md) — the sibling tool for *data races*, the third member of the sanitizer family.
- [04 — Leak Detection & Valgrind](../04-memory-leak-detection-valgrind/junior.md) — another runtime tool, focused on leaks and memory errors, complementary to UBSan.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/junior.md) — your *own* runtime checks, the hand-written cousin of a sanitizer's automatic ones.
- [Static Analysis & Linting](../../static-analysis/) — catching bugs by *reading* the code (no execution), complementary to dynamic tools like UBSan.
