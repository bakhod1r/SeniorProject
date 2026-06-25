# Interpretation, Compilation, JIT, AOT — Middle Level

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)
> **Focus:** The mechanics under the strategies — interpreter dispatch techniques, the bytecode loop, what a JIT *actually* does at runtime, tiered compilation, warmup, and on-stack replacement.

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
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Stop treating the interpreter and the JIT as black boxes.** What instruction sequence actually runs the interpreter loop? What does "the JIT compiled this method" mean step by step? Why is warmup unavoidable, and what is on-stack replacement?

At junior level we drew the four strategies — interpret, bytecode, JIT, AOT — as a spectrum. At this level we open each one up. The headline ideas:

- An interpreter spends a shocking fraction of its time not on *your* arithmetic but on the **dispatch** — fetching the next instruction and jumping to the code that handles it. There's a whole family of techniques (switch-based, direct-threaded, indirect-threaded, computed-goto) whose entire purpose is to make that jump cheaper. Understanding dispatch is understanding why interpreters are slow and how they get faster.
- A JIT is not magic. It is a compiler that runs *inside* your process, triggered by counters, fed by **profiles**, producing machine code into a buffer that the program then jumps into. Once you see it as "a compiler that runs at runtime and uses information unavailable at build time," the rest follows.
- **Tiered compilation** exists because there's a fundamental tension: a cheap-but-dumb compiler gives you native speed *quickly*; an expensive-but-smart compiler gives you *better* native speed but takes longer. So runtimes use both — a fast first tier to get off the interpreter, then a slow optimizing tier for the truly hot code.
- **On-stack replacement (OSR)** is the trick that lets a JIT optimize a loop that's *already running* — swapping out the interpreted loop for the compiled one *mid-flight*, without waiting for the function to be called again.

This page makes those concrete. Higher levels cover deoptimization, speculative optimization, PGO for AOT, and the engineering economics.

---

## Prerequisites

- **Required:** The junior-level model — the four strategies and the "translation timing" idea.
- **Required:** Comfort reading a `switch`/`case` and a `while` loop in C-like pseudocode.
- **Required:** A rough sense of what "a pointer" and "a function pointer" are.
- **Helpful:** Having seen disassembly or bytecode output once (Python `dis`, `javap -c`).
- **Helpful:** Knowing that a CPU has a branch predictor that does better on predictable jumps than unpredictable ones.

