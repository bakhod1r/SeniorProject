# Reading Codegen (Disassembly & Compiler Output) — Tasks & Exercises

> **Topic:** [Reading Codegen (Disassembly & Compiler Output)](README.md)
> **Focus:** Hands-on exercises that build the practical skill of reading what the compiler (and JIT) produced — verified by *looking*, not guessing.

---

## Introduction

These tasks are meant to be done *with the tools open*. Reading codegen is a muscle: you build it by repeatedly forming a hypothesis ("this should vectorize / inline / fold"), looking at the output, and reconciling the two. Every task has a **self-check** so you know when you've succeeded, a **hint** if you're stuck, and a **sparse solution** for the harder ones (read it only after a real attempt).

The single most important tool is **Compiler Explorer (godbolt.org)** — most tasks can be done entirely in a browser. A few need a local toolchain (`gcc`/`clang`, `objdump`, `perf`) or a runtime (`node`, `java`). Use **Intel syntax** throughout (it's Godbolt's default; pass `-masm=intel` / `objdump -M intel` locally) to avoid the operand-order trap.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

### Task 1: Add two numbers and read it

Write `int add(int a, int b) { return a + b; }`. Compile at `-O2` in Compiler Explorer and read the assembly.

- **Self-check:** You can name which registers hold `a` and `b` (the first two integer arguments), which register holds the return value, and you understand why there's an `lea` instead of an `add`.
- **Hint:** On Linux x86-64, integer args arrive in `rdi`, `rsi`, …; the return value leaves in `rax`/`eax`. `lea` can do `a + b` in one instruction.

### Task 2: -O0 vs -O2 side by side

Take the same `add` function. Open two compiler panes in Godbolt: one with `-O0`, one with `-O2`. Compare.

- **Self-check:** You can explain why `-O0` shuffles values through the stack (`[rbp-4]`, `[rbp-8]`) and has a prologue/epilogue, while `-O2` is two instructions. You understand why you'd never judge performance from `-O0`.
- **Hint:** `-O0` does a literal, debuggable translation with no optimization.

### Task 3: Constant folding

Write `int answer(void) { return 6 * 7; }` at `-O2`. Then change it to take a parameter: `int mul(int x) { return x * 7; }`. Read both.

- **Self-check:** `answer` is a single `mov eax, 42` (the multiply is gone — folded). `mul` actually multiplies (or strength-reduces) because the input is unknown. You understand why putting test values in `main` would fold everything away.

### Task 4: Strength reduction

Write three functions: `times8(x)` → `x * 8`, `times7(x)` → `x * 7`, `div2u(unsigned x)` → `x / 2`. Read each at `-O2`.

- **Self-check:** `times8` uses a shift or scaled `lea` (no `imul`). `times7` may use `lea` tricks (`x*8 - x`) or a real `imul`. `div2u` is a single `shr`. You can articulate "multiply/divide by a power of two becomes a shift."
- **Hint:** `lea eax, [rdi + rdi*8]` computes `x*9`; combinations of `lea`/`shl`/`sub` build other constants cheaply.

### Task 5: Spot the loop shape

Write `int sum_to(int n)` that loops `for (i=0; i<n; i++) total += i;`. Read it at `-O0` (to see the loop) and at `-O2` (it may vanish into a closed-form formula).

- **Self-check:** At `-O0` you can identify the loop's parts: the top label, the `cmp` + conditional jump out, the body, the increment, the `jmp` back. At `-O2` you can recognize that the loop disappeared and the compiler computed `n*(n-1)/2` directly.
- **Hint:** The universal loop shape is `label: cmp; jcc exit; <body>; <increment>; jmp label`.

### Task 6: Signed division surprise

Write `int half(int x) { return x / 2; }` (signed) and `unsigned uhalf(unsigned x) { return x / 2; }`. Read both at `-O2`.

- **Self-check:** `uhalf` is one `shr`. `half` is *several* instructions (extract sign bit, bias, `sar`). You can explain *why*: signed division truncates toward zero, but `sar` rounds toward negative infinity, so a correction is needed for negative inputs. This is a non-optimization with a nameable cause, not a bug.

### Task 7: Find the `call` (inlining detector)

Write `static int sq(int x){return x*x;}` and `int use(int n){return sq(n)+sq(n+1);}`. Read `use` at `-O2`. Then mark `sq` with `__attribute__((noinline))` and read again.

- **Self-check:** Without `noinline`, there is **no** `call sq` — the `imul` appears inline. With `noinline`, you see `call sq`. You've confirmed the `call` instruction is your inlining detector.

---

## Core

### Task 8: Prove vectorization (and that `-march` matters)

Write `void add_arrays(float* a, float* b, float* out, int n){ for(int i=0;i<n;i++) out[i]=a[i]+b[i]; }`. Read it at `-O3`, then at `-O3 -march=x86-64-v3`.

