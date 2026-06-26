# Reading Codegen (Disassembly & Compiler Output) — Senior Level

> **Topic:** [Reading Codegen (Disassembly & Compiler Output)](README.md)
> **Focus:** Settling optimization debates with evidence, the benchmark-optimized-away trap, why `-O3` sometimes loses, and reading LLVM IR as the layer between source and assembly.

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

---

## Introduction

> Focus: **Reading codegen as a *method* — using disassembly to prove or refute optimization claims, to debug performance, and to avoid measuring something the compiler already deleted.**

By now you can read assembly fluently and recognize the optimizations that matter. The senior shift is from *reading* to *deciding things with the reading*. You're the person a team turns to when there's a disagreement: "is the compiler vectorizing this?", "did my refactor make it faster or just different?", "why is `-O3` slower than `-O2` here?". You answer those not with intuition but with **codegen as evidence**.

This level is also where you learn the discipline's most expensive trap: **the compiler optimizes away your benchmark.** You measure a function that "does nothing observable," the optimizer deletes it entirely, and you proudly report a nanosecond timing for an empty loop. Senior engineers know how to defeat this (`DoNotOptimize`, `black_box`, `volatile` sinks) — and, crucially, how to *verify in the disassembly* that the work survived.

> 🎓 **Why this matters for a senior:** Your performance conclusions become *organizational truth*. If you claim "we should rewrite this in SIMD" and the compiler was already vectorizing the scalar version, you've wasted a sprint. If you "prove" a 10× speedup that was actually the optimizer deleting a dead benchmark, you've shipped a lie. The defense against both is the same: read the codegen, confirm the work exists, attribute the time, and present the disassembly as evidence. Opinions don't survive a code review of the assembly.

This page covers: using disassembly to settle "is this optimization happening?" debates with evidence; the benchmark-optimized-away trap and the sinks that defeat it (`benchmark::DoNotOptimize` / `ClobberMemory`, Rust `std::hint::black_box`, `volatile` sinks); why `-O3` can be *slower* than `-O2` (code bloat, i-cache, bad inlining/unroll heuristics); reading **LLVM IR** (`clang -emit-llvm -S`) as the explainable middle layer; and surprising-codegen stories (the compiler did something clever; the compiler *refused* to optimize because of UB/volatile/aliasing). `professional.md` extends this to JIT disassembly and aliasing-driven failures in production.

---

## Prerequisites

- **Required:** Fluent reading of optimized x86-64 (`middle.md`): SIMD recognition, BCE, inlining, `perf annotate`.
- **Required:** Comfort controlling compiler flags (`-O2/-O3`, `-march`, `-ffast-math`, LTO).
- **Required:** You've written at least one microbenchmark and care whether it's honest.
- **Helpful:** Exposure to LLVM IR or any SSA-form intermediate representation.
- **Helpful:** A working `perf` setup and a real workload to profile.

You do **not** need: JIT internals (`professional.md`), or the ability to write a compiler pass. This is about *reading* and *deciding*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Optimized away** | The compiler proved code has no observable effect and deleted it. The bane of naive microbenchmarks. |
| **Sink / clobber** | A construct that forces the compiler to treat a value as "observed" so it can't be eliminated: `DoNotOptimize`, `black_box`, a `volatile` store. |
| **`DoNotOptimize` / `ClobberMemory`** | Google Benchmark helpers: `DoNotOptimize(x)` forces `x` to be computed and kept; `ClobberMemory()` forces pending memory writes to be considered observed. |
| **`black_box`** | Rust's `std::hint::black_box(x)` — an opaque identity function the optimizer can't see through; prevents folding/eliminating around it. |
| **`volatile`** | A C/C++ qualifier forcing every read/write to actually happen (memory-mapped I/O semantics). Often misused as a benchmark sink. |
| **LLVM IR** | LLVM's typed, SSA-form intermediate representation — the layer between source and machine code. Readable, target-independent, where most optimizations happen. |
| **SSA (Static Single Assignment)** | An IR form where each value is assigned exactly once (`%1`, `%2`, …). Makes data flow explicit and optimizations easier to read. |
| **`-emit-llvm`** | Clang flag to print LLVM IR (`-S` for text `.ll`, no flag for bitcode `.bc`). |
| **Code bloat** | Larger machine code from aggressive inlining/unrolling, which can hurt instruction-cache behavior and overall speed. |
| **i-cache pressure** | When hot code no longer fits in the L1 instruction cache, causing fetch stalls — a way `-O3` can be slower. |
| **UB (Undefined Behavior)** | A program condition the language says must never occur; the compiler optimizes *assuming it can't*, sometimes with surprising results. |
| **Aliasing** | Whether two pointers might refer to the same memory. If the compiler can't rule it out, many optimizations are blocked. |
| **`restrict` / `noalias`** | A promise that a pointer doesn't alias others, unlocking optimizations. Visible as `noalias` in LLVM IR. |
| **Reassociation** | Reordering arithmetic (e.g. float sums) for parallelism — only legal under relaxed FP (`-ffast-math` / `fast` flags in IR). |
| **PGO** | Profile-guided optimization: feeding runtime profiles back to the compiler so it optimizes the actually-hot paths. |

