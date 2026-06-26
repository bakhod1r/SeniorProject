# Optimization — Senior Level

> **Topic:** [Optimization](README.md)
> **Focus:** The full optimizer as a *pipeline of cooperating passes* — the loop transforms, the SSA-based catalog, register allocation as optimization, escape analysis and devirtualization, the **phase-ordering** problem, and the **undefined-behavior** contract that gives the optimizer its license (and produces its most dangerous surprises).

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

> Focus: **How is a real optimizer organized, why is its pass order an unsolved problem, and how does undefined behavior turn from "latitude" into deleted code?**

A production optimizer is not a single algorithm; it is a **pipeline** of dozens to hundreds of passes, each a small transformation built on the dataflow/SSA machinery from `middle.md`. The pipeline's design is dominated by one uncomfortable truth: **optimizations enable and disable each other, and there is no provably optimal order to run them in.** Inlining exposes constants that constant propagation can fold, which makes branches dead that DCE can delete, which shrinks a loop enough that LICM and vectorization can transform it — but vectorization might block a later optimization, and running inlining *too* early can bloat code that a later pass would have simplified. This is the **phase-ordering problem**, and every compiler answers it with a hand-tuned, partly-iterated fixed pipeline that is *good*, never optimal.

The second pillar at this level is the **undefined-behavior contract**. The as-if rule (from `junior.md`) says the optimizer must preserve observable behavior *of a well-defined program*. The flip side: for programs that exhibit **undefined behavior** — signed overflow, out-of-bounds access, strict-aliasing violations, dereferencing null, data races — the standard imposes *no* requirements, so the optimizer is free to assume **UB never happens** and to optimize on that assumption. This is the source of the optimizer's most powerful inferences *and* its most infamous surprises: the deleted null check, the loop that "shouldn't" be infinite that gets removed, the security bug born from `-O2`. A senior engineer must understand both the latitude and the liability.

In one sentence: **a real optimizer is a carefully ordered pipeline of SSA passes whose power comes from inlining and undefined-behavior assumptions, and whose correctness is a constant engineering battle (miscompiles, translation validation, UB exploitation).**

> 🎓 **Why this matters for a senior engineer:** You own the build flags and the performance of hot code that compiles to surprising assembly. You'll debug a release-only crash that's actually UB the optimizer weaponized. You'll decide whether to ship `-O3`, enable LTO/PGO, or add `-fno-strict-aliasing` to make a legacy codebase safe. You need to reason about the pipeline as a system, not memorize pass names.

This page covers: the optimization catalog organized by scope (peephole/local, global SSA, loop, interprocedural); loop transforms and auto-vectorization; register allocation, escape analysis, devirtualization, and bounds-check elimination as optimizations; the phase-ordering problem and the `-O` level pipelines; LTO and PGO in outline; and the undefined-behavior controversy with concrete weaponization examples. JIT-specific speculative optimization is referenced and lives fully in runtime-systems.

---

## Prerequisites

- **Required:** `middle.md` — dataflow analysis, the lattice/fixpoint framework, SSA form, phi nodes, SCCP/GVN.
- **Required:** Comfort reading x86-64 or AArch64 assembly at a basic level (recognizing loads, stores, branches, SIMD ops).
- **Required:** A working model of caches (i-cache vs d-cache), branch prediction, and out-of-order execution — optimization payoffs are about *hardware* behavior.
- **Helpful but not required:** Having read disassembly on godbolt and compared `-O2` vs `-O3` on real code.
- **Helpful but not required:** Exposure to the C/C++ memory model and the list of undefined behaviors in the standard.

You do **not** need to know:

