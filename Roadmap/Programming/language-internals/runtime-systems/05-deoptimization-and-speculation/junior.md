# Deoptimization & Speculation — Junior Level

> **Topic:** [Deoptimization & Speculation](README.md)
> **Focus:** Why a JIT compiler *guesses* about your code, what happens when the guess is wrong, and why a wrong guess never changes the answer your program computes — only its speed.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

> Focus: **Why does a JIT compiler bet on assumptions it cannot prove, and what is "deoptimization"?**

When you run a program in a modern language runtime — the JVM (HotSpot), JavaScript (V8 in Chrome and Node.js, SpiderMonkey in Firefox), or .NET — your code does **not** start out as fast machine code. It starts out being *interpreted* or run through a cheap baseline compiler: slow, but quick to get going. Then, while your program runs, the runtime watches which functions are "hot" (called over and over) and hands those to an **optimizing JIT compiler** that produces genuinely fast native code.

Here is the catch that this whole topic is about. To produce *fast* machine code, the optimizing compiler needs to know things about your program — for example, "this variable is always a number," or "this method is never overridden," or "this array only ever holds integers." But the compiler is running *while your program runs*, and it often **cannot prove** these things will always be true. The future hasn't happened yet. So instead of giving up, it does something bold: it **assumes** the thing is true, compiles fast code based on that assumption, and inserts a cheap little check — a **guard** — that verifies the assumption still holds each time the code runs.

If the guard passes: great, the fast path runs. If the guard ever **fails** — say someone finally calls your function with a string instead of a number — the runtime cannot keep running the optimized code, because that code was built on an assumption that's now false. So it performs a **deoptimization** ("deopt"): it throws away the optimized native version mid-execution, rebuilds the equivalent slower state (as if the interpreter had been running all along), and continues from there. Your program keeps computing the **exact same answer** — it just runs slower from that point.

In one sentence: **speculation is the JIT making an educated bet so it can emit fast code; deoptimization is the safety net that catches the program and lands it gently in slow-but-correct mode when the bet loses.**

> 🎓 **Why this matters for a junior:** You will write JavaScript or Java that is mysteriously slow even though it "looks fine." Very often the cause is that you keep *breaking the JIT's guesses* — passing mixed types, changing object shapes, hitting code paths the compiler pruned. Understanding that the engine is *betting on you being consistent* is the key to writing code that stays fast.

This page covers: what "hot code" and tiered compilation are, what an assumption/guard/bet looks like in plain terms, what deoptimization actually does to a running program, why it never changes results, and the most common everyday patterns (in JS especially) that trigger deopts.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can write and run a simple program in at least one of: JavaScript (Node.js), Java, C#, or Python.
- **Required:** You understand what a *function* is and what it means to *call* one repeatedly in a loop.
- **Required:** A vague sense that source code eventually becomes machine instructions the CPU runs.
- **Helpful but not required:** You've heard the words "interpreter," "compiler," and "JIT" before.
- **Helpful but not required:** You know what a variable's *type* is (number vs string vs object).

You do **not** need to know:

