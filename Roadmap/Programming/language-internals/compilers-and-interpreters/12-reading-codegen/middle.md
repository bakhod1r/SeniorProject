# Reading Codegen (Disassembly & Compiler Output) — Middle Level

> **Topic:** [Reading Codegen (Disassembly & Compiler Output)](README.md)
> **Focus:** Recognizing real optimizations in the output — vectorization, inlining, bounds-check elimination — and using `perf annotate` to find which instructions actually cost time.

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

> Focus: **You can read the basics. Now: did the loop *vectorize*? Did the bounds check survive? Where does the time actually go?**

At the junior level you learned to open the hood — Compiler Explorer, the registers, the dozen instructions, constant folding and strength reduction. That's the alphabet. This level is reading sentences: recognizing the *optimizations that matter for performance* in real output, and connecting the assembly to where time is actually spent.

The questions get sharper:

- "I have a hot numeric loop. Did the compiler **vectorize** it into SIMD instructions (`xmm`/`ymm`/`zmm`, packed adds), or is it processing one element at a time?"
- "In Rust/Go/Java, every array access can carry a **bounds check**. Did the compiler eliminate it in my hot loop, or am I paying for a comparison-and-branch on every iteration?"
- "I expected this function to inline. It didn't. *Why?*"
- "`perf` says this loop is 40% of my runtime. Which *instruction* inside it is hot?"

Reading codegen at this level is how you turn "it feels slow" into "the compiler failed to vectorize because of this loop-carried dependency, here in the assembly." That's the difference between a guess and a diagnosis.

> 🎓 **Why this matters for a mid-level engineer:** You're now the person who's expected to *fix* the slow thing, not just notice it. The most common performance wins on hot numeric code are (1) getting the compiler to vectorize, (2) eliminating bounds checks, and (3) getting a hot call inlined. You can't make any of those happen reliably if you can't *see* whether they're happening. The assembly is your feedback loop.

This page covers: SIMD/vectorization and how to recognize it in the output (`xmm`/`ymm`/`zmm`, packed `padd`/`mulps`/`vfmadd`), bounds-check elimination across Rust/Go/Java/C++, why inlining sometimes doesn't happen and how to read that, loop unrolling, the calling convention as visible in the prologue/epilogue, and `perf record` + `perf annotate` to map hot time onto instructions. `senior.md` covers proving optimizations rigorously and the benchmark-optimized-away trap; `professional.md` covers JIT disassembly and aliasing.

---

## Prerequisites

What you should know before reading this:

- **Required:** Comfortable reading the basic x86-64 from `junior.md` — registers, `mov`/`lea`/`add`/`cmp`/`jmp`/`call`, addressing modes, Intel syntax.
- **Required:** You can drive Compiler Explorer (select compiler, set flags, read the color-mapped output).
- **Required:** Understanding what a loop and an array index look like in assembly.
- **Helpful but not required:** A vague sense of what SIMD is ("do the same operation on 4/8/16 numbers at once").
- **Helpful but not required:** You've run a profiler at least once, even just `time` or a flame graph.

You do **not** need to know:

