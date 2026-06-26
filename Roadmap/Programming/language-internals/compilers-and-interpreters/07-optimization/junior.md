# Optimization — Junior Level

> **Topic:** [Optimization](README.md)
> **Focus:** What does a compiler *do* when you pass `-O2`? It rewrites your code into faster, smaller code that behaves the same. This page is about *what same means* and the handful of classic rewrites you should be able to recognize.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What is a compiler optimization, and what does it promise you?**

When you compile a C, Rust, or Go program with `-O2` (or build a release JAR, or let a JIT warm up), the machine code that runs is **not** a literal translation of what you wrote. The compiler has *rewritten* it. It folded `2 + 3` into `5` before your program ever ran. It noticed you computed `a * b` twice and computed it once. It deleted a branch it proved could never be taken. It turned `x * 2` into a shift. It pulled a calculation out of a loop that didn't depend on the loop. All of this is called **optimization**: transforming the program so it runs **faster** or is **smaller**, while keeping its behavior the same.

That last clause is the whole game. The compiler is allowed to change *anything* it wants — reorder, delete, duplicate, replace one instruction sequence with a totally different one — **as long as you can't tell the difference by observing the program's behavior.** This is called the **"as-if" rule**: the optimized program must behave *as if* it had executed your original source exactly as written. What counts as "observable" is precise (output you print, files you write, volatile hardware accesses) and what counts as *not* observable is surprisingly broad (the exact order of internal arithmetic, whether a temporary variable ever existed, how many instructions ran).

In one sentence: **an optimizer is a program that rewrites your program into a faster one that you can't catch in the act.**

> 🎓 **Why this matters for a junior:** Two things. First, the optimizer is the reason "obviously slow" code is sometimes fast and "obviously fast" code is sometimes slow — the compiler may have already fixed (or ruined) your micro-optimization. Stop hand-optimizing things `-O2` already does. Second, when you write code with *undefined behavior* (signed overflow, reading uninitialized memory, dereferencing a pointer that might be null), the optimizer is *allowed to assume it never happens* and can delete your safety checks. Optimization is where "harmless" bugs turn into deleted code. Knowing the basics keeps you out of both traps.

This page covers: the as-if rule and what "observable" means, the classic local rewrites you'll see in disassembly (constant folding, strength reduction, dead code elimination, common subexpression elimination), the most important enabling optimization (inlining), the basics of loop optimization, and the `-O0`/`-O1`/`-O2`/`-O3` levels. Deeper machinery — dataflow analysis, SSA, the phase-ordering problem, LTO and PGO, the undefined-behavior controversy — lives in the higher tiers.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to compile and run a program in at least one compiled language (C, C++, Rust, or Go).
- **Required:** What a variable, a function, a loop, and an `if` branch are.
- **Required:** A rough sense that source code becomes machine instructions the CPU executes.
- **Helpful but not required:** Having looked at assembly once (e.g. on godbolt.org). You do not need to *read* assembly fluently — recognizing patterns is enough.
- **Helpful but not required:** The idea that some operations (multiply, divide) are slower than others (add, shift).

You do **not** need to know:

- What an *intermediate representation* (IR) or *SSA form* is — that's `middle.md`.
- Dataflow analysis, lattices, or fixpoints — that's `middle.md`.
- How `-flto` or profile-guided optimization works — that's `senior.md` and `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Optimization** | Transforming a program so it runs faster or is smaller while preserving its observable behavior. |
| **As-if rule** | The compiler may transform the program however it likes, as long as it behaves *as if* the original source ran unchanged. The legal license for all optimization. |
| **Observable behavior** | The things the standard says a correct program must produce: I/O, accesses to `volatile` objects, program termination/output. The optimizer must preserve these exactly. |
| **Optimization level** | A flag (`-O0`, `-O1`, `-O2`, `-O3`, `-Os`, `-Oz`) that selects how aggressively the compiler optimizes. |
| **Pass** | One transformation the compiler runs over the program (e.g. "the constant-folding pass"). Compilers run dozens in sequence. |
| **Constant folding** | Computing constant expressions at compile time: `2 + 3` becomes `5`. |
| **Constant propagation** | Replacing a variable with its known constant value throughout the code. |
| **Strength reduction** | Replacing an expensive operation with a cheaper one: `x * 2` → `x << 1`. |
| **Dead code elimination (DCE)** | Removing code whose result is never used or that can never run. |
| **Common subexpression elimination (CSE)** | Computing a repeated expression once and reusing the result. |
| **Inlining** | Replacing a function *call* with a copy of the function's *body*. The most important enabling optimization. |
| **Loop-invariant code motion (LICM)** | Moving a computation that doesn't change across loop iterations *out* of the loop. |
| **Loop unrolling** | Duplicating a loop body so each iteration does more work and the loop runs fewer times. |
| **Peephole optimization** | Local cleanup of a few adjacent instructions at a time. |
| **Undefined behavior (UB)** | A program construct the language standard places no requirements on. The optimizer is allowed to assume UB never occurs. |