You do **not** yet need: SSA form, register allocation, escape analysis, or the deoptimization machinery — those are `senior.md` and `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dispatch** | The act of an interpreter selecting and jumping to the handler for the next instruction. The interpreter's core overhead. |
| **Decode** | Extracting the opcode (and operands) from the next bytecode instruction before dispatching. |
| **Opcode** | The numeric code identifying a bytecode instruction (e.g. `BINARY_ADD`, `LOAD_FAST`). |
| **Switch-based dispatch** | Dispatch via a big `switch(opcode)` in a loop. Simple, portable, but the indirect jump is poorly branch-predicted. |
| **Direct threading** | Dispatch where each bytecode is replaced by the *address* of its handler, so dispatch is "jump to the address stored here." Faster; needs computed-goto (a GCC/Clang extension). |
| **Indirect threading** | Like direct threading but through a table: each opcode indexes a table of handler addresses. Slightly more indirection, more compact bytecode. |
| **Computed goto** | A compiler extension (`&&label`, `goto *ptr`) that lets you jump to a dynamically chosen label — the building block of threaded interpreters. |
| **Profiling (in a JIT)** | Counting how often code runs and recording observed types/branches, to decide what and how to compile. |
| **Invocation counter** | A per-method counter incremented on each call; crossing a threshold triggers compilation. |
| **Backedge counter** | A per-loop counter incremented each time a loop iterates back; triggers compilation of hot loops (and OSR). |
| **Tiered compilation** | Using multiple compilers of increasing quality and cost (interpreter → fast JIT → optimizing JIT). |
| **Baseline / template JIT** | A fast, simple JIT that emits straightforward native code per bytecode with little optimization. Quick to produce, modest speedup. |
| **Optimizing JIT** | A slow, sophisticated JIT that applies inlining, escape analysis, etc. Produces fast code but costs CPU and time. |
| **OSR (On-Stack Replacement)** | Replacing an interpreted (or lower-tier) frame with a compiled one *while it is running*, typically for a long loop. |
| **Warmup** | The transient period during which a JIT'd program runs below peak speed because compilation hasn't finished. |
| **Code cache** | The region of memory where a JIT writes the native code it generates. |
| **Inline cache** | A per-call-site cache of "last time, this call dispatched to *this* method/type," speeding up dynamic dispatch. |

---

## Core Concepts

### 1. The interpreter loop, and why dispatch dominates

A bytecode interpreter is fundamentally:

```c
for (;;) {
    Opcode op = *pc++;          // FETCH + DECODE
    switch (op) {               // DISPATCH
        case OP_ADD:   /* pop b, pop a, push a+b */   break;
        case OP_LOAD:  /* push local */               break;
        case OP_JUMP:  pc = bytecode + operand;        break;
        /* ... dozens more ... */
    }
}
```

For a simple instruction like `OP_ADD`, the *useful* work is one machine `add`. But around it sits: increment `pc`, load the opcode, run the `switch` (which compiles to an indirect jump through a jump table), and loop back. That scaffolding can be **3–10× the cost of the useful work.** This is the *dispatch overhead*, and it's why a bytecode interpreter is typically 10–50× slower than native code even though it's far faster than tree-walking.

Worse: the `switch`'s indirect jump is **hard for the CPU branch predictor.** From the CPU's view, "where does this jump go?" changes with every instruction — the predictor mispredicts often, stalling the pipeline. Reducing those mispredictions is the whole point of the next idea.

### 2. Dispatch techniques: switch → threaded → computed-goto

There's a ladder of dispatch implementations, each cheaper than the last:

**Switch-based (the baseline):**
```c
for (;;) { switch (*pc++) { case OP_ADD: ...; break; ... } }
```
One indirect jump per instruction, through the `switch` table. The single dispatch point means the branch predictor sees *all* opcodes' transitions merged together — poor prediction.

**Direct threading (computed goto):**
```c
static void *table[] = { &&do_add, &&do_load, &&do_jump, /* ... */ };
#define DISPATCH() goto *table[*pc++]
do_add:  /* ...; */ DISPATCH();
do_load: /* ...; */ DISPATCH();
```
Here the dispatch is *duplicated at the end of every handler.* Now the CPU sees a *separate* indirect jump per opcode, and each one tends to be followed by a predictable next opcode (e.g. a `LOAD` is often followed by another `LOAD`). The branch predictor does **much** better. This single change can speed an interpreter up 20–50%. It requires the computed-goto extension (`&&label`, `goto *`) available in GCC and Clang — which is exactly why CPython compiles a faster interpreter under those compilers.

**Indirect threading** trades a little speed for compactness: bytecode stores small opcodes that index a handler table, rather than full addresses. A common choice for memory-constrained VMs.

The takeaway: **the interpreter's speed is dominated by how cheaply it can get from one instruction's handler to the next.** Everything from CPython's 3.11 "adaptive specializing interpreter" to LuaJIT's interpreter is, in part, a story about better dispatch.

### 3. What a JIT actually does, step by step

Demystified, a method-based JIT (like HotSpot or RyuJIT) does this:

```text
1. The method runs interpreted. A per-method invocation counter ticks up
   on each call; a backedge counter ticks up on each loop iteration.
2. When a counter crosses a threshold, the method is queued for compilation
   (often on a background compiler thread, so the program keeps running).
3. The JIT reads the method's bytecode, builds an internal IR, and applies
   optimizations (inlining, constant folding, dead-code elimination, ...).
4. It allocates machine registers and emits native code into the CODE CACHE.
5. It patches the method's entry so future calls jump to the compiled code
   instead of the interpreter.