- **Self-check:** With plain `-O3` you may see scalar `addss` or narrow SIMD; with `-march=x86-64-v3` you see `ymm` registers, packed `vaddps`, and the counter advancing by 8. You can explain that vectorization width depends on which instructions the compiler is allowed to assume the CPU has.
- **Hint:** Look for the `s` (scalar) vs `p` (packed) suffix — `addss` is scalar, `addps`/`vaddps` is vectorized.

### Task 9: Diagnose a missed vectorization

Write `void prefix(float* a, int n){ for(int i=1;i<n;i++) a[i]=a[i-1]+a[i]; }`. Read it at `-O3 -march=x86-64-v3`. It will *not* vectorize.

- **Self-check:** You see scalar `addss` in a tight loop, no `ymm`/packed add. You can name the blocker: a loop-carried dependency (`a[i]` depends on `a[i-1]`). Turn on `-fopt-info-vec-missed` (gcc) or `-Rpass-missed=loop-vectorize` (clang) and confirm the compiler's stated reason matches your diagnosis.

### Task 10: The float-reduction blocker and `-ffast-math`

Write a dot product: `float dot(const float* a, const float* b, int n){ float s=0; for(int i=0;i<n;i++) s+=a[i]*b[i]; return s; }`. Read at `-O3 -march=x86-64-v3`, then add `-ffast-math`.

- **Self-check:** Without `-ffast-math` the loop stays scalar (`mulss`/`addss`) because reassociating float adds changes rounding. With `-ffast-math` you see packed `vfmadd231ps` and often multiple `ymm` accumulators. You can explain the correctness trade-off `-ffast-math` makes.
- **Hint:** Floating-point addition is not associative; vectorizing a sum reorders the additions, so the compiler refuses unless you permit it.

### Task 11: Bounds-check elimination in Rust

In Compiler Explorer (Rust, `-O`), write two functions summing a `&[u32]`: one with `for i in 0..v.len() { s += v[i]; }`, one with `v.iter().sum()`. Compare.

- **Self-check:** The indexed version may contain a `cmp`/branch to a `panic_bounds_check` symbol inside the loop; the iterator version has no per-iteration length compare and no panic branch (and is more likely to vectorize). You can explain why "use iterators" is BCE you can *see*, not dogma.
- **Hint:** Search the indexed version's assembly for `panic` / `bounds`.

### Task 12: Bounds-check elimination in Go

Locally: write `func Sum(a []int) int { s:=0; for i:=0;i<len(a);i++ { s+=a[i] }; return s }`. Build with `go build -gcflags='-d=ssa/check_bce/debug=1'` and disassemble with `go tool objdump`.

- **Self-check:** You can find the bounds-check diagnostic output and locate (or confirm the absence of) a `CMPQ` + jump to `runtime.panicIndex` in the disassembly. Rewriting as `for _, x := range a { s += x }` removes the per-iteration check; confirm by re-reading.
- **Hint:** Ranging, or a single `_ = a[len(a)-1]` before the loop, can let the compiler prove the index is in range.

### Task 13: Why didn't it inline?

Write a deliberately large function (e.g. 50 lines of arithmetic) called from a small one. At `-O2`, confirm it did *not* inline (a `call` is present). Then ask the compiler why.

- **Self-check:** You see `call bigfunc`. Running `clang -O2 -Rpass-missed=inline file.cpp` (or `gcc -O2 -fopt-info-inline`) prints a remark like "not inlined because too costly." You can connect the visible `call` to the stated reason.

### Task 14: `perf annotate` finds the real bottleneck

Locally, write a program that sums a large array with poor locality (e.g. stride through a big array, or a pointer-chasing linked list). Build with `-O2 -g`, run `perf record -g ./prog`, then `perf annotate` the hot function.

- **Self-check:** The hot instruction (highest sample %) is a **memory load**, not the arithmetic. You can articulate that the bottleneck is memory/cache, so the fix is about data layout, not doing fewer adds.
- **Hint:** A cache-missing load dominates; confirm with `perf record -e cache-misses`. Beware sample skid — read the surrounding block.

### Task 15: Same source, identical codegen

Find two stylistically different ways to write the same logic (e.g. an explicit index loop vs. `std::accumulate`; a ternary vs. an if/else returning the same value). Compile both at `-O2` and diff the assembly.

- **Self-check:** For at least one pair, the assembly is *identical*, proving the style choice has zero runtime cost. You can state this as a code-review principle: "write the readable version; the compiler emits the same machine code."

---

## Advanced

### Task 16: Defeat the optimized-away benchmark

Using Google Benchmark (or a hand-rolled timing loop in C++), benchmark a pure function whose result you initially leave unused. Read the disassembly of the timed loop.