---

## Core Concepts

### 1. The As-If Rule: Optimize Anything, Change Nothing Visible

The compiler's freedom and its constraint are the same sentence: **rewrite the program any way you want, as long as its observable behavior is unchanged.** This is the "as-if" rule (it's literally spelled that way in the C and C++ standards).

What is **observable**, and must be preserved exactly:

- Data written to files, the console, the network — your `printf`, your `write()`.
- Reads and writes to `volatile` objects (think hardware registers, memory-mapped I/O).
- Whether the program terminates, and with what exit code.

What is **not observable**, and the compiler may freely change:

- The order in which internal arithmetic happens (as long as the result is the same).
- Whether a local variable physically exists in memory, a register, or nowhere at all.
- How many machine instructions run, in what order, on which registers.
- Whether a function call happened at all (it might get inlined or deleted).

So when you write:

```c
int x = 2 + 3;
int y = x * 4;
printf("%d\n", y);
```

The compiler is allowed to emit code equivalent to `printf("%d\n", 20);` — it never computes `2+3`, never multiplies, never stores `x` or `y` anywhere. You cannot tell, because the *only* observable thing (the printed `20`) is identical. That's the as-if rule in action.

### 2. The Classic Local Optimizations

These are the rewrites you'll recognize first in disassembly. They're "local" because they look at small windows of code.

**Constant folding.** Compute constant expressions at compile time. `60 * 60 * 24` becomes `86400` in the binary — the multiplications never run.

**Constant propagation.** If `x = 5` and `x` isn't changed afterward, replace later uses of `x` with `5`. This often *enables* more folding: `int x = 5; int y = x + 3;` → `y = 8`.

**Copy propagation.** If `b = a` and neither changes, replace later uses of `b` with `a`, so the copy may become dead and get deleted.

**Algebraic simplification.** Apply math identities: `x + 0` → `x`, `x * 1` → `x`, `x * 0` → `0`, `x - x` → `0`, `!!b` → `b`.

**Strength reduction.** Replace expensive ops with cheap ones. `x * 2` → `x << 1`. `x * 8` → `x << 3`. `x / 4` (for unsigned) → `x >> 2`. Even `x * 5` becomes `(x << 2) + x` — a shift and an add, faster than a general multiply on many CPUs. (The compiler does this; *you* should usually just write `x * 5` and let it.)

**Common subexpression elimination (CSE).** If you compute the same thing twice and nothing in between changed the inputs, compute it once:

```c
int p = (a + b) * c;
int q = (a + b) * d;   // (a + b) is computed twice in source...
```

becomes, internally, `t = a + b; p = t * c; q = t * d;` — one addition.