6. The next call runs at native speed.
```

The two things to hold onto: a JIT is **a compiler running concurrently with your program**, and its trigger is **counters that detect hotness.** Nothing mystical.

### 4. Why a JIT can use information AOT can't

This is the conceptual heart. An AOT compiler sees only the *source*. A JIT sees the *running program*. So a JIT can record and exploit facts that are simply unavailable at build time:

- **Observed types.** In a dynamic language, `a + b` could be ints, floats, strings, or user objects. The JIT watches and sees: *"at this call site, it's always been two ints."* It compiles a fast int-add path (with a cheap guard), instead of the fully general dispatch an AOT compiler would be forced to emit.
- **Branch frequencies.** The JIT sees that an `if` is taken 99.9% of the time, and lays out the common path straight-line (good for the instruction cache and branch predictor), shoving the rare path off to the side.
- **Devirtualization.** A virtual/interface call *could* go to many implementations, but the JIT sees it has only ever gone to one — so it inlines that one directly, with a guard to fall back if a new type ever shows up.
- **Inlining across "dynamic" boundaries.** The JIT can inline a callee it only knows at runtime, then optimize the combined code as a unit.

All of these are **speculative** — bets based on past behavior, protected by cheap **guards**. If a guard fails (a new type appears, the rare branch fires), the JIT bails out (deoptimizes — covered at senior level). The point for now: *the JIT trades a small per-bet check for the ability to specialize on reality.*

### 5. Tiered compilation: the speed/quality tension

There is no single best compiler, because two goals conflict:

- *Compile fast* → get off the slow interpreter sooner → but produce only modestly optimized code.
- *Compile well* → produce excellent code → but it takes longer, delaying the benefit.

The resolution every serious runtime adopts: **use several tiers.**

```text
HotSpot:   interpreter  →  C1 (client, fast/cheap)  →  C2 (server, slow/optimal)
V8:        Ignition (interp) → Sparkplug (baseline) → Maglev (mid) → TurboFan (optimizing)
.NET:      interpreter-ish / QuickJIT (Tier 0)      →  optimizing JIT (Tier 1)
```

Code starts interpreted. Once warm, a *cheap* compiler (HotSpot's C1, V8's Sparkplug) quickly produces decent native code — big win, small delay. If the code keeps running hot, the *expensive* compiler (C2, TurboFan) recompiles it into highly optimized code. Cold code never escapes the interpreter, and that's fine. **Tiering gets you most of the speedup quickly and the last bit of speedup eventually** — the best of both compilers.

HotSpot even uses the lower tier to *collect profiles* for the higher tier: C1-compiled code includes counters whose data C2 later consumes. The tiers cooperate.

### 6. Warmup, and why it's unavoidable

**Warmup** is the time from launch until the program reaches peak speed. It's unavoidable in a JIT because:

1. The runtime *must* run code (interpreted or low-tier) for a while to know it's hot — you can't profile code that hasn't run.
2. Compilation itself consumes CPU, competing with your program.
3. Higher tiers wait for enough profiling data to optimize well.

So a JIT'd program's speed-over-time looks like a curve that starts low and climbs to a plateau. For a server that lives for hours, this is a rounding error. For a CLI that lives 50 ms, warmup is *the entire lifetime* — the program exits before reaching peak, having paid all the cost and reaped none of the benefit. **This single fact is why AOT exists for short-lived programs.**

### 7. On-Stack Replacement (OSR): optimizing a loop already in flight

Consider:

```text
function main() {
    for i in 0 .. 1_000_000_000 {   // one giant loop
        work(i)
    }
}
```

`main` is called *once*. Its invocation counter will never trigger compilation. But the loop is blazing hot. Without help, this loop would run interpreted forever, even as the *backedge* counter screams "compile me!"

**OSR** solves this. When the backedge counter trips, the JIT compiles the *loop* (not just future calls), then performs a delicate maneuver: it **transfers the currently-running interpreted frame into the freshly compiled code mid-loop** — copying over the live local variables and the loop index, and jumping into the compiled loop at the right point. The loop continues, now at native speed, *without restarting.* That's on-stack replacement: replacing the executing frame on the stack with a compiled version.

OSR is why a JIT can speed up a single long-running loop in `main`, not just code that's called repeatedly. It's fiddly (the runtime must map interpreter state to compiled-code state exactly) but essential for real workloads dominated by big loops.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Dispatch overhead** | A short-order cook who, between every single chop, has to re-read the ticket to find out what to do next. The reading, not the chopping, eats the time. |
| **Switch dispatch** | One central dispatcher radioing every taxi from one desk — a bottleneck, and the dispatcher can't predict who's next. |
| **Threaded dispatch** | Each taxi knowing directly which taxi tends to follow it, so handoffs are smooth and predictable. |
| **Invocation/backedge counters** | A turnstile counting how often a door is used; once it's busy enough, management installs an escalator (compiles it). |
| **Tiered compilation** | A draft system: a fast typist produces a rough usable draft immediately; a meticulous editor later rewrites the *frequently-read* chapters to perfection. |
| **Warmup** | A car engine that runs rich and sluggish until it reaches operating temperature, then settles into efficient cruising. |
| **OSR** | Re-treading a tire *while the car is still rolling* — swapping the worn (interpreted) loop for a fresh (compiled) one without stopping the journey. |
| **Inline cache** | A receptionist who remembers "the last three callers all wanted the sales team" and routes instantly until a different request arrives. |

---

## Mental Models

### The "Fetch-Decode-Dispatch Tax" Model

Picture every interpreted instruction as: *(tax) + (work) + (tax)*, where the tax is fetch/decode/dispatch and the work is the actual operation. For cheap operations, tax ≫ work. Native code pays the tax *once*, at compile time, and then the running program is *all work.* Every interpreter optimization (threading, superinstructions, specialization) is an attempt to shrink the tax; every JIT is an attempt to *eliminate* it for hot code.

### The "JIT is a Compiler on a Background Thread, Steered by Counters" Model

Replace "JIT magic" with this concrete picture: counters tick as code runs; when one trips, a *normal compiler* (running on another thread, using profile data) emits native code into a buffer; the method's entry is repointed at that buffer. Everything advanced — tiering, OSR, deopt — is an elaboration of this loop. Holding this model stops you from over-mystifying JITs.

### The "Speculate-and-Guard" Model

A JIT's power comes from *betting*: "this is always an int," "this branch is never taken," "this call always lands here." Each bet is wrapped in a cheap **guard** that checks the bet still holds; if it fails, fall back. Trade: a tiny per-bet check buys you aggressively specialized code. The whole adaptive-optimization edifice is bets plus guards plus a fallback (deoptimization).

### The "Climb to Peak" Model

A JIT'd program's throughput over time is a rising curve: interpret (low) → baseline JIT (mid) → optimizing JIT (high plateau). An AOT program is a flat line at the plateau from t=0. Whether the area-under-the-curve favors JIT or AOT depends entirely on **how long the program runs.** Short run: AOT's flat line wins. Long run: JIT reaches the same plateau and the early deficit becomes negligible.

---

## Code Examples

### A switch-dispatch bytecode interpreter (tiny but real)

```c
typedef enum { OP_PUSH, OP_ADD, OP_MUL, OP_PRINT, OP_HALT } Opcode;