- JIT/deoptimization internals — referenced here, owned by runtime-systems.
- Whole build-system integration of LTO/PGO at scale — that's `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Pass** | One transformation or analysis run over the IR. The pipeline is an ordered list of passes. |
| **Phase-ordering problem** | The fact that passes enable/disable each other and no provably optimal order exists. |
| **Peephole optimization** | Pattern-matching small instruction windows and rewriting them (e.g. `mov`+`add` → `lea`). |
| **LICM** | Loop-invariant code motion — hoisting loop-invariant computations out of the loop. |
| **Induction variable** | A variable that changes by a constant amount each loop iteration (e.g. the loop counter). |
| **IV strength reduction** | Replacing a multiply on an induction variable with an addition each iteration. |
| **Loop unrolling / fusion / fission / interchange** | Body duplication / merging adjacent loops / splitting one loop / swapping nesting order. |
| **Vectorization (SIMD)** | Transforming scalar loop iterations into operations on vectors (process N elements per instruction). |
| **Software pipelining** | Overlapping iterations of a loop to keep the CPU's execution units busy. |
| **Register allocation** | Mapping unbounded virtual registers to a finite physical register set (graph coloring, linear scan). |
| **Escape analysis** | Proving an allocation does not "escape" its function, enabling stack allocation / scalar replacement. |
| **Scalar replacement of aggregates (SROA)** | Splitting a struct into individual scalars that can live in registers. |
| **Devirtualization** | Replacing a virtual/indirect call with a direct call when the target can be proven. |
| **Bounds-check elimination** | Removing array-bounds checks the compiler proves can never fail. |
| **Tail-call optimization (TCO)** | Reusing the caller's stack frame for a call in tail position, turning recursion into iteration. |
| **Undefined behavior (UB)** | Constructs the standard places no requirements on; the optimizer may assume they never occur. |
| **Strict aliasing** | The rule that pointers of incompatible types don't alias, which the optimizer exploits. |
| **LTO** | Link-time optimization — optimizing across translation-unit (and library) boundaries at link time. |
| **PGO** | Profile-guided optimization — using runtime profiles to guide inlining, layout, and branch hints. |
| **Translation validation** | Proving an individual compilation's output is equivalent to its input (e.g. Alive2 for LLVM). |

---

## Core Concepts

### 1. The Catalog, Organized by Scope

It helps to file optimizations by the *scope* of program they examine.

**Peephole / local (within a basic block).** Pattern-match short instruction sequences and rewrite to cheaper equivalents: `mov`+`add` → `lea`, redundant `mov` elimination, `cmp 0` → `test`, multiply-by-power-of-two → shift. Cheap, run repeatedly (LLVM's `instcombine`, GCC's combine pass).

**Global / SSA (within a function).** The dataflow/SSA optimizations: **SCCP**, **GVN/CSE**, copy/constant propagation, aggressive **DCE**, **LICM**, **jump threading**, **tail duplication**. These dominate intra-procedural performance.

**Loop (within loop nests).** LICM, induction-variable simplification and strength reduction, **unrolling**, **fusion/fission**, **interchange**, **vectorization**, **software pipelining** (covered below).

**Interprocedural (across functions).** **Inlining** (the keystone), **devirtualization**, interprocedural constant propagation, **escape analysis**, dead-function/argument elimination, and — at link time — whole-program versions of all of these via **LTO**.

The keystone across scopes is still **inlining**: it converts an interprocedural problem into an intraprocedural one, after which every global and loop optimization can fire. Most of a modern compiler's wins trace back to "inline, then optimize the merged body."

### 2. Loop Optimizations in Depth

Loops are where time is spent, so they get the richest transforms.

**LICM** hoists invariant computations out (from `middle.md`). **Induction-variable strength reduction** turns `i*stride` (a multiply each iteration) into a running pointer incremented by `stride` — converting multiplies to adds. **Induction-variable simplification** canonicalizes and eliminates redundant induction variables.

**Loop unrolling** duplicates the body K times, cutting loop-overhead branches by K and exposing instruction-level parallelism — at the cost of i-cache pressure. **Loop fusion** merges two adjacent loops over the same range into one (better cache reuse, less loop overhead). **Loop fission** splits one loop into two (to isolate a vectorizable part, or relieve register pressure). **Loop interchange** swaps the nesting order of nested loops so the innermost stride matches memory layout — turning a cache-hostile column traversal into a cache-friendly row traversal, often a multiple-x win.

**Vectorization (auto-SIMD)** is the highest-leverage loop transform. The compiler proves successive iterations are independent (no loop-carried dependency, no aliasing) and rewrites the loop to process 4/8/16 elements per instruction using SIMD registers (SSE/AVX/AVX-512 on x86, NEON/SVE on ARM). The wins are large but the preconditions are strict: no data dependencies across iterations, provable non-aliasing (`restrict` helps enormously), trip counts the compiler can reason about, and no side-effecting calls inside. A single un-provable alias or an `if` with a side effect can silently disable it.