- How to write SIMD intrinsics or assembly by hand (we only *recognize* the compiler's SIMD output).
- The microarchitecture (ports, latency/throughput tables) — that's deep performance work beyond this page.
- JIT internals or aliasing analysis in depth — `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **SIMD** | "Single Instruction, Multiple Data" — one instruction operates on a *vector* of several values at once. |
| **Vectorization** | The compiler transforming a scalar loop (one element per iteration) into SIMD (many elements per iteration). |
| **`xmm` / `ymm` / `zmm`** | The SIMD registers: 128-bit (`xmm0`–`xmm15`, SSE), 256-bit (`ymm`, AVX/AVX2), 512-bit (`zmm`, AVX-512). Wider = more elements per instruction. |
| **Packed instruction** | A SIMD instruction that operates on packed lanes, e.g. `paddd` (packed add of 4 int32s), `mulps`/`vmulps` (packed multiply of floats). The `p`/`ps`/`pd` suffixes signal "packed." |
| **Scalar instruction** | Operates on *one* value, e.g. `addss` (add *scalar* single). The presence of `ss`/`sd` instead of `ps`/`pd` means **not** vectorized. |
| **Bounds check** | A runtime `if (index >= length) panic;` inserted by memory-safe languages (Rust, Go, Java, C#) before an array access. |
| **Bounds-check elimination (BCE)** | The optimizer proving a check is always true and removing it, saving a compare+branch per access. |
| **Inlining** | Copying a callee's body into the caller. Removes call overhead and *enables* further optimization across the boundary. |
| **Loop unrolling** | Replicating a loop body N times so fewer iterations (and fewer branch checks) run. |
| **Register spill** | When the compiler runs out of registers and stores values to the stack (`mov [rsp+...], reg`), then reloads them. Costs memory traffic. |
| **Prologue / Epilogue** | Function entry/exit code: saving callee-saved registers, adjusting `rsp`, restoring on return. |
| **Calling convention (ABI)** | The agreed rules: on Linux x86-64 (System V), integer args go in `rdi, rsi, rdx, rcx, r8, r9`; return in `rax`. |
| **`perf`** | The Linux sampling profiler. `perf record` samples the running program; `perf report`/`perf annotate` show where time went, down to the instruction. |
| **`perf annotate`** | Shows a function's disassembly with a *percentage of samples* next to each instruction — the hottest instructions. |
| **Hot instruction** | An instruction where the profiler attributes a lot of time (often a memory load that misses cache, or a hard-to-predict branch). |
| **FMA** | Fused multiply-add: `a*b + c` in one instruction (`vfmadd...`). A strong signal the compiler vectorized a dot-product-style loop. |
| **Reduction** | A loop that accumulates into a scalar (`sum += a[i]`). Vectorizing it requires the compiler to use multiple accumulators and combine at the end. |

---

## Core Concepts

### 1. Recognizing vectorization in the output

A scalar loop processes one element per iteration. A *vectorized* loop processes a whole vector (4, 8, or 16 elements) per iteration using SIMD registers. You recognize it by three signals:

1. **SIMD registers appear:** `xmm0`, `ymm0`, `zmm0` instead of only `eax`/`rax`.
2. **Packed instructions appear:** mnemonics ending in `ps`, `pd`, `d`/`q` with a `p` prefix — `paddd`, `addps`, `vmulps`, `vfmadd231ps`. The `p` and `ps`/`pd` mean "packed / parallel lanes."
3. **The loop counter advances by more than 1:** you'll see `add rcx, 8` (advance by 8 elements) instead of `add rcx, 1`, plus often a scalar "remainder" loop afterward for the leftover elements.

If instead you see **scalar** SIMD instructions — `addss` (add scalar single), `mulsd` (multiply scalar double) — the loop is using the SIMD *registers* but only one lane at a time. **That is not vectorized.** The `s` (scalar) vs `p` (packed) distinction is the whole game.

### 2. Why a loop fails to vectorize

The compiler will not vectorize when it can't *prove* it's safe. Common blockers:

- **Loop-carried dependency:** each iteration depends on the previous (`a[i] = a[i-1] + x`). Can't run lanes in parallel.
- **Possible pointer aliasing:** if `dst` and `src` might overlap, vectorizing could change results. (C's `restrict` / Rust's non-aliasing guarantees unlock vectorization — covered in `professional.md`.)
- **Function calls in the loop body** that aren't inlined: the compiler can't vectorize across an opaque call.
- **Complex control flow / early exits** inside the loop.
- **Floating-point reduction without `-ffast-math`:** `sum += a[i]` over floats changes rounding if reassociated, so the compiler won't vectorize a float sum unless you allow it (`-ffast-math` / `-funsafe-math-optimizations`). Integer sums vectorize freely.

When you *expected* vectorization and didn't get it, the cause is almost always one of these. Reading the assembly tells you it didn't happen; reasoning about these blockers tells you *why*.

### 3. Bounds-check elimination

In memory-safe languages, `arr[i]` compiles to roughly:

```text
if i >= arr.len { panic }   ; the bounds check
load arr[i]
```

That `cmp` + conditional branch (a `ja`/`jae` to a panic block) executes on *every* access. In a hot loop this can matter. The optimizer eliminates the check when it can prove `i` is always in range — e.g. iterating `0..arr.len()` with an iterator, or after a single up-front length check. You recognize:

- **Check present:** a `cmp` against the length and a conditional `jump` to a `panic`/`bounds_check_fail` label inside the loop.
- **Check eliminated:** the load happens with no preceding compare-to-length and no panic branch.

In Rust, using iterators (`for x in &v`) instead of indexing (`for i in 0..v.len() { v[i] }`) is the canonical way to get BCE — and you confirm it by looking. In Go, the compiler prints `-gcflags=-d=ssa/check_bce/debug=1` diagnostics, and you can also read the disassembly for the `CMPQ`/`panicIndex` calls.

### 4. Reading why inlining did or didn't happen

Inlining is visible by the *absence of a `call`* and the callee's logic appearing inline. When it *doesn't* happen, you see `call func`. Reasons the compiler declines:

- **Function too large** (exceeds the inliner's cost budget).
- **Recursion** (can't inline a function into itself indefinitely).
- **Called through a function pointer / virtual dispatch** (target unknown at compile time).
- **Not visible** (defined in another translation unit without LTO; cross-module without link-time optimization).
- **Marked `#[inline(never)]` / `noinline`**, or simply not marked `inline` and the heuristic said no.

Compilers can tell you *why*. Clang/GCC: `-Rpass=inline` / `-Rpass-missed=inline` (and `-fopt-info-inline`) print remarks like "function not inlined because too costly." Reading codegen confirms the result; the optimization remarks explain the decision.

### 5. Loop unrolling and what it looks like

Unrolling duplicates the body so each iteration does the work of several. You recognize it by **the body's instructions appearing N times in a row** before the loop's compare-and-branch, with the counter advancing by N. Unrolling reduces branch overhead and exposes more independent work for the CPU to pipeline; it often appears *together* with vectorization (vectorize by 8, unroll by 2 → 16 elements per iteration). Too much unrolling bloats code (and can hurt the instruction cache) — `senior.md` discusses when `-O3` makes things *bigger, not faster*.

### 6. The calling convention, visible in assembly

On Linux x86-64 (System V ABI), integer/pointer arguments arrive in `rdi, rsi, rdx, rcx, r8, r9` (in that order), and the return value leaves in `rax` (or `xmm0` for floats). You can *see* this:

- A function reading `rdi` first is reading its first argument.
- The **prologue** (`push rbp; mov rbp, rsp; sub rsp, N`) sets up a stack frame; the **epilogue** (`leave`/`pop rbp; ret`) tears it down.
- `push`/`pop` of `rbx`, `r12`–`r15` at the edges means those *callee-saved* registers are being preserved because the function uses them.

Knowing the convention lets you read an unfamiliar function and immediately identify "this is doing X with the first two arguments."

### 7. From assembly to time: `perf annotate`

Reading assembly tells you *what* the CPU does; it does **not** tell you *what's slow*. A `mov` that loads from cache and a `mov` that misses to DRAM look identical in the disassembly but differ 100×. To find the *hot instructions*, profile:

```bash
perf record -g ./my_program
perf report            # pick the hot function, press 'a' to annotate
# or directly:
perf annotate -s my_hot_function
```

`perf annotate` shows the function's disassembly with a **percentage of samples** beside each instruction. The instructions with high percentages are where time actually goes — usually a memory load (cache miss) or a mispredicted branch. This closes the loop: *read* the asm to understand the work, *profile* it to find the cost.

---

## Real-World Analogies

**Assembly line, single vs. multi-head.** A scalar loop is one worker fitting one bolt at a time. A vectorized loop is a multi-head machine fitting 8 bolts in one motion (`ymm` = 8 lanes). Recognizing vectorization is glancing at the machine and counting the heads.

**The security checkpoint that learns you're a regular.** A bounds check is a guard checking your ID at every door. Bounds-check elimination is the guard realizing, after one check at the entrance, that you're cleared for the whole floor and waving you through the rest — fewer stops, same safety, because it's *provably* fine.

**Photocopying a colleague into your office.** Inlining is photocopying a small helper's work directly onto your desk so you don't have to walk down the hall (`call`) every time. When the helper's job is huge, you don't photocopy it — you still walk over. Reading the asm tells you which one happened.

**A heat map over a blueprint.** The disassembly is the blueprint of what the machine does. `perf annotate` is a thermal camera laid over it, showing which instructions are actually hot. The blueprint alone can't tell you where the heat is.

---

## Mental Models

**Model 1: `p` is parallel, `s` is scalar.** When scanning SIMD output, the suffix tells you everything. `addps`/`paddd` = packed = vectorized. `addss`/`addsd` = scalar = one lane = *not* vectorized even though SIMD registers are involved. Train your eye to catch that single letter.

**Model 2: The compiler vectorizes only what it can prove safe.** If you don't see vectorization, ask "what couldn't it prove?" — aliasing, a dependency, a float reassociation, an opaque call. The blocker is usually nameable.

**Model 3: A bounds check is a `cmp`+branch to a panic block.** Train yourself to spot the panic/`bounds_check_fail` target. Its presence inside a loop = check still there. Its absence = eliminated.

**Model 4: No `call` where you expected one = inlined; a `call` where you wanted none = a missed inline.** The `call` instruction is your inlining detector.

**Model 5: Asm shows work, `perf` shows cost.** Two instructions that look equally cheap can differ 100× at runtime (cache hit vs. miss). Never infer "slow" from the *instruction list* alone — overlay a profile.

**Model 6: Unrolling + vectorization compound.** Modern `-O3` often unrolls *and* vectorizes, so the hot loop body looks long and dense. Don't be alarmed — count the elements-per-iteration (the counter increment) to see the real width.

---

## Code Examples

> Try every one at godbolt.org with Intel syntax. The point is to *see* the difference, not memorize listings.

### Example 1: A vectorized loop vs. a scalar one

```c
void add_arrays(float *a, float *b, float *out, int n) {
    for (int i = 0; i < n; i++)
        out[i] = a[i] + b[i];
}
```

At `-O3 -march=x86-64-v3` (enables AVX2), the hot part looks like (simplified):

```asm
.L_vector:
        vmovups ymm0, [rsi + rax*4]    ; load 8 floats from b
        vaddps  ymm0, ymm0, [rdi + rax*4]  ; add 8 floats from a  (PACKED add)
        vmovups [rdx + rax*4], ymm0    ; store 8 floats to out
        add     rax, 8                 ; advance by 8 elements!
        cmp     rax, rcx
        jb      .L_vector
        ; ... a scalar remainder loop for leftover elements ...
```

`ymm0`, `vaddps` (packed), and `add rax, 8` together scream "vectorized, 8 floats per iteration." Compare with `-O2` *without* `-march` (default baseline) — you may get scalar `addss` (one float at a time). The `march` flag matters: vectorization width depends on which instructions the compiler is allowed to assume the CPU has.

### Example 2: A loop that *won't* vectorize (carried dependency)

```c
void prefix(float *a, int n) {
    for (int i = 1; i < n; i++)
        a[i] = a[i-1] + a[i];   // each element depends on the previous
}
```

No matter the flags, you'll see **scalar** `addss` in a tight loop — no `ymm`, no packed add. The dependency `a[i]` ← `a[i-1]` forces sequential execution. This is the "why didn't it vectorize?" answer made visible: a loop-carried dependency. (Gcc with `-fopt-info-vec-missed` will literally print "not vectorized: unsupported use in stmt.")

### Example 3: Bounds check present vs. eliminated (Rust)

```rust
// Indexing — may keep a bounds check per access:
pub fn sum_indexed(v: &[u32]) -> u32 {
    let mut s = 0;
    for i in 0..v.len() {
        s += v[i];
    }
    s
}

// Iterator — bounds check eliminated:
pub fn sum_iter(v: &[u32]) -> u32 {
    v.iter().sum()
}
```

In the indexed version's assembly you may find a `cmp`/`jae` to a `panic_bounds_check` label inside the loop. In the iterator version, the loop loads directly with no per-iteration length compare and no panic branch — and it's far more likely to vectorize. Reading both side by side is the proof that "use iterators" isn't dogma; it's BCE you can *see*.

### Example 4: Inlined vs. not, and finding out why

```cpp
int helper(int x) { return x * 3 + 1; }   // small: should inline

int caller(int n) {
    return helper(n) + helper(n + 1);
}
```

At `-O2`, expect **no `call helper`** — the body (`*3 + 1`) appears twice, inlined. To ask the compiler *why* a missed inline happened on a bigger function:

```bash
clang -O2 -Rpass=inline -Rpass-missed=inline file.cpp
# prints: "remark: 'big_func' not inlined into 'caller' because too costly"
gcc   -O2 -fopt-info-inline file.cpp
```

The remark plus the visible `call` together give you the full story: it didn't inline, and here's the reason.

### Example 5: Reduction needs multiple accumulators

```c
float dot(const float *a, const float *b, int n) {
    float s = 0;
    for (int i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}
```

With strict floating-point (`-O2` only), this stays **scalar** (`mulss`/`addss`) because reassociating float adds changes the result. With `-O3 -ffast-math -march=x86-64-v3`, you'll see `vfmadd231ps ymm…` (fused multiply-add, packed) and often *several* `ymm` accumulators (`ymm0`–`ymm3`) summed at the end — that's the compiler vectorizing the reduction. Seeing `vfmadd...ps` is a strong "yes, it vectorized the dot product" signal.

### Example 6: `perf annotate` on a hot loop

```bash
perf record -g ./matmul
perf report          # navigate to the hot function, press 'a'
```

Annotated output (sketch):

```asm
       │    .L_inner:
 12.3% │      vmovups ymm1, [rsi + rax*4]
  4.1% │      vfmadd231ps ymm0, ymm1, [rdi + rax*4]
 58.7% │      vmovups ymm1, [rcx + rax*4]     ; <-- the hot one: a cache-missing load
  ...  │      add     rax, 8
```

The 58.7% on a `vmovups` load tells you the bottleneck is *memory*, not arithmetic — the FMA is cheap, the load that misses cache is what hurts. That redirects your fix from "do less math" to "improve data layout / locality." You could never have guessed that from the source.

### Example 7: Loop unrolling

```c
int sum(const int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
```

At `-O3`, gcc may both vectorize (`paddd` on `xmm`/`ymm`) **and** unroll, so you see *two or four* packed adds back-to-back with the counter advancing by 16 or 32 before the branch. Counting the increment (`add rax, 16`) tells you the effective width per iteration.

### Example 8: Go bounds-check diagnostics

```bash
# Tell the Go compiler to report bounds-check decisions:
go build -gcflags='-d=ssa/check_bce/debug=1' ./...
# It prints lines like:  "main.go:12:9: Found IsInBounds"  (check present)
# Disassemble to confirm:
go tool objdump -s 'mypkg.Sum' ./mybinary
```

In the Go disassembly, a remaining bounds check appears as a `CMPQ` against the length and a jump to a `runtime.panicIndex` call. Hoisting a single `_ = a[n-1]` before the loop, or ranging instead of indexing, often removes the per-iteration check — and you confirm by re-reading the disassembly.

---

## Pros & Cons

**Pros of reading optimization-level codegen:**

- **You can verify the three highest-value optimizations** (vectorization, BCE, inlining) instead of hoping.
- **`perf annotate` turns "slow" into a specific hot instruction**, redirecting your effort to the real bottleneck.
- **You learn *why* an optimization didn't happen**, which is exactly what you need to *make* it happen.
- **It makes you precise in code review:** "this indexing keeps a bounds check; switch to an iterator" is a concrete, checkable claim.

**Cons / costs:**

- **More to recognize:** SIMD mnemonics, panic branches, FMA forms — a bigger vocabulary than the junior set.
- **Output depends heavily on flags** (`-march`, `-ffast-math`, LTO). You must control these to read meaningfully.
- **Vectorized `-O3` output is dense and long**, which can be intimidating before you learn to skim it.
- **`perf` needs a real run on real data** (and often root/`perf_event_paranoid` config), unlike Godbolt which is instant.
- **It's still only half the picture** without microarchitectural understanding (latency/throughput) for the deepest tuning.

---

## Use Cases

- **Confirming a hot loop vectorized** before and after a refactor (e.g. switching to iterators, adding `restrict`, enabling `-march`).
- **Diagnosing a missed vectorization** by reading the scalar output and naming the blocker (dependency, aliasing, float reassociation).
- **Proving a bounds check was eliminated** when you rewrote indexing as iteration in Rust/Go.
- **Checking whether a hot helper inlined**, and using `-Rpass-missed=inline` to learn why not.
- **Finding the actual hot instruction** in a loop with `perf annotate` — usually revealing a memory or branch bottleneck, not the arithmetic you assumed.
- **Validating a `-march`/`-mtune` change** actually produced wider SIMD instructions.
- **Reviewing a teammate's "optimization"** by checking the assembly is genuinely different (and better), not just differently-spelled source.

---

## Coding Patterns

### Pattern 1: Toggle `-march` to test vectorization potential

```bash
# Baseline (portable, narrow SIMD) vs. AVX2-enabled:
-O3                          # default ISA
-O3 -march=x86-64-v3         # allows AVX2/FMA  -> wider ymm, packed FMA
```

If a loop vectorizes only with `-march=x86-64-v3`, you've learned the win requires building for a newer CPU baseline. Read both outputs.

### Pattern 2: Ask the compiler for optimization remarks

```bash
gcc   -O3 -fopt-info-vec        -fopt-info-vec-missed file.c
clang -O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize file.c
```

These print *why* loops did or didn't vectorize. Use them alongside the disassembly: remarks explain, assembly confirms.

### Pattern 3: Prefer iterators, then verify BCE

In Rust, rewrite `for i in 0..v.len() { v[i] }` as `for x in &v` (or `.iter()`), then read the asm to confirm the panic branch is gone. Don't assume — verify.

### Pattern 4: Hoist a length assertion to enable BCE

```rust
let n = v.len();
assert!(slice.len() >= n);   // one check up front
for i in 0..n { /* v[i], slice[i] now provably in range */ }
```

A single up-front check can let the optimizer drop the per-iteration checks. Confirm in the disassembly.

### Pattern 5: `perf record` → `perf annotate` to find the hot instruction

```bash
perf record -g ./prog && perf report   # 'a' to annotate the hot function
```

Always profile before optimizing a loop. Let the percentages, not your intuition, pick the target.

### Pattern 6: Separate "did it inline" from "is it fast"

First check inlining (look for the `call`). *Then* profile. An inlined function can still be slow for other reasons; a non-inlined call can be irrelevant if it's cold. Use both tools for their own job.

---

## Best Practices

- **Always read at your shipping flags.** Vectorization, BCE, and inlining all depend on `-O2`/`-O3`, `-march`, `-ffast-math`, and LTO. Reading the wrong configuration gives wrong conclusions.
- **Learn the `s`-vs-`p` suffix cold.** It is the fastest way to tell "vectorized" from "using SIMD registers scalar-ly."
- **Pair the disassembly with optimization remarks.** `-fopt-info-*` / `-Rpass-*` explain decisions the assembly only shows the result of.
- **Profile before you optimize a loop.** `perf annotate` repeatedly reveals the bottleneck is memory or a branch, not the code you'd have rewritten.
- **Name the vectorization blocker.** If a loop didn't vectorize, identify which of dependency / aliasing / float-reassociation / opaque-call caused it.
- **Confirm BCE by looking for the panic branch**, not by trusting that "iterators are faster."
- **Re-read after every change.** Treat the assembly as a regression check: did my refactor keep the loop vectorized?
- **Keep `-march` honest.** Reading AVX-512 output is pointless if you deploy to CPUs without it.

---

## Edge Cases & Pitfalls

- **Mistaking scalar SIMD for vectorization.** Seeing `xmm0` is *not* enough — `addss`/`mulsd` on `xmm` is scalar. Only packed (`ps`/`pd`/`paddd`) is vectorized. This is the #1 mid-level misread.
- **Vectorizing floats without allowing reassociation.** A float `sum += a[i]` won't vectorize at `-O2` because it would change rounding. Forgetting `-ffast-math` (and its correctness implications) leaves you puzzled by scalar output that's actually *correct* behavior.
- **`-march=native` on the build box ≠ the deploy target.** You read beautiful AVX-512, ship to a CPU without it, and the binary faults or runs a slow path. Read for the *target* ISA.
- **Assuming BCE because the source uses iterators.** Iterators *usually* enable BCE, but a complex body can still keep checks. Look.
- **Reading the wrong function in `perf annotate`** because of inlining — inlined code is attributed to the caller. If a function "has no samples," its work may be folded into its caller.
- **`perf` samples skid.** The instruction the profiler blames can be a few instructions *after* the real culprit (a slow load shows up on a later instruction). Read the surrounding block, not just the single hot line.
- **Confusing unrolling with vectorization.** A long loop body might be unrolled scalar code, not SIMD. Check for packed mnemonics and the counter stride to tell them apart.
- **Forgetting LTO.** Cross-file inlining only happens with link-time optimization. A `call` to another translation unit at `-O2` without LTO doesn't mean "can't inline" — it means "couldn't see the body."
- **`-O3` not always faster.** More unrolling/inlining can bloat code and thrash the instruction cache. Sometimes `-O2` is faster on the *whole* program. Read *and* measure; don't assume bigger optimization level wins. (`senior.md` digs into this.)
- **Float vs. double width confusion.** A `ymm` holds 8 floats *or* 4 doubles. If your data is `double`, the same register processes half as many elements — don't expect 8-wide throughput.