void run(int *bytecode) {
    int stack[256];
    int sp = 0;
    int *pc = bytecode;
    for (;;) {
        switch (*pc++) {                      // <-- DISPATCH
            case OP_PUSH:  stack[sp++] = *pc++;            break;
            case OP_ADD:   stack[sp-2] += stack[sp-1]; sp--; break;
            case OP_MUL:   stack[sp-2] *= stack[sp-1]; sp--; break;
            case OP_PRINT: printf("%d\n", stack[sp-1]);     break;
            case OP_HALT:  return;
        }
    }
}
// program for (2 + 3) * 4:
// PUSH 2, PUSH 3, ADD, PUSH 4, MUL, PRINT, HALT
```

Every iteration: load `*pc`, run the `switch` (an indirect jump), do tiny work, loop. The `switch` is the dispatch tax.

### The same interpreter, threaded with computed goto (GCC/Clang)

```c
void run_threaded(int *bytecode) {
    static void *table[] = { &&do_push, &&do_add, &&do_mul, &&do_print, &&do_halt };
    int stack[256]; int sp = 0; int *pc = bytecode;
    #define DISPATCH() goto *table[*pc++]      // <-- dispatch baked into each handler
    DISPATCH();
do_push:  stack[sp++] = *pc++;              DISPATCH();
do_add:   stack[sp-2] += stack[sp-1]; sp--;  DISPATCH();
do_mul:   stack[sp-2] *= stack[sp-1]; sp--;  DISPATCH();
do_print: printf("%d\n", stack[sp-1]);       DISPATCH();
do_halt:  return;
}
```

Functionally identical, but each handler ends with its *own* indirect jump. The branch predictor now learns per-opcode transition patterns, often cutting dispatch cost substantially. This is a real technique CPython uses.

### Observing tiered compilation in the JVM

Run any hot-loop Java program with diagnostics:

```bash
java -XX:+PrintCompilation Warmup 2>&1 | head -40
```

You'll see lines like:

```text
   45    1       3       Warmup::addToN (12 bytes)     <- tier 3 = C1 with profiling
  120    2       4       Warmup::addToN (12 bytes)     <- tier 4 = C2 (optimizing)
  121    1       3       Warmup::addToN (12 bytes)   made not entrant
