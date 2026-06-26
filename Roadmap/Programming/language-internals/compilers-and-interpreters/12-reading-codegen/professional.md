# Reading Codegen (Disassembly & Compiler Output) — Professional Level

> **Topic:** [Reading Codegen (Disassembly & Compiler Output)](README.md)
> **Focus:** Reading what JIT compilers produce at runtime (HotSpot, V8), deopt/inline-cache/OSR in the disassembly, ARM64 fluency, aliasing failures in real systems, and codegen as a production diagnostic tool.

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

> Focus: **Codegen you can't see at build time — the machine code a JIT generates *while the program runs* — plus reading across architectures (ARM64) and using disassembly to debug real production performance.**

Ahead-of-time codegen (gcc/clang/rustc) is static: compile once, read the `.s`, done. But enormous amounts of code run on **JIT compilers** — the JVM's HotSpot, V8 (Node/Chrome), .NET's RyuJIT, LuaJIT, PyPy. These compile *at runtime*, guided by what the program actually does: they profile, inline based on observed call targets, speculate on types, and **deoptimize** back to the interpreter when a speculation is wrong. The codegen changes as the program runs. To read it you need different tools (`-XX:+PrintAssembly`, `--print-opt-code`, `--trace-turbo`) and a different mental model: the assembly is *provisional*, guarded by assumptions, and littered with deopt points and inline caches.

At this level you also read across architectures fluently — ARM64 is now the default in data centers (Graviton, Ampere) and on every Mac — and you use disassembly as a *production* diagnostic: proving that a regression is a missed inline after a deploy, that a hot path deoptimized, that an aliasing assumption broke vectorization in the real (not reduced) code.

> 🎓 **Why this matters for a professional:** The systems you're responsible for are increasingly JIT-compiled and increasingly ARM. A "performance bug" in a Java or Node service is often a *codegen* bug — a megamorphic call site that stopped inlining, a hot loop that keeps deoptimizing on an unexpected type, an OSR that never kicks in. None of that is visible in the source or even a flame graph alone; you have to read what the JIT emitted and *why it changed*. And when you migrate a fleet from x86 to ARM64, you need to read both ISAs to explain why something got faster or slower. This is where codegen literacy stops being a nice-to-have and becomes load-bearing for incident response.

This page covers: JIT disassembly for HotSpot (`-XX:+PrintAssembly`, tiered compilation) and V8 (`--print-bytecode`, `--print-opt-code`, `--trace-turbo`, `node --print-opt-code`); reading **deopt points, inline caches (monomorphic→polymorphic→megamorphic), and OSR** in the disassembly (mostly in prose, since JIT asm is dense); enough **ARM64** to read it (fixed-width instructions, the different register file and mnemonics); aliasing and other optimization failures as they appear in *real* code; and using all of this for production diagnosis. This is the deepest tier; it assumes everything in `senior.md`.

---

## Prerequisites

- **Required:** Everything in `senior.md` — fluent optimized x86-64, SIMD/BCE/inlining recognition, LLVM IR, the benchmark-optimized-away discipline.
- **Required:** Working knowledge of at least one JIT runtime (JVM or V8/Node) as a *user*.
- **Required:** Comfort with `perf`/profilers on a live system.
- **Helpful:** Exposure to ARM64 or any RISC ISA.
- **Helpful:** Having owned a production performance incident end to end.