**Software pipelining** overlaps the start of iteration *i+1* with the finish of iteration *i*, scheduling instructions so the CPU's pipeline never stalls waiting for a dependency. It's vectorization's scheduling cousin — heavily used on in-order and VLIW targets.

### 3. Register Allocation as Optimization

After the IR is optimized, it still uses *unbounded virtual registers*. **Register allocation** maps them onto the finite physical register set (16 GP registers on x86-64). This is itself an optimization: values that live in registers are far cheaper than values spilled to the stack. The classic formulation is **graph coloring** — build an interference graph (two values that are simultaneously live interfere and can't share a register), then color it with K colors (K = physical registers); uncolorable nodes are **spilled** to memory. **Linear-scan** allocation is a faster, lower-quality alternative used in JITs where compile time matters. (Register allocation belongs to code generation; the cross-link is that allocation quality directly determines whether all the upstream optimization survives to fast machine code — spilling a hot value can erase the benefit of every preceding pass.)

### 4. Escape Analysis, Devirtualization, Bounds-Check Elimination, TCO

**Escape analysis** proves an allocated object does not "escape" the function (no reference to it is stored anywhere outlasting the call, returned, or passed to an opaque callee). If it doesn't escape, the compiler can **stack-allocate** it (no GC/heap pressure) or, via **scalar replacement of aggregates**, split it into individual registers and skip allocation entirely. This is central in Go (heap-vs-stack decided by escape analysis), Java/HotSpot (scalar replacement of non-escaping objects), and C++ (RVO-adjacent reasoning).

**Devirtualization** replaces a virtual or indirect call with a direct call (then often inlines it) when the dynamic type is provable — from `final`, from a single loaded implementation, or from class-hierarchy analysis. JITs do **speculative devirtualization** (assume the monomorphic type seen so far, guard it, deoptimize if wrong — a runtime-systems topic). Direct calls are faster *and* inlinable; virtual calls are neither, so devirtualization is a big enabling win in OO code.

**Bounds-check elimination** removes array-bounds checks the compiler proves can't fail — e.g. inside `for (i = 0; i < a.len; i++) a[i]`, the index is provably in range, so the per-iteration check is deleted. Critical for the performance of safe languages (Java, Go, Rust, C#); the optimizer recovers most of the cost of memory safety.

**Tail-call optimization** reuses the caller's stack frame when a call is the last action before returning, turning tail recursion into a loop (constant stack space). Mandatory in functional languages (Scheme guarantees it); opportunistic in C/C++ (`-O2` often does it); explicit in some (`[[clang::musttail]]`).

### 5. The Phase-Ordering Problem and the `-O` Pipelines

Passes enable and disable each other, so **the order matters and no optimal order exists** — phase ordering is provably hard (the search space is enormous and pass interactions are non-monotone). Compilers respond with a **fixed, hand-tuned pipeline**, and they *iterate* some clusters (run inlining → simplification → inlining again) to chase the cascade. LLVM's pipeline, for instance, runs early simplification to make functions inlinable, an inliner inside a "CGSCC" pass manager that re-simplifies after inlining, then loop and vectorization passes late.

The `-O` levels are *presets* of this pipeline:

- **`-O0`** — essentially no passes; fast compile, faithful debugging.
- **`-O1`** — a conservative subset; quick wins, low code growth.
- **`-O2`** — the full standard pipeline minus the most code-bloating transforms; the production default.
- **`-O3`** — `-O2` plus aggressive inlining, unrolling, and vectorization. **Not reliably faster** — the extra code can blow the i-cache, hurt branch prediction, and increase memory traffic. Always measure; on many real workloads `-O2` ties or beats `-O3`.
- **`-Os` / `-Oz`** — optimize for size; skip transforms that grow the binary (`-Oz` even more aggressively). Often a *good speed choice* on i-cache-bound code precisely because smaller code fits in cache.

The takeaway: optimization level is a *trade-off knob*, not a "more is better" dial.

### 6. LTO and PGO (Outline)

**Link-time optimization (LTO)** defers optimization to link time, when the linker sees *all* translation units (and with full LTO, all of them at once). This enables **cross-module inlining**, whole-program devirtualization, and interprocedural constant propagation across file boundaries — wins ordinary per-file compilation can't reach. **ThinLTO** is a scalable, parallel variant that summarizes each module and imports only the functions worth inlining, getting most of full-LTO's benefit at a fraction of the link cost.

**Profile-guided optimization (PGO)** compiles twice: an instrumented (or sampled) first build collects a *real* execution profile, and the second build uses it to guide decisions optimizers otherwise guess at — which calls to inline (hot ones), how to lay out basic blocks (hot path falls through, cold code is split out to keep the i-cache hot), and which branches to predict. PGO routinely yields 5–20% on large applications because it replaces static heuristics with measured truth. (Both are detailed in `professional.md` as build-engineering concerns.)

JITs take this further with **speculative, profile-driven, deopt-guarded** optimization: they assume the common case observed at runtime, compile aggressively for it, and bail out (deoptimize) if an assumption breaks — covered fully in runtime-systems.

### 7. The Undefined-Behavior Contract — Latitude and Liability

The as-if rule only constrains the optimizer for **well-defined** executions. When a program has **undefined behavior**, the standard imposes *no* requirements at all, so the optimizer is licensed to **assume UB cannot occur** and optimize accordingly. This is not malice — it's the source of huge wins:

- **Signed-overflow is UB**, so the compiler assumes `i + 1 > i` always holds for `int i` — which lets it prove loops terminate, promote `int` induction variables to wider types, and vectorize. (`-fwrapv` makes signed overflow defined two's-complement, *disabling* these.)
- **Strict aliasing** (pointers of incompatible types don't alias) lets the compiler keep a value in a register across a write through an unrelated pointer type — enabling CSE/LICM it otherwise couldn't prove. (`-fno-strict-aliasing` turns this off.)
- **Dereferencing null is UB**, so if you dereference `p` and *then* check `if (p)`, the compiler concludes `p` can't be null at the check and **deletes the branch** — the value couldn't have been read otherwise.

The liability is that the *same* inferences turn latent bugs into miscompiles and security holes. The infamous pattern: a "harmless" null check deleted because of a prior dereference (a real Linux kernel CVE class), an overflow-based bounds check optimized away (signed overflow UB), an infinite loop deleted because loops without side effects are assumed to terminate. Code that "worked at `-O0`" breaks at `-O2` because `-O0` doesn't run the passes that *act on* the UB assumption.

Two engineering responses: (1) **eliminate UB** — sanitizers (`-fsanitize=undefined,address`), warnings, and discipline; and (2) **constrain the optimizer** when porting UB-laden legacy code — `-fwrapv`, `-fno-strict-aliasing`, `-fno-delete-null-pointer-checks`. And because the optimizer itself can have bugs (**miscompiles**), serious toolchains lean on **translation validation** like **Alive2**, which proves (or refutes) that a specific LLVM transformation preserves semantics — catching optimizer bugs that fuzzing alone misses.

A related foot-gun: **`-ffast-math`** lets the optimizer treat floating-point as associative and assume no NaNs/infinities, enabling vectorized reductions and reassociation — but *changing results*, breaking Kahan summation, `x != x` NaN checks, and anything depending on IEEE semantics. It's UB-adjacent latitude you opt into, and it bites silently.

---

## Real-World Analogies

**The assembly line with reorderable stations (phase ordering).** Imagine a factory where each station improves the product, but some stations only work if a *previous* station already did its job, and a few stations *undo* the prep a later station needs. There's no provably best ordering of stations for every possible product — so you hand-tune one good line, and for a few clusters you send the product around the loop twice. That's the optimization pipeline.

**Vectorization as packing a shipping truck.** Doing one box per trip (scalar) wastes the truck. If the boxes are independent and identical, you load 8 at once (SIMD) and make one trip. But if box 5 must be packed *after* box 4 is sealed (a loop-carried dependency), you can't batch them — and if you can't prove the boxes won't collide (aliasing), you conservatively make single trips.

**Undefined behavior as a contract loophole.** You sign a contract that says "I will never divide by zero." The optimizer, trusting the contract, builds fast machinery that *assumes* the divisor is nonzero — skipping the safety guard. If you *do* divide by zero, you've breached the contract, and the machinery does something arbitrary (maybe deletes your later safety check entirely). The optimizer didn't betray you; you broke the promise it optimized against.

**PGO as paving the cow-paths.** Instead of guessing where people will walk, you watch the actual foot traffic for a week, then pave the busy routes wide and let the rare ones stay dirt. The hot path gets the straight, cache-friendly layout; cold code is shoved aside.

---

## Mental Models

**Model 1: Inlining is the lever; everything else is the load it lifts.** Nearly every interprocedural win is "inline, then re-run the intra-procedural pipeline on the bigger body." When you tune for performance, you're often really tuning *what gets inlined*. LTO and PGO are, in large part, "inline across files / inline the hot calls."

**Model 2: The optimizer optimizes the program you *promised*, not the one you wrote.** Every UB is a promise ("no signed overflow," "these pointers don't alias," "this pointer isn't null here"). The optimizer takes you at your word. Break the promise and the output is *correct for some program*, just not yours. This reframes UB bugs from "compiler did something weird" to "I lied to the compiler."

**Model 3: `-O3` and `-ffast-math` are not "max performance" — they're "different trade-offs."** Higher optimization trades code size, predictability, and (for fast-math) numerical correctness for *potential* speed. The senior move is to *measure the specific workload* and often discover `-O2` or even `-Os` wins.

**Model 4: Correctness of the optimizer is not free either.** Optimizers have miscompile bugs; aggressive UB exploitation expands the blast radius of *your* bugs. Defensive posture: sanitizers in CI, conservative flags on legacy code, and awareness that translation-validation tools (Alive2) exist because "the optimizer is correct" is an assumption, not a fact.

---

## Code Examples

### Loop interchange for cache locality (C)

```c
// Column-major traversal of a row-major array: cache-hostile (stride = N).
for (int j = 0; j < N; j++)
    for (int i = 0; i < N; i++)
        sum += a[i][j];

// After loop interchange: row-major traversal, stride = 1, cache-friendly.
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        sum += a[i][j];
```

The compiler (with the right analysis, or you by hand) swaps the loops so the inner index strides by 1 through contiguous memory. On large `N` this is often a several-fold speedup purely from cache behavior — no fewer arithmetic ops, just better access order.

### Aliasing blocks vectorization; `restrict` unblocks it (C)

```c
void add(float *a, float *b, float *c, int n) {
    for (int i = 0; i < n; i++)
        a[i] = b[i] + c[i];     // can a alias b or c? Compiler must assume yes.
}

void add_r(float *restrict a, float *restrict b, float *restrict c, int n) {
    for (int i = 0; i < n; i++)
        a[i] = b[i] + c[i];     // restrict promises no aliasing → clean vectorization
}
```

Without `restrict`, the compiler emits a runtime alias check plus a scalar fallback (in case `a` overlaps `b`/`c`). With `restrict`, it vectorizes directly. Inspect on godbolt at `-O3 -march=native` — the second function uses AVX (`vaddps`); the first guards itself first.

### Undefined behavior: the deleted null check (C)

```c
int deref(int *p) {
    int x = *p;          // dereference — UB if p is null, so compiler assumes p != null
    if (p == NULL)       // ... therefore this check is provably false ...
        return -1;       // ... and this branch is DELETED.
    return x;
}
```

At `-O2`, the `if (p == NULL)` branch is removed entirely: because `*p` already executed (UB if null), the optimizer concludes `p` cannot be null at the check. If `p` *is* null, you get a crash on the deref with no graceful `-1` — the safety net was optimized away. This exact pattern caused a real Linux kernel privilege-escalation bug. The fix is to check *before* dereferencing (or compile with `-fno-delete-null-pointer-checks` on kernel-style code).

### Signed overflow UB enabling (and `-fwrapv` disabling) a transform (C)

```c
// Compiler assumes signed i never overflows, so (i + 1 > i) is always true,
// the loop provably terminates, and i can be promoted/vectorized.
int sum(int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];   // 'i' as int: overflow is UB
    return s;
}
```

At `-O2`, the compiler may widen `i` to 64-bit and vectorize freely. Compile with `-fwrapv` (signed overflow defined as wraparound) and some of these inferences are *disabled* — slower but UB-safe-by-definition. This is the trade legacy codebases make.

### Escape analysis → stack allocation (Go)

```go
func sum(n int) int {
    p := new(int)   // does *p escape? No — only used locally.
    for i := 0; i < n; i++ { *p += i }
    return *p
}
```

```bash
go build -gcflags='-m' escape.go
# ./escape.go: new(int) does not escape   ← stack-allocated, zero heap/GC pressure
```

Go's escape analysis proves `p` doesn't escape `sum`, so the allocation is placed on the stack — no heap allocation, no garbage to collect. Make `p` escape (return it, store it in a global) and the same line reports "escapes to heap."

### Seeing the pipeline and confirming a transform (LLVM)

```bash
# Print the IR after every pass to find exactly where vectorization fires:
clang -O3 -mllvm -print-after-all -S add.c 2>&1 | grep -A2 'loop-vectorize'

# Ask why a loop did NOT vectorize:
clang -O3 -Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize -c add.c
# -> "loop not vectorized: cannot prove pointers do not alias" etc.
```

The `-Rpass-missed`/`-Rpass-analysis` remarks are the senior engineer's best tool: the compiler *tells you* which precondition it couldn't prove, turning "why didn't it vectorize?" from guesswork into a specific, fixable fact.

---

## Pros & Cons

**Pros**

- **Order-of-magnitude wins are routine.** Inlining + vectorization + good register allocation can make optimized code many times faster than naive `-O0`.
- **Safe languages get their cost back.** Bounds-check elimination, devirtualization, and escape analysis recover most of the overhead of memory safety and dynamic dispatch.
- **Whole-program scope via LTO/PGO.** Cross-module inlining and profile-guided layout reach wins impossible at the single-file level.

**Cons**

- **No optimal pass order.** Phase ordering means every compiler leaves performance on the table for *some* programs and over-optimizes others.
- **UB exploitation is a footgun.** The same assumptions that enable speed weaponize latent bugs into miscompiles and CVEs.
- **`-O3`/`-ffast-math` aren't free wins.** Code bloat, i-cache pressure, and broken FP semantics mean they must be measured and chosen, not defaulted.
- **Optimizers have bugs.** Miscompiles happen; aggressive transforms have a history of correctness issues, which is why translation validation exists.
- **Cost.** Heavy optimization, LTO, and PGO add real build time and pipeline complexity.

---

## Use Cases

- **Tuning a hot kernel.** Read `-Rpass`/`-print-after-all`, fix the precondition (add `restrict`, remove an aliasing store, hoist a side-effecting call) so vectorization/LICM fires, and confirm in the assembly.
- **Debugging a release-only crash.** Suspect UB first. Run `-fsanitize=undefined,address`, build at `-O1` to narrow the pass, and check for deleted-check patterns.
- **Hardening legacy C.** Apply `-fwrapv -fno-strict-aliasing -fno-delete-null-pointer-checks` to neutralize the most dangerous UB exploitation while you fix the root causes.
- **Shipping a perf-sensitive binary.** Evaluate `-O2` vs `-O3` vs `-Os` on the *actual* workload; enable ThinLTO and PGO if the build infrastructure supports it.
- **Choosing FP flags.** Reach for `-ffast-math` (or finer `-ffp-contract`, `-fno-math-errno`) only with numerical tests in place, and never for code that inspects NaN/inf.

---

## Coding Patterns

- **Feed the vectorizer.** Eliminate aliasing the compiler can't disprove (`restrict`, local copies, separate buffers), keep loop bodies branch-light and call-free, and use simple integer induction variables. Then *verify* with vectorization remarks.
- **Inline-enable hot paths.** Keep hot helpers small; mark genuine hot leaf calls for inlining where the language allows; use LTO to inline across translation units. Most perf tuning is inlining tuning.
- **Make types tell the truth so escape analysis/devirtualization fire.** `final`/`sealed` classes and concrete types enable devirtualization; not leaking references enables stack allocation. Don't gratuitously box, capture, or store references.
- **Prefer defined operations on hot paths.** Use unsigned or explicit wider types where overflow is intended; don't *rely* on UB for speed — write code that's both defined *and* lets the optimizer prove what it needs.
- **Treat `-ffast-math` as a per-translation-unit decision, never a global default**, and isolate fast-math code so it can't silently change unrelated FP results.

---

## Best Practices

- **Measure on the real workload; never trust the `-O` number.** Benchmark `-O2`/`-O3`/`-Os` and pick by data. On i-cache-bound services `-Os` frequently wins.
- **Use the compiler's optimization remarks.** `-Rpass`, `-Rpass-missed`, `-Rpass-analysis` (Clang) and `-fopt-info` (GCC) tell you exactly what fired and what didn't, and *why*. This is the difference between guessing and engineering.
- **Run sanitizers in CI, not just locally.** UBSan + ASan catch the bugs the optimizer would otherwise weaponize. A clean sanitizer run is the precondition for trusting `-O2`/`-O3`.
- **Adopt LTO/PGO deliberately, with build infrastructure to support it.** ThinLTO for scalable cross-module inlining; PGO with a representative profile (a stale profile can *hurt*).
- **Don't paper over miscompiles by lowering `-O`.** If `-O2` "breaks" your code, prove whether it's UB (almost always) or a genuine optimizer bug before reaching for `-O0`. Report real miscompiles upstream with a reduced test case (`creduce`).

---

## Edge Cases & Pitfalls

- **The deleted null/overflow check.** Covered above — the single most dangerous UB-exploitation pattern. Always validate *before* the operation that makes the value's validity an assumption.
- **`-O3` slower than `-O2`.** Aggressive inlining/unrolling bloated the binary past the i-cache. Real and common; measure both.
- **Vectorization silently disabled.** One un-provable alias, one side-effecting call, or one loop-carried dependency turns a vectorized loop back into a scalar one with *no error* — only a missed-optimization remark. Check the remarks; don't assume.
- **`-ffast-math` breaking summation/NaN logic.** Reassociation changes results; `x != x` (a NaN test) folds to `false`. Devastating in numerical code and easy to enable accidentally via a build preset.
- **Register pressure erasing upstream wins.** Excessive inlining or unrolling can spill hot values to the stack, and the spill cost can exceed the benefit of every prior optimization. More inlining is not monotonically better.
- **PGO with a stale or unrepresentative profile.** The optimizer trusts the profile; if it's from a different workload, it lays out *cold* code as hot and *pessimizes* the real path. Refresh profiles with releases.
- **LTO exposing latent ODR/UB bugs.** Cross-module inlining can surface one-definition-rule violations and UB that per-file builds hid — a "LTO broke my build" that's really "LTO revealed my bug."
- **Tail-call optimization that *doesn't* happen.** C/C++ TCO is opportunistic — a destructor, a `volatile`, or a non-tail position quietly prevents it, and deep recursion overflows the stack. Use `[[clang::musttail]]` (or restructure) when you *need* the guarantee.

---

## Summary

A production optimizer is a **pipeline of SSA-based passes** filed by scope: **peephole/local**, **global** (SCCP, GVN, DCE, LICM, jump threading), **loop** (IV strength reduction, unrolling, fusion/fission, interchange, **vectorization**, software pipelining), and **interprocedural** (inlining, devirtualization, escape analysis, IPCP). **Inlining is the keystone** — it converts interprocedural problems into intraprocedural ones and unlocks the cascade. **Register allocation**, **escape analysis** (→ stack allocation / SROA), **devirtualization**, and **bounds-check elimination** are themselves optimizations that recover the cost of abstraction and safety.

The pipeline's central difficulty is **phase ordering**: passes enable and disable each other, no optimal order exists, so compilers use a hand-tuned, partly-iterated pipeline exposed as the `-O` presets — and **`-O3` is not reliably faster than `-O2`** (code bloat, i-cache). **LTO** widens optimization to whole-program scope; **PGO** replaces static heuristics with measured profiles; JITs push this to speculative, deopt-guarded optimization (runtime-systems).

The deepest senior concept is the **undefined-behavior contract**: the as-if rule only binds the optimizer for well-defined executions, so it is licensed to **assume UB never happens** — the source of major wins (signed-overflow loop reasoning, strict aliasing) *and* of its most dangerous surprises (the deleted null check, the removed bounds test, the `-O2`-only CVE). The engineering response is sanitizers and discipline to *eliminate* UB, conservative flags (`-fwrapv`, `-fno-strict-aliasing`) to *constrain* it on legacy code, and **translation validation** (Alive2) because optimizers themselves can miscompile. `-ffast-math` is the same bargain for floating point: real speed, changed semantics.

The next tier (`professional.md`) takes this to **production build engineering**: rolling out LTO/PGO at scale, optimization-driven build/CI design, BOLT-style post-link optimization, governing FP and UB flags across a large codebase, and the organizational discipline that keeps an aggressively optimized build correct.