**Dead code elimination (DCE).** Remove code whose results are never used, and code that can never execute. `if (false) { ... }` — the body is deleted. A variable you compute but never read — the computation is deleted. A **dead store** (writing a value that's overwritten before any read) is removed too.

### 3. Inlining: The One That Unlocks Everything Else

**Inlining** replaces a function *call* with a copy of the function's *body*. Instead of jumping to `square()`, the compiler pastes `x * x` right where the call was.

The direct win is avoiding call overhead (pushing arguments, the jump, the return). But the *real* value is what inlining **enables**: once the body is pasted in, all the other optimizations can see across the old function boundary. Constants flow in, dead branches collapse, common subexpressions merge.

```c
int square(int x) { return x * x; }
int f() { return square(5); }
```

After inlining, `f()` is `return 5 * 5;`, which constant-folds to `return 25;`. The function call *and* the multiplication both vanish. This is why inlining is called the **most important enabling optimization**: it's the door that lets every other pass walk through.

The cost: inlining a function everywhere it's called **duplicates** its code, which makes the binary bigger and can hurt the instruction cache. Compilers use heuristics (small functions, hot call sites) to decide. You'll meet the trade-offs in detail in the higher tiers.

### 4. Loop Optimizations (The Junior Slice)

Loops run their body many times, so optimizing inside a loop pays off proportionally. Two you should recognize:

**Loop-invariant code motion (LICM).** If a computation inside a loop produces the same value every iteration, hoist it *out*:

```c
for (int i = 0; i < n; i++)
    a[i] = b[i] + c * d;   // c*d is the same every iteration
```

becomes:

```c
int t = c * d;
for (int i = 0; i < n; i++)
    a[i] = b[i] + t;       // multiply once, not n times
```

**Loop unrolling.** Do several iterations' worth of work per loop pass to reduce loop overhead (the counter increment and the branch):

```c
for (int i = 0; i < n; i++) sum += a[i];
```

might become a version that adds four elements per iteration. Fewer branches, more instruction-level parallelism — but a bigger body.

### 5. Optimization Levels: What `-O2` Actually Means

You select how hard the compiler tries with a flag:

| Flag | Intent |
|------|--------|
| `-O0` | **No optimization.** Fast compiles, easy debugging — variables stay where you put them, line numbers map cleanly. The default while developing. |
| `-O1` | Basic optimizations, modest cost. |
| `-O2` | **The standard release level.** Almost all optimizations that don't risk large code-size growth. What most production builds use. |
| `-O3` | `-O2` plus aggressive ones (more inlining, vectorization). Sometimes faster, **sometimes slower** because of code bloat. Measure, don't assume. |
| `-Os` | Optimize for **size** — like `-O2` but avoid transformations that grow the binary. |
| `-Oz` | Optimize for size even harder (Clang). |

The key junior takeaway: **`-O0` for debugging, `-O2` for shipping.** `-O3` is not automatically better — it can bloat code and thrash the instruction cache, so it must be measured, not assumed. (You'll see why in `senior.md`.)

---

## Real-World Analogies

**The editor who tightens your prose.** You hand in an essay that says "in the event that it is raining, then in that case bring an umbrella." A good editor returns "if it rains, bring an umbrella." Same *meaning* — the reader can't tell information was lost — but fewer words. The optimizer is that editor: it preserves what the program *means to an observer* while cutting everything redundant.

**Pre-computing a recipe.** A recipe says "add 60 × 60 × 24 grams of flour." Before you start cooking you compute that once: 86,400 grams. You don't re-multiply at every step. That's constant folding.

**Prepping ingredients before you start.** If every pancake needs the same melted butter, you melt all the butter *once* before the griddle, not per pancake. That's loop-invariant code motion.

**Doubling by sliding, not multiplying.** Ask a child "what's 7 × 2?" and they might add 7 + 7. Ask "what's 7 doubled?" and the answer is instant. Strength reduction is the compiler choosing the cheap mental shortcut (a bit shift) over the expensive general operation (a multiply).

**Copy-pasting a short helper instead of phoning a friend.** If you need a one-line calculation done, you do it in your head rather than calling someone, waiting for them to pick up, telling them the numbers, and waiting for the answer. Inlining is the compiler pasting a small function's work inline instead of paying for the "phone call."

---

## Mental Models

**Model 1: The optimizer is a faithful liar.** It will tell the CPU a completely different story than you wrote — different instructions, different order, missing pieces — but the *ending* (the observable output) is word-for-word identical. Trust it about the ending; never assume anything about the middle.

**Model 2: Observable behavior is the contract; everything else is negotiable.** Picture a glass box around your program with only a few holes: I/O, volatile accesses, termination. The compiler can rearrange every gear inside the box as long as what comes out of the holes is unchanged. Your job as a junior is to know which holes exist (so you don't accidentally rely on the gears).

**Model 3: Optimizations cascade.** Constant propagation feeds constant folding, which makes a branch dead, which lets DCE delete a whole block, which makes a function tiny enough to inline, which exposes *more* constants. One enabled optimization is a domino. This is why inlining matters so much — it knocks over the first domino across a function boundary.

**Model 4: `-O0` shows your code; `-O2` shows the compiler's idea of your code.** When you debug at `-O2` and a variable reads "optimized out," that's not a bug — the variable genuinely doesn't exist in the optimized program. Debug at `-O0`, ship at `-O2`.

---

## Code Examples

### Constant folding and propagation (C, via godbolt)

```c
int seconds_per_day(void) {
    int hours = 24;
    int minutes = hours * 60;
    int seconds = minutes * 60;
    return seconds;
}
```

At `-O2`, the entire function compiles to the equivalent of:

```asm
seconds_per_day:
    mov eax, 86400      ; the whole computation folded to one constant
    ret
```

No multiplications, no `hours`/`minutes`/`seconds` variables. The compiler propagated and folded everything at compile time.

### Strength reduction (C)

```c
unsigned times_eight(unsigned x) { return x * 8; }
```

At `-O2`:

```asm
times_eight:
    lea eax, [0 + rdi*8]   ; or: shl edi, 3 — a shift, not a multiply
    ret
```

The multiply by 8 became a shift-left-by-3 (or a `lea`). You wrote the clear thing (`x * 8`); the compiler chose the cheap thing.

### Common subexpression elimination (C)

```c
int f(int a, int b, int c, int d) {
    int p = (a + b) * c;
    int q = (a + b) * d;
    return p + q;
}
```

At `-O2`, the compiler computes `a + b` **once** into a register and reuses it for both products. The source has two `(a + b)`; the machine code has one addition.

### Dead code elimination (C)

```c
int g(int x) {
    int unused = x * x * x;   // never read
    if (1 == 2) {             // can never be true
        return -1;            // unreachable — deleted
    }
    return x + 1;
}
```

At `-O2`, `g` is just `return x + 1;`. The cube is a dead store and is removed; the `if` body is dead code and is removed.

### Inlining unlocks folding (C)

```c
static int square(int x) { return x * x; }
int demo(void) { return square(5) + 1; }
```

At `-O2`, `demo` returns `26` — `square(5)` is inlined to `5 * 5`, folded to `25`, plus `1` is `26`. The call and the multiply both disappear.

### Loop-invariant code motion (C)

```c
void scale(int *a, int n, int c, int d) {
    for (int i = 0; i < n; i++)
        a[i] = a[i] + c * d;   // c*d does not change across the loop
}
```

At `-O2`, `c * d` is computed once before the loop and the loop body just adds the precomputed value. (At `-O3` the loop may also be *vectorized* to process several elements per instruction — more on that in higher tiers.)

> **How to see all of this yourself:** paste any of these into [godbolt.org](https://godbolt.org), pick a compiler (e.g. `x86-64 gcc` or `clang`), and toggle between `-O0` and `-O2`. Watching the assembly shrink and rearrange is the single best way to build intuition for what optimization does.

---

## Pros & Cons

**Pros**

- **Free speed.** Flipping `-O0` to `-O2` often makes programs several times faster with zero source changes.
- **Cleaner source.** You can write the *clear* version (`x * 5`, a helper function, a readable loop) and let the compiler produce the *fast* version (shifts, inlined bodies, hoisted loads). Readability and performance stop fighting.
- **Portability.** The compiler picks the cheap instruction sequence *for the target CPU*. The same `x * 8` becomes the right thing on x86, ARM, and RISC-V.

**Cons**

- **Harder debugging.** At `-O2`, variables vanish, line numbers jump around, and breakpoints land in surprising places. You usually debug at `-O0`.
- **It can expose latent bugs.** If your code has undefined behavior, the optimizer may "exploit" it and produce code that crashes or misbehaves — code that *seemed* fine at `-O0`. (This is the UB controversy; it's a major topic in the higher tiers.)
- **`-O3` is not free.** More inlining and unrolling means a bigger binary, which can overflow the instruction cache and run *slower*. Aggressive optimization must be measured.
- **Slower compiles.** Higher levels and LTO take longer to build.

---

## Use Cases

- **Shipping a release build.** Compile with `-O2` (the default release level for most projects).
- **Debugging a crash.** Rebuild with `-O0 -g` so the debugger shows your variables and lines faithfully.
- **A hot inner loop is slow.** Before hand-optimizing, check what the compiler already did at `-O2`/`-O3` on godbolt — often it's already done your trick, and your job is to feed it cleaner code (e.g. remove an alias the compiler couldn't see past).
- **A small embedded target.** Use `-Os`/`-Oz` to fit the binary in limited flash, accepting slightly slower code.
- **A surprising performance difference between two builds.** Check the optimization level first — a `-O0` accidental build is a very common cause of "why is this 10× slower?"

---

## Coding Patterns

- **Write for clarity; trust the compiler for speed.** Don't replace `x * 2` with `x << 1` in source "for speed" — the compiler already does it, and the shift is harder to read and can be *wrong* for signed division. Write the obvious thing.
- **Keep hot helpers small and in the same translation unit.** Small functions get inlined; a small `static` helper in the same `.c` file is the easiest thing for the compiler to inline. (Cross-file inlining needs LTO — a higher-tier topic.)
- **Make constants visible.** Use `const`/`constexpr`/`final` so the compiler *knows* a value won't change and can propagate and fold it. Hiding a constant behind a non-const global blocks the optimization.
- **Don't compute the same thing in a loop.** Even though LICM exists, it can only hoist what it can *prove* is invariant. If a function call or a pointer write might change things, the compiler conservatively keeps the work inside. Hoist obvious invariants yourself when in doubt.
- **Build release with `-O2`, debug with `-O0 -g`.** Two build configurations, used deliberately.

---

## Best Practices

- **Always benchmark optimized builds.** Never measure performance at `-O0` — the numbers are meaningless. And when comparing `-O2` vs `-O3`, *measure the actual program*, don't assume the higher number wins.
- **Look at the assembly when it matters.** For a genuinely hot path, godbolt is faster than guessing. You'll learn what the compiler does and doesn't do.
- **Don't fight the optimizer with micro-tricks.** Hand-rolled bit twiddling, manual loop unrolling, and clever arithmetic are usually things `-O2` already does — and your version may block a *better* optimization the compiler would have found.
- **Fix undefined behavior; don't rely on it.** Code that works at `-O0` but breaks at `-O2` almost always has UB. Turn on sanitizers (`-fsanitize=undefined,address`) and warnings (`-Wall -Wextra`). The optimizer is allowed to assume UB never happens — so don't make it happen.
- **Keep a separate debug build.** When a release-only bug appears, reproduce it at `-O1` first (often still buggy, but easier to step through) before dropping to `-O0`.

---

## Edge Cases & Pitfalls

- **"It works at `-O0` but breaks at `-O2`."** The classic. Nearly always undefined behavior your code got away with at `-O0`. The fix is to find and remove the UB (sanitizers help), *not* to ship at `-O0`. Optimization didn't cause the bug; it revealed it.
- **A deleted null check.** If you dereference a pointer and *then* check it for null, the compiler may reason "you already dereferenced it, so it can't be null" and **delete your null check** — because dereferencing null is UB, so the check is "dead." Check *before* you dereference. (This is a famous real-world security bug class; the senior tier covers it.)
- **`-O3` ran slower than `-O2`.** Not a paradox. `-O3`'s extra inlining and unrolling bloated the code, the instruction cache started missing, and the program slowed down. Measure both.
- **Floating-point math "changed."** `-ffast-math` lets the compiler reorder and simplify floating-point arithmetic in ways that change results (because FP isn't truly associative). It can break code that depends on exact FP behavior. Don't enable it blindly.
- **A `volatile` variable wasn't optimized — on purpose.** `volatile` tells the compiler "this access is observable; don't remove or reorder it." It exists precisely to *opt out* of optimization for hardware registers and memory-mapped I/O. It is **not** a threading tool (a common confusion).
- **A debug "this should print" disappeared.** A variable you computed for inspection but never *use* may be optimized away, and a debugger will show it as "optimized out." That's correct behavior, not a compiler bug. Mark it `volatile` or actually use it if you need it to survive.
- **Empty loop deleted.** An empty `for` loop you wrote as a delay can be deleted entirely (it has no observable effect). Busy-wait delays must use `volatile` or proper timing primitives.

---

## Summary

A compiler optimization rewrites your program into a faster or smaller one while preserving its **observable behavior** — that's the **as-if rule**, the license under which everything else operates. What's observable (I/O, `volatile`, termination) is preserved exactly; everything else (instruction order, temporaries, even whether a function call happened) is fair game.

The classic local rewrites — **constant folding/propagation**, **copy propagation**, **algebraic simplification**, **strength reduction**, **common subexpression elimination**, and **dead code elimination** — are the ones you'll first recognize in assembly. **Inlining** is the most important because it's an *enabling* optimization: pasting a function body in lets every other pass see across the boundary, and optimizations cascade. **Loop-invariant code motion** and **unrolling** are the loop-level rewrites to know first.

Practically: ship with `-O2`, debug with `-O0 -g`, never assume `-O3` is faster (measure it), and remember that the optimizer is allowed to *assume your code has no undefined behavior* — which is why "works at `-O0`, breaks at `-O2`" almost always means a real bug in your code, not the compiler's. Write clear source; let the optimizer make it fast.

The next tier (`middle.md`) opens the hood: the intermediate representation, **dataflow analysis** (the framework that proves these transformations are safe), SSA form, and why the *order* you run passes in changes the result.