---

## Core Concepts

### 1. Codegen as evidence: settling debates

The senior use of disassembly is *adjudication*. Someone claims X about the compiler; you produce the assembly that confirms or refutes it. The method is always the same:

1. **Reduce to a minimal function** that isolates the claim (no `main`, real parameters, your shipping flags).
2. **Read the output** for the specific signal (packed SIMD? a `call`? a panic branch? a single `mov` from folding?).
3. **Vary one thing** (a flag, a rewrite) and read the *difference*.
4. **Present the diff** as the evidence. "Here's the scalar loop; here's the same loop with `restrict`, now vectorized" ends the argument.

This is more reliable than benchmarking for *structural* claims ("did it vectorize / inline / fold"), because benchmarks have noise and the codegen is deterministic. Reserve benchmarking for *quantitative* claims ("how much faster").

### 2. The benchmark-optimized-away trap

This is the single most common way performance numbers lie. Consider:

```cpp
// WRONG: this "benchmark" likely measures an empty loop.
for (auto _ : state) {
    int x = expensive_compute(42);   // result unused -> may be deleted entirely
}
```

If `expensive_compute(42)` has no side effects and its result is unused, the optimizer is *entitled* to delete the call, the loop body, and possibly the loop. You then measure nanoseconds for *nothing*. The fixes are **sinks** that force the compiler to treat the result as observed:

- **Google Benchmark:** `benchmark::DoNotOptimize(expensive_compute(42));` (keeps the value), and `benchmark::ClobberMemory();` (treats memory writes as observed).
- **Rust:** `std::hint::black_box(expensive_compute(42));` — and `black_box` your *inputs* too, so the compiler can't constant-fold across the call.
- **C/C++ by hand:** store into a `volatile` sink, or use an inline-asm clobber.

**Critically:** the sink alone is not proof. You must *read the disassembly* and confirm the work is actually emitted inside the timed loop. If the body is gone, your sink was insufficient. The discipline is: defeat the optimizer with a sink, then *verify in the assembly*, then trust the number.

### 3. Why `-O3` is sometimes slower than `-O2`

"-O3 is faster" is folklore that's often false. `-O3` enables more aggressive inlining, unrolling, and vectorization heuristics that *can* backfire:

- **Code bloat → i-cache pressure.** Aggressive inlining/unrolling grows hot code past L1-i; fetch stalls cost more than the optimization saved.
- **Over-unrolling small loops** wastes the loop-stream buffer and increases register pressure → spills.
- **Speculative vectorization** of a loop that's usually short (the scalar remainder dominates) adds setup overhead.
- **Inlining a cold path** into a hot caller pushes the hot path further apart.

The senior move: when someone proposes `-O3`, *measure the whole program* (not a microbenchmark), and if it regresses, *read the codegen* to find the bloat (look for huge inlined bodies, deep unrolling). Sometimes the right answer is `-O2` plus targeted `__attribute__((hot))`/PGO, not a blanket `-O3`.

### 4. Reading LLVM IR — the explainable middle layer

Assembly is the *final* answer but it's noisy (register allocation, scheduling). **LLVM IR** sits between source and machine code: typed, SSA-form, target-independent, and it's where most optimizations happen. Reading it is often *clearer* than assembly for understanding *what the optimizer decided* before register allocation muddied it.