You do **not** need to be able to write a JIT or a compiler backend. You need to *read* their output and reason about *why it changed at runtime*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **JIT (Just-In-Time) compiler** | Compiles code to machine instructions *during execution*, guided by runtime profiling. Examples: HotSpot C2, V8 TurboFan, RyuJIT. |
| **Tiered compilation** | Running interpreted/lightly-compiled first, then recompiling hot methods at higher optimization once they prove hot (HotSpot C1→C2; V8 Ignition→Sparkplug→Maglev→TurboFan). |
| **Deoptimization (deopt)** | The JIT abandoning optimized machine code and falling back to the interpreter when a speculative assumption is violated. |
| **Speculation / assumption** | An optimistic bet the JIT makes (this call site has one target; this variable is always an int) that the optimized code is guarded against. |
| **Inline cache (IC)** | A per-call-site cache of resolved targets. **Monomorphic** (1 type), **polymorphic** (few), **megamorphic** (many → falls back to a slow generic lookup, and stops inlining). |
| **OSR (On-Stack Replacement)** | Swapping a long-running interpreted loop's stack frame for optimized code *mid-execution*, without waiting for the next call. |
| **`-XX:+PrintAssembly`** | HotSpot flag (needs the `hsdis` disassembler plugin) that prints the machine code the JIT generated, annotated with bytecode and deopt info. |
| **`--print-opt-code` / `--trace-turbo`** | V8 flags to dump optimized machine code / TurboFan's IR and pipeline. `node --print-opt-code` exposes them via Node. |
| **`hsdis`** | A disassembler plugin the JVM loads so `PrintAssembly` can render machine code as readable asm. |
| **uncommon trap** | HotSpot's term for a deopt point — a guarded branch to the deopt handler when an assumption fails. |
| **ARM64 / AArch64** | The 64-bit ARM ISA: fixed-width 32-bit instructions, 31 general registers `x0`–`x30` (32-bit views `w0`–`w30`), load/store architecture. |
| **Load/store architecture** | RISC style: arithmetic works only on registers; memory is touched only by explicit `ldr`/`str`. (Contrast x86, where instructions can operate directly on memory.) |
| **Aliasing failure** | A real-world optimization miss caused by the compiler being unable to prove two pointers/references don't overlap. |
| **PGO / profile-guided** | Feeding runtime profiles back into an AOT compiler — the static analogue of what a JIT does continuously. |

---

## Core Concepts

### 1. JIT codegen is provisional and profile-driven

An AOT compiler's output is fixed. A JIT's output is a *bet*. HotSpot's C2 and V8's TurboFan watch the program run, observe that a call site only ever calls one method or that a variable is always a small integer, and generate **optimized code specialized to those observations** — with **guards** that check the assumptions still hold. When a guard fails (a new type shows up, an integer overflows into a float), the code **deoptimizes**: it discards the optimized version and resumes in the interpreter, often recompiling later with the new information.

This means reading JIT codegen has an extra dimension AOT doesn't: *the code you read is conditional on assumptions, and it can be thrown away and regenerated.* A method might be interpreted, then C1-compiled, then C2-compiled, then deoptimized, then recompiled — each a different machine-code body. To read it you must know *which* version you're looking at and *what it's betting on*.

### 2. Reading HotSpot's output

The JVM can print the machine code it generates, but only with the `hsdis` disassembler plugin installed:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly \
     -XX:CompileCommand=print,'com.example.MyClass::hotMethod' MyApp
