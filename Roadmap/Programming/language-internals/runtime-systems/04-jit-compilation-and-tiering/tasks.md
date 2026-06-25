# JIT Compilation & Tiering — Hands-On Tasks

> **Topic:** [JIT Compilation & Tiering](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have heard
of warmup" to "I can read a tier transition in `PrintCompilation`, prove
escape analysis eliminated an allocation, force a megamorphic regression on
purpose, and decide between JIT and AOT for a real workload." Every task is
small enough for one or two focused sessions, and they build on one another.
Attempt each one *before* reading the hints — five minutes of watching a
function refuse to speed up teaches more than any explanation.

How to use this file: read the task, write the code, run it under the trace
flags it names (`-XX:+PrintCompilation`, `--trace-opt`, `-jdump`), and only
then check the hints. Mark a self-check box when you can *explain the
observed output to another person*, not when the program merely runs. The
sample solutions are intentionally sparse — they appear only where the
canonical answer is more instructive than your first attempt would be. Most
tasks are about *observing the runtime*, not writing clever code.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks build the mental model: warmup is real, the runtime will narrate
what it does, and tiers are observable.

### Task 1: Feel the warmup curve

**Problem.** Write a program (Java or Node) that runs the same compute-heavy
function in batches, timing each batch, for ~30 batches. Print the per-batch
time. Identify the batch at which the time stops dropping and flattens.

**Constraints.**
- Use the same input and the same loop body in every batch.
- Print the result somewhere so it can't be optimized away.
- Do not change any flags yet — observe the *default* curve.

**Hints (try without first).**
- The first few batches are noticeably slower; the time then drops in one or
  two steps and flattens. Those steps are tier transitions.
- If your times are *flat from the start*, your function is probably too
  trivial (dead-code-eliminated) or your batches too short. Make it heavier.

**Self-check.**
- [ ] You can point at the batch where the JIT clearly kicked in.
- [ ] You can explain why "the same code" got faster with no code change.
- [ ] You can articulate why timing only batch 0 would be misleading.

---

### Task 2: Make the runtime narrate

**Problem.** Re-run Task 1's program under `-XX:+PrintCompilation` (Java) or
`--trace-opt` (Node). Find your hot function in the output and describe its
journey.

**Constraints.**
- Capture the output to a file and search it for your function name.
- For Java, note the tier column and any `%` (OSR) or `made not entrant`
  markers.

**Hints (try without first).**
- In HotSpot, you'll typically see your function compiled at tier 3 first,
  then again at tier 4 — the 3→4 jump is C1-with-profiling handing to C2.
- A `%` means the loop was OSR-compiled (replaced mid-run). `made not
  entrant` means an older compiled version was retired for a newer one.
- In Node, `--trace-opt` prints a line when V8 optimizes your function.

**Self-check.**
- [ ] You found the exact line(s) where your function was compiled.
- [ ] You can read the tier number and say what it means.
- [ ] You can match a tier transition in the log to a drop in Task 1's curve.

---

### Task 3: Break a benchmark with dead-code elimination

**Problem.** Write a "benchmark" that computes a value in a loop but *never
uses it*, and time it. Then fix it to consume the result. Compare.

**Constraints.**
- Version A: compute `result` and discard it.
- Version B: accumulate `result` into a sink and print the sink.
- Run both warmed up.

**Hints (try without first).**
- Version A may report an impossibly small time — the JIT legally deleted the
  whole computation because it has no observable effect.
- Version B reports the real cost. The difference *is* the lesson.

**Self-check.**
- [ ] You produced a "0 ms" (or near-zero) result from version A.
- [ ] You can explain the as-if rule that permits the deletion.
- [ ] You understand why JMH/benchmark.js use blackholes/sinks.

<details>
<summary>Sparse solution sketch</summary>

The trap is that `for (...) compute(i);` with the result discarded has no
side effect, so the optimizer removes the loop body, then the loop. Consume
the result: `long sink = 0; for (...) sink += compute(i); print(sink);`. Real
harnesses provide a "blackhole" that consumes a value in a way the compiler
cannot see through.
</details>

---

### Task 4: Cap the top tier and measure the cost

**Problem.** Run your Task 1 Java program three ways and compare steady-state
batch time: default tiered, `-XX:TieredStopAtLevel=1`, and (optionally)
`-XX:-TieredCompilation`. Explain the differences in startup and peak.

**Constraints.**
- Compare the *flattened* (steady-state) batch time, not batch 0.
- Also note, informally, how quickly each reaches steady state.

**Hints (try without first).**
- `TieredStopAtLevel=1` (C1 only, no C2) usually starts faster but tops out
  *slower* — the best optimizations live in C2/tier 4.
- Pure non-tiered C2 usually starts *slower* but reaches a high peak.

**Self-check.**
- [ ] You measured a higher steady-state floor with `TieredStopAtLevel=1`.
- [ ] You can state the startup-vs-throughput trade-off from your own numbers.
- [ ] You can name a workload where each setting is the right choice.

---

## Core

These tasks make individual optimizations and counters *visible*.

### Task 5: Trigger and recognize OSR

**Problem.** Write a method called exactly **once** that contains a loop
running tens of millions of times. Run under `-XX:+PrintCompilation` and find
the OSR compilation of that loop.

**Constraints.**
- The method's invocation count must stay at 1; the loop's back-edge count
  must be huge.
- Identify the `%`-marked line for your method.

**Hints (try without first).**
- Because the method is called once, only the back-edge counter trips — so
  normal method-entry compilation never fires; OSR is what rescues the loop.
- The `%` in the PrintCompilation line is the tell-tale OSR marker.

**Self-check.**
- [ ] You found the `%` OSR line for your loop.
- [ ] You can explain why the invocation counter alone would never compile it.
- [ ] You can describe what state must be transferred to enter compiled code
      mid-loop.

---

### Task 6: Observe monomorphic vs megamorphic in V8

**Problem.** Write a Node function `getX(o) { return o.x; }` and benchmark it
twice: once over 1,000 objects that all share one shape (monomorphic), once
over objects with ~50 distinct shapes (megamorphic). Compare times under
`--trace-opt`.

**Constraints.**
- The *only* difference between runs must be object shape stability.
- Warm up both before timing.

**Hints (try without first).**
- Create distinct shapes by adding a differently-named property per object
  (`o['k' + (i % 50)] = i`).
- The monomorphic run is dramatically faster: its inline cache stays
  specialized and `getX` inlines; the megamorphic run can't specialize.

**Self-check.**
- [ ] You measured a large gap from shape stability alone.
- [ ] You can explain what the inline cache at `o.x` recorded in each case.
- [ ] You can connect "megamorphic" to "inlining lost" to "slow."

<details>
<summary>Sparse solution sketch</summary>

Monomorphic: build `{x:i}` uniformly. Megamorphic: give each object an extra,
varying-named property so its hidden class differs. Same `getX`, same loop —
the IC at `o.x` is monomorphic in the first case (fast, inlinable) and
megamorphic in the second (generic lookup, no inline). This is the single
most important practical lesson about dynamic-language JITs.
</details>

---

### Task 7: Prove escape analysis eliminated an allocation

**Problem.** Write a Java loop that "creates" hundreds of millions of small
value objects that never escape their method (e.g., a `Vec` used only to
compute a dot product). Run with escape analysis on (default) and off
(`-XX:-DoEscapeAnalysis`). Compare throughput and, if you can, allocation
counts.

**Constraints.**
- The objects must be provably non-escaping (not stored in a field, not
  returned, not passed to an unknown method).
- Measure steady state.

**Hints (try without first).**
- With EA on, scalar replacement turns the objects into registers and the
  loop allocates essentially nothing despite "creating" billions.
- With `-XX:-DoEscapeAnalysis`, the same loop allocates per iteration and the
  GC works hard — throughput drops.
- Use a GC log or an allocation profiler to *see* the allocations appear.

**Self-check.**
- [ ] You observed a throughput difference between EA on and off.
- [ ] You can state the conditions under which an object "escapes."
- [ ] You can explain why inlining makes EA more powerful.

---

### Task 8: Watch a deopt happen on purpose

**Problem.** In Node, optimize a function by feeding it one consistent type
many times, then suddenly feed it a different type. Run under
`--trace-opt --trace-deopt` and find the deoptimization.

**Constraints.**
- Phase 1: call `add(a, b)` with integers until it optimizes.
- Phase 2: call `add("x", "y")` once.
- Capture and locate the `deoptimizing` line.

**Hints (try without first).**
- V8 specializes `add` for integer arithmetic with an overflow guard. The
  string call violates the type assumption and forces a bailout.
- The `deoptimizing` line names the function and (often) the reason.

**Self-check.**
- [ ] You produced a single, intentional deopt.
- [ ] You can explain which assumption the guard protected and how it failed.
- [ ] You can describe what the runtime does after deopt (fall back,
      re-profile, possibly re-optimize more generally).

---

### Task 9: Confirm bounds-check elimination

**Problem.** Write a Java loop summing an `int[]` with a clean
`for (i=0; i<a.length; i++) s += a[i]`. Then write a second version that
indexes the array through a separate index array so the JIT *cannot* relate
the index to the length. Compare speed; if you have hsdis, inspect the
assembly.

**Constraints.**
- Both versions touch the same number of elements.
- Warm both to top tier before measuring.

**Hints (try without first).**
- The clean loop's index is provably in range, so the per-iteration bounds
  check is eliminated; the indirect version reintroduces a check the JIT
  can't prove away.
- `-XX:+PrintAssembly` (with hsdis) shows the inner loop with no bounds
  comparison in the clean case.

**Self-check.**
- [ ] You measured the indirect version slower.
- [ ] You can explain why the clean loop's check is provably redundant.
- [ ] (If you used hsdis) you found the loop body has no bounds compare.

---

### Task 10: Inspect a tracing JIT

**Problem.** Write a tight numeric loop in Lua and run it under
`luajit -jdump`. Identify a recorded trace and at least one guard.

**Constraints.**
- The loop must be hot enough to be traced (millions of iterations).
- Locate the IR/mcode dump for the trace.

**Hints (try without first).**
- `-jdump` prints the trace LuaJIT recorded for the hot loop, its guards, and
  the generated machine code.
- This is a *different* JIT model from HotSpot/V8: the unit of compilation is
  a linear loop trace, not a whole method.

**Self-check.**
- [ ] You found a recorded trace in the dump.
- [ ] You can point at a guard and say what it protects.
- [ ] You can explain what a side-exit does when a guard fails.

---

## Advanced

These tasks connect optimizations to production behavior.

### Task 11: Force a megamorphic regression in Java

**Problem.** Build a hot loop calling a virtual method over an array that is
initially all one concrete type (monomorphic). Confirm with
`-XX:+PrintInlining` that the call inlines and the loop is fast. Then mix in
several more subtypes until the site goes megamorphic. Show that inlining
disappears and throughput drops.

**Constraints.**
- Keep everything else identical between the two runs.
- Use `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`.

**Hints (try without first).**
- With one type, the profile lets C2 speculatively devirtualize and inline.
- With many types, there's no dominant receiver to bet on; the site falls
  back to vtable dispatch, inlining is lost, and the loop slows sharply.

**Self-check.**
- [ ] You saw the method inline in the monomorphic case and not in the
      megamorphic case.
- [ ] You measured the throughput drop.
- [ ] You can explain why this regression is invisible in a flat CPU profile.

<details>
<summary>Sparse solution sketch</summary>

`Shape[]` of all `Circle` → `x.area()` inlines (profile sees one type). Fill
the array with `Circle/Square/Triangle/...` (enough distinct types to exceed
the polymorphic limit) → the site is megamorphic, `PrintInlining` reports it
was *not* inlined ("not inlined: virtual call" / megamorphic), and the loop
runs at vtable-dispatch speed. Mirrors the classic "added a subclass, perf
halved" incident.
</details>

---

### Task 12: Provoke and recognize code-cache exhaustion

**Problem.** Run an application that compiles a lot of methods with a
deliberately tiny `-XX:ReservedCodeCacheSize` (e.g., `8m`). Observe the
`CodeCache is full` message and the throughput drop. Then inspect the cache
with `jcmd <pid> Compiler.codecache`.

**Constraints.**
- Use a program with a large enough hot-method footprint to fill 8 MB.
- Capture the moment compilation is disabled and behavior changes.

**Hints (try without first).**
- When the cache fills, HotSpot can disable the compiler; methods not already
  compiled fall back to the interpreter — a throughput cliff.
- In production this looks like "throughput halved, nothing in app logs."

**Self-check.**
- [ ] You triggered `CodeCache is full. Compiler has been disabled.`
- [ ] You observed (or can explain) the resulting throughput drop.
- [ ] You can describe how you'd monitor and alert on this in production.

---

### Task 13: Quantify the warmup tax for a short-lived process

**Problem.** Take a representative workload and measure how long (or how many
iterations) it takes to reach steady state. Then estimate the warmup cost as
a fraction of total work for a process that runs for, say, 300 ms versus one
that runs for 1 hour.

**Constraints.**
- Express warmup duration concretely (ms or iterations to flatten).
- Compute the warmup-as-fraction-of-total for both lifetimes.

**Hints (try without first).**
- For the 1-hour process, warmup is a rounding error. For the 300 ms process,
  warmup may be most of the run — the process dies before the JIT pays off.
- This number is exactly what justifies switching short-lived workloads to
  AOT.

**Self-check.**
- [ ] You produced a concrete warmup duration.
- [ ] You computed warmup-as-fraction for both lifetimes.
- [ ] You can state the lifetime threshold below which AOT is the better bet
      for this workload.

---

### Task 14: Compare JIT and AOT startup (GraalVM)

**Problem.** Take a small JVM program, run it normally (JIT), then build it
with GraalVM Native Image (AOT) and run the binary. Compare startup time and,
if the program runs long enough, peak throughput.

**Constraints.**
- Measure startup (time to first useful output) for both.
- If your program has a hot loop, also measure steady-state throughput.

**Hints (try without first).**
- The native binary starts in milliseconds with a flat profile (no warmup);
  the JIT version starts slower but reaches a higher peak throughput.
- For a short-lived process the native binary wins overall; for a long-lived
  throughput service the JIT version wins overall.

**Self-check.**
- [ ] You measured a large startup advantage for the native binary.
- [ ] You measured (or can reason about) the JIT's peak-throughput advantage.
- [ ] You can articulate which workloads each model suits and why.

---

## Capstone

### Task 15: Diagnose a synthetic "mystery regression"

**Problem.** Construct a service-like Java program with a hot request path.
Establish a fast baseline and confirm (via `-XX:+PrintInlining`) that the key
call inlines. Then introduce *one* of the following silent regressions and
diagnose it *using only runtime tooling*, without looking at your own diff:
(a) a new subtype on a hot hierarchy (megamorphic), (b) removing `final` from
a hot method, (c) shrinking the code cache below the working set, or (d)
unstable types causing a deopt storm. Write up the symptom, the tool that
revealed it, and the root cause.

**Constraints.**
- Pick one regression and hide which one from your "diagnosis" notes until
  the end.
- Use `PrintCompilation`, `PrintInlining`, JFR or async-profiler, and
  `jcmd Compiler.codecache` as appropriate.
- Produce a short incident-style writeup.

**Hints (try without first).**
- Megamorphic: `PrintInlining` shows the key call no longer inlines; CPU per
  request rises with no obvious culprit.
- Removed `final`: the call that was statically devirtualized now depends on
  speculation and may go polymorphic.
- Code-cache: `CodeCache is full`, methods fall back to interpreter, no app
  log explanation.
- Deopt storm: repeated optimize/deopt churn on one method, high compiler
  CPU, sawtooth throughput.

**Self-check.**
- [ ] You diagnosed the regression from runtime signals alone.
- [ ] You named the *exact* tool output that revealed it.
- [ ] You identified the upstream root cause and the correct fix (not a flag
      band-aid where a data/structure fix is required).
- [ ] You can explain why this class of bug is invisible to source review and
      to a naive flame graph.

<details>
<summary>Sparse solution sketch</summary>

The discipline here is *runtime-first* diagnosis. Symptom → tool → cause:
- "Throughput halved, nothing in logs" → `jcmd Compiler.codecache` / the
  `CodeCache is full` message → exhaustion → raise `ReservedCodeCacheSize`
  and monitor occupancy.
- "Hot path got slower after a feature merge" → `-XX:+PrintInlining` shows the
  key call not inlined → megamorphic site (or lost `final`) → restore
  monomorphism / restore `final` / split the call path.
- "High compiler CPU, sawtooth throughput" → JFR/`--trace-deopt` shows
  repeated deopts on one method → unstable types → stabilize the data, don't
  reach for a flag.
The point is that each fix is *upstream of the JIT*: you make the program
more predictable so the JIT's bets become safe again.
</details>
