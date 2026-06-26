# Optimization — Hands-On Tasks

> **Topic:** [Optimization](README.md)

---

## Introduction

This file takes you from "I know `-O2` makes code faster" to "I can read optimized assembly, prove why a transformation did or didn't fire, weaponize and defuse an undefined-behavior bug, and stage an LTO+PGO+BOLT build." Every task is concrete and runnable. The single most valuable tool throughout is [godbolt.org](https://godbolt.org) (the Compiler Explorer) for watching assembly change, and a local Clang/GCC for the pipeline tasks.

How to use this file: read the task, *predict the answer first*, then run it and compare. The lesson is almost always in the gap between your prediction and the assembly. Use the compiler's own remarks (`-Rpass-missed`, `-fopt-info`) and IR dumps (`-print-after-all`, `-fdump-tree-all`) rather than guessing — the compiler will tell you what it did. Mark a self-check done when you can *explain the mechanism* to someone else, not when the program merely runs. Sample solutions are sparse and appear only where the canonical answer teaches more than your first attempt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild intuition for what the optimizer actually does to your code. Short, but each introduces a transformation or a tool you'll reuse.

### Task 1: Watch constant folding and propagation happen

**Problem.** On godbolt, compile this at `-O0` and then `-O2` (x86-64 gcc or clang) and compare the assembly:

```c
int seconds_per_day(void) {
    int h = 24, m = h * 60, s = m * 60;
    return s;
}
```

**Constraints.** Don't change the source between the two builds. Read both outputs.

**Hints (try without first).**
- At `-O0` you'll see the multiplications and stack stores literally emitted.
- At `-O2` the whole function should collapse to loading one constant.
- Compute what that constant should be by hand.

**Self-check.**
- [ ] You can state the single constant the `-O2` version returns and why.
- [ ] You can explain why `-O0` kept the variables and `-O2` deleted them (as-if rule).
- [ ] You can name the two optimizations involved (constant propagation, constant folding).

---

### Task 2: Spot strength reduction

**Problem.** Compile `unsigned f(unsigned x){ return x * 8; }` and `unsigned g(unsigned x){ return x * 5; }` at `-O2`. Look at the assembly for both.

**Constraints.** Use unsigned types (signed changes the story for division — note that).

**Hints (try without first).**
- `x * 8` should become a shift (`shl ..., 3`) or an `lea`.
- `x * 5` should become a shift-and-add, not a `mul`/`imul`.
- Try `x / 4` (unsigned) too — it becomes a shift. Then try signed `int / 4` and see why it's *not* a simple shift.

**Self-check.**
- [ ] You can read the `lea`/`shl` and explain it computes the multiply.
- [ ] You can explain why signed `x / 4` needs extra instructions (rounding toward zero for negatives) and unsigned doesn't.
- [ ] You understand why you should *not* hand-write `x << 3` in source.

---

### Task 3: See dead code elimination delete a branch

**Problem.** Compile and inspect at `-O2`:

```c
int g(int x) {
    int cube = x * x * x;   // never used
    if (1 == 2) return -1;  // never true
    return x + 1;
}
```

**Hints (try without first).**
- The function body at `-O2` should be a single `lea`/`add` computing `x + 1`.
- The cube is a dead store; the `if` body is unreachable.

**Self-check.**
- [ ] You can confirm both the cube computation and the `if` branch are gone.
- [ ] You can explain "dead store" vs "unreachable code" — two distinct DCE triggers.

---

### Task 4: Inlining unlocks folding

**Problem.** Compile at `-O2`:

```c
static int square(int x) { return x * x; }
int demo(void) { return square(5) + 1; }
```

Then make `square` non-`static` and *not* defined in the same file (declare it `extern`). Recompile. Compare.

**Hints (try without first).**
- The `static` version: `demo` returns the constant `26`, no call, no multiply.
- The `extern` version: `demo` must emit an actual `call` — the compiler can't see the body, so it can't inline or fold.

**Self-check.**
- [ ] You can explain why visibility (same translation unit) controls inlinability.
- [ ] You can connect this to *why LTO exists* (to inline across translation units).

---

## Core

These require reading remarks and IR, and reasoning about *why* an optimization did or didn't fire.

### Task 5: Make a loop vectorize, then explain what broke it

**Problem.** Compile with `clang -O3 -march=native -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -Rpass-analysis=loop-vectorize`:

```c
void add(float *a, float *b, float *c, int n) {
    for (int i = 0; i < n; i++) a[i] = b[i] + c[i];
}
```

Read the remark. Then add `restrict` to all three pointers and recompile. Compare the assembly and the remark.

**Hints (try without first).**
- Without `restrict`, the compiler either emits a runtime alias check plus a scalar fallback, or reports it couldn't prove non-aliasing.
- With `restrict`, you should see SIMD instructions (`vaddps` / `addps`) and a "vectorized loop" remark.

**Self-check.**
- [ ] You can quote the exact missed-optimization remark and translate it ("cannot prove pointers don't alias").
- [ ] You can explain what `restrict` promises and why that promise enables vectorization.
- [ ] You can identify the SIMD instruction and its vector width in the output.

---

### Task 6: Loop interchange and the memory hierarchy

**Problem.** Benchmark these two on a large `N` (e.g. 4096), same array:

```c
// Version A (column-major over row-major storage):
for (int j = 0; j < N; j++) for (int i = 0; i < N; i++) sum += a[i][j];
// Version B (row-major):
for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) sum += a[i][j];
```

Time both at `-O2`. Then check whether `-O3` auto-interchanges A.

**Hints (try without first).**
- B should be dramatically faster — its inner stride is 1 (contiguous), A's is `N` (cache-hostile).
- The arithmetic is identical; the difference is *entirely* cache behavior.
- Use `perf stat -e cache-misses ./prog` to see the miss-rate difference directly.

**Self-check.**
- [ ] You can quantify the speedup and attribute it to cache lines, not instruction count.
- [ ] You can explain why the compiler is *conservative* about auto-interchange (it must prove the reordering is legal and beneficial).

---

### Task 7: Build SSA and watch SCCP fire (LLVM IR)

**Problem.** For this function, emit LLVM IR, build SSA with `mem2reg`, then run `sccp`:

```c
int h(void) {
    int flag = 1;
    int x;
    if (flag) x = 42; else x = some_extern();
    return x;
}
```

```bash
clang -O0 -S -emit-llvm -Xclang -disable-O0-optnone h.c -o h.ll
opt -passes='mem2reg' -S h.ll -o h.ssa.ll      # see the phi node
opt -passes='mem2reg,sccp,dce' -S h.ll -o h.opt.ll
```

**Hints (try without first).**
- In `h.ssa.ll` you should see a `phi` node merging the two branches' values of `x`.
- After SCCP, the function should `ret i32 42` — the `else` edge is unreachable (flag is constant 1), so `some_extern()` is deleted.
- Plain constant propagation *without* reachability wouldn't get this. That's the point of SCCP.

**Self-check.**
- [ ] You can point at the phi node and explain what it selects.
- [ ] You can explain why SCCP (constant propagation fused with reachability) beats doing the two separately.

---

### Task 8: Weaponize, then defuse, an undefined-behavior null check

**Problem.** Compile at `-O2` and inspect:

```c
int deref(int *p) {
    int x = *p;
    if (p == NULL) return -1;   // does this survive?
    return x;
}
```

Then recompile with `-fno-delete-null-pointer-checks` and compare.

**Hints (try without first).**
- At plain `-O2`, the `if (p == NULL)` branch is *deleted* — the prior `*p` makes "p is null" provably impossible (UB).
- With `-fno-delete-null-pointer-checks`, the check survives.
- Now fix the *source* properly: check before dereferencing. Confirm the fixed version is both safe and keeps the check.

**Self-check.**
- [ ] You can explain *why* the check is deleted in terms of UB and the as-if rule.
- [ ] You can name a real-world consequence (the Linux kernel null-deref CVE class).
- [ ] You can state the correct fix (check before deref) vs the workaround (the flag).

**Solution sketch.** The compiler reasons: `*p` is UB if `p == NULL`; the standard says UB cannot occur in a correct program; therefore at the `if`, `p != NULL` is a proven fact; therefore `p == NULL` is constant-`false`; therefore the branch is dead and DCE removes it. The *correct* program is `if (p == NULL) return -1; int x = *p; return x;` — the validity check precedes the operation whose validity it guards. `-fno-delete-null-pointer-checks` only patches the symptom; the real bug is dereferencing before validating.

---

### Task 9: Signed-overflow UB and `-fwrapv`

**Problem.** Compile this at `-O2`, then again with `-fwrapv`, and compare the loop's assembly:

```c
int sum(int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
```

**Hints (try without first).**
- At `-O2`, the compiler may widen `i` and/or vectorize, relying on "signed overflow is UB" to assume the loop is well-behaved.
- With `-fwrapv`, signed overflow becomes defined wraparound, and some of those inferences are disabled — observe whether vectorization or induction-variable widening changes.

**Self-check.**
- [ ] You can explain how "signed overflow is UB" helps the optimizer reason about loop trip counts.
- [ ] You can articulate the trade `-fwrapv` makes (UB-safety vs lost optimization).

---

## Advanced

These are multi-step and require local tooling (Clang/LLVM, `perf`).

### Task 10: Escape analysis — heap vs stack (Go)

**Problem.** Write a Go function that allocates with `new`/`&` in two variants: one where the pointer escapes (returned or stored globally) and one where it doesn't. Run `go build -gcflags='-m'` and read the escape decisions.

**Hints (try without first).**
- `go build -gcflags='-m'` prints "does not escape" (stack) or "escapes to heap".
- Returning a pointer to a local forces a heap allocation; using it only locally allows stack allocation.
- Confirm with `go build -gcflags='-m -m'` for the reasoning chain.

**Self-check.**
- [ ] You can predict, before running, which variant escapes and why.
- [ ] You can explain the performance consequence (heap alloc + GC pressure vs free stack allocation).
- [ ] You can connect escape analysis to scalar replacement of aggregates.

---

### Task 11: `-O2` vs `-O3` vs `-Os` on a real workload

**Problem.** Take a non-trivial program (or a benchmark like a JSON parser or a small interpreter). Build it at `-O2`, `-O3`, and `-Os`. Measure wall-clock time *and* binary size. Use `perf stat -e instructions,L1-icache-load-misses,iTLB-load-misses ./prog` for each.

**Hints (try without first).**
- Don't assume `-O3` wins. On i-cache-bound code it often loses to `-O2`/`-Os`.
- Correlate any `-O3` slowdown with higher `L1-icache-load-misses` / `iTLB-load-misses`.
- Binary size should grow `-Os` < `-O2` < `-O3`.

**Self-check.**
- [ ] You have a table of time, size, and i-cache misses for all three levels.
- [ ] You can explain any case where the *more* optimized build is *slower*, mechanistically (code bloat → i-cache pressure).
- [ ] You can state which level you'd ship for *this* program and justify it with data.

---

### Task 12: Prove an LICM failure is an aliasing problem, then fix it

**Problem.** Construct a loop where an obviously-invariant computation is *not* hoisted because of a possible aliasing store, e.g.:

```c
void f(int *a, int *p, int c, int d, int n) {
    for (int i = 0; i < n; i++) { *p = a[i]; a[i] = a[i] + c * d; }
}
```

Inspect at `-O2`: is `c*d` hoisted? Then break the aliasing (copy `c*d` to a local before the loop, or mark pointers `restrict`) and confirm hoisting.

**Hints (try without first).**
- `c` and `d` are plain ints here, so `c*d` *should* hoist — modify so the invariant depends on memory that `*p` might alias, to actually block LICM.
- The general lesson: LICM only hoists what it can *prove* invariant; an aliasing store breaks the proof.
- Use `clang -O2 -Rpass=licm -Rpass-missed=licm` if available, or read the assembly for where the multiply lives.

**Self-check.**
- [ ] You can construct a case where LICM provably fails due to aliasing.
- [ ] You can fix it two ways (local copy, `restrict`) and explain each.

---

### Task 13: Differential testing for UB / miscompiles

**Problem.** Build a small program at `-O0` and at `-O2 -flto`. Feed a corpus of inputs through both and diff the outputs. Introduce a deliberate UB bug (e.g. signed overflow in a bounds calculation, or read of an uninitialized variable) and watch a divergence appear. Then classify it with `-fsanitize=undefined,address`.

**Hints (try without first).**
- A clean program should produce *identical* output at both levels — divergence means UB or (rarely) a miscompile.
- Sanitizers will pinpoint the UB; that's how you distinguish "my bug" from "compiler bug."
- Fuzzing (`libFuzzer`) is how you generate a large corpus cheaply.

**Self-check.**
- [ ] You have a working `-O0` vs optimized differential harness.
- [ ] You can demonstrate a divergence from a deliberate UB and then *classify* it with sanitizers.
- [ ] You can explain why "it differs at `-O2`" is evidence of UB, not proof of a compiler bug.

---

## Capstone

### Task 14: Stage a full LTO + PGO build and attribute the wins

**Problem.** Take a CPU-bound C/C++ program with a representative workload. Build and benchmark it in four configurations, measuring time and `perf` counters at each step:

1. `-O2` baseline.
2. `-O2 -flto=thin`.
3. `-O2 -flto=thin` + instrumented PGO (`-fprofile-generate` → train → `llvm-profdata merge` → `-fprofile-use`).
4. (Optional, if you can build with `--emit-relocs`) the PGO binary post-processed with BOLT.

Produce a table: configuration → wall-clock time → binary size → L1-icache-misses → branch-misses. Attribute the delta of each stage.

**Constraints.**
- Use a *representative* training workload for PGO; note what happens if you train on an unrepresentative one (it can regress).
- Keep the workload identical across measurements; warm caches; run multiple trials.

**Hints (try without first).**
- ThinLTO's win comes from cross-module inlining/devirtualization — expect it on programs split across many files.
- PGO's win shows up as fewer branch misses and better i-cache behavior (hot/cold layout).
- BOLT's additional win is almost entirely i-cache/iTLB miss reduction.
- Deliberately train PGO on a *wrong* workload and watch it regress — that's the freshness lesson made concrete.

**Self-check.**
- [ ] You have a four-row table with time, size, and the relevant `perf` counters.
- [ ] You can attribute each stage's win to a mechanism (cross-module inlining, profile-guided layout, post-link i-cache packing).
- [ ] You can demonstrate (or explain) how a stale/unrepresentative PGO profile *regresses* performance.
- [ ] You can articulate, for a real service, which stages you'd adopt and what the build-time/correctness costs are.

**Solution sketch.** Expect roughly: ThinLTO adds a moderate win on multi-file programs (cross-TU inlining); PGO adds a larger one concentrated in branch-misprediction and i-cache (the hot path now falls through and is densely packed); BOLT adds a further i-cache/iTLB win on top. The attribution discipline matters more than the exact numbers: each stage should show a *distinct* mechanism in the counters, and any stage that doesn't move the fleet number isn't worth its build-time and correctness cost. The wrong-profile experiment is the crucial one — it shows PGO/BOLT are *maintained profile pipelines* with freshness as a production concern, not one-time flags.

---