```

The output interleaves: the Java bytecode, the generated machine code (x86-64 or ARM64), and crucial annotations — the **deopt points** (labeled with the bytecode index they'd return to), the **inline decisions** (which callees got inlined into this method), and **safepoint** polls. What you look for:

- **Did the hot method reach C2?** (Tier 4 is the fully-optimized one; tools like JITWatch visualize this.)
- **Did the expected calls inline?** Megamorphic call sites won't, and you'll see a real virtual dispatch (`call` through a vtable) instead of inlined code.
- **Where are the uncommon traps?** Each is a guarded branch; a hot one firing repeatedly is a deopt storm.

Reading raw `PrintAssembly` is dense; in practice professionals use **JITWatch** to make it navigable, but the underlying skill is the same — recognize inlining, deopt guards, and the compilation tier.

### 3. Reading V8's output

V8 (Node/Chrome) exposes its pipeline through flags:

```bash
node --print-bytecode foo.js          # Ignition bytecode
node --print-opt-code foo.js          # TurboFan-optimized machine code
node --trace-turbo foo.js             # dumps TurboFan IR (view in turbolizer)
node --trace-opt --trace-deopt foo.js # logs which functions optimized/deoptimized and WHY
```

`--trace-deopt` is the most actionable for a service owner: it prints the *reason* a function deoptimized ("wrong map," "not a Smi," "insufficient type feedback"). That reason almost always maps to a real code smell — a hot function that receives objects of changing "shape" (hidden class), or numbers that sometimes overflow `Smi` range into heap doubles. `--print-opt-code` then shows the optimized machine code so you can confirm what got inlined and where the deopt guards sit. The combination — *why* it deoptimized (trace) plus *what* the optimized code looks like (opt-code) — is how you debug a Node hot path.

### 4. Inline caches: monomorphic → polymorphic → megamorphic

Dynamic-dispatch languages cache call-site resolutions in **inline caches**. The state of a call site determines whether the JIT can inline through it:

- **Monomorphic** (always one receiver type/shape): the JIT inlines the target directly. Fast.
- **Polymorphic** (a handful of types): a small dispatch, sometimes still inlined per-type.
- **Megamorphic** (many types): the JIT gives up and emits a generic, *un-inlined* lookup. This is a classic silent performance cliff.

In the disassembly, a monomorphic, inlined site shows the callee's body; a megamorphic site shows a call into a runtime stub / generic IC handler. The lesson for engineers: keeping hot call sites *monomorphic* (consistent object shapes in JS, avoiding deep type-mixing) is what keeps inlining alive — and you confirm it by reading the opt-code or the IC state (`--trace-ic` in V8).

### 5. OSR and deopt in the disassembly (prose)

**OSR (On-Stack Replacement)** matters when a single long-running loop is hot but its enclosing method is only ever called once (think `main` with a giant loop). Normal JIT compilation triggers on *method entry*, so without OSR the hot loop would run interpreted forever. OSR lets the runtime compile the loop and *replace the running frame mid-loop*. In HotSpot's `PrintAssembly` you'll see a separate OSR-compiled version of the method with a distinct entry point keyed to the loop's bytecode index. Recognizing "this is the OSR version" explains why a microbenchmark's first iterations are slow (interpreted) and later ones fast (OSR-compiled) — a frequent JIT-benchmark confound.

**Deopt points** appear as guarded branches: a type check, a null check, an array-store check, or a "class hierarchy hasn't changed" check, each branching to the deopt handler if it fails. A *hot* deopt (firing every iteration) means the optimized code is constantly being abandoned — catastrophic for performance and invisible without reading the guards or the deopt trace. The professional skill is connecting "this service got slow after a deploy" to "a new code path made a hot call site megamorphic / a hot value polymorphic, triggering repeated deopt."

### 6. Reading ARM64

ARM64 (AArch64) is now unavoidable — Apple Silicon, AWS Graviton, Ampere. It reads differently from x86 but the *skill transfers*; you just learn a new vocabulary:

- **Fixed-width 32-bit instructions.** Every instruction is 4 bytes. No variable-length decoding.
- **31 general registers** `x0`–`x30` (64-bit) with 32-bit views `w0`–`w30`; `sp` is separate; `xzr`/`wzr` is a hardwired zero register.
- **Load/store architecture.** Arithmetic operates only on registers; memory is touched *only* by `ldr`/`str`. There is no `add [mem], reg` like x86 — you `ldr`, `add`, `str`.
- **Different mnemonics:** `mov`, `add`, `sub`, `mul`, `ldr`/`str`, `b`/`bl` (branch / branch-with-link = call), `ret`, `cbz`/`cbnz` (compare-and-branch-if-zero), `cmp` + `b.eq`/`b.ne`.
- **Calling convention (AAPCS64):** args in `x0`–`x7`, return in `x0`, link register `x30` holds the return address (so leaf functions need no stack frame).
- **SIMD/NEON:** vector registers `v0`–`v31` (128-bit), with `.4s`/`.2d` lane suffixes (e.g. `fadd v0.4s, v1.4s, v2.4s` = 4 packed floats). SVE adds scalable vectors. Recognizing these is the ARM equivalent of spotting `ymm`/`vaddps`.

You don't need to write ARM64; you need to recognize a loop, a call, an array index (`ldr w0, [x1, x2, lsl #2]`), and vectorized NEON, so you can read codegen on the architecture you actually deploy to.

### 7. Aliasing and optimization failures in real (not reduced) code

The reduced examples that vectorize in `senior.md` often *don't* in production because real code has aliasing the compiler can't rule out, hidden calls (allocations, virtual dispatch, bounds panics), and abstraction layers. The professional skill is reading the *real* hot loop's codegen and identifying which production-specific factor blocked the optimization: a `std::vector::operator[]` that wasn't inlined, a smart-pointer indirection, a possibly-aliasing output buffer, an exception-handling landing pad fragmenting the loop. AOT analogue of the JIT's deopt: the optimization that worked in the lab fails on the real shape of the code, and only the disassembly of the *actual* build shows it.

---

## Real-World Analogies

**The contractor who keeps re-reading the room.** An AOT compiler builds once from the blueprint. A JIT is a contractor who watches how you actually use the room and rebuilds the furniture layout to match — but keeps a guard at the door ("if a different kind of guest arrives, tear it down and start over"). Reading JIT codegen is inspecting both the current layout and the guards that will trigger a rebuild (deopt).

**The bouncer's memory.** An inline cache is a bouncer who remembers regulars. Monomorphic: one regular, instant wave-through (inlined). Megamorphic: so many faces they give up and check every ID against the full list (generic lookup, no inlining). Keeping the line monomorphic keeps the bouncer fast.

**Two dialects of the same language.** x86 and ARM64 are dialects: same concepts (registers, loads, branches, calls), different words and grammar (fixed-width, load/store-only). Reading both is like a translator fluent in two related languages — the *ideas* transfer; you relearn the vocabulary.

**The understudy stepping in mid-scene.** OSR is the optimized understudy replacing the interpreted actor *in the middle of a long monologue*, without restarting the scene. It explains why the performance changes partway through a long loop.

---

## Mental Models

**Model 1: JIT codegen is a bet plus a guard.** Every optimized JIT body is specialized to runtime observations and guarded by deopt checks. Read both the fast path *and* what would invalidate it.

**Model 2: A deopt trace is a bug report from the optimizer.** `--trace-deopt` / uncommon-trap reasons tell you *exactly* which assumption broke. Treat the reason as the root cause to fix (a polymorphic shape, an overflowing Smi), not noise.

**Model 3: Inlining lives and dies by call-site shape.** Monomorphic stays inlined; megamorphic falls off the cliff. Performance regressions after a deploy are often "a new caller made a hot site megamorphic." Read the IC state.

**Model 4: The ISA is vocabulary; the structure is universal.** A loop, a call, an array index, a vectorized body look different on ARM64 but mean the same thing. Learn the mapping, not a new universe.

**Model 5: Reduced examples lie about production.** The lab loop vectorizes; the real one doesn't, because of aliasing/hidden-calls/abstractions. Always read the codegen of the *actual* build, on the *actual* target.

**Model 6: JIT warmup confounds every benchmark.** Interpreted → C1/Sparkplug → C2/TurboFan → maybe deopt. A number taken before steady state is meaningless. Read which tier produced the code you're timing.

---

## Code Examples

### Example 1: Printing HotSpot's JIT assembly for one method

```bash
# Requires the hsdis plugin on the library path.
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly \
     -XX:CompileCommand='print,com/example/Hot::loop' \
     -XX:-TieredCompilation -XX:CompileThreshold=10000 com.example.Hot
```

In the output, look for: the compiler that produced it (`C2`/Tier 4), inlined callees listed in the comments, `uncommon_trap` entries (deopt points), and whether array accesses still carry a range check. A megamorphic call shows up as a virtual dispatch rather than an inlined body. (In practice, pipe this into **JITWatch** for a navigable view.)

### Example 2: V8 — seeing *why* a hot function deoptimizes

```js
function add(a, b) { return a + b; }
for (let i = 0; i < 1e6; i++) add(i, i);     // monomorphic: numbers -> optimized
add("x", "y");                                // new shape -> DEOPT
```

```bash
node --trace-opt --trace-deopt --print-opt-code add.js
```

`--trace-deopt` prints something like `deoptimizing ... reason: not a Smi` or `wrong map`, naming the exact assumption that broke (`add` was specialized for integers; a string call invalidated it). `--print-opt-code` shows the optimized machine code with the deopt guards. The fix — keep `add` monomorphic — is justified by the trace, not a hunch.

### Example 3: V8 inline-cache state (mono → mega)

```bash
node --trace-ic hot.js
```

For each call site, V8 logs IC transitions: `0->1` (monomorphic), `1->P` (polymorphic), `P->N` / `MEGAMORPHIC`. A hot site reaching `MEGAMORPHIC` is the smoking gun for "why did this stop being fast?" — the JIT can no longer inline it. Restructuring the code so the hot site sees consistent object shapes pulls it back to monomorphic, which you confirm by re-reading `--trace-ic` and `--print-opt-code`.

### Example 4: Reading an ARM64 loop

```c
int sum(const int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += a[i];
    return s;
}
```

ARM64 at `-O2` (scalar, simplified):

```asm
sum:
        mov     w0, wzr          ; s = 0  (wzr = zero register)
        cmp     w1, #0
        b.le    .Ldone           ; if n <= 0, skip
        mov     x2, #0           ; i = 0
.Lloop:
        ldr     w3, [x0, x2, lsl #2]  ; w3 = a[i]  (base + i*4)
        add     w0, w0, w3            ; s += a[i]
        add     x2, x2, #1           ; i++
        cmp     x2, x1
        b.lt    .Lloop
.Ldone:
        ret
```

The array index `[x0, x2, lsl #2]` is ARM's `base + index<<2`, exactly the x86 `[rdi + rcx*4]`. `b.lt`/`b.le` are the conditional branches, `wzr` is the zero register. Same loop *structure*, different vocabulary. At `-O3 -mcpu=...` you'd see NEON (`v0.4s`, `add v0.4s, v1.4s, v2.4s`) — the ARM equivalent of packed SIMD.

### Example 5: Recognizing NEON vectorization on ARM64

```asm
.Lvec:
        ld1     {v1.4s}, [x0], #16      ; load 4 floats, post-increment x0 by 16
        ld1     {v2.4s}, [x1], #16      ; load 4 floats from the other array
        fadd    v0.4s, v1.4s, v2.4s     ; PACKED add of 4 floats
        st1     {v0.4s}, [x2], #16      ; store 4 floats
        subs    x3, x3, #4              ; 4 elements per iteration
        b.ne    .Lvec
```

`v0.4s` (4×32-bit float lanes), `fadd ... .4s` (packed), and the counter dropping by 4 are the NEON signals — directly analogous to `ymm`/`vaddps`/`add rax, 8` on x86. Vectorization literacy transfers across ISAs once you learn the lane-suffix notation.

### Example 6: A production aliasing failure in real code

```cpp
void normalize(std::vector<float>& data, const float* factor) {
    for (size_t i = 0; i < data.size(); ++i)
        data[i] *= *factor;     // does '*factor' alias inside 'data'? compiler can't be sure
}
```

In the real build's disassembly you may find the compiler *reloading `*factor` every iteration* (a scalar load inside the loop) because it cannot prove `factor` doesn't point into `data`'s buffer — so it can't hoist the load or vectorize. Hoisting manually (`const float f = *factor;` before the loop) or `__restrict` removes the doubt; the disassembly then shows the load hoisted out and the loop vectorized. This is the senior-tier aliasing lesson, but found in *real, abstraction-laden* code rather than a reduced snippet.

### Example 7: JIT warmup confounding a benchmark

```js
function f(x) { /* hot work */ return x * 31 + 7; }
console.time('cold'); for (let i=0;i<1e5;i++) f(i); console.timeEnd('cold'); // interpreted/Sparkplug
console.time('warm'); for (let i=0;i<1e7;i++) f(i); console.timeEnd('warm'); // TurboFan, after warmup
```

The `cold` timing measures interpreted/baseline code; the `warm` timing measures TurboFan output after the function tiered up. Reporting the cold number as "the performance of `f`" is the JIT analogue of the optimized-away trap. Confirm steady state (`--trace-opt` shows when `f` reaches TurboFan) before trusting any JIT benchmark, and read `--print-opt-code` to see what you're actually timing.

### Example 8: Tiered compilation tiers in HotSpot

```bash
java -XX:+PrintCompilation MyApp | grep hotMethod
# Output columns include the tier:  '3' = C1 with profiling, '4' = C2 (fully optimized)
```

`PrintCompilation` shows each method's compilation tier and any deopts (`made not entrant`, `made zombie`). Seeing `hotMethod` reach tier 4 and *stay* there means stable optimized code; repeated tier-4 → deopt → recompile means a speculation keeps failing — exactly what to read the `PrintAssembly`/deopt reason for next.

---

## Pros & Cons

**Pros of professional-level codegen reading:**

- **Diagnoses JIT-specific regressions** (deopt storms, megamorphic call sites, OSR gaps) that are invisible in source and ambiguous in flame graphs.
- **Connects "service got slow after deploy" to a concrete codegen cause** via deopt/IC traces.
- **Enables honest cross-architecture reasoning** (x86 ↔ ARM64) during fleet migrations.
- **Catches the JIT-warmup benchmark trap**, the runtime analogue of optimized-away.
- **Explains real-code optimization failures** (production aliasing, un-inlined abstractions) that reduced examples miss.

**Cons / costs:**

- **JIT disassembly is dense and runtime-dependent**; it needs extra tooling (`hsdis`, JITWatch, turbolizer) and steady-state runs.
- **Output is non-deterministic** across runs (profiling order, thresholds), unlike AOT codegen.
- **High skill ceiling:** reading two ISAs plus JIT semantics is a real investment.
- **Easy to over-interpret** a single deopt or IC transition that doesn't actually matter for throughput.
- **Tooling setup friction** (hsdis builds, perf permissions, V8 debug flags) can stall an investigation.

---

## Use Cases

- **Root-causing a Node/JVM service regression** to a megamorphic call site or a hot deopt after a deploy, using `--trace-deopt`/`--trace-ic` or `PrintCompilation` + `PrintAssembly`.
- **Validating an x86→ARM64 migration**: reading both builds' hot loops to explain a throughput change and confirm NEON/SVE vectorization on the new fleet.
- **Confirming a hot Java method reached C2 and stays there** (no deopt churn) under production-like load.
- **Debugging "fast in microbenchmark, slow in prod"** by reading the real, aliased, abstraction-heavy hot loop's codegen.
- **Justifying a refactor to keep call sites monomorphic / object shapes stable** with IC-state evidence.
- **Diagnosing OSR gaps** in long-loop workloads where the enclosing method never re-enters.
- **Comparing PGO vs. non-PGO AOT builds** as the static counterpart to JIT specialization.

---

## Coding Patterns

### Pattern 1: Trace first, disassemble second (JIT)

```bash
node --trace-opt --trace-deopt --trace-ic app.js   # find WHAT changed and WHY
node --print-opt-code app.js                        # then read the resulting code
```

The traces tell you which function/site to read and the *reason*; the opt-code shows the result. Don't start by staring at megabytes of `--print-opt-code`.

### Pattern 2: Keep hot call sites monomorphic

Design hot paths so they see one object shape / one receiver type. In JS, construct objects with consistent property order and types; in Java, avoid mixing many subclasses through one hot virtual call. Verify with `--trace-ic` / inlining in `PrintAssembly`.

### Pattern 3: Reach steady state before measuring

```bash
node --trace-opt app.js | grep 'optimizing f'   # confirm f tiered up
```

Warm up the JIT, confirm the hot method reached the top tier, *then* benchmark. Discard cold iterations. Read the opt-code to know what you're timing.

### Pattern 4: Read the target ISA, not the build-host ISA

When deploying to ARM64 (Graviton/Apple), disassemble the *ARM64* build (`objdump -d` on the arm binary, or Godbolt's ARM compilers). Don't reason about Graviton performance from x86 codegen.

### Pattern 5: Hoist possibly-aliasing loads, then verify

```cpp
const float f = *factor;          // break the aliasing doubt
for (...) data[i] *= f;
```

Hoist invariant loads manually (or annotate `__restrict`) and confirm in the disassembly that the load left the loop and vectorization appeared.

### Pattern 6: Use the right viewer for dense output

JITWatch for HotSpot, turbolizer for V8 TurboFan IR, `perf annotate` for hot-instruction attribution. Raw text dumps are for spot checks; the viewers are for real investigations.

---

## Best Practices

- **Treat deopt/IC traces as primary evidence.** `--trace-deopt`/`--trace-ic` (V8) and `PrintCompilation`/uncommon-trap reasons (HotSpot) name the root cause; read them before the raw assembly.
- **Always benchmark JITs at steady state** and confirm the compilation tier of the code you're timing.
- **Read codegen for the architecture you deploy to**, especially across an x86↔ARM64 fleet.
- **Keep hot call sites monomorphic and object shapes stable**, and verify with IC state rather than assuming.
- **Read the real build's codegen, not a reduced snippet**, when diagnosing production aliasing/inlining failures.
- **Set up the viewers (JITWatch, turbolizer) before the incident**, not during it — tooling friction kills investigations.
- **Connect codegen findings to a fixable code change** (a polymorphic shape, an un-hoisted aliasing load), not just an observation.
- **Re-verify after the fix**: re-read the trace and opt-code to confirm the deopt/megamorphic/scalar-loop is actually gone.

---

## Edge Cases & Pitfalls

- **`hsdis` not installed → no assembly.** `PrintAssembly` silently shows only bytecode without the disassembler plugin. Build/install `hsdis` first.
- **Reading the C1 body and concluding C2 is slow.** Tiered compilation produces multiple bodies; make sure you're reading the *top-tier* (C2/TurboFan) code, not an interim tier.
- **A single deopt is normal.** Functions often deopt once during warmup and recompile fine. Only *repeated, hot* deopts matter. Don't chase a one-time trap.
- **Megamorphic isn't always fatal.** If the call site is cold, its lost inlining is irrelevant. Confirm it's actually hot (profile) before refactoring around it.
- **OSR code differs from the normal compiled version.** Don't compare an OSR body to a method-entry body and conclude the optimizer is inconsistent.
- **Non-determinism across runs.** JIT output depends on profiling order and thresholds; two runs can compile differently. Reproduce conclusions across several runs.
- **Misreading ARM64 condition flags.** `cmp` + `b.lt`/`b.ge` semantics (signed vs. unsigned: `b.lt`/`b.ge` are signed, `b.lo`/`b.hs` unsigned) are easy to flip — analogous to the x86 `jl`/`jb` distinction.
- **Assuming x86 memory-operand habits on ARM.** ARM64 is load/store-only; there's no `add [mem], reg`. If you expect a single memory-arithmetic instruction, you'll misread the `ldr`/`add`/`str` triple.
- **Production aliasing you can't fix with `restrict`.** In C++ with references/smart-pointers, the aliasing doubt may come from the type system; the fix is restructuring, not an annotation. Read carefully before promising a one-line fix.
- **`--print-opt-code` flooding you.** Without narrowing to one function (`--print-opt-code-filter`), V8 dumps everything. Scope it.
- **Cross-arch SIMD width assumptions.** NEON is 128-bit (4 floats); AVX2 `ymm` is 256-bit (8 floats); AVX-512/SVE differ again. Don't assume the same per-iteration width after an ISA migration — read the lane suffix and the counter stride.
- **JIT inlining hides work in callers.** Just like AOT inlining, inlined JIT code is attributed to the caller in profiles; a "free" method may be inlined hot work elsewhere.
