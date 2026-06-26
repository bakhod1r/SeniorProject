# Optimization — Interview Questions

> **Topic:** [Optimization](README.md)

---

## Introduction

These questions probe whether a candidate understands compiler optimization as a *discipline*, not a list of buzzwords. The strongest answers tie every transformation back to the two foundations — the **as-if rule** (optimize freely, preserve observable behavior) and **dataflow analysis** (prove the transformation's precondition) — and treat **undefined behavior** as a contract the optimizer enforces rather than a mystery. Weak answers recite "the compiler makes it faster" without explaining *what it's allowed to change*, *how it knows the change is safe*, or *why `-O3` sometimes loses*.

The set is grouped into Conceptual / Foundational, Tool-Specific (LLVM passes, `-O` levels, GCC, JIT, PGO/LTO), Tricky / Trap (where the textbook answer is wrong), and System / Design scenarios. Read the question, answer out loud, then check yourself against the model answer.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [System / Design Scenarios](#system--design-scenarios)

---

## Conceptual / Foundational

## Question 1

**What is the "as-if" rule, and what counts as observable behavior?**

The as-if rule is the legal license for all optimization: a compiler may transform a program in any way it likes, as long as the optimized program behaves *as if* the original source had executed exactly as written. The constraint is **observable behavior**, which in C/C++ is precisely: accesses to `volatile` objects, data written to files/streams (I/O), and the program's termination behavior. Everything else — the order of internal arithmetic, whether a temporary or even a whole function call physically exists, how many instructions run, which registers are used — is *not* observable and is fair game to change, delete, duplicate, or reorder. The disciplined framing: the optimizer must preserve the program's *interactions with the outside world*, nothing more. This is why `int x = 2+3; printf("%d", x*4);` can compile to `printf("%d", 20)` — the only observable thing (the printed value) is identical.

## Question 2

**What is dataflow analysis and why is it the foundation of optimization?**

Dataflow analysis computes, for every program point, a conservative summary of facts that hold there (which definitions reach this point, which variables are live, which expressions are already available), by modeling the program as a control-flow graph, attaching a fact set to each node, and iterating a transfer function plus a meet operator to a fixpoint. It's foundational because optimizations are *theorems* and dataflow is the *proof system*: to delete a store you must prove the value is never read (live-variable analysis), to hoist a computation you must prove its inputs don't change (loop-invariant analysis), to propagate a constant you must prove only that constant reaches the use (reaching definitions). Without the proof, the transformation could change behavior. The framework is unified: forward/backward direction × may/must combination covers the four canonical analyses, and lattice theory (monotone functions on a finite-height lattice) guarantees the iteration terminates.

## Question 3

**Name and explain the four canonical dataflow analyses along the forward/backward and may/must axes.**

**Reaching definitions** (forward, may): which assignments could be the source of a variable's value here — enables constant/copy propagation. **Live variables** (backward, may): which variables may be read later before being overwritten — enables dead-store elimination and drives register allocation. **Available expressions** (forward, must, intersection at merges): which expressions are already computed on *every* path here with operands unchanged — enables common subexpression elimination. **Very-busy / anticipated expressions** (backward, must): expressions that *will* be computed on every forward path — enables code hoisting. The 2×2 grid (direction × may/must) is the whole conceptual map; "may" uses union at merges (a fact holds on *some* path), "must" uses intersection (on *all* paths).

## Question 4

**What is SSA form and why do modern optimizers use it?**

SSA (Static Single Assignment) is an IR where every variable is assigned exactly once; each use therefore refers to a single, syntactically-evident definition. At control-flow merges, a **phi node** (φ) reconciles the multiple incoming definitions ("x3 = φ(x1, x2)" picks based on which edge was taken), with phi placement computed from dominance frontiers. The payoff: use-def chains become explicit and trivial, so global analyses that were expensive in normal IR become near-local. Constant propagation, value numbering, and dead-code elimination collapse to walking use-def edges. This is why SSA underpins LLVM, GCC's GIMPLE, V8's Turbofan, and the JVM's C2 — optimizations like SCCP (sparse conditional constant propagation) and GVN (global value numbering) are cheap and powerful only because of SSA's single-definition guarantee.

## Question 5

**Why is inlining called the most important *enabling* optimization?**

Inlining's direct benefit (avoiding call overhead) is minor; its real value is removing the *function boundary* that blocks every other optimization. An opaque call is an analysis barrier — the compiler must assume it reads and writes all reachable memory, killing available-expression and reaching-definition facts. Inline the body and constants flow across the old boundary, dead branches collapse, common subexpressions merge, and the merged code gets the full intra-procedural pipeline. Optimizations cascade: `square(5)` inlines to `5*5`, folds to `25`. Most interprocedural performance work is, at bottom, "inline the right calls, then re-optimize." The cost is code duplication (binary size, i-cache pressure), so compilers use heuristics (small functions, hot call sites) — and PGO/LTO are largely about making *better* inlining decisions.

## Question 6

**Explain strength reduction with examples.**

Strength reduction replaces an expensive operation with a cheaper equivalent. The classic scalar cases: `x * 2` → `x << 1`, `x * 8` → `x << 3`, unsigned `x / 4` → `x >> 2`, and `x * 5` → `(x << 2) + x` (a shift plus an add, faster than a general multiply on many CPUs). The most valuable form is **induction-variable strength reduction** inside loops: an address like `base + i*stride` computed each iteration becomes a running pointer incremented by `stride` — converting a per-iteration multiply into a per-iteration add. The interview point: you should write the clear source (`x * 5`, `a[i]`) and let the compiler do this; hand-written shifts are harder to read and can be *wrong* for signed division.

## Question 7

**What is the phase-ordering problem?**

Optimization passes enable and disable each other — inlining exposes constants for propagation, propagation makes branches dead for DCE, DCE shrinks loops for vectorization — but some passes also *undo* prep a later pass needs, and the interactions are non-monotone. There is no provably optimal order to run passes in for all programs (the search space is enormous and pass effects depend on each other). Compilers respond with a **fixed, hand-tuned pipeline** and *iterate* some clusters (inline → simplify → inline again) to chase the cascade. The consequence: every compiler leaves performance on the table for *some* programs and over-optimizes others, and the `-O` levels are just curated presets of this pipeline. There's no silver bullet — pass order is a heuristic art.

## Question 8

**How is undefined behavior connected to optimization?**

The as-if rule only binds the optimizer for *well-defined* executions. For programs that exhibit undefined behavior — signed overflow, out-of-bounds access, strict-aliasing violations, null dereference, data races — the standard imposes *no* requirements, so the optimizer is licensed to **assume UB never happens** and optimize on that assumption. This is the source of major wins (signed-overflow-is-UB lets the compiler assume loops terminate and vectorize; strict aliasing lets it keep values in registers across writes) *and* its most dangerous surprises (a null check deleted because a prior dereference "proves" the pointer is non-null; a bounds check removed via overflow reasoning). The key reframe: UB bugs aren't the compiler "doing something weird" — they're the compiler optimizing the program you *promised* (no UB), which differs from the one you wrote.

## Question 9

**What is escape analysis and what does it enable?**

Escape analysis proves whether an allocated object "escapes" its function — i.e., whether any reference to it outlives the call (returned, stored in a global/heap structure, or passed to an opaque callee). If it provably *doesn't* escape, the compiler can **stack-allocate** it (no heap/GC pressure) or, via scalar replacement of aggregates, split it into individual registers and skip allocation entirely. It's central to Go (heap-vs-stack is decided this way — `go build -gcflags=-m` reports it), HotSpot Java (scalar replacement of non-escaping objects), and C++ reasoning. It's a big win because it removes allocation cost from clean, allocation-heavy code.

## Question 10

**Why does memory safety not have to be slow — what optimization recovers the cost?**

**Bounds-check elimination.** Safe languages (Java, Go, Rust, C#) insert array-bounds checks; the optimizer proves which can never fail and deletes them. In `for (i = 0; i < a.len; i++) a[i]`, the index is provably in range every iteration, so the per-access check is removed — recovering most of the cost. Similarly, **devirtualization** removes the cost of dynamic dispatch by proving the target type (from `final`, single implementation, or class-hierarchy analysis) and replacing the indirect call with a direct (and then inlinable) one. Together with escape analysis, these are why high-level safe code can approach C performance: the optimizer recovers the abstraction tax.

---

## Tool-Specific

## Question 11

**What do `-O0`, `-O1`, `-O2`, `-O3`, `-Os`, and `-Oz` mean, and is `-O3` always fastest?**

`-O0` runs essentially no optimization (fast compile, faithful debugging). `-O1` is a conservative subset. `-O2` is the full standard pipeline minus the most code-bloating transforms — the production default. `-O3` adds aggressive inlining, unrolling, and vectorization. `-Os` optimizes for size (like `-O2` but skips size-growing transforms); `-Oz` (Clang) optimizes for size even harder. **`-O3` is not always fastest:** its extra inlining and unrolling can bloat code past the instruction cache, raising i-cache and iTLB misses and *slowing the program down*. On i-cache-bound services `-O2` or even `-Os` frequently wins. The correct posture is to *measure the actual workload*, not assume the higher number is better.

## Question 12

**Walk through the LLVM optimization pipeline and name key passes.**

LLVM's pipeline (the "new pass manager") roughly: front-end emits unoptimized IR; **mem2reg/SROA** promotes stack slots to SSA registers and builds phi nodes; early simplification (**instcombine** peephole, **simplifycfg**, **SCCP**, **GVN/EarlyCSE**) makes functions clean and inlinable; an **inliner** runs inside a CGSCC (call-graph SCC) pass manager that *re-simplifies after inlining* to chase the cascade; then loop passes (**LICM**, **loop-rotate**, **indvars**, **loop-unroll**, **loop-vectorize**, **slp-vectorize**) run late once the body is simplified; finally lowering and codegen (instruction selection, register allocation, scheduling). You can inspect it with `opt -print-after-all` or `clang -mllvm -print-after-all`, and probe missed optimizations with `-Rpass-missed=loop-vectorize` and `-Rpass-analysis`.

## Question 13

**How do you find out *why* a loop didn't vectorize?**

Use the compiler's optimization remarks. In Clang: `-Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize` makes the compiler emit messages like "loop not vectorized: cannot prove pointers do not alias" or "loop not vectorized: value that could not be identified as reduction is used outside the loop." In GCC: `-fopt-info-vec-missed`. These remarks turn "why didn't it vectorize?" from guesswork into a specific, fixable fact — usually an un-provable alias (fix with `restrict`), a loop-carried dependency, a side-effecting call inside the loop, or a trip count the compiler can't reason about. Reading remarks is *the* senior debugging skill for optimization.

## Question 14

**What is LTO, and what's the difference between full LTO and ThinLTO?**

Link-time optimization defers optimization to link time when the linker sees all translation units, enabling cross-module inlining, whole-program devirtualization, and interprocedural constant propagation across file boundaries — wins per-file compilation can't reach. **Full (monolithic) LTO** merges all modules into one IR module and optimizes it together: maximal scope but serial, memory-hungry, no incrementality — doesn't scale to large binaries. **ThinLTO** has each module emit a compact summary; a fast serial thin-link phase decides cross-module function imports; then modules are optimized *in parallel* and cached per-module. ThinLTO gets ~80–95% of full-LTO's benefit at a fraction of the link cost, with incremental rebuilds and distributed caching intact — the standard choice at scale.

## Question 15

**What is PGO, and what's the difference between instrumented and sampled (AutoFDO) PGO?**

Profile-guided optimization compiles twice: a first build collects a real execution profile, and the second build uses it to guide decisions optimizers otherwise *guess* — which calls to inline (the hot ones), how to lay out basic blocks (hot path falls through, cold code split out to keep the i-cache hot), and which branches to predict. **Instrumented PGO** inserts counters (`-fprofile-generate`), runs a representative training workload, and merges an exact profile (`llvm-profdata merge`) consumed by `-fprofile-use`. **Sampled PGO / AutoFDO** (`-fprofile-sample-use`) harvests profiles from *production* via hardware sampling (`perf` with LBR), needing no instrumented binary — production *is* the training set and profiles refresh naturally. PGO commonly yields 5–20% on large applications; the operational risk is **profile staleness**, which can *regress* performance.

## Question 16

**What does GCC's `-fwrapv` do and when would you use it?**

`-fwrapv` makes signed integer overflow *defined* as two's-complement wraparound, instead of undefined behavior. By default, signed overflow is UB, which the optimizer exploits — it assumes `i + 1 > i` always holds, letting it prove loops terminate, widen induction variables, and vectorize. `-fwrapv` *disables* those inferences: code becomes UB-safe with respect to signed overflow but potentially slower (some loop optimizations no longer fire). You'd use it when porting legacy code that *relies* on wraparound behavior, or in security-sensitive contexts where you'd rather forgo the optimization than risk UB-driven miscompiles. It's one of a family of "constrain the optimizer" flags alongside `-fno-strict-aliasing` and `-fno-delete-null-pointer-checks`.

## Question 17

**What kinds of optimization can a JIT do that an ahead-of-time compiler cannot?**

A JIT optimizes with *runtime information* an AOT compiler can only guess at: it can do **speculative** optimizations guarded by checks and undone by **deoptimization** if the assumption breaks. Examples: speculative **devirtualization/inlining** of a polymorphic call site that has been monomorphic so far (assume the one type seen, guard it, deopt if a new type appears); type specialization in dynamic languages (assume `x` is always an integer); branch and value speculation from observed profiles; and on-stack replacement to optimize a long-running loop mid-execution. The safety net is deopt: if a guard fails, the JIT bails to the interpreter or a less-optimized version. AOT can't do this — it must be correct for *all* inputs — which is why PGO exists (it gives AOT a *static* approximation of the profile a JIT gets for free). (JIT/deopt internals belong to runtime systems.)

## Question 18

**What is `-ffast-math` and why is it dangerous?**

`-ffast-math` relaxes IEEE-754 floating-point semantics so the optimizer can reassociate FP arithmetic (treat it as associative, which it isn't), assume no NaNs or infinities, ignore signed zeros, and contract `a*b+c` into a fused multiply-add. This enables vectorized reductions and reassociation for real speed — but it **changes results**. It breaks Kahan summation (the compensation term gets optimized away), folds `x != x` NaN checks to `false`, and silently alters any code depending on exact FP behavior. It's dangerous because it's easy to enable globally via a build preset, and the corruption is silent — no crash, just wrong numbers. Best practice: keep it off fleet-wide, and isolate any use to specific, numerically-tested translation units (or use the granular `-ffp-contract`, `-fno-math-errno` instead).

## Question 19

**What is BOLT / post-link optimization, and why is it needed *after* LTO and PGO?**

BOLT (Binary Optimization and Layout Tool) takes an already-linked binary plus a `perf` profile and *rewrites* its code layout: it reorders basic blocks so hot paths fall through, splits cold code (error handling) out of hot functions, and clusters hot functions together. It's needed *after* LTO/PGO because code-layout decisions in the compiler are made before *final addresses* exist — only at the linked-binary level can layout be optimized for the real i-cache, iTLB, and branch predictor. On large server binaries it commonly adds 5–15% on top of PGO, dominated by instruction-cache and iTLB miss reduction. Propeller achieves similar via relinking with basic-block labels. The trade is another pipeline stage, another profile to manage, and a binary-rewrite step that must be reproducible.

---

## Tricky / Trap Questions

## Question 20

**You dereference a pointer and then check it for null, and at `-O2` the null check disappeared. Bug in the compiler?**

No — it's UB exploitation, and the compiler is correct under the standard. Dereferencing a null pointer is undefined behavior, so once `*p` executes, the optimizer is entitled to assume `p` is non-null *from that point on* — which makes the subsequent `if (p == NULL)` provably false, so the branch is dead code and gets deleted. If `p` actually is null you crash on the deref with no graceful path, because the safety net was optimized away. This exact pattern caused a real Linux kernel privilege-escalation bug. The fix is to check *before* dereferencing; the workaround for kernel-style code is `-fno-delete-null-pointer-checks`. The trap is blaming the compiler — the program had UB, and the optimizer optimized the well-defined program you implicitly promised.

## Question 21

**"My code works at `-O0` but crashes at `-O2`." Where's the bug?**

Almost always in *your* code, not the compiler — it's undefined behavior the `-O0` build happened to tolerate because `-O0` doesn't run the passes that *act on* the UB assumption. At `-O2` the optimizer exploits the UB (deletes a "dead" check, reorders based on a no-aliasing assumption, widens an overflowing counter) and the latent bug becomes a crash. The correct response is to find the UB with `-fsanitize=undefined,address`, *not* to ship at `-O0` (which hides the bug and forfeits performance). Only after sanitizers come up clean should you suspect an actual optimizer miscompile — and then you'd bisect (`opt-bisect`, `-print-after-all`), minimize with `creduce`, and report upstream. Genuine miscompiles exist but are far rarer than UB.

## Question 22

**Is `-O3` always faster than `-O2`? Justify with mechanism.**

No. `-O3`'s extra aggressive inlining and loop unrolling *grow the code*. When the working set of hot instructions exceeds the instruction cache (typically 32KB L1i), you get i-cache and iTLB misses that stall the pipeline — and the program runs *slower* than the more compact `-O2` build, despite doing "more optimization." The mechanism is the memory hierarchy: optimization that trades code size for fewer instructions only wins if the bigger code still fits in cache. On i-cache-bound workloads (large servers with cold-ish code), `-O2` or even `-Os` regularly beats `-O3`. The disciplined answer is always "measure the real workload" — never assume the higher `-O` number wins.

## Question 23

**A microbenchmark shows your hand-written `x << 3` is no faster than `x * 8`. Why bother optimizing at all?**

Because the compiler already turned `x * 8` into a shift (or `lea`) at `-O2` — your hand optimization is redundant. This is the trap of micro-optimizing things the optimizer does for free: you've made the source harder to read for zero gain, and worse, your manual transformation can *block* a better optimization the compiler would have found (e.g. folding the whole expression, or a different addressing-mode trick). The lesson is to write the clear, obvious source and let `-O2` produce the fast machine code — then, for genuinely hot paths, *read the assembly* (godbolt) to confirm and to find what the compiler *couldn't* do (usually an aliasing or side-effect barrier you can remove), rather than guessing.

## Question 24

**Your loop computes the same `c*d` each iteration; you assume LICM hoists it, but it didn't. Why?**

LICM can only hoist what it can *prove* is loop-invariant. If anything in the loop body might change `c` or `d` — for instance a store through a pointer that *might* alias them, or a function call the compiler can't see into (assumed to write all memory) — then `c*d` is *not provably* invariant and the compiler conservatively keeps it inside the loop. The fix is to eliminate the uncertainty: copy `c` and `d` (or `c*d`) into locals the analysis can prove don't alias the loop's writes, or mark pointers `restrict`. This is the general lesson: "the compiler should have optimized this" usually means "the analysis couldn't prove the precondition" — and the precondition is usually aliasing or an opaque side effect.

## Question 25

**Two threads race on a variable, and the optimizer produced impossible-looking behavior. Is that allowed?**

Yes, if the access is a **data race** (concurrent access, at least one a write, with no synchronization), because a data race is undefined behavior in the C/C++ memory model. Under UB the optimizer is free to assume it doesn't happen, and within a single thread it may keep the variable in a register, reorder accesses, or coalesce writes — producing behavior that looks impossible if you (incorrectly) assume the source's memory operations happen verbatim in order. The single-threaded as-if rule preserves *that thread's* observable behavior, not cross-thread visibility of non-synchronized accesses. The fix is to use atomics or locks (which establish happens-before and constrain the optimizer); `volatile` is *not* the answer in C/C++ (it's for hardware/MMIO, not thread synchronization).

## Question 26

**Does `volatile` prevent the optimizer from breaking your multithreaded code in C++?**

No — that's a classic confusion. C/C++ `volatile` means "this access is observable; don't elide, duplicate, or reorder it relative to other volatiles" and exists for memory-mapped I/O, hardware registers, and signal handlers. It provides **no** atomicity, **no** inter-thread happens-before, and **no** protection against data races — two threads racing on a `volatile` still have a data race (UB). For thread synchronization you need `std::atomic` (or locks), which establish the memory-model ordering the optimizer and hardware must respect. (Java's `volatile` is different — it *is* a synchronization primitive with acquire/release semantics — which is part of why the confusion persists.) Using C++ `volatile` for threading is one of the most common legacy bugs.

---

## System / Design Scenarios

## Question 27

**Design the build pipeline for a latency-critical service where a 5% CPU win matters at fleet scale.**

A four-stage optimized build. (1) Per-module `-O2` (measure vs `-O3`/`-Os` — i-cache-bound services often prefer the smaller code). (2) **ThinLTO** for parallel, cacheable cross-module inlining and whole-program devirtualization. (3) **PGO via AutoFDO** — sample profiles from production with `perf`/LBR so production traffic is the training set, with a **freshness SLO** and automated profile refresh tied to the release train. (4) **BOLT** post-link for hot/cold splitting and basic-block layout (build with `--emit-relocs`). Wrap it all in correctness gates: ASan/UBSan/TSan in CI (the precondition for trusting any UB exploitation), differential testing (`-O0` vs optimized on a large corpus), and **reproducible builds including the profile artifact** so you can bisect. Measure and attribute the win *per stage* on the real workload, and drop any stage whose gain doesn't justify its build-time and correctness cost.

## Question 28

**Your org wants to enable `-ffast-math` everywhere for speed. How do you respond?**

Push back on the global default and propose scoped adoption. `-ffast-math` changes results (FP reassociation, NaN/inf assumptions, signed-zero handling, FMA contraction) and the corruption is silent — it breaks Kahan summation, `x != x` NaN tests, and anything depending on IEEE semantics, and a fleet-wide default has caused real correctness incidents. Instead: keep it **off by default fleet-wide**; let teams opt *specific, numerically-tested translation units* into it behind a reviewed override; and prefer the granular flags (`-ffp-contract=fast`, `-fno-math-errno`) that capture most of the safe wins without the dangerous ones. Pair any adoption with numerical regression tests. The governance principle: the safe choice is the default, the dangerous knob is gated by justification and review.

## Question 29

**You're adopting LTO for the first time and the build starts failing. Triage.**

Treat LTO adoption as a **correctness event**, not just a perf change — cross-module inlining surfaces whole-program bugs that per-file builds hid, chiefly one-definition-rule (ODR) violations and UB previously confined to a single translation unit. Triage: (1) confirm it's an *exposed* bug, not an LTO miscompile — run the differential test (`-O2` non-LTO vs LTO) and sanitizers (ASan/UBSan) to classify. (2) For ODR violations, find the inconsistent definitions (different struct layouts, inline functions defined differently across TUs); LTO merges them and exposes the mismatch. (3) Only if sanitizers are clean and the divergence persists do you suspect an LTO bug — then bisect and minimize for an upstream report. The framing for stakeholders: "LTO didn't break the build, it found the bug" — and that's a reason to fix the bug, not to abandon LTO. Gate adoption behind the differential/sanitizer gate so the next bug is caught in CI.

## Question 30

**A new release shipped with PGO and performance regressed instead of improving. What happened and how do you prevent it?**

The most likely cause is a **stale or unrepresentative profile**. PGO trusts the profile to label hot/cold; if the profile came from an old release (or a different workload/region/tenant) and the code changed, the optimizer lays out *cold* code as hot and *pessimizes* the actually-hot path — net regression. Prevention: a **freshness SLO** with automated profile collection from current production and refresh tied to the release train; alerting when profile age exceeds threshold; and for divergent workloads, **merging representative profiles** or running per-class profiles rather than over-fitting one source. Also ensure new code (which has no profile) degrades gracefully to static heuristics rather than being mislabeled. Operationally, PGO and BOLT are not one-time setups — they're maintained profile pipelines, and profile freshness is a first-class production concern.

---