```

The number after the method (`3`, then `4`) is the **tier**. You can literally watch `addToN` get promoted from C1 (tier 3) to C2 (tier 4) as it stays hot. The `made not entrant` line is the old C1 code being retired in favor of the C2 version.

### Forcing OSR to reveal itself

```java
public class OsrDemo {
    public static void main(String[] args) {
        long total = 0;
        // One call to main; a single enormous loop. Only OSR can speed this up.
        for (long i = 0; i < 5_000_000_000L; i++) {
            total += i % 7;
        }
        System.out.println(total);
    }
}
```

Run with `-XX:+PrintCompilation` and look for a `%` in the output — HotSpot marks OSR compilations with `%`:

```text
  210   12 %     4       OsrDemo::main @ 9 (28 bytes)   <- the % means OSR
```

The `@ 9` is the bytecode offset of the loop where the running frame was swapped to compiled code. Without OSR, this loop would crawl along interpreted because `main` is only ever called once.

### Watching V8 tiers (Node.js)

```bash
node --trace-opt --trace-deopt hot.js
```

With a function called in a hot loop, you'll see V8 report optimizing (TurboFan) the function, and — if a speculation fails — deoptimizing it. This is the JS-side mirror of the JVM output above.

---

## Pros & Cons

| Aspect | Interpreter | JIT | AOT |
|--------|-------------|-----|-----|
| **Dispatch overhead** | Pays it on every instruction. | Eliminated for hot code; cold code still pays it. | None — code is native. |
| **Uses runtime profiles** | No. | Yes — its core advantage. | Only via a separate PGO step (offline). |
| **Startup** | Fast (no compile). | Slow (warmup). | Fastest. |
| **Peak throughput** | Low. | High (often matches/beats AOT). | High. |
| **Memory** | Low. | High (compiler + code cache + profiles). | Low. |
| **Adapts mid-run (OSR, respecialization)** | N/A. | Yes. | No. |
| **Complexity to implement** | Low. | Very high. | Medium-high. |
| **Code-gen at runtime as attack surface** | No runtime codegen. | Yes — writable+executable memory. | No runtime codegen. |

---

## Use Cases

- **Threaded/computed-goto interpreters** are the right investment when you must stay an interpreter (portability, simplicity, fast startup) but want to claw back speed without writing a JIT — exactly CPython's and LuaJIT's interpreter strategy.
- **Tiered JITs** suit long-running, throughput-sensitive systems (app servers, browsers, databases) where warmup amortizes and peak speed compounds over billions of operations.
- **OSR** matters for any workload dominated by a *single long loop* called once — batch jobs, simulation kernels, data-processing inner loops. Without OSR a JIT can't help those.
- **AOT** remains the answer when warmup is a tax you can't afford: CLIs, serverless, and latency-critical cold starts.

---

## Coding Patterns

### Pattern 1: Benchmark *after* warmup, and report both numbers

For JIT'd languages, measure startup-to-first-result *and* steady-state throughput separately. Use a proper harness (JMH for Java, `benchmark.js`/`tinybench` for JS) that discards warmup iterations.

```text
phase 1: run hot path until -XX:+PrintCompilation shows tier-4 (warmed up)
phase 2: time the now-compiled hot path
report: cold-start latency AND warm throughput — they are different products
```

### Pattern 2: Help the JIT keep its bets cheap (monomorphic call sites)

A JIT specializes best when a call site sees *one* type ("monomorphic"). Code that throws many types at one site ("megamorphic") defeats inline caches and devirtualization. Pattern: keep hot call sites type-stable — don't mix wildly different objects through the same hot dispatch point.

### Pattern 3: Pre-warm before taking load (servers)

For JIT'd services behind a load balancer, run synthetic traffic through the hot paths *before* marking the instance healthy, so real users don't hit the interpreting phase.

```text
on startup: replay representative requests N times (warmup)
then:       signal readiness / register with the load balancer
```

### Pattern 4: Don't fight OSR with awkward loop shapes

OSR works best on standard counted loops. Bizarre control flow (loops with many exits, gotos) can make a runtime fail to OSR-compile and leave a hot loop interpreted. Keep hot loops conventional.

---

## Best Practices

- **Profile to find what's actually hot before optimizing.** In any of these runtimes, the cost is concentrated in a few hot methods/loops; optimize those, ignore the rest.
- **Trust the tiered system; don't second-guess it.** Hand-rolling "manual JIT hints" is rarely worth it; let counters and profiles do their job. Tune thresholds only with data.
- **Account for warmup in SLOs and benchmarks.** A p99 latency measured during warmup is meaningless for a long-lived service — and critical for a short-lived one.
- **Prefer type-stable hot paths.** Monomorphic call sites are the JIT's happy path; megamorphic ones are slow in every JIT'd language.
- **Know which dispatch your interpreter uses.** If you ship or embed an interpreter (Lua, a scripting engine), building it with computed-goto support can be a free 20–40% win.
- **Separate cold-start and steady-state thinking.** They optimize differently and often pull in opposite directions (AOT helps one, JIT the other).

---

## Edge Cases & Pitfalls

- **Benchmarking the interpreter by accident.** Running a JIT'd function once and timing it measures interpretation + compilation, not the compiled code. Always warm up first; this is the single most common JIT-benchmark mistake.
- **A loop in `main` that's slow despite a JIT.** If your runtime lacks OSR (or fails to OSR a weird loop), a hot loop in a once-called function stays interpreted. Restructuring into a separately-called hot function can let the normal invocation-counter path compile it.
- **Megamorphic call sites silently killing performance.** A hot dispatch point that sees dozens of types can't be devirtualized or inline-cached well; throughput craters with no obvious error.
- **Computed goto isn't portable.** Threaded interpreters using `&&label`/`goto *` compile on GCC/Clang but not MSVC, which historically forced a switch-based fallback path (and slower interpretation on Windows builds).
- **Warmup spikes under autoscaling.** Every newly spawned JIT'd instance re-warms; a sudden scale-out event can cause a latency spike as fresh instances interpret before compiling. Pre-warming mitigates this.
- **Code cache exhaustion.** A JIT writes native code into a fixed-size code cache. Pathologically large or numerous methods can fill it; HotSpot then stops compiling and silently falls back to interpreting, tanking performance. (`-XX:ReservedCodeCacheSize` tunes it.)
- **Confusing tier numbers.** In HotSpot, tier 3 is C1-*with-profiling* and tier 4 is C2; tier 1 is C1-*without*-profiling. The numbers aren't a simple "higher = more optimized" ladder, which trips people reading `PrintCompilation`.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 UNDER THE HOOD: DISPATCH, JIT, TIERS              │
├──────────────────────────────────────────────────────────────────┤
│ Interpreter loop = FETCH → DECODE → DISPATCH → (tiny work) → loop │
│   The dispatch (indirect jump) is the tax. Threading shrinks it.  │
├──────────────────────────────────────────────────────────────────┤
│ Dispatch ladder (cheapest last):                                  │
│   switch        one central indirect jump (bad prediction)        │
│   indirect      handler addresses via a table (compact)           │
│   direct/threaded  jump baked into each handler (best prediction) │
│   needs computed-goto (&&label, goto *) — GCC/Clang only          │
├──────────────────────────────────────────────────────────────────┤
│ A JIT, demystified:                                               │
│   counters detect hot → bg compiler reads bytecode + PROFILE →    │
│   emits native into code cache → repoint entry → run native       │
├──────────────────────────────────────────────────────────────────┤
│ JIT's edge over AOT: runtime PROFILE it bets on, guarded:         │
│   observed types · branch freq · devirtualization · inlining      │
├──────────────────────────────────────────────────────────────────┤
│ Tiered compilation (speed vs quality):                            │
│   HotSpot: interp → C1 → C2                                        │
│   V8:      Ignition → Sparkplug → Maglev → TurboFan               │
│   .NET:    Tier 0 (QuickJIT) → Tier 1 (optimizing)               │
├──────────────────────────────────────────────────────────────────┤
│ Warmup = unavoidable climb to peak (must run to profile).         │
│ OSR    = swap a RUNNING interpreted loop for compiled, mid-flight.│
│          (HotSpot marks it '%' in PrintCompilation.)              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- An interpreter's cost is dominated by **dispatch** — fetch/decode/jump-to-handler — not by your arithmetic. The **switch → indirect → direct(threaded)** ladder makes dispatch cheaper, mostly by helping the CPU branch predictor; **computed goto** is the enabling compiler feature (GCC/Clang).
- A **JIT is just a compiler running inside your process**, triggered by **invocation and backedge counters**, fed by **profiles**, emitting native code into a **code cache** and repointing method entries at it.
- The JIT's superpower over AOT is **profile-driven speculation**: observed types, branch frequencies, devirtualization, and cross-boundary inlining — each a **bet wrapped in a cheap guard**.
- **Tiered compilation** resolves the speed-vs-quality tension: a fast cheap compiler (C1, Sparkplug) gets code off the interpreter quickly; a slow optimizing compiler (C2, TurboFan) perfects the hottest code later. Lower tiers also *collect profiles* for higher tiers.
- **Warmup** is unavoidable — you must run code to know it's hot, and compiling costs CPU. A program's throughput climbs to a plateau; whether JIT or AOT wins depends on **how long it runs.**
- **On-Stack Replacement (OSR)** lets a JIT optimize a loop that's *already executing* in a once-called function, swapping the live frame into compiled code mid-loop — essential for big-loop workloads.
- Practical consequences: warm up before benchmarking, keep hot call sites **monomorphic**, **pre-warm** JIT'd servers before taking load, and remember that runtime code generation is both the JIT's power and a security surface.

---

## Further Reading

- *Crafting Interpreters* (Part III, "A Bytecode Virtual Machine") — Robert Nystrom. Builds a real bytecode VM and discusses dispatch. https://craftinginterpreters.com/
- *The Structure and Performance of Efficient Interpreters* — Ertl & Gregg. The definitive study of threaded dispatch and branch prediction.
- *Tiered Compilation in the JVM* — the HotSpot tiered-compilation design documents and `PrintCompilation` references.
- *Sparkplug — a non-optimizing JavaScript compiler* — V8 blog. Why a fast baseline tier matters.
- *Launching Ignition and TurboFan* — V8 blog. The bytecode + JIT pipeline of a modern JS engine.
- *On-Stack Replacement in the HotSpot JVM* — talks and papers on how live frames are migrated to compiled code.
- *Inside the Python 3.11 specializing adaptive interpreter* — for a modern take on speeding up a bytecode interpreter without a full JIT.
- *Computed gotos for efficient dispatch tables* — Eli Bendersky's blog post, a clear hands-on explanation.