- **Self-check:** In the naive version, the timed loop body contains *none* of the function's work (it was deleted). After adding `benchmark::DoNotOptimize(result)` (and `DoNotOptimize(input)` to defeat folding), the disassembly shows the actual work inside the loop. You understand the sink is necessary *and* that you must verify in the assembly.
- **Hint:** Sink *both* ends — input to stop constant folding, output to stop dead-code elimination.

<details>
<summary>Sparse solution</summary>

```cpp
static int hot(int x) { return x * x + x; }
static void BM(benchmark::State& s) {
    int in = 42;
    for (auto _ : s) {
        benchmark::DoNotOptimize(in);   // input opaque -> no folding
        int r = hot(in);
        benchmark::DoNotOptimize(r);    // result observed -> not deleted
    }
}
```
Then compile and confirm the loop body contains `imul`/`add`. If it doesn't, your sink was insufficient (e.g. you only sank `r` but passed a constant). The number is only valid once the work is visible in the disassembly.
</details>

### Task 17: Rust `black_box` on both ends

In Compiler Explorer (Rust, `-O`), write a function `fn work(x:u64)->u64 { x.wrapping_mul(0x9E3779B97F4A7C15) }`. Call it three ways: `work(42)`, `work(black_box(42))` (input only), and `black_box(work(black_box(42)))` (both ends). Compare the codegen.

- **Self-check:** `work(42)` folds to a constant `mov`; input-only `black_box` still lets the result be dropped if unused; both-ends shows the actual `mul` surviving. You can explain why you must `black_box` input *and* output.

### Task 18: `-O3` made it slower — prove it

Find or construct a program where `-O3` regresses vs `-O2` (a function with many call sites that `-O3` over-inlines, or a small hot loop `-O3` over-unrolls). Time the whole program both ways, compare `.text` size, and read the hot function.

- **Self-check:** You can show `-O3` is slower (whole-program timing), `.text` is larger (`size`), and the hot function's disassembly is visibly bloated (massive inline/unroll). You can articulate the i-cache/register-pressure mechanism and propose a targeted fix.
- **Hint:** Use `hyperfine` for timing and `size binary` for the text section.

<details>
<summary>Sparse solution sketch</summary>

```bash
clang -O2 app.c -o app_o2;  clang -O3 app.c -o app_o3
hyperfine ./app_o2 ./app_o3      # observe -O3 slower
size app_o2 app_o3               # observe larger .text for -O3
objdump -d -M intel app_o3 | less  # find the bloated hot function
```
Targeted fix: `-O2` plus `[[gnu::hot]]` on the genuinely hot function, or PGO, instead of blanket `-O3`. Document the codegen that justifies the choice.
</details>

### Task 19: `restrict` unlocks vectorization — show it in IR and asm

Write `void axpy(float* x, float* y, float a, int n){ for(int i=0;i<n;i++) y[i]=a*x[i]+y[i]; }` and a `restrict` version. Compare both the LLVM IR (`clang -O2 -emit-llvm -S`) and the assembly (`-O3 -march=x86-64-v3`).

- **Self-check:** The `restrict` version's IR has `noalias` on the `x`/`y` parameters; its assembly shows packed `vfmadd...ps`. The non-`restrict` version lacks `noalias` and either has a runtime overlap check or stays scalar. You've shown aliasing was the blocker — in two layers.
- **Hint:** Godbolt has an "LLVM IR" output pane; search it for `noalias`.

### Task 20: Read an ARM64 loop

In Compiler Explorer, take the array-sum loop and compile with an **ARM64 (AArch64) gcc/clang** at `-O2`. Map every instruction to its x86 equivalent.

- **Self-check:** You can identify the loop label, the array index `ldr w_, [x_, x_, lsl #2]` (= `base + i*4`), the accumulate `add`, the increment, the `cmp` + `b.lt`, and `ret`. You recognize `wzr`/`xzr` as the zero register and that arithmetic only works on registers (load/store architecture).
- **Hint:** `b.lt`/`b.ge` are signed conditional branches; `bl` is a call; there is no `add [mem], reg` on ARM.

### Task 21: Recognize NEON vectorization

Compile the float `add_arrays` loop for ARM64 at `-O3` (with an appropriate `-mcpu`). Find the vectorized inner loop.

- **Self-check:** You can identify NEON: `v0.4s`/`v1.4s` registers, packed `fadd v0.4s, v1.4s, v2.4s` (4 floats per op), `ld1`/`st1` vector loads/stores, and the counter dropping by 4. You can state the analogy to x86 `ymm`/`vaddps` and note NEON is 128-bit (4 floats) vs AVX2's 256-bit (8 floats).

### Task 22: V8 deopt — find the reason

Locally with Node: write `function add(a,b){return a+b;}`, call it a million times with numbers, then once with strings. Run `node --trace-opt --trace-deopt --print-opt-code add.js`.