- How a register allocator or instruction scheduler works (that's `senior.md` / `professional.md`).
- The exact metadata format the runtime uses to reconstruct frames (that's `middle.md` and beyond).
- Anything about escape analysis, scalar replacement, or class-hierarchy analysis yet.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Interpreter** | The component that executes your program one bytecode/instruction at a time. Slow per operation, but starts instantly with no compile step. |
| **JIT (Just-In-Time) compiler** | A compiler that turns hot parts of your program into native machine code *while the program is running*. |
| **Baseline / Tier 1 compiler** | A fast-but-dumb compiler (e.g. V8's *Sparkplug*, HotSpot's *C1*) that compiles quickly without heavy optimization. |
| **Optimizing / Tier 2+ compiler** | The smart, slow compiler (e.g. V8's *TurboFan*, HotSpot's *C2*) that produces the fastest code — by *speculating*. |
| **Hot code** | A function or loop that runs often enough that it's worth compiling and optimizing. |
| **Speculation** | The JIT *assuming* something it cannot prove (a type, a call target, a branch never taken) so it can emit faster code. |
| **Assumption** | The specific thing the JIT is betting on (e.g. "`x` is always a 32-bit int"). |
| **Guard** | A cheap runtime check inserted by the JIT that verifies an assumption still holds before trusting the fast path. |
| **Deoptimization (deopt)** | Abandoning the optimized native code mid-run and falling back to slower, more general code (interpreter or baseline). |
| **Bailout** | V8's word for a deopt: "bailing out" of optimized code back to a less-optimized tier. |
| **Uncommon trap** | HotSpot's word for the spot in optimized code where a failed guard jumps out to deoptimize. |
| **Monomorphic** | A call site or operation that has only ever seen *one* type/shape. The JIT loves this — it's the easiest thing to speculate on. |
| **Polymorphic / Megamorphic** | A site that has seen several / many different types. Harder or impossible to speculate well on. |
| **Hidden class / Shape / Map** | The engine's internal description of an object's structure (which fields it has, in what order). JS engines key speculation off this. |
| **SMI (Small Integer)** | V8's tagged representation for small integers. A separate, faster category from floating-point doubles. |
| **Deopt loop / deopt storm** | A performance bug where code is optimized, deopted, re-optimized, deopted… forever, never settling. |

---

## Core Concepts

### 1. Your code does not start fast — it *becomes* fast

When you run `node script.js` or launch a Java program, the runtime does **not** stop to compile everything into optimal machine code first. That would make startup painfully slow. Instead it uses **tiers**:

```text
Tier 0:  Interpreter         — runs immediately, slow per op
Tier 1:  Baseline compiler   — quick compile, modest speedup        (V8 Sparkplug, HotSpot C1)
Tier 2+: Optimizing compiler — slow compile, biggest speedup        (V8 TurboFan, HotSpot C2)
```

The runtime *profiles* your program as it runs — counting how many times each function is called, what types flow through each operation — and **promotes** the hottest code up the tiers. Optimization happens *lazily*, only where it pays off.

### 2. To go fast, the compiler must assume things it can't prove

Consider this tiny JavaScript function:

```js
function add(a, b) {
  return a + b;
}
```

In JavaScript, `+` is wildly general. It can add two numbers, concatenate two strings, coerce an object to a string, add a boolean to a number, and so on. The *fully correct* machine code for `a + b` has to check the types of `a` and `b` and dispatch to one of many behaviors. That's slow.

But suppose, while profiling, the engine notices that **every single time** `add` has been called, both `a` and `b` were small integers. It now *bets* that this will keep being true and emits machine code that does essentially one CPU `ADD` instruction — as fast as C. That bet is **speculation**.

### 3. The bet always comes with a guard

The engine is not reckless. Alongside the fast `ADD`, it inserts a **guard**: a cheap check at the top, like *"if `a` is not a small integer, or `b` is not a small integer, abandon ship."* In pseudocode the optimized `add` looks like:

```text
optimized_add(a, b):
    if not isSmallInt(a): DEOPT      # guard
    if not isSmallInt(b): DEOPT      # guard
    return a + b                     # single fast integer add
```

The guards are cheap — a tag check and a branch — far cheaper than the general "figure out what `+` means" logic. As long as the guards pass, you get near-C speed.

### 4. Deoptimization: what happens when a guard fails

Now someone calls `add("hello", "world")`. The guard `isSmallInt(a)` fails. The optimized code **cannot** continue — it has no string-concatenation logic; it was compiled assuming integers. So the engine performs a **deoptimization**:

1. It **stops** running the optimized native code at the guard.
2. It **reconstructs** the state the program would have been in if the slow interpreter had been running this function all along — the values of `a`, `b`, any locals, where in the function we are.
3. It **resumes** execution in the interpreter (or baseline tier) from that point.
4. The interpreter handles `"hello" + "world"` correctly, producing `"helloworld"`.

The crucial point: **the program produced the correct answer.** Deopt is not an error and not a crash. It's a controlled fallback that trades speed for the generality the situation now requires.

### 5. Semantics are *always* preserved — this is the law

This is the single most important idea on this page. **Speculation and deoptimization never change what your program computes.** They only change *how fast* it computes it. The guard + deopt machinery exists precisely to guarantee that the fast path is only ever taken when it would produce the identical result to the slow path. If there is any chance the fast path would be wrong, the guard fails and you fall back to code that is guaranteed correct.

So you never debug a "deopt produced the wrong number" bug — it can't happen. You only ever debug a "my code is slow because it keeps deopting" *performance* problem. Keep that distinction sharp.

### 6. The expensive failure mode: deopt loops

A single deopt is cheap and harmless. The problem is when it happens **over and over**. Imagine your `add` function gets optimized for integers, then deopts when a string shows up, then gets re-optimized, then a string shows up again, deopts again… The engine spends all its time compiling and throwing away code instead of running it. This is a **deopt loop** or **deopt storm**, and it can make code *slower than if it had never been optimized at all*. Most of this topic, at higher tiers, is about recognizing and preventing this.

---

## Real-World Analogies

**The express checkout lane.** A grocery store opens an "express lane: 10 items or fewer." The cashier can move fast *because they assume* every customer has ≤10 items — no need to weigh down the lane with logic for huge carts. The "10 items or fewer" sign is the **guard**. If someone rolls up with 40 items (guard fails), the cashier redirects them to a regular lane (deopt). The express lane was never *wrong* — it just only works under its assumption, and there's a fallback for everyone else.

**The commuter who always takes the highway.** You learn that your commute is fastest via the highway and you stop even checking the side streets — you *speculate* the highway is clear. But you glance at the traffic app (the guard) before merging. If it's jammed, you reroute (deopt). You arrive at work either way; speculation just usually saves time.

**A recipe assuming fresh ingredients.** A fast recipe says "throw the eggs straight in." It assumes the eggs are fresh. A careful cook cracks each egg into a separate bowl first (the guard) to check. A bad egg means stopping and getting another (deopt). Either way the dish ends up correct — the check just protects the fast assumption.

**A pre-printed form.** A clerk uses a pre-filled form because *most* applicants are local residents. That's faster than asking every question. But there's a checkbox: "non-resident?" If checked (guard fails), they switch to the long form (deopt). The pre-filled form is a speculation that the common case holds.

---

## Mental Models

### Model 1: "Bet, then verify"

Every speculative optimization is a **bet + a guard**:

```text
BET:    "I think a and b are always integers."
GUARD:  "Check that they are. Cheap."
FAST:   "If so, run the one-instruction version."
DEOPT:  "If not, fall back to the fully general version. Correct, just slow."
```

If you remember nothing else, remember *bet → guard → (fast | deopt)*.

### Model 2: The trapdoor under the fast floor

Picture the optimized code as a polished fast floor. Scattered across it are **trapdoors** (HotSpot literally calls these *uncommon traps*). Each trapdoor is a guard. As long as your assumptions hold, you sprint across the solid floor. The moment a guard fails, a trapdoor opens and you drop down into the basement — the interpreter — which is slower but where *everything* works. You don't fall and get hurt; you land safely and keep walking. Re-climbing to the fast floor (re-optimization) takes a moment of compiler time.

### Model 3: Speculation is a *consistency contract* with you

The engine is implicitly saying: *"If you keep feeding me consistent shapes and types, I'll keep running your code blazingly fast. The moment you get weird and inconsistent, I have to slow down to stay correct."* Writing JIT-friendly code is mostly about **being predictable**: same types, same object shapes, same call targets. The engine rewards consistency and penalizes surprise.

---

## Code Examples

The examples below are deliberately small. The point is to *see* speculation and deopt with your own eyes by turning on the engine's tracing.

### Example 1: Watch V8 deoptimize a JavaScript function

```js
// add.js
function add(a, b) {
  return a + b;
}

// Warm it up with integers so V8 optimizes it for SMIs.
let total = 0;
for (let i = 0; i < 1_000_000; i++) {
  total += add(i, i + 1);   // always integers -> monomorphic, optimized
}

// Now break the assumption ONCE.
console.log(add("hello", "world"));   // string -> guard fails -> deopt

console.log(total);
```

Run it with V8's tracing flags (works in Node.js):

```bash
node --trace-opt --trace-deopt add.js
```

You'll see lines like:

```text
[marking 0x... <JSFunction add> for optimized recompilation, reason: hot ...]
[completed optimizing 0x... <JSFunction add (...)>]
...
[deoptimizing (DEOPT eager): begin 0x... <JSFunction add> ...]
  ;;; deoptimize at <add.js:3:12>, not a Smi
```

That `not a Smi` is the engine telling you: *the guard that checked "is this a small integer" failed.* The fast version got abandoned and execution fell back. The program still printed `helloworld` and the correct `total`.

### Example 2: A self-inflicted deopt loop (anti-pattern)

```js
// loop-deopt.js
function classify(x) {
  return x + 1;          // engine will specialize this for the type it sees
}

for (let i = 0; i < 1_000_000; i++) {
  // Alternate between number and string every iteration.
  const arg = (i % 2 === 0) ? i : String(i);
  classify(arg);          // type flips constantly -> repeated deopts
}
```

Run with `node --trace-deopt loop-deopt.js` and you'll see deopt messages firing repeatedly. The function can never *settle* on a single specialization because you keep changing the input type. This is the deopt-storm shape in miniature — and it's exactly what to avoid.

The fix is trivial: **don't mix types into the same hot function.** Keep numbers with numbers and strings with strings.

### Example 3: The same idea on the JVM (HotSpot)

Java is statically typed, so you won't get *type* deopts the way JS does. But HotSpot speculates on *which method a virtual call lands on* (class-hierarchy analysis) and on *which branches are taken*. You can watch compilation and deopt activity:

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintCompilation \
     -XX:+TraceDeoptimization \
     YourProgram
```

In `PrintCompilation` output, a method tagged with `%` is an *on-stack-replacement* (a hot loop compiled mid-run), and a method later marked `made not entrant` or `made zombie` is one whose optimized code was invalidated — often because the runtime had to deoptimize after an assumption (like "this method is never overridden") was broken when a new class loaded. You don't need to read every line as a junior; the goal is to *see that it happens*.

### Example 4: Proving semantics are preserved

```js
// correctness.js
function half(x) {
  return x / 2;
}

// Optimize for integers.
for (let i = 0; i < 1_000_000; i++) half(i);

// Now feed it values that break the int assumption — fractions, big numbers.
console.log(half(7));        // 3.5  -> correct
console.log(half(2 ** 40));  // 549755813888 -> correct, even after deopt
console.log(half(NaN));      // NaN -> correct
```

No matter how many guards fail and how many deopts occur, every printed value is mathematically correct. Speed varies; **answers do not.**

---

## Pros & Cons

### Pros of speculative optimization (with deopt as the safety net)

- **Near-native speed for dynamic languages.** This is *the* technique that makes JavaScript and the JVM fast. Without speculation, `a + b` in JS would forever pay the full "what does `+` mean here?" tax.
- **You only pay for generality you actually use.** If your code is consistent, you get the fast path. The slow, general code exists but rarely runs.
- **Always correct.** The guard guarantees the fast path is only taken when it's equivalent to the slow path. You never trade correctness for speed.
- **Adaptive.** The runtime optimizes based on *what your program actually does*, not what it might theoretically do — sometimes beating an ahead-of-time compiler.

### Cons / costs

- **Deopt isn't free.** Reconstructing interpreter state and falling back costs time. Rare deopts are negligible; frequent ones hurt.
- **Deopt loops are a real performance pathology.** Code that keeps getting optimized and de-optimized can run *slower* than un-optimized code.
- **Hard to reason about without tools.** You can't tell from the source whether your function got deopted — you have to turn on tracing.
- **Surprising sensitivity.** Tiny, innocent-looking changes (mixing one float into an int array, adding a property to one object) can flip a hot path from fast to slow.

---

## Use Cases

You don't "use deoptimization" directly — the runtime does it for you. But understanding it is essential when you:

- **Profile slow JS/Java/C# code** and need to know *why* a function the profiler flags as hot is slow despite looking simple.
- **Write hot inner loops** (game loops, parsers, numeric kernels, request handlers) where staying on the fast path matters.
- **Read engine traces** (`--trace-deopt`, `-XX:+PrintCompilation`) during performance investigation.
- **Decide how to structure data** — e.g. keeping arrays homogeneous, keeping object shapes stable — to stay JIT-friendly.

---

## Coding Patterns

### Pattern 1: Keep types monomorphic in hot functions

```js
// ❌ Mixed types feed the same function -> polymorphic -> deopts.
function size(x) { return x.length; }
size([1, 2, 3]);     // array
size("abc");          // string
size({ length: 9 }); // object

// ✅ If a function is hot, feed it ONE shape/type consistently,
//    or split into specialized functions.
function arrSize(a) { return a.length; }   // only ever arrays
function strSize(s) { return s.length; }   // only ever strings
```

### Pattern 2: Initialize objects with all fields up front (stable shape)

```js
// ❌ Adding fields later mutates the hidden class -> shape churn -> deopts.
const p = {};
p.x = 1;
p.y = 2;       // each assignment can transition the hidden class

// ✅ Declare the full shape at construction so the hidden class is fixed.
const p2 = { x: 1, y: 2 };
```

### Pattern 3: Keep numeric arrays homogeneous

```js
// ❌ Mixing integers and floats can force the array out of its fast
//    integer representation.
const a = [1, 2, 3];
a.push(3.14);   // representation may transition

// ✅ Decide up front: all integers, or all doubles.
const ints = [1, 2, 3, 4];
const dbls = [1.0, 2.5, 3.14];
```

### Pattern 4: Don't leave holes in arrays

```js
// ❌ "Holey" array — the engine can't assume every slot is present.
const a = [];
a[0] = 1;
a[100] = 2;   // indices 1..99 are holes -> slow, deopt-prone path

// ✅ Fill densely / use the right size from the start.
const b = new Array(101).fill(0);
b[0] = 1;
b[100] = 2;
```

---

## Best Practices

- **Be predictable.** The single best thing you can do is feed hot functions consistent types and consistent object shapes. The JIT rewards consistency.
- **Measure before you worry.** Most functions are never hot enough to be optimized. Only chase deopts in code the profiler says is actually hot.
- **Turn on the trace when investigating.** `node --trace-deopt` and `-XX:+PrintCompilation` turn an invisible problem into a readable log.
- **Separate the slow path.** If a function is *usually* called with integers but *sometimes* with something weird, consider routing the weird case to a different function so the hot one stays monomorphic.
- **Don't micro-optimize blindly.** "JIT-friendly" patterns matter in genuine hot paths and almost nowhere else. Readability wins in cold code.
- **Trust correctness.** Never suspect deopt of producing wrong results. If your numbers are wrong, it's a logic bug, not the JIT.

---

## Edge Cases & Pitfalls

### Pitfall 1: Thinking a deopt is an error

A deopt log line looks alarming, but a *few* deopts during warm-up are completely normal — the engine is feeling out your program's behavior. Only **repeated** deopts on the **same** hot function are a problem.

### Pitfall 2: Mixing `int` and `double` in numeric code

In JS, `1` (a small integer) and `1.0`/`3.14` (a double) are represented differently. A loop that mostly works on integers but occasionally produces a fraction can keep tripping the integer guard. Pick one numeric domain for a hot loop.

### Pitfall 3: Building objects field-by-field

Every time you add a new property to an object, you may transition its hidden class. If you do this inside a hot loop, or build "the same kind of object" two different ways in two places, you create multiple shapes for what should be one — and that confuses speculation.

### Pitfall 4: Using `arguments` or `try/catch` in old engines (legacy gotcha)

Historically, certain JS constructs (`arguments`, `eval`, `with`, `try/catch`) disabled or hampered optimization entirely. Modern V8 handles most of these far better than it used to, but `arguments` in particular is still worth avoiding in hot code — prefer rest parameters (`...args`).

### Pitfall 5: Assuming the fast path always runs

You wrote "fast" code, but if its guards keep failing, the fast path is *never taken*. The optimized version exists in memory but execution keeps bailing to the slow tier. Always confirm with a trace before assuming your hot path is actually hot *and* stable.

### Pitfall 6: Expecting Java type-deopts like JS

Java is statically typed, so you won't get "wrong type" deopts. Java's deopts come from *other* speculations: an assumed-final method getting overridden by a newly loaded class, a branch the compiler pruned suddenly being taken, or a null-check that was speculated away. Different triggers, same mechanism.

---

## Cheat Sheet

```text
WHY SPECULATE?    To emit fast machine code, the JIT must assume facts it
                  cannot prove (types, call targets, branches, no overflow).

THE PATTERN       BET  -> assume the common case
                  GUARD-> cheap runtime check of the assumption
                  FAST -> run the specialized code if guard passes
                  DEOPT-> fall back to slow-but-correct code if guard fails

DEOPT IS          controlled fallback, NOT a crash, NOT a wrong answer.
                  Reconstructs interpreter state, resumes there.

NEVER             changes program semantics. Slower-but-correct, always.

WATCH IT          JS:   node --trace-opt --trace-deopt script.js
                  JVM:  java -XX:+PrintCompilation -XX:+TraceDeoptimization App

PROBLEM SHAPE     deopt LOOP / STORM = optimize -> deopt -> optimize -> ...
                  Caused by inconsistent types/shapes in a hot function.

STAY FAST (JS)    - same types per function (monomorphic)
                  - declare all object fields up front (stable shape)
                  - homogeneous arrays (all ints or all doubles)
                  - no holes in arrays
                  - prefer ...rest over arguments

KEY VOCAB         V8: "bailout" / "deopt"   HotSpot: "uncommon trap"
                  monomorphic (1 type) < polymorphic < megamorphic (many)
```

---

## Summary

A modern language runtime makes your code fast by **speculating**: the optimizing JIT *assumes* facts it can't prove — that a value is always an integer, that a method is never overridden, that a branch is never taken — and emits fast machine code based on those assumptions. Each assumption is protected by a cheap **guard**. When a guard passes, you get near-native speed. When a guard fails, the runtime **deoptimizes**: it abandons the optimized code mid-execution, reconstructs the equivalent slower state, and continues in the interpreter or baseline tier.

The non-negotiable rule is that **deoptimization never changes your program's result** — it only changes its speed. So you never debug "deopt gave the wrong answer"; you only ever debug "my hot code is slow because it keeps deopting." The everyday cause, especially in JavaScript, is *inconsistency*: mixing types, mutating object shapes, holey arrays. Write predictable, consistent hot code, and the JIT will keep its fast bets — and keep your program fast. The deeper mechanics — how the runtime maps optimized registers back to interpreter state, materializes objects that escape analysis had deleted, and invalidates code on class loading — are what `middle.md`, `senior.md`, and `professional.md` build on this foundation.
