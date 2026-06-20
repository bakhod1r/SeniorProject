# CPU-Bound Optimization — Senior Level

> **Roadmap:** [Performance](../README.md) → CPU-Bound Optimization
> *The professional page taught you to measure before you cut. This page is about the machine you are actually feeding: a wide, deeply-pipelined, out-of-order CPU that retires four instructions per cycle when you respect it and stalls for two hundred cycles when you don't. Here we work below the algorithm — at the level of pipeline ports, branch predictors, cache lines, and the assembly the compiler actually emitted.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Modern Core — Superscalar, Out-of-Order, Speculative](#the-modern-core--superscalar-out-of-order-speculative)
4. [Top-Down Methodology — Where the Slots Go](#top-down-methodology--where-the-slots-go)
5. [Branch Prediction and Why a Sorted Array Is Faster](#branch-prediction-and-why-a-sorted-array-is-faster)
6. [SIMD and Vectorization — Auto, Intrinsic, and When It Fails](#simd-and-vectorization--auto-intrinsic-and-when-it-fails)
7. [Data Layout — AoS vs SoA, Hot/Cold Splitting, Padding](#data-layout--aos-vs-soa-hotcold-splitting-padding)
8. [False Sharing and Cache-Line Effects in Parallel Code](#false-sharing-and-cache-line-effects-in-parallel-code)
9. [Memory-Level Parallelism and Prefetching](#memory-level-parallelism-and-prefetching)
10. [Profile-Guided Optimization and Reading the Asm to Verify](#profile-guided-optimization-and-reading-the-asm-to-verify)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Optimizing for the microarchitecture — making code that the CPU's pipeline, branch predictor, vector units, and cache hierarchy can actually run fast.**

By the professional level you profile honestly, you read flame graphs without fooling yourself, and you know that the first job is to delete work, not to shave cycles off work that shouldn't exist. That gets you most of the way. The senior jump is what happens *after* you've picked the right algorithm and the hot loop is genuinely CPU-bound: now the bottleneck is the machine itself, and "CPU-bound" stops being one thing.

A loop that is "100% CPU" can be limited by completely different resources: it might be waiting on the branch predictor recovering from mispredictions, or starved because the frontend can't decode instructions fast enough, or backend-bound on a single overloaded execution port, or stalled for hundreds of cycles on an L3 miss while the core sits idle with nothing to retire. Each of these is a different fix, and a flame graph that just says `hot_loop 38%` cannot tell them apart. This page is about *what kind* of CPU-bound you have, how to measure it with hardware counters, and the handful of transformations — branchless code, vectorization, data layout, prefetch — that move the needle once you're down at this layer. The recurring discipline: **read the assembly to confirm the compiler did what you think.**

---

## Prerequisites

- **Required:** You've internalized [professional.md](professional.md) — profiling honestly, latency vs throughput, knowing when *not* to optimize.
- **Required:** You can read x86-64 or AArch64 assembly well enough to follow a loop body and recognize a vector instruction.
- **Helpful:** A working mental model of the cache hierarchy: ~4-cycle L1, ~12-cycle L2, ~40-cycle L3, ~200+ cycle DRAM; 64-byte cache lines.
- **Helpful:** You've run `perf stat` and seen IPC, and you know that IPC below ~1 on a 4-wide core means the core is starving.

---

## The Modern Core — Superscalar, Out-of-Order, Speculative

The mental model most engineers carry — "the CPU executes my instructions one at a time, in order" — has been false for thirty years. A modern x86 core (Intel Golden Cove, AMD Zen 4) or a wide ARM core (Apple Firestorm) is a **superscalar, out-of-order, speculative** machine, and optimizing for it requires understanding three properties.

**Superscalar (wide).** The core can decode, issue, and retire multiple instructions *per cycle*. Mainstream big cores are 4–6 wide on retire; Apple's cores are 8-wide. Each cycle the frontend tries to deliver up-to-N micro-ops (µops) to the backend. If your code only offers one independent instruction per cycle, you waste 3–7 of those slots — the machine is idle while looking 100% busy.

**Out-of-order (OoO).** Instructions are decoded into µops, renamed onto a large physical register file (to break false dependencies), and dropped into a **scheduler / reservation station**. From there they execute *as soon as their inputs are ready*, not in program order, dispatched to **execution ports**. A µop only commits ("retires") in program order, from the **reorder buffer (ROB)** — which is hundreds of entries deep (Golden Cove: 512). That deep window is what lets the core keep working across a cache miss: it can run ~hundreds of instructions ahead of a stalled load, *if those instructions are independent of the load*.

**Ports are the real throughput limit.** Each port handles certain operations. A simplified Golden Cove layout:

| Port(s) | Handles |
|---|---|
| p0, p1, p5, p6 (+more) | integer ALU |
| p0, p1, p5 | vector / FP ALU, FMA |
| p2, p3, p11 | loads (address generation) |
| p4, p9 + p7, p8 | stores (data + address) |
| p0, p6 | branches |

Two integer multiplies that could in principle run in parallel may both need p1 and serialize. This is **port pressure**, and it's why "fewer instructions" isn't always faster — six instructions spread across six ports beat four instructions all contending for one port.

**Speculative.** The frontend doesn't wait to learn the outcome of a branch; it *predicts* it and runs ahead speculatively, squashing the work if wrong. This is the single most important property for the branch-prediction section below.

```bash
perf stat -e cycles,instructions,uops_retired.retire_slots ./app
#   IPC = instructions / cycles. On a 4-wide core, IPC ~3.5 is excellent,
#   ~1.0 means three quarters of the machine is idle every cycle.
```

> **Key insight:** "CPU-bound" is not a measurement — it's the *absence* of an I/O wait. The real question is which part of this wide, speculative, out-of-order machine is the bottleneck: frontend delivery, a saturated port, a mispredicted branch, or a memory stall with an empty ROB. You optimize each completely differently, so the first job is to find out which one you have.

---

## Top-Down Methodology — Where the Slots Go

The honest way to answer "which part of the machine is the bottleneck" is the **Top-Down Microarchitecture Analysis Method** (TMA), developed at Intel and exposed by `perf` and the `toplev` tool. Instead of asking "what code is hot," it asks "what happened to every **pipeline slot**" — a slot being one µop-issue opportunity, of which a 4-wide core has 4 per cycle.

Every slot, each cycle, falls into exactly one of four top-level buckets:

```
                         ┌─ Retiring          → a µop was issued AND it usefully retired (good!)
   pipeline slot ────────┤  Bad Speculation   → a µop was issued but squashed (mispredicted branch / machine clear)
                         │  Frontend Bound    → no µop issued; the frontend couldn't deliver one
                         └─ Backend Bound     → no µop issued; the backend couldn't accept one (ports full / memory stall)
```

- **Retiring** — work that counted. Even here, high "retiring" can hide that you're retiring *more instructions than necessary* (e.g. failed vectorization doing 8× the µops).
- **Bad Speculation** — the core ran code down the wrong path and threw it away. Almost always branch mispredictions. Fix: help the predictor or go branchless.
- **Frontend Bound** — the backend is hungry but the frontend can't feed it: instruction-cache misses, decode bottlenecks, a cold µop cache. Fix: reduce code size on the hot path, improve I-cache locality (PGO helps a lot here).
- **Backend Bound** — the dominant bucket in most real code. Splits into **Core Bound** (execution ports saturated, e.g. divider or FMA throughput) and **Memory Bound** (stalled on L1/L2/L3/DRAM). Fix for memory-bound: data layout, prefetch, blocking. Fix for core-bound: fewer/cheaper µops, spread across ports.

```bash
# The level-1 breakdown straight from perf:
perf stat -M TopdownL1 ./app
#  Retiring        22.1 %
#  Bad Speculation  8.4 %
#  Frontend Bound   5.3 %
#  Backend Bound   64.2 %   ← drill in

# Drill into backend with Andi Kleen's toplev (pmu-tools):
toplev.py -l3 --no-desc ./app
#  ... Backend_Bound.Memory_Bound.DRAM_Bound  41.7 %   ← it's waiting on main memory
```

That last line is the payoff: a flame graph said "hot loop 64%"; TMA says the loop spends 42% of all pipeline slots stalled on DRAM. No amount of branchless cleverness will help — the fix is in the cache hierarchy (data layout, prefetch, blocking), which is exactly the [memory-layout and locality](../05-memory-and-allocation-profiling/senior.md) toolkit.

> **Key insight:** Top-down is a *decision tree*, not a dashboard. Each level tells you which subtree to expand. You don't read all the counters; you follow the dominant bucket down until it names a concrete resource — `DRAM_Bound`, `Ports_Utilization`, `Branch_Mispredicts` — and only then do you pick a transformation. Optimizing without doing this is how people spend a week vectorizing a loop that was memory-bound the whole time.

---

## Branch Prediction and Why a Sorted Array Is Faster

Because the core is speculative, every conditional branch is a *guess*. The branch predictor (a TAGE-style multi-table predictor on modern cores) is astonishingly good — well over 95% accuracy on typical code — but a misprediction is expensive: the speculative pipeline must be flushed and refilled, costing roughly **15–20 cycles** on a deep modern pipeline. At 4 IPC, that's ~60–80 instructions of lost work per misprediction.

The canonical demonstration — the most-upvoted question in Stack Overflow history — is "why is processing a *sorted* array faster?":

```cpp
// data[] holds values 0..255; sum only those >= 128
long sum = 0;
for (int i = 0; i < N; i++)
    if (data[i] >= 128)        // ← the branch in question
        sum += data[i];
```

With **random** data, `data[i] >= 128` is true ~50% of the time in no pattern, so the predictor is wrong about half the time — a misprediction every other iteration. With the **same data sorted**, the branch is taken `false` for the whole first half and `true` for the whole second half: two long runs the predictor nails after one mispredict each. Same instructions, same cache behavior, same algorithm — the sorted version can run **5–6× faster** purely because of branch prediction. `perf` shows it directly:

```bash
perf stat -e branches,branch-misses ./sum_random
#   branch-misses:  24.7% of all branches      ← catastrophic
perf stat -e branches,branch-misses ./sum_sorted
#   branch-misses:   0.3% of all branches
```

The senior fix is to **remove the data-dependent branch entirely** so there's nothing to mispredict — *branchless* code. The compiler often does this for you via a **conditional move** (`cmov`), which computes both paths' selectors and picks without a branch:

```cpp
// branchless: no data-dependent control flow
sum += data[i] & -(data[i] >= 128);   // mask is 0x00.. or 0xFF.., then AND
```

```asm
; the branchless / cmov form has NO conditional jump in the loop body:
        cmp     eax, 128
        cmovge  edx, eax          ; conditionally move, no branch to mispredict
        add     rcx, rdx
```

A `cmov` is ~1–2 cycles and *never mispredicts* — but it always has a data dependency on both operands, so it's not free: if the branch were highly predictable (say 99% one way), the *branch* is actually faster because the predictor lets the pipeline run ahead, whereas `cmov` serializes. **Branchless wins exactly when the branch is unpredictable.** This is the real lesson: don't blanket-replace branches with `cmov`; replace the *unpredictable* ones. Measure `branch-misses` first.

In other languages the same physics applies with different controls. In **Java**, the C2 JIT profiles branches at runtime and will compile a never-taken branch as an *uncommon trap* (deoptimize if it ever fires) — so a branch that's biased in production but not during warm-up can deopt and stall; this is why JMH warm-up that doesn't match production branch bias gives lying numbers. In **Go**, you can hint with `[]bool` lookup tables or arithmetic, but the compiler's `cmov` generation is weaker than GCC/Clang, so reading the asm (`go build -gcflags=-S`) matters more.

> **Key insight:** A predictable branch is nearly free; an unpredictable one costs ~15–20 cycles. The transformation is not "branches are slow" — it's "*mispredictions* are slow." Sorting the data, hoisting the branch out of the loop, or going branchless are all the same move: give the predictor a pattern, or remove the prediction.

---

## SIMD and Vectorization — Auto, Intrinsic, and When It Fails

A scalar `add` processes one element; a SIMD `add` processes a whole vector — 8 `int32`s with AVX2 (256-bit), 16 with AVX-512 (512-bit), 4 with ARM NEON (128-bit). For data-parallel loops this is a 4–16× throughput multiplier, and it's the difference between memory-bandwidth-bound and not. There are three ways to get it, in increasing order of effort and control.

**1. Auto-vectorization.** The compiler vectorizes the loop for you at `-O2`/`-O3`. When it works it's free; the problem is it *silently* fails for reasons that aren't obvious, and you only find out by checking:

```bash
clang -O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -march=native -c hot.c
#  hot.c:12: remark: vectorized loop (vectorization width: 8) [-Rpass=loop-vectorize]
#  hot.c:20: remark: loop not vectorized: value that could not be identified as
#                    reduction is used outside the loop [-Rpass-missed=loop-vectorize]
gcc   -O3 -fopt-info-vec-missed -march=native -c hot.c   # GCC's equivalent
```

Auto-vectorization commonly fails on: **loop-carried dependencies** (each iteration needs the previous result), **potential aliasing** (the compiler can't prove two pointers don't overlap — fix with `restrict`/`__restrict`), **unpredictable trip counts or early exits**, **function calls in the loop** (unless inlined), and **non-unit stride / gather patterns**. The most common real-world fix is telling the compiler pointers don't alias:

```c
void axpy(float a, float * restrict y, const float * restrict x, int n) {
    for (int i = 0; i < n; i++) y[i] += a * x[i];   // now provably vectorizable
}
```

**2. Intrinsics.** When the compiler won't or can't, you write the vector instructions yourself via intrinsics — typed wrappers over SIMD ops. Full control, but you've committed to an instruction set and the code is ugly:

```c
#include <immintrin.h>
// sum 8 floats per iteration with AVX
__m256 acc = _mm256_setzero_ps();
for (int i = 0; i < n; i += 8)
    acc = _mm256_add_ps(acc, _mm256_loadu_ps(&x[i]));   // _mm256_load_ps needs 32B alignment
```

**Alignment matters.** `_mm256_load_ps` (aligned) faults on an unaligned address and is faster on older microarchitectures; `_mm256_loadu_ps` (unaligned) is safe and on modern cores nearly as fast *when the data happens to be aligned* — but a load that straddles a cache line still costs extra. Align hot SIMD buffers to the vector width (`alignas(32)` / `posix_memalign`) so loads never split a cache line.

**3. Per-language reality.** **C and C++** have the full intrinsics surface plus auto-vectorization; **Rust** has both (`std::arch` intrinsics, plus `std::simd` portable SIMD on nightly) and its aliasing rules make auto-vectorization *more* reliable than C because the borrow checker proves non-aliasing the compiler otherwise can't. **Java**'s C2 JIT auto-vectorizes simple loops (superword/SLP), and the **Vector API** (JEP 448, incubating) gives explicit, portable SIMD that the JIT lowers to AVX/NEON — the modern way to get reliable vectorization on the JVM. **Go is the outlier: it has no intrinsics and the compiler does essentially no auto-vectorization** — to get SIMD in Go you drop to hand-written assembly (`.s` files, the Plan 9 assembler) or call out to C via cgo (which has its own overhead). This is a genuine, deliberate limitation; for SIMD-heavy numeric kernels, Go is the wrong tool, and a senior recognizes that rather than fighting it.

> **Key insight:** Auto-vectorization is the right default *but you must verify it happened* — the gap between "should vectorize" and "did vectorize" is enormous and silent. Check `-Rpass`/`-fopt-info-vec`, and if it failed, decide consciously: fix the blocker (`restrict`, restructure the reduction), drop to intrinsics, or accept scalar. And know your language: Rust makes auto-vec reliable, Java gives you the Vector API, Go gives you assembly or nothing.

---

## Data Layout — AoS vs SoA, Hot/Cold Splitting, Padding

The fastest instruction is the one whose data is already in L1. Once a loop is memory-bound (TMA said `Memory_Bound`), the lever is no longer the code — it's how the data is laid out in memory, because that determines how much useful payload rides in each 64-byte cache line you pay ~200 cycles to fetch.

**Array of Structs (AoS) vs Struct of Arrays (SoA).** Consider particles:

```c
// AoS: one struct per particle, fields interleaved
struct Particle { float x, y, z; float vx, vy, vz; int id; char flags; };
struct Particle parts[N];

// SoA: one array per field
struct Particles { float x[N], y[N], z[N], vx[N], vy[N], vz[N]; int id[N]; char flags[N]; };
```

A loop that updates only `x += vx` for every particle, over AoS, drags an entire 32-byte struct into cache per particle but uses 8 bytes of it — 75% of every cache line and of memory bandwidth is wasted, and it defeats vectorization (the `x` values aren't contiguous). The SoA version walks two dense `float` arrays: every byte fetched is used, and the loop auto-vectorizes cleanly because `x[i]` and `vx[i]` are unit-stride. For data-parallel hot loops, **SoA is usually 2–4× faster** purely on cache and vectorization grounds. The cost is ergonomics — "one particle" is now scattered across arrays — so it's a hot-path-only transformation, not a default.

**Hot/cold splitting.** Even within one struct, separate the fields the hot loop touches from the ones it rarely does:

```c
struct OrderHot  { uint64_t id; int32_t price; int32_t qty; };       // walked every tick
struct OrderCold { char     customer[64]; time_t created; /* ... */ };
// hot array stays dense → more orders per cache line → fewer misses
```

**Struct packing and padding.** The compiler inserts padding to satisfy alignment, and field *order* changes the size. Reorder largest-to-smallest to eliminate holes:

```c
struct Bad  { char a; double b; char c; };   // 24 bytes: 7B pad after a, 7B tail pad
struct Good { double b; char a; char c; };   // 16 bytes: only 6B tail pad
```

```bash
pahole -C OrderHot ./app     # shows every field's offset, size, and padding holes
gcc -Wpadded -c order.c      # warns where the compiler inserted padding
```

Shrinking a hot struct from 24 to 16 bytes means 33% more elements per cache line and per DRAM fetch — directly fewer misses on a memory-bound walk. In **Go**, the same applies: field order changes struct size, `go vet` doesn't flag it but tools like `fieldalignment` do; in **Rust**, `#[repr(C)]` fixes layout (otherwise the compiler reorders for you, which is usually what you want), and `#[repr(packed)]` removes padding at the cost of unaligned-access penalties.

> **Key insight:** When you're memory-bound, you're paying full cache-line and DRAM-bandwidth cost regardless of how few bytes you use. AoS→SoA, hot/cold splitting, and field reordering are all the same move: **maximize the useful payload per 64-byte line you fetch.** This is the highest-leverage transformation for memory-bound code, and the asm/profile won't change — only the cache-miss counters will.

---

## False Sharing and Cache-Line Effects in Parallel Code

The previous section was about a single core's cache. The moment you go parallel, the cache *coherence* protocol (MESI/MOESI) adds a failure mode that is invisible in the source and brutal in the numbers: **false sharing.**

Cores keep coherent caches by line, not by byte. When core A writes any byte of a 64-byte line, the protocol invalidates that line in every *other* core's cache — even if core B was using a completely different byte of the same line. Two threads writing two *different* variables that happen to land in the same cache line will ping-pong that line between their L1 caches, each write triggering a coherence miss (~40–100+ cycles). The variables aren't shared; the *line* is — hence "false" sharing.

```c
// classic false-sharing bug: per-thread counters packed together
struct { long count; } counters[NUM_THREADS];   // adjacent longs → same cache line
// thread t does: counters[t].count++  in a tight loop
// → every increment by every thread bounces ONE cache line across all cores
```

This can make a "parallel" loop *slower* than the single-threaded version, and it scales backwards: more cores = more contention on the line. The fix is to pad each thread's data onto its own cache line:

```c
struct alignas(64) Counter { long count; };      // C++: each on its own 64B line
Counter counters[NUM_THREADS];
```

```bash
# perf c2c (cache-to-cache) is the tool built exactly for this:
perf c2c record ./app && perf c2c report
#   → flags HITM (hit-modified) events and the exact cache line + offsets contended
```

Language equivalents: **Rust** has `crossbeam_utils::CachePadded<T>`; **Java** has `@Contended` (with `-XX:-RestrictContended`) and the JDK's `LongAdder`/`@jdk.internal.vm.annotation.Contended` exist precisely to avoid this; **Go**'s `runtime` pads internal per-P structures, and you replicate it with `_ [64]byte` padding or `[64 - 8]byte` fillers around hot fields. The flip side — **true sharing** of a single hot counter — has the same symptom; the fix there is sharding (per-core counters summed at read time), which is the `LongAdder` strategy.

> **Key insight:** Coherence operates on cache lines, not variables. Two threads can contend fiercely over data they never logically share, because their unrelated variables sit in one 64-byte line. When a parallel loop scales worse than linearly — or *negatively* — suspect false sharing before lock contention, and reach for `perf c2c` to prove it. This is the bridge to [concurrency and contention](../06-concurrency-and-contention/senior.md).

---

## Memory-Level Parallelism and Prefetching

A single DRAM access costs ~200+ cycles, but the core does *not* have to eat that latency serially. Each core can have ~10–12 outstanding cache misses in flight at once (limited by the **Line Fill Buffers** / MSHRs). This is **memory-level parallelism (MLP)**: if you issue many independent misses, their latencies overlap, and your effective per-access cost collapses from 200 cycles toward 200/12.

The enemy of MLP is the **dependent load chain** — pointer chasing:

```c
// linked-list traversal: each load's ADDRESS depends on the previous load's RESULT
while (node) { sum += node->val; node = node->next; }   // misses CANNOT overlap → ~200 cyc each
```

The core cannot prefetch `node->next->next` because it doesn't know the address until `node->next` returns. This is why a linked list of 1M nodes can be **10× slower** to traverse than a contiguous array of the same data, despite identical algorithmic complexity — the array's accesses are independent and the hardware prefetcher streams them; the list serializes on the dependency chain. The structural fix is to use arrays / indices instead of pointers wherever traversal is hot.

**Hardware prefetchers** detect sequential and strided access patterns and fetch ahead automatically — which is why a linear array scan rarely stalls. They fail on irregular access (hash tables, trees, gather). For those, **software prefetch** can help by issuing the load early:

```c
for (int i = 0; i < n; i++) {
    __builtin_prefetch(&data[index[i + PREFETCH_DISTANCE]], 0, 0);  // fetch ahead
    process(data[index[i]]);                                        // ~PD iters later it's in L1
}
```

Software prefetch is a *sharp* tool: too short a distance and the data isn't back in time; too long and you evict it before use or pollute the cache; and on a regular pattern you just fight the hardware prefetcher and lose. It only wins on **irregular, latency-bound** access where you can compute the future address well ahead — the classic case being walking an index array into a large table, or a hash-join probe. Always measure; a wrong prefetch distance is a slowdown.

> **Key insight:** Memory latency is fixed at ~200 cycles, but memory *throughput* is governed by how many misses you keep in flight. Independent accesses overlap and approach bandwidth-bound; dependent accesses (pointer chasing) serialize and stay latency-bound. The single biggest MLP win is structural — arrays and indices instead of pointer chains — long before you reach for `__builtin_prefetch`.

---

## Profile-Guided Optimization and Reading the Asm to Verify

The compiler makes thousands of guesses — which branch is likely, which functions to inline, how to lay out basic blocks, when to vectorize. At compile time it's guessing blind. **Profile-Guided Optimization (PGO)** gives it the answers: you build an instrumented binary, run it on a *representative* workload, and feed the collected profile back into a second build.

```bash
# C/C++ with Clang (instrumentation PGO):
clang -O2 -fprofile-generate -o app_inst *.c
./app_inst < representative_workload          # produces default.profraw
llvm-profdata merge -o app.profdata *.profraw
clang -O2 -fprofile-use=app.profdata -o app_optimized *.c
```

With a real profile the compiler does what blind heuristics can't: lay out hot basic blocks contiguously (fewer I-cache misses and taken branches — directly attacking the *frontend-bound* TMA bucket), arrange branches so the common case falls through, inline the calls that actually dominate, and skip vectorizing genuinely cold loops. Typical wins are **5–20%** on large branchy applications (compilers, databases, browsers) — gains that come almost entirely from frontend and branch-layout improvements no amount of source tweaking achieves.

**Go's PGO is exceptionally low-friction** and worth calling out: collect a `pprof` CPU profile from production, drop it in the package directory as `default.pgo`, and `go build` uses it automatically — no flags, no two-phase build. It primarily drives more aggressive inlining and devirtualization, typically **2–7%**, and because the profile comes from real production traffic it stays representative. **Java** does this *continuously and for free*: the C2 JIT is a profile-guided optimizer by nature — it profiles every branch and call at runtime and recompiles hot methods with that data, which is why warm JVM code can beat statically-compiled C on branchy workloads, and why warm-up and matching production behavior are everything. **Rust** uses the same LLVM PGO machinery as Clang via `-Cprofile-generate`/`-Cprofile-use`.

What PGO and the compiler **cannot** do: change your data layout, fix false sharing, vectorize across a real loop-carried dependency, or know a branch is unpredictable in a way it can fix without your help. Those are the human transformations from the sections above.

**And the discipline that ties it all together: read the assembly.** Every claim in this page is verifiable in the emitted code, and the compiler frequently does *not* do what you assumed — an `#pragma omp simd` that didn't vectorize, a `cmov` that became a branch, an "inlined" function that wasn't, a hot loop the optimizer left with a redundant bounds check.

```bash
objdump -d --no-show-raw-insn app | less        # disassemble the built binary
clang -O3 -S -masm=intel -o - hot.c             # emit asm directly, Intel syntax
go build -gcflags='-S' .                          # Go assembly
go build -gcflags='-m' .                          # Go escape analysis: did it heap-allocate?
# or paste into Compiler Explorer (godbolt.org) to A/B two source versions side by side
```

For Go specifically, `-gcflags=-m` reports **escape analysis** decisions — whether a value stayed on the stack or escaped to the heap. A value that escapes turns a free stack allocation into a GC-managed heap allocation, and for CPU-bound code that allocates in a hot loop, keeping values on the stack (by not letting pointers escape) is often a bigger win than any microarchitectural tweak.

> **Key insight:** PGO closes the gap between the compiler's compile-time guesses and your program's real behavior — and it attacks exactly the frontend-bound and bad-speculation buckets that source-level changes can't reach. But neither PGO nor the optimizer can fix data layout, false sharing, or a genuine dependency. And whatever you believe the compiler did, *the assembly is the ground truth* — verify before you claim a win.

---

## Mental Models

- **"CPU-bound" is a family, not a diagnosis.** Frontend-bound, backend core-bound, backend memory-bound, and bad-speculation are four different problems wearing the same "100% CPU" costume. Top-down (TMA) is how you tell them apart, and each has a different fix.

- **The machine is wide, out-of-order, and speculative.** It retires several µops per cycle, runs hundreds of instructions ahead of a stalled load, and guesses every branch. Optimizing means feeding it independent work and giving its predictor a pattern — not minimizing instruction count in a vacuum.

- **Mispredictions, not branches, are slow.** A predictable branch is nearly free because the predictor lets the pipeline run ahead. Branchless/`cmov` only wins when the branch is *unpredictable* — measure `branch-misses` before reaching for it.

- **Memory-bound code is fixed by layout, not by code.** Once TMA says `Memory_Bound`, the lever is bytes-per-cache-line: SoA, hot/cold splitting, struct packing, arrays-not-pointers. The instructions don't change; the miss counters do.

- **Coherence works on lines, not variables.** False sharing makes "unshared" data contend. When parallel code scales backwards, suspect the cache line before the lock — and use `perf c2c`.

- **The assembly is the only ground truth.** Auto-vectorization, `cmov`, inlining, bounds-check elimination — all silently fail. Verify in `objdump`/`-S`/godbolt before believing a transformation happened.

---

## Common Mistakes

1. **Optimizing without the top-down breakdown.** Vectorizing a memory-bound loop, or going branchless on a perfectly-predicted branch, is wasted effort. Run `perf stat -M TopdownL1` (then `toplev`) first and let the dominant bucket pick the transformation.

2. **Replacing every branch with `cmov`.** Branchless serializes on a data dependency and *loses* to a well-predicted branch (which lets the pipeline run ahead). Only de-branch the ones with high `branch-misses`.

3. **Assuming the loop vectorized because you wrote it to.** Auto-vectorization fails silently on aliasing, reductions, and early exits. Check `-Rpass=loop-vectorize` / `-fopt-info-vec`, and read the asm for vector instructions.

4. **Reaching for SIMD in Go.** Go has no intrinsics and effectively no auto-vectorization. For SIMD-heavy kernels that's hand-written Plan 9 assembly or cgo — often a sign the kernel belongs in C/Rust.

5. **Per-thread data packed into one cache line.** Adjacent per-thread counters false-share and make parallel code scale negatively. Pad to 64 bytes (`alignas(64)`, `CachePadded`, `@Contended`) and confirm with `perf c2c`.

6. **Pointer-chasing in a hot path.** Linked lists and pointer-heavy trees serialize memory accesses (no MLP) and defeat the hardware prefetcher — often 10× slower than the array equivalent. Prefer arrays and indices for hot traversal.

7. **Software-prefetching a sequential scan.** The hardware prefetcher already handles strided access; manual prefetch there only pollutes cache and adds instructions. Software prefetch is for *irregular, latency-bound* access with a computable future address.

8. **Trusting micro-benchmarks that don't match production branch bias / warm-up.** Especially on the JVM, where C2 compiles based on observed branch behavior — a benchmark with the wrong bias measures a different machine than production runs.

---

## Test Yourself

1. A flame graph shows one loop at 60% of CPU time. Name the four top-down buckets and explain why the flame graph can't tell you which one this loop is in.
2. Why is summing a *sorted* array (with a `>= threshold` branch) several times faster than summing the same data unsorted? What counter proves it?
3. When does a branchless `cmov` formulation *lose* to a plain conditional branch, and why?
4. Give three concrete reasons a compiler silently refuses to auto-vectorize a loop, and how you'd detect and fix one of them.
5. Two threads increment two different counters and the parallel version is slower than single-threaded. What's the most likely cause, and which tool confirms it?
6. Why can traversing a contiguous array be ~10× faster than traversing a linked list holding identical data, even though both are O(n)?
7. What classes of optimization does PGO unlock that source-level changes can't, and name one thing PGO fundamentally *cannot* fix.

<details>
<summary>Answers</summary>

1. The buckets are **Retiring, Bad Speculation, Frontend Bound, Backend Bound** (Backend splitting into Core-bound and Memory-bound). A flame graph attributes *wall time* to code but says nothing about *why the pipeline slots were spent* — a 60% loop could be retiring usefully, flushing on mispredicts, starved by the frontend, or stalled on DRAM, which need opposite fixes. `perf stat -M TopdownL1` / `toplev` is what distinguishes them.
2. Sorting turns a ~50%-random branch into two long predictable runs, so branch mispredictions collapse from ~25% to near 0. A misprediction costs ~15–20 cycles of pipeline flush; eliminating them is the entire speedup. `perf stat -e branch-misses` proves it (e.g. 24.7% → 0.3%).
3. `cmov` always carries a data dependency on both inputs and can't be speculated past, so it serializes. When the branch is *highly predictable*, the predictor lets the out-of-order core run far ahead speculatively, beating the serialized `cmov`. Branchless only wins when the branch is *unpredictable* (high `branch-misses`).
4. Any three of: **loop-carried dependency** (each iteration needs the last — restructure the reduction or accept scalar); **potential pointer aliasing** (compiler can't prove non-overlap — add `restrict`/`__restrict`); **early exit / data-dependent trip count**; **non-inlined call in the loop**; **non-unit stride / gather**. Detect with `-Rpass-missed=loop-vectorize` (Clang) or `-fopt-info-vec-missed` (GCC); fix aliasing with `restrict`.
5. **False sharing**: the two counters sit in the same 64-byte cache line, so each write invalidates the other core's copy, ping-ponging the line via the coherence protocol (~40–100+ cyc per bounce) and scaling negatively. `perf c2c record/report` flags the HITM events and the exact contended line/offsets. Fix: pad each to its own cache line.
6. The array's accesses are **independent**, so the hardware prefetcher streams them and many misses overlap (high MLP) — effectively bandwidth-bound. The list is a **dependent load chain**: each `next` address isn't known until the prior load returns, so misses serialize at ~200 cycles each (latency-bound) and can't be prefetched.
7. PGO unlocks **profile-driven block layout** (hot blocks contiguous → fewer I-cache misses, fewer taken branches — fixes frontend-bound), **branch arrangement** (common case falls through — fixes bad-speculation), and **profile-driven inlining/devirtualization** — things blind heuristics can't get right. PGO *cannot* fix data layout, false sharing, a genuine loop-carried dependency, or memory-boundedness — those are human transformations.

</details>

---

## Cheat Sheet

```
DIAGNOSE FIRST — TOP-DOWN (which kind of CPU-bound?)
  perf stat -M TopdownL1 ./app        Retiring / BadSpec / Frontend / Backend
  toplev.py -l3 ./app                  drill the dominant bucket to a named resource
  perf stat -e cycles,instructions     IPC; <1 on a 4-wide core = starving

BRANCHES (bad-speculation bucket)
  perf stat -e branches,branch-misses  misprediction ~15-20 cycles each
  fix: sort/partition data, hoist branch, or go branchless (cmov) — ONLY if unpredictable
  verify: objdump -d  → look for cmov vs conditional jump

VECTORIZATION (core-bound / throughput)
  clang -O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -march=native
  gcc   -O3 -fopt-info-vec-missed -march=native
  fix blockers: restrict pointers, restructure reductions; else intrinsics (immintrin.h)
  align hot SIMD buffers (alignas(32)); Rust=reliable auto-vec, Java=Vector API, Go=asm only

DATA LAYOUT (memory-bound bucket)
  AoS → SoA for data-parallel loops (2-4x); hot/cold field splitting
  reorder fields large→small; pahole -C / gcc -Wpadded to find padding holes
  arrays + indices instead of pointer chains (preserves MLP)

PARALLEL / COHERENCE
  perf c2c record && perf c2c report   find false sharing (HITM events)
  pad per-thread data to 64B: alignas(64) / CachePadded / @Contended / LongAdder

MEMORY-LEVEL PARALLELISM
  ~10-12 misses in flight per core; independent loads overlap, dependent serialize
  __builtin_prefetch(addr,0,0)  ONLY for irregular latency-bound access; measure distance

PGO + VERIFY
  C/C++/Rust: -fprofile-generate → run → -fprofile-use   (5-20% on branchy code)
  Go: drop default.pgo in pkg dir, go build (auto, 2-7%);  Java: C2 JIT does it live
  go build -gcflags='-m'   escape analysis (stack vs heap)
  ALWAYS: objdump -d / clang -S -masm=intel / godbolt.org — asm is ground truth
```

---

## Summary

- A modern core is **superscalar, out-of-order, and speculative** — it retires several µops per cycle across multiple **ports**, runs hundreds of instructions ahead of a stalled load, and predicts every branch. "Fewer instructions" is not the goal; *feeding the machine independent work and a predictable control flow* is.
- **"CPU-bound" decomposes** via the **top-down method** into Retiring, Bad Speculation, Frontend-bound, and Backend-bound (core vs memory). `perf -M TopdownL1` and `toplev` name the real bottleneck so you don't optimize the wrong layer.
- **Mispredictions cost ~15–20 cycles**, which is why a sorted array sums faster than an unsorted one (the predictor gets a pattern). Branchless/`cmov` helps *only* for unpredictable branches; measure `branch-misses` first.
- **SIMD** is a 4–16× throughput multiplier — auto-vectorize and verify it happened (`-Rpass`/`-fopt-info-vec`), drop to intrinsics with aligned data when it fails. Rust makes auto-vec reliable, Java has the Vector API, **Go has neither** and needs assembly.
- **Data layout** (AoS→SoA, hot/cold splitting, struct packing) is the lever for memory-bound code: maximize useful payload per 64-byte cache line. **False sharing** is the parallel failure mode — coherence is per-line — found with `perf c2c`, fixed with 64-byte padding.
- **MLP** means independent misses overlap (toward bandwidth-bound) while pointer chains serialize (latency-bound) — prefer arrays to pointers; reserve software prefetch for irregular access. **PGO** fixes frontend/branch-layout that source can't, and **the assembly is always the final arbiter** of what the compiler actually did.

You now optimize the machine, not just the algorithm — diagnosing *which* resource is the limit and applying the one transformation that moves it. The next layer up, [concurrency and contention](../06-concurrency-and-contention/senior.md), is what happens when many of these cores fight over the same data.

---

## Further Reading

- *Computer Architecture: A Quantitative Approach* — Hennessy & Patterson. The canonical text on pipelines, ILP, speculation, and memory hierarchy.
- [Agner Fog's optimization manuals](https://www.agner.org/optimize/) — instruction tables (latency/throughput/ports per microarchitecture) and the microarchitecture guide; indispensable for port-level reasoning.
- *A Top-Down Method for Performance Analysis and Counters Architecture* — Ahmad Yasin (the TMA paper); plus Andi Kleen's `pmu-tools`/`toplev`.
- [Intel 64 and IA-32 Optimization Reference Manual](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html) — authoritative on ports, prefetchers, and SIMD.
- *What Every Programmer Should Know About Memory* — Ulrich Drepper. Cache lines, NUMA, false sharing, and prefetching, in depth.
- [Compiler Explorer (godbolt.org)](https://godbolt.org) — the fastest way to A/B source against emitted assembly across compilers and flags.

---

## Related Topics

- [junior.md](junior.md) — what "CPU-bound" means and the first-order fixes (better algorithm, less work).
- [middle.md](middle.md) — profiling a hot loop, reading IPC and cache-miss counters, basic flame-graph interpretation.
- [professional.md](professional.md) — operating CPU optimization in production: when to invest, regression guarding, and the cost/benefit of microarchitectural work.
- [06 — Concurrency and Contention](../06-concurrency-and-contention/senior.md) — false sharing, lock contention, and scaling curves when many cores share data.
- [05 — Memory Optimization](../05-memory-and-allocation-profiling/senior.md) — allocation, GC pressure, and working-set effects that feed the cache hierarchy.
- [Language Internals › Compilers](../../../language-internals/compilers-and-interpreters/README.md) — what the optimizer and JIT do inside the compile that PGO steers.