- **Self-check:** `--trace-deopt` prints a reason such as "not a Smi" / "wrong map" tied to the string call; you can connect it to the specialization `add` made for integers. You can describe the fix (keep `add` monomorphic) and how you'd verify it (re-run the trace; no deopt).
- **Hint:** Wrap the hot calls in a loop to force optimization, then trigger the type change after.

### Task 23: V8 inline-cache state

Locally with Node: create objects with the *same* shape vs. *different* shapes feeding one hot call site. Run `node --trace-ic hot.js` and observe the IC transitions.

- **Self-check:** With consistent shapes the site stays monomorphic (`0->1`); with many shapes it reaches `MEGAMORPHIC`. You can explain that megamorphic kills inlining and is a silent performance cliff, and that keeping object shapes stable preserves it.

---

## Capstone

### Task 24: End-to-end optimization verification report

Pick a real hot kernel from a project you have (or write a realistic one: a matrix-vector multiply, an image convolution, a string scan). Produce a short "codegen verification" report.

- **Self-check:** Your report answers, *with evidence (disassembly/IR snippets)*: (1) does the hot loop vectorize at the shipping flags? (2) is the hot helper inlined? (3) are bounds checks eliminated (if a safe language)? (4) where does `perf annotate` say the time actually goes? (5) for any missed optimization, what is the named blocker and the fix? You distinguish structural claims (settled by codegen) from magnitude claims (settled by a verified-not-optimized-away benchmark).
- **Hint:** Treat it like an experiment log: hypothesis, the exact command/flags, the codegen evidence, the conclusion.

### Task 25: Make a missed optimization happen

Find (or construct) a hot loop in your kernel that *doesn't* vectorize or *isn't* inlined. Diagnose the blocker from the codegen, apply a fix (`restrict`/non-aliasing, hoist an invariant load, force the inline, switch indexing to iteration), and prove the optimization now happens.

- **Self-check:** You have *before* and *after* disassembly showing the change (scalar → packed, `call` → inlined body, panic-branch → eliminated). You can name the blocker and explain why your change removed it. You measured the actual speedup with a benchmark you verified isn't optimized away.

<details>
<summary>Sparse solution pattern</summary>

```cpp
// Before: '*factor' reloaded every iteration (possible aliasing with 'data')
void normalize(std::vector<float>& data, const float* factor) {
    for (size_t i = 0; i < data.size(); ++i) data[i] *= *factor;
}
// After: hoist the invariant load -> compiler can vectorize
void normalize(std::vector<float>& data, const float* factor) {
    const float f = *factor;            // breaks the aliasing doubt
    for (size_t i = 0; i < data.size(); ++i) data[i] *= f;
}
```
Read both: the "after" assembly shows the load hoisted out of the loop and a packed multiply (`vmulps`) where the "before" had a per-iteration scalar load. Then benchmark with a verified sink.
</details>

### Task 26: JIT steady-state, end to end

For a JVM or Node hot method: write a benchmark, confirm it reaches the top compilation tier (`-XX:+PrintCompilation` shows tier 4 / `--trace-opt` shows TurboFan), discard warmup, and read the optimized machine code (`PrintAssembly` via hsdis / `--print-opt-code`). Identify the inlined callees and any deopt guards.

- **Self-check:** You can show the method reached the top tier and stays there (no deopt churn), point to inlined callees in the disassembly, and locate the deopt/uncommon-trap guards. You can explain why a number taken before steady state would have been meaningless, and what would cause this method to deoptimize in production.
- **Hint:** For HotSpot, JITWatch makes `PrintAssembly` navigable; for V8, scope `--print-opt-code` with `--print-opt-code-filter` to your function.

### Task 27: Cross-architecture migration check

Take one hot kernel and produce a side-by-side codegen comparison for x86-64 (AVX2) and ARM64 (NEON). Explain any expected throughput difference.

- **Self-check:** You have both disassemblies, confirm vectorization on each (packed `vaddps`/`ymm` vs `fadd .4s`/`v` registers), and can explain the per-iteration element count on each ISA (e.g. 8 floats AVX2 vs 4 floats NEON). You can predict and justify a throughput delta from the SIMD width and instruction differences — exactly what a real x86→Graviton migration validation needs.

---

## How to Know You're Done

You've internalized this topic when you instinctively respond to "is the compiler optimizing this?" by opening Compiler Explorer instead of guessing; when you can read an unfamiliar loop on x86-64 *or* ARM64 and identify its structure, its array indexing, and whether it's vectorized; when you never trust a microbenchmark without confirming the work survived in the disassembly; and when, faced with a missed optimization, you can name the blocker (aliasing, a hidden call, FP strictness, a megamorphic call site, `volatile`) rather than shrugging. The skill is not memorizing instructions — it's turning performance folklore into evidence by looking.