```bash
clang -O2 -emit-llvm -S file.c -o file.ll   # textual IR
```

In IR you can see: inlining (the callee's IR appears in the caller), constant folding (a `ret i32 42`), `noalias`/`nonnull` attributes on parameters, vectorized loops (`<8 x float>` vector types), and `fast` math flags on FP ops. When assembly is too low-level to reason about, drop to IR. Godbolt has an "LLVM IR output" view that color-maps source↔IR just like it does for assembly.

### 5. When the compiler refuses to optimize — and why

Equally important to spotting optimizations is diagnosing *missing* ones. Common, nameable causes:

- **Possible aliasing.** Two `int*` parameters might overlap, so the compiler can't reorder or vectorize across them. `restrict` (C) / non-overlapping slices (Rust) / `__restrict` removes the doubt. In IR, look for `noalias` on the parameters — present = the compiler knows they don't alias.
- **A hidden function call** in the loop (an un-inlined helper, an operator overload, a destructor, a `malloc`) that the compiler must treat as opaque, killing vectorization and motion.
- **`volatile`.** Every access must happen, exactly as written — no folding, no hoisting, no elimination. Great for hardware, ruinous if accidental.
- **UB constraints cutting the other way.** Signed-overflow and strict-aliasing assumptions let the compiler optimize *more*; but `-fno-strict-aliasing` (common in kernels) or `-fwrapv` *removes* assumptions and you'll see less aggressive code. Reading the codegen with and without these flags shows their cost.
- **Floating-point strictness.** Without `-ffast-math`, the compiler can't reassociate or contract FP ops, so reductions stay scalar. The IR shows `fast`/`reassoc` flags when they're permitted.

The senior skill: see the missed optimization in the assembly, form a hypothesis (aliasing? hidden call? volatile? FP strictness?), test it by changing exactly that one thing, and read the new output.

### 6. Surprising codegen, in both directions

Two categories of surprise are worth internalizing:

- **The compiler was cleverer than you.** It replaced your loop with a closed-form formula, turned a `popcount` loop into a single `popcnt`, recognized a `memcpy` pattern and called `memcpy`, or vectorized something you assumed it couldn't. Reading codegen keeps you humble: *check before hand-optimizing*, because you may be "fixing" something already optimal.
- **The compiler did nothing, for a reason you can name.** A division that "should" be a shift wasn't, because the value is signed and could be negative (signed division by a power of two needs a correction). A loop that "should" vectorize didn't, because of aliasing. Each non-optimization has a cause; finding it is the job.

---

## Real-World Analogies

**The lab notebook vs. the press release.** A microbenchmark number is a press release. The disassembly is the lab notebook showing the experiment actually ran. A senior engineer never publishes the press release without the notebook — because half the time the notebook reveals the "experiment" measured an empty tube (the optimized-away benchmark).

**The over-eager renovation.** `-O3` is a contractor who, told "make it faster," knocks out *every* wall (inlining everything, unrolling everything). Sometimes the open plan is better; sometimes you've destroyed the structural walls and the house is slower to live in (i-cache thrash). You inspect the blueprint (codegen) before approving.

**The interpreter between you and the witness.** LLVM IR is a professional interpreter who renders the witness's testimony (your source) in clear, precise language *before* it's transcribed into legal shorthand (assembly). When the shorthand is ambiguous, you go back to the interpreter's clean rendering.

**The magician's reveal.** When the compiler does something clever, reading codegen is watching the slow-motion reveal of the trick. When it *refuses*, it's the magician explaining "I can't do that one — you're holding my hand" (aliasing, volatile, UB constraints).

---

## Mental Models

**Model 1: Structural claims → read codegen; quantitative claims → benchmark (then read codegen).** "Did it vectorize/inline/fold" is answered by the assembly, deterministically. "How much faster" needs measurement — but only *after* you've confirmed via codegen that the thing you're timing actually runs.

**Model 2: A sink is a contract, not a guarantee — verify it.** `DoNotOptimize`/`black_box`/`volatile` *should* keep the work, but you confirm by reading the loop body in the disassembly. No body, no number.

**Model 3: Optimization level is a hypothesis, not a setting.** `-O3` *might* be faster. Treat it as a claim to test on the whole program, with the codegen explaining any regression.

**Model 4: IR is the "why," assembly is the "what."** When assembly tells you *what* happened but not *why*, drop to LLVM IR where attributes (`noalias`, `fast`) and inlined bodies make the decision legible.

**Model 5: Every missing optimization has a nameable cause.** Aliasing, a hidden call, `volatile`, FP strictness, signedness, or a cost-heuristic. Don't accept "the compiler just didn't" — find which one.

**Model 6: Trust, but read.** The compiler is usually right and often cleverer than you. Before hand-optimizing, read the codegen to check it isn't already optimal — and after hand-optimizing, read it to confirm you actually changed something.

---

## Code Examples

### Example 1: The optimized-away benchmark, exposed and fixed

```cpp
#include <benchmark/benchmark.h>
static int hot(int x) { return x * x + x; }

// BROKEN: result unused -> body may vanish.
static void BM_Broken(benchmark::State& s) {
    for (auto _ : s) hot(42);              // 'hot(42)' is dead code
}
// FIXED: force the result to be observed, and hide the input.
static void BM_Fixed(benchmark::State& s) {
    int in = 42;
    for (auto _ : s) {
        benchmark::DoNotOptimize(in);      // compiler can't fold '42'
        int r = hot(in);
        benchmark::DoNotOptimize(r);       // compiler must keep 'r'
    }
}
```

Compile and *read the loop body* (Godbolt or `objdump`). In `BM_Broken` you'll find the loop contains no `imul`/`add` at all — the work is gone. In `BM_Fixed` you'll see `imul`/`add` survive inside the timed loop. **Only the second is a real benchmark, and only the disassembly proves it.**

### Example 2: Rust `black_box` — both ends matter

```rust
use std::hint::black_box;

fn work(x: u64) -> u64 { x.wrapping_mul(0x9E3779B97F4A7C15) }

fn bench() {
    // Without black_box on the INPUT, the compiler constant-folds work(42).
    let r = work(black_box(42));
    black_box(r);   // and without this, the result is dead -> deleted
}
```

If you `black_box` only the result but pass a literal `42`, the optimizer may still constant-fold `work(42)` to a single constant and you measure a `mov`. Read the codegen: the multiply must be present. `black_box` the *input* to defeat folding and the *output* to defeat elimination.

### Example 3: `restrict` unlocking vectorization, seen in IR and asm

```c
void axpy(float *x, float *y, float a, int n) {        // may NOT vectorize
    for (int i = 0; i < n; i++) y[i] = a * x[i] + y[i];
}
void axpy_r(float * restrict x, float * restrict y, float a, int n) {  // vectorizes
    for (int i = 0; i < n; i++) y[i] = a * x[i] + y[i];
}
```

Read the LLVM IR (`clang -O2 -emit-llvm -S`): the `restrict` version shows `noalias` on the `x`/`y` parameters; without it, the compiler must assume `x` and `y` might overlap and inserts a runtime overlap check or stays scalar. In the assembly, `axpy_r` shows packed `vfmadd...ps`; `axpy` may show scalar `vfmadd...ss` or a guarded slow path. This *is* the evidence that aliasing was the blocker.

### Example 4: Signed division that surprises you

```c
int half(int x) { return x / 2; }       // signed: NOT just a shift
unsigned uhalf(unsigned x) { return x / 2; }  // unsigned: a clean shift
```

```asm
half:                          ; signed needs a correction for negatives
        mov     eax, edi
        shr     eax, 31        ; grab the sign bit
        add     eax, edi       ; bias so truncation rounds toward zero
        sar     eax, 1
        ret
uhalf:                         ; unsigned is trivial
        mov     eax, edi
        shr     eax, 1
        ret
```

If you ever wondered "why isn't `x/2` just `shr`?" — the disassembly answers: signed division by a power of two must correct for negative operands. This is a non-optimization *with a nameable cause* (signedness), not a compiler bug.

### Example 5: The compiler beats your loop (closed form)

```c
unsigned sum_n(unsigned n) {
    unsigned s = 0;
    for (unsigned i = 0; i <= n; i++) s += i;
    return s;
}
```

At `-O2`, gcc often emits a handful of instructions computing `n*(n+1)/2` directly — *no loop at all*. If you were about to "optimize" this loop by hand, the codegen tells you not to bother. Read first.

### Example 6: Reading LLVM IR to see inlining and folding

```bash
clang -O2 -emit-llvm -S demo.c -o demo.ll
```

```llvm
; A folded constant return:
define i32 @answer() {
  ret i32 42                ; '6 * 7' folded to 42 in IR, before asm
}
; A vectorized loop shows vector types:
%wide = load <8 x float>, ptr %p   ; 8-wide vector load -> vectorized
```

Vector types like `<8 x float>` in the IR confirm vectorization at a level above register allocation. `noalias`/`nonnull` attributes on parameters explain *why* optimizations were legal. IR is frequently the clearest place to read the optimizer's decisions.

### Example 7: `-O3` regression, found in the codegen

```bash
# Whole-program timing, not a microbenchmark:
clang -O2 app.c -o app_o2 && clang -O3 app.c -o app_o3
hyperfine ./app_o2 ./app_o3        # suppose -O3 is 8% SLOWER
size app_o2 app_o3                 # -O3 .text is much larger -> bloat
objdump -d app_o3 | less           # the hot function is massively inlined/unrolled
```

The combination — slower whole-program time, larger `.text`, and a visibly bloated hot function in the disassembly — diagnoses an i-cache/bloat regression. The fix might be `-O2` with `[[gnu::hot]]` on the truly-hot function, or PGO, rather than blanket `-O3`.

### Example 8: A `volatile` accidentally killing optimization

```c
int sum(const volatile int *a, int n) {   // 'volatile' here is a mistake
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
```

Because `a` is `volatile`, every `a[i]` read *must* happen, in order — the compiler cannot vectorize, hoist, or coalesce. The assembly shows a scalar load per element with no SIMD, even at `-O3`. Spotting the scalar loop and tracing it back to a stray `volatile` is a classic senior diagnosis. (`volatile` is for hardware/`sig_atomic_t`, not for "make sure the read happens in my benchmark" — use a proper sink instead.)

---

## Pros & Cons

**Pros of the senior, evidence-driven approach:**

- **Ends debates with deterministic proof** instead of noisy benchmarks for structural questions.
- **Prevents the most expensive performance lie** (the optimized-away benchmark) by verifying the work survives.
- **Explains regressions** (`-O3` slower, missed vectorization) by tracing them to a nameable cause in the codegen/IR.
- **LLVM IR gives an explainable layer** when assembly is too noisy to reason about.
- **Protects against wasted effort** — you check whether the compiler already did the optimization before doing it by hand.

**Cons / costs:**

- **Requires discipline:** sink + verify + measure is more steps than "just run the benchmark."
- **IR and asm both take fluency** to read quickly; the ramp is real.
- **Structural correctness ≠ speed.** Confirming vectorization doesn't tell you it's *fast enough*; you still profile.
- **Conclusions are flag- and target-specific**, so they must be reproduced in the real build config.
- **Over-reliance risk:** reading codegen can become a rabbit hole that displaces actually shipping the fix.

---

## Use Cases

- **Adjudicating "is the compiler vectorizing this?"** in a design review by pasting both versions into Godbolt and showing the packed-vs-scalar difference.
- **Auditing a microbenchmark** before trusting its numbers: confirm in the disassembly that the timed body isn't empty.
- **Diagnosing a `-O3` regression** by correlating whole-program timing, `.text` size, and visible bloat in the hot function.
- **Explaining a missed optimization** (aliasing, hidden call, volatile, FP strictness) with the IR `noalias`/`fast` attributes as evidence.
- **Deciding whether a hand-written SIMD rewrite is worth it** by first checking whether the compiler already vectorized the scalar version.
- **Justifying `restrict`/`__restrict`/non-aliasing refactors** by showing the before/after codegen.
- **Validating PGO** improved the hot path layout by comparing instrumented vs. optimized disassembly.

---

## Coding Patterns

### Pattern 1: Sink-and-verify for every microbenchmark

```cpp
benchmark::DoNotOptimize(input);
auto r = under_test(input);
benchmark::DoNotOptimize(r);
benchmark::ClobberMemory();   // if the work writes memory
```

Then open the disassembly and confirm the timed loop contains the real work. Never trust a number you haven't verified at the instruction level.

### Pattern 2: Minimal-function reduction for adjudication

Strip the claim to one parameterized function, compile with the *shipping* flags, read the one signal you care about (packed SIMD / `call` / panic branch / single `mov`). Keep the snippet in your notes to re-run later.

### Pattern 3: Change exactly one thing, read the diff

To prove a cause, vary a single variable — add `restrict`, add `-ffast-math`, remove `volatile`, switch `-O2`↔`-O3` — and read the difference. One change, one conclusion.

### Pattern 4: Drop to IR when assembly is too noisy

```bash
clang -O2 -emit-llvm -S file.c -o file.ll
```

Read `noalias`/`nonnull` attributes, `<N x T>` vector types, and `fast` FP flags to understand *why* the optimizer did what it did, above the register-allocation noise.

### Pattern 5: Whole-program A/B for optimization-level decisions

Time the *real program* (`hyperfine`, production-like input) for `-O2` vs `-O3`, not a microbenchmark. If `-O3` regresses, `size` + `objdump` to find the bloat. Decide per-program, even per-function (`[[gnu::hot]]`, `__attribute__((optimize(...)))`).

### Pattern 6: Check-before-optimizing

Before writing intrinsics or hand-unrolling, read the compiler's current output. If it's already optimal (closed-form, already vectorized, already a single intrinsic), don't waste the effort — and document the codegen that proves it.

---

## Best Practices

- **Always verify a microbenchmark in the disassembly.** Sinks are necessary but not sufficient; read the timed loop and confirm the work is there.
- **Reserve disassembly for structural claims and benchmarking for quantitative ones** — and require both before a performance decision.
- **Treat `-O3` as a hypothesis.** Measure whole-program, and if it regresses, explain it from the codegen before reverting blindly.
- **Read LLVM IR when assembly obscures the decision.** Attributes and vector types make the optimizer's reasoning legible.
- **Name the blocker for every missed optimization.** "It didn't vectorize" is incomplete; "it didn't vectorize because the pointers might alias — here's the IR without `noalias`" is senior.
- **Check the compiler hasn't already done it** before hand-optimizing.
- **Reproduce in the real build config.** Flags, `-march`, LTO, and PGO all change the codegen; conclusions don't transfer across configs.
- **Keep your reduced examples.** They become a regression suite for "is this still vectorized?" after future changes.

---

## Edge Cases & Pitfalls

- **The sink that doesn't sink.** `DoNotOptimize` on the *result* but a constant *input* still lets folding happen. Hide both ends. Verify in the asm.
- **`volatile` as a benchmark sink.** It works but pessimizes more than intended (forces every access, blocks coalescing) and can give misleadingly slow numbers. Prefer `DoNotOptimize`/`black_box`.
- **Trusting `-O3` because it's a bigger number.** It frequently regresses via bloat/i-cache. Measure the whole program.
- **Reading a structural conclusion off `-O0`.** No optimizations run at `-O0`, so "it didn't vectorize" there is meaningless.
- **Confusing "legal" with "profitable."** The compiler may *be allowed* to vectorize but decline because its cost model says it's not worth it (short trip counts). The IR/remarks distinguish "couldn't" from "chose not to."
- **`-ffast-math`'s correctness cost.** It unlocks FP vectorization but changes results (NaN handling, associativity, denormals). Reading the faster codegen is only half the story — confirm the numerics are acceptable.
- **Strict-aliasing surprises.** Type-punning through incompatible pointers is UB; the compiler may optimize based on the assumption it doesn't happen, producing codegen that "drops" your write. The fix (`memcpy`, `-fno-strict-aliasing`) is visible in the diff.
- **Signed-overflow assumptions.** The compiler assumes signed overflow never happens and optimizes accordingly; `-fwrapv` removes that and you'll see different (often less optimized) code. Don't mistake the difference for a bug.
- **Inlining hiding samples.** When you profile after confirming inlining, the inlined work shows up in the *caller*. Don't conclude "the function is free."
- **IR is not the final word.** The optimizer keeps working after the IR you printed (and the backend does its own thing). For the *final* truth, read the assembly; use IR to understand *intent*.
- **Reduced example diverges from production.** A tiny snippet may vectorize while the real (bigger, aliased, call-laden) loop doesn't. Confirm conclusions on code shaped like the real thing.
