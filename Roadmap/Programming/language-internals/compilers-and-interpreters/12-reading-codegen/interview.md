# Reading Codegen (Disassembly & Compiler Output) — Interview Questions

> **Topic:** [Reading Codegen (Disassembly & Compiler Output)](README.md)
> **Focus:** Whether a candidate can open the hood, read what the compiler (or JIT) produced, and use it as *evidence* to verify optimizations and debug performance.

---

## Introduction

These questions probe whether a candidate can read codegen as a practical skill — not whether they have memorized opcodes. The strongest signal is a candidate who, faced with "is this optimization happening?", reaches for evidence (Compiler Explorer, `objdump`, `perf annotate`, a deopt trace) instead of asserting folklore. Such candidates distinguish *what* the assembly does from *what's slow*, name the precise blocker when an optimization is missing (aliasing, a hidden call, FP strictness, a megamorphic call site), and know the traps that make performance numbers lie (the optimized-away benchmark, JIT warmup, reading `-O0`). Weaker candidates speak only in source-level abstractions ("the compiler is smart, it handles that") and have never confirmed a single claim by looking.

The sections progress from conceptual foundations, through tool-specific fluency (Godbolt, objdump/perf, LLVM IR, JIT disassembly), into tricky traps where the obvious answer is wrong, and finally design/judgment scenarios.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Tool-Specific](#tool-specific)
  - [Compiler Explorer / Godbolt](#compiler-explorer--godbolt)
  - [objdump / perf](#objdump--perf)
  - [LLVM IR](#llvm-ir)
  - [JIT Disassembly](#jit-disassembly)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design / Judgment Scenarios](#design--judgment-scenarios)

---

## Conceptual / Foundational

## Question 1

**Q: What does "reading codegen" mean, and why would you ever do it?**

Reading codegen means inspecting the machine instructions (or their human-readable assembly form) that the compiler produced from your source — by emitting assembly (`gcc -S`/`clang -S`), disassembling a binary (`objdump -d`), or using a tool like Compiler Explorer. You do it to answer questions the source code can't: did a function inline, did a loop vectorize, was a bounds check eliminated, was a constant folded, is there a `call` where you expected inline code. The core value is replacing *folklore* ("the compiler optimizes that away") with *evidence* (here are the instructions). For performance work specifically, it's the only way to verify that an optimization you assumed is actually happening.

## Question 2

**Q: Explain the difference between AT&T and Intel assembly syntax. Why does it matter?**

They are two textual spellings of the *same* x86 machine instructions. Intel syntax writes the destination first (`mov rax, 5` = "put 5 into rax") and uses bare register names. AT&T syntax writes the source first (`mov $5, %rax` = the same thing) with `%` on registers and `$` on immediates. It matters because the operand order is *reversed*: if you read AT&T as if it were Intel, you'll think data flows backward. `gcc -S` and `objdump` default to AT&T on Linux; Compiler Explorer and MSVC default to Intel. The practical advice is to force one syntax everywhere (`-masm=intel`, `objdump -M intel`, the Godbolt "Intel" toggle) and stay consistent.

## Question 3

**Q: Why is `-O0` assembly a poor guide to performance?**

At `-O0` the compiler does an almost literal, optimization-free translation: it shuttles every value through the stack (`mov [rbp-4], …`), adds full prologues/epilogues, and performs no inlining, folding, vectorization, or register promotion. It exists to make debugging predictable (source maps cleanly to instructions). Your release build (`-O2`/`-O3`) looks completely different — tighter, reordered, with values kept in registers. Judging speed or "did it optimize?" from `-O0` is meaningless; always read at the optimization level you ship.

## Question 4

**Q: How do you tell, from the assembly, whether a function was inlined?**

Look for the `call` instruction. If the callee you expected to be inlined still shows `call funcname`, it wasn't inlined. If there's no `call` and the callee's logic (its arithmetic, its loads) appears directly inside the caller, it was. Inlining removes the call/return overhead *and* lets the optimizer work across the boundary (folding, vectorizing through the inlined body), so its presence often unlocks other optimizations you can also see.

## Question 5

**Q: What signals in the assembly tell you a loop was vectorized?**

Three signals together: (1) SIMD registers appear — `xmm`, `ymm`, or `zmm` instead of only general-purpose `rax`/`eax`; (2) *packed* instructions appear — mnemonics like `paddd`, `addps`, `vmulps`, `vfmadd231ps`, where the `p`/`ps`/`pd` means parallel lanes; (3) the loop counter advances by more than one (`add rax, 8`), usually followed by a scalar remainder loop. The crucial subtlety: *scalar* SIMD instructions (`addss`, `mulsd`) use the SIMD registers one lane at a time and are **not** vectorization. The `s` (scalar) vs `p` (packed) suffix is the deciding letter.

## Question 6

**Q: What is constant folding and strength reduction, and how do they look in codegen?**

Constant folding is the compiler computing a result at compile time: `return 6 * 7;` becomes `mov eax, 42`. Strength reduction replaces an expensive operation with a cheaper one: `x * 8` becomes a shift or a scaled `lea` (`lea eax, [0 + rdi*8]`) instead of `imul`, because multiplying by a power of two is a shift. Both are easy to spot and are good first optimizations to learn to recognize — if the multiply or the computation simply isn't in the output, the compiler did it for you.

## Question 7

**Q: The assembly tells you *what* the CPU does. What does it *not* tell you, and how do you fill that gap?**

It doesn't tell you what's *slow*. Two instructions that look equally trivial — say, two `mov` loads — can differ by 100× at runtime if one hits L1 cache and the other misses to DRAM. To find the actual cost you profile: `perf record` then `perf annotate`, which overlays a percentage-of-samples on each instruction. The hot instruction is usually a cache-missing load or a mispredicted branch, not the arithmetic you'd have guessed. So: read the assembly to understand the *work*, profile to find the *cost*.

## Question 8

**Q: Why might the compiler refuse to vectorize a loop you think is trivially parallel?**

Because it can't *prove* it's safe. Common blockers: a loop-carried dependency (`a[i] = a[i-1] + x`); possible pointer aliasing (the output might overlap the input, so it can't reorder); a non-inlined function call in the body (opaque to the optimizer); complex control flow or early exits; and floating-point reductions without relaxed math (`sum += a[i]` over floats changes rounding if reassociated, so it stays scalar unless `-ffast-math`). Each is a nameable cause you can identify and often remove (`restrict`, hoisting, `-ffast-math`).

## Question 9

**Q: What's a register spill and how would you spot it?**

A spill is the compiler running out of registers and storing a live value to the stack, then reloading it — because x86-64 has only 16 general-purpose registers. You spot it as a lot of `mov [rsp+...], reg` (store) / `mov reg, [rsp+...]` (reload) traffic in the middle of a hot block, not just in the prologue. Heavy spilling in a hot loop signals register pressure — often from over-unrolling or too many live variables — and is a clue that an optimization (or the source structure) is hurting more than helping.

## Question 10

**Q: How does ARM64 assembly differ from x86-64 at a glance, and does the skill transfer?**

ARM64 (AArch64) is a load/store RISC ISA: fixed-width 32-bit instructions, ~31 general registers (`x0`–`x30`, 32-bit views `w0`–`w30`), a zero register (`xzr`/`wzr`), and arithmetic that works *only* on registers — memory is touched only by `ldr`/`str` (no `add [mem], reg`). Branches are `b`/`bl`/`b.eq`/`cbz`; calls are `bl`; SIMD is NEON (`v0.4s` lanes). The *skill transfers completely*: a loop, a call, an array index (`ldr w0, [x1, x2, lsl #2]`), and a vectorized body look different but mean the same thing. You relearn vocabulary, not concepts.

---

## Tool-Specific

### Compiler Explorer / Godbolt

## Question 11

**Q: Walk me through using Compiler Explorer to check whether a function vectorizes.**

Go to godbolt.org, paste the function (as a *function with parameters*, not `main` — otherwise it constant-folds), pick the target compiler (e.g. x86-64 clang), and set the flags to your shipping level plus the right ISA (`-O3 -march=x86-64-v3` to allow AVX2). Read the right pane: click a source line and the matching assembly highlights in the same color. Look for `ymm` registers and packed mnemonics (`vaddps`, `vfmadd...ps`) and a counter that strides by 8. If you only see scalar `addss`, it didn't vectorize — then toggle `-fopt-info-vec-missed`/`-Rpass-missed=loop-vectorize` to learn why.

## Question 12

**Q: Why should you write your test as a function with parameters instead of putting values in `main`?**

If you hardcode inputs (`int x = 5; foo(x);` in `main`), the optimizer can constant-fold the entire computation and you'll see a single `mov` with the precomputed answer and no logic — useless for studying the codegen. A function with real parameters forces the compiler to emit general code that handles arbitrary inputs, which is what you actually want to read.

## Question 13

**Q: What is the single most useful Compiler Explorer feature for someone learning to read assembly?**

The source↔assembly color mapping: clicking a source line highlights exactly the instructions generated from it (and vice versa) in a shared color. This removes the hardest part of learning — figuring out which instructions correspond to which source — and lets you study the mapping construct by construct. The instant feedback loop (change a flag, see the output change immediately) is a close second.

## Question 14

**Q: How would you use Godbolt to prove that two different ways of writing the same code compile identically?**

Open two compiler panes (Godbolt supports multiple), put version A in one and version B in the other with identical flags, and compare the assembly. If the output is identical, you've proven the style choice has zero runtime cost — which is a common, valuable code-review outcome ("write it the readable way; the compiler produces the same machine code"). If they differ, the diff tells you which is doing more work.

### objdump / perf

## Question 15

**Q: How do you disassemble a compiled binary and see the original source alongside it?**

Compile with debug info and disassemble with the source-interleaving flag: `gcc -O2 -g -c file.c` then `objdump -d -M intel -S file.o`. `-d` disassembles, `-M intel` forces Intel syntax, and `-S` interleaves the source lines with the corresponding instructions (it needs the `-g` debug info to map them). This is how you read codegen when you only have a binary, or when you want to confirm the *actual shipped* code rather than a Godbolt approximation.

## Question 16

**Q: What does `perf annotate` give you that `objdump` doesn't?**

`objdump` shows the static disassembly — every instruction, with no notion of cost. `perf annotate` (after `perf record`) overlays a *percentage of samples* next to each instruction, telling you where runtime actually went. So `objdump` answers "what does this function do?" and `perf annotate` answers "which instruction in it is hot?". The hot instruction is usually a memory load that misses cache or a mispredicted branch — which redirects your optimization effort from the arithmetic you'd have guessed to the real bottleneck.

## Question 17

**Q: You run `perf annotate` and the hot instruction is a `mov` load at 60%. What does that tell you and what do you do?**

It tells you the bottleneck is *memory*, not computation — that load is stalling on a cache miss (or DRAM). The surrounding arithmetic is cheap by comparison. The fix is about *data*, not *code*: improve locality (better data layout, blocking/tiling, struct-of-arrays vs array-of-structs), prefetch, or reduce the working-set size — not "do fewer multiplies." Caveat: `perf` sample skid means the blamed instruction can be a few instructions after the true culprit, so read the surrounding block, and confirm with cache-miss events (`perf record -e cache-misses` / `perf c2c` for false sharing).

## Question 18

**Q: In a memory-safe language, how would you confirm with `objdump` that a bounds check was or wasn't eliminated?**

A bounds check compiles to a comparison against the array length and a conditional branch to a panic/abort handler before the access. In the disassembly, look inside the loop for a `cmp` against the length register and a `ja`/`jae` (or in Go, a jump to `runtime.panicIndex`; in Rust, a branch to a `panic_bounds_check` symbol). If that compare-and-branch is present on every iteration, the check survived; if the load happens with no preceding length compare and no panic branch, it was eliminated. In Go you can also use `-gcflags=-d=ssa/check_bce/debug=1` to have the compiler report its decisions, then confirm in `go tool objdump`.

### LLVM IR

## Question 19

**Q: What is LLVM IR and why read it instead of (or before) assembly?**

LLVM IR is LLVM's typed, SSA-form, target-independent intermediate representation — the layer between source and machine code where most optimizations actually happen. You emit it with `clang -O2 -emit-llvm -S file.c`. It's often *clearer* than assembly for understanding the optimizer's *decisions*, because it isn't yet obscured by register allocation and instruction scheduling. In IR you can directly see inlining (the callee's IR appears inline), constant folding (`ret i32 42`), vectorization (vector types like `<8 x float>`), and crucial attributes like `noalias`/`nonnull`/`fast` that explain *why* an optimization was legal.

## Question 20

**Q: You see `noalias` on a function parameter in the LLVM IR. What does it mean and why do you care?**

`noalias` means the compiler knows that pointer does not overlap other pointers the function can access — typically because the source used `restrict` (C) or a non-aliasing guarantee (Rust's `&mut`). You care because aliasing is one of the most common reasons loops *don't* vectorize or invariant loads don't hoist: if the compiler can't rule out overlap, it must assume the worst. Seeing `noalias` confirms the optimizer has the information it needs; its *absence* on pointers you know don't alias is a hint to add `restrict` and unlock the optimization.

## Question 21

**Q: How can LLVM IR show you the difference between "the compiler couldn't optimize" and "it chose not to"?**

Vector types and `fast` flags in the IR, combined with optimizer remarks (`-Rpass-missed=loop-vectorize`), distinguish the two. If the IR lacks `noalias`/the loop has a dependency, the compiler *couldn't* (it would be unsafe). If everything is legal but the loop stays scalar, the cost model *chose not to* (e.g. the trip count is too small to pay off). The remark text usually says which ("not vectorized: unsupported use" = couldn't; "vectorization not beneficial" = chose not to). That distinction tells you whether to fix correctness-blockers or to override the heuristic.

### JIT Disassembly

## Question 22

**Q: How do you read the machine code a JIT generates, for HotSpot and for V8?**

For HotSpot, `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly` (with the `hsdis` disassembler plugin) prints the JIT-generated machine code, annotated with bytecode and deopt points; `-XX:CompileCommand=print,Class::method` scopes it, and JITWatch makes it navigable. For V8/Node, `node --print-bytecode` shows Ignition bytecode, `node --print-opt-code` shows TurboFan-optimized machine code, `--trace-turbo` dumps the IR (viewable in turbolizer), and `--trace-opt`/`--trace-deopt` log which functions optimized/deoptimized and *why*. The key difference from AOT: this code is generated at runtime, specialized to observed behavior, and can be discarded and regenerated.

## Question 23

**Q: What is deoptimization, and how would you find out *why* a function keeps deoptimizing?**

Deoptimization is the JIT abandoning optimized machine code and falling back to the interpreter because a speculative assumption (a type, a call target, no-overflow) was violated. To find the reason, use the runtime's trace: V8's `--trace-deopt` prints a reason string ("not a Smi", "wrong map", "insufficient type feedback"); HotSpot logs "uncommon trap" reasons and `made not entrant`/`PrintCompilation` churn. The reason almost always maps to a code smell — a hot function receiving objects of changing shape, or numbers that overflow the small-integer range. A *one-time* deopt during warmup is normal; *repeated, hot* deopts are the performance bug.

## Question 24

**Q: What's an inline cache, and how does its state (monomorphic/polymorphic/megamorphic) affect codegen?**

An inline cache records the resolved target(s) at a dynamic-dispatch call site. Monomorphic (one observed type/shape) lets the JIT inline the target directly — fast. Polymorphic (a few) gives a small dispatch, sometimes still inlined per type. Megamorphic (many) makes the JIT give up and emit a generic, *un-inlined* runtime lookup — a silent performance cliff. In the disassembly, monomorphic sites show the inlined body; megamorphic sites show a call into a generic IC stub. You inspect IC state with `--trace-ic` (V8); keeping hot sites monomorphic (consistent object shapes) is what preserves inlining.

## Question 25

**Q: What is OSR (On-Stack Replacement) and why does it matter when reading JIT codegen or benchmarking?**

OSR replaces a *currently-running* interpreted (or baseline) stack frame with optimized code mid-execution — crucial when a single long-running loop is hot but its enclosing method is only entered once (so normal method-entry-triggered compilation never fires). In HotSpot's `PrintAssembly` you'll see a distinct OSR-compiled version with an entry keyed to the loop's bytecode index. It matters for benchmarking because the first iterations run interpreted and later ones run OSR-compiled, so a naive timing that includes warmup conflates the two — the JIT analogue of measuring before steady state.

---

## Tricky / Trap Questions

## Question 26

**Q: A colleague benchmarks `expensive(42)` in a loop and reports it takes 0.3 ns. What's almost certainly wrong?**

The compiler optimized the benchmark away. If `expensive(42)`'s result is unused and the function has no side effects, the optimizer is entitled to delete the call, the body, and possibly the loop — so the 0.3 ns is the cost of an *empty loop*. The fix is a sink that forces the result to be observed: `benchmark::DoNotOptimize(result)` (and `ClobberMemory()`), Rust's `std::hint::black_box`, or a `volatile` store. Critically, the sink isn't proof on its own — you must read the disassembly of the timed loop and confirm the actual work (the `imul`, the `call`) is present. No work in the loop body, no valid number.

## Question 27

**Q: You add `DoNotOptimize` to the result but the benchmark is still suspiciously fast. What did you miss?**

Probably the *input*. If you pass a literal (`expensive(42)`), the compiler can constant-fold the whole computation to a precomputed constant before the sink ever applies, so you measure a `mov`. You must hide the input too: `DoNotOptimize` the input variable, or `black_box` it in Rust. Sink *both* ends — input to defeat folding, output to defeat dead-code elimination — and then verify in the assembly that the multiply/computation actually survives inside the loop.

## Question 28

**Q: `x / 2` for a signed `int` didn't compile to a single shift. Is the compiler broken?**

No. Signed division by a power of two is *not* a plain arithmetic shift, because shifting a negative number rounds toward negative infinity while C/C++ integer division truncates toward zero. So the compiler emits a correction: extract the sign bit (`shr eax, 31`), add it as a bias, then `sar` (arithmetic shift). For an *unsigned* value, `x / 2` *is* a single `shr`. This is a non-optimization with a nameable cause (signedness/rounding semantics), not a bug — a perfect example of "read the codegen and reason about why" rather than assuming the compiler erred.

## Question 29

**Q: You enable `-O3` expecting a speedup and the program gets slower. How is that possible and how do you confirm the cause?**

`-O3` enables more aggressive inlining, unrolling, and speculative vectorization, which can backfire: code bloat pushes the hot path out of the L1 instruction cache (i-cache misses), over-unrolling increases register pressure and causes spills, and speculative vectorization adds setup overhead for loops that are usually short. Confirm by timing the *whole program* (not a microbenchmark), checking `.text` grew (`size`), and reading the hot function's disassembly for a massively inlined/unrolled body. The fix is often targeted (`-O2` plus `[[gnu::hot]]` on the truly hot function, or PGO) rather than blanket `-O3`.

## Question 30

**Q: A loop looks like it uses SIMD registers (`xmm0` everywhere) but you say it's not vectorized. Why?**

Because the instructions are *scalar* SIMD: `addss`/`mulsd`/`subss` operate on a single lane of the `xmm` register, not all of them. SSE/AVX use the same `xmm`/`ymm` register file for both scalar floating-point and packed vector math. The `ss`/`sd` suffix (scalar single/double) means one element per instruction; only the `ps`/`pd` packed forms (`addps`, `mulpd`) or integer `p*` forms (`paddd`) are true vectorization. Seeing the register file is not enough — read the suffix.

## Question 31

**Q: Your reduced Godbolt example vectorizes beautifully, but the real production loop doesn't. What's going on?**

Reduced examples strip away exactly the things that block optimization in real code: aliasing (real output buffers might overlap inputs), hidden calls (an un-inlined `operator[]`, a smart-pointer indirection, an allocation, a destructor, a bounds panic), abstraction layers, and exception-handling landing pads that fragment the loop. The compiler must be conservative about all of these. The fix is to read the *real build's* disassembly, identify which production-specific factor blocked it, and address that (`restrict`/non-aliasing, force the inline, hoist an invariant load) — then re-read to confirm.

## Question 32

**Q: A microbenchmark on a JVM shows a method getting 5× faster between the first and tenth run with no code change. Bug?**

No — JIT warmup. The method ran interpreted (or C1/baseline) first, then HotSpot recompiled it at C2 (or V8 at TurboFan) once it proved hot, and possibly OSR-compiled a hot loop mid-execution. The early runs measure interpreted/baseline code; the later ones measure fully-optimized code. The "bug" is benchmarking before steady state. The fix is to warm up, confirm the method reached the top tier (`-XX:+PrintCompilation` / `--trace-opt`), discard warmup iterations, and read `--print-opt-code`/`PrintAssembly` to know which code you're actually timing.

## Question 33

**Q: You used `volatile` on a loop variable to "stop the compiler from optimizing my benchmark away," and now the loop is mysteriously slow even for trivial work. What happened?**

`volatile` forces *every* access to actually occur, in program order, with no coalescing, hoisting, or vectorization — that's its hardware/`sig_atomic_t` semantics, not a benchmark tool. So a `volatile` array makes the compiler emit a separate, ordered load/store per element even when the work is trivial, pessimizing the loop far beyond just "keeping the result." It does prevent dead-code elimination, but as a side effect it disables real optimizations, giving misleadingly slow numbers. Use a proper sink (`DoNotOptimize`/`black_box`) that keeps the value observed *without* forbidding optimization of the surrounding code.

---

## Design / Judgment Scenarios

## Question 34

**Q: Two engineers disagree about whether the compiler vectorizes a hot kernel. As tech lead, how do you settle it?**

Make it an evidence question, not an opinion one. Reduce the kernel to a parameterized function, compile it with the *exact shipping flags* (`-O3 -march=...`, LTO if used), and read the codegen in Compiler Explorer — look for packed mnemonics and the strided counter. If it didn't vectorize, turn on `-Rpass-missed=loop-vectorize`/`-fopt-info-vec-missed` to get the reason, and check the LLVM IR for missing `noalias`. Present the assembly diff (scalar vs. vectorized-after-`restrict`) as the resolution. For the *quantitative* question ("how much faster"), benchmark — but only after confirming via codegen that the timed work actually runs. Structural claims → codegen; magnitude claims → measurement.

## Question 35

**Q: A service regressed in latency after a deploy with no obvious algorithmic change. Walk me through using codegen to diagnose it.**

First localize with a profiler (flame graph / `perf`) to the hot function. If it's a JIT runtime (JVM/Node), pull the runtime traces: `--trace-deopt`/`--trace-ic` (V8) or `PrintCompilation` + deopt reasons (HotSpot) — a frequent cause is the new code making a hot call site megamorphic (lost inlining) or feeding a hot function a new type/shape (deopt storm). If it's AOT, disassemble the hot function in the new vs. old build and look for a regressed inline (a new `call`), a vanished vectorization (scalar where there was packed), or a new bounds check. Tie the finding to a concrete code change, fix it, and re-read the trace/disassembly to confirm the deopt/megamorphic/scalar-loop is gone.

## Question 36

**Q: You're migrating a fleet from x86-64 to ARM64 (Graviton). How does codegen reading factor into validating the migration?**

You read the codegen of the *ARM64* build, not the x86 one, for the hot paths. Confirm the compiler vectorized with NEON/SVE where it did with AVX on x86 (`v0.4s` packed lanes, the counter striding by the lane count) — vectorization can differ across ISAs and `-mcpu` settings. Check that hot calls still inline and bounds checks are still eliminated on the new target. Be careful about SIMD width assumptions: NEON is 128-bit (4 floats) vs. AVX2's 256-bit (8 floats), so per-iteration throughput differs and that alone can explain a perf delta. The deliverable is a per-hot-loop explanation of any throughput change, grounded in both ISAs' disassembly.

## Question 37

**Q: When is reading codegen the *wrong* use of engineering time, and what would you do instead?**

When the question is "where is my time actually going?" at the system level, or the bottleneck is clearly elsewhere (I/O, network, lock contention, an O(n²) algorithm). Codegen reading is a *micro* tool; it shines for verifying a specific optimization on a specific hot kernel, not for finding the bottleneck in the first place. The discipline is: profile first to find *where* time goes; only when you've localized to a hot, CPU-bound kernel does reading its codegen pay off. Reading assembly for a function that's 0.1% of runtime is a rabbit hole. Match the depth of the tool to the size of the win.

## Question 38

**Q: Design a habit/workflow for a team that wants to keep hot paths optimized over time. How does codegen fit in?**

Treat codegen as a regression check, not a one-off. Concretely: (1) keep minimal Compiler Explorer snippets of the critical kernels and re-check them when the code or compiler changes ("is this still vectorized?"); (2) build with optimizer remarks in CI for hot files (`-Rpass-missed=inline,loop-vectorize`) and review new misses; (3) for JIT services, add steady-state benchmarks and alert on deopt/megamorphic transitions (`--trace-deopt`/`--trace-ic` in canary runs); (4) require that any "this is faster" claim in a PR comes with disassembly or a verified-not-optimized-away benchmark. The goal is to make "did the optimization actually happen?" a checkable, repeatable artifact rather than tribal knowledge that erodes with the next refactor or compiler upgrade.
