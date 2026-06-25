# Deoptimization & Speculation — Hands-On Tasks

> **Topic:** [Deoptimization & Speculation](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have heard
the word deopt" to "I can force a deopt on demand, read the reason it fired,
distinguish warm-up from a storm, and stabilize the broken bet without
disabling the optimizer." The whole point is to make an invisible mechanism
*visible* with your own eyes — so almost every task is run-and-observe, not
just read-and-nod.

How to use this file: read the task, write and run the program **under the
tracing flags it specifies** (`node --trace-deopt`, `java -XX:+PrintCompilation`,
etc.), and only then check the hints. Mark a self-check box when you can
*explain the trace output to someone else*, not when the program merely runs.
The sample solutions are intentionally sparse — they appear only where the
canonical answer is more instructive than your first attempt.

A note you must internalize before starting: **a deopt is never a wrong
answer.** Every program in this file prints the correct result; the exercises
are purely about *speed* and *why the engine bailed*. If you ever think a
deopt corrupted your output, you have a logic bug, not a deopt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks rebuild the mental model and get the tooling working. Short, but
each one introduces a primitive or a failure mode you'll reuse.

### Task 1: See your first deopt

**Problem.** Write a JS function `add(a, b)` that returns `a + b`. Warm it up
by calling it a million times with two integers. Then call it once with two
strings. Run it under V8's deopt tracing and capture the deopt line.

**Constraints.**
- Use Node.js.
- Run with `node --trace-opt --trace-deopt add.js`.
- Print the result of the string call to prove the program is still correct.

**Hints (try without first).**
- The warm-up loop must actually *use* the result (accumulate it), or dead-code
  elimination may delete the calls and you'll see nothing.
- Look for a line containing `deoptimizing` and a reason like `not a Smi`.
- The string call still prints `helloworld` — correct, just slow.

**Self-check.**
- [ ] You found the `[deoptimizing ...]` line and can read its reason.
- [ ] You can explain *which guard* failed (the integer/Smi check).
- [ ] You can state why the output is still correct.

---

### Task 2: Get the JVM tooling working

**Problem.** Write any Java program with a hot loop calling a small method a
few million times. Run it so that you can see compilation and deopt events.

**Constraints.**
- Run with
  `java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+TraceDeoptimization YourClass`.
- Identify in the output: a method being compiled, and the meaning of the `%`
  marker.

**Hints (try without first).**
- `%` in `PrintCompilation` means On-Stack Replacement — a long-running loop
  compiled mid-execution.
- You won't necessarily see a deopt yet (Java is statically typed). The goal
  here is just to read the compilation log fluently.
- `made not entrant` and `made zombie`, if they appear, mean invalidated code.

**Self-check.**
- [ ] You can point at a method-compiled line and an OSR (`%`) line.
- [ ] You understand why you might *not* see a type-deopt in plain Java.

---

### Task 3: Warm-up vs steady state

**Problem.** Take the function from Task 1 but feed it *only* integers, for
ten million iterations. Count how many deopt lines appear. Then describe the
difference between the deopts you see now (if any) and a "storm."

**Constraints.**
- Same `--trace-deopt` run.
- Do not introduce any non-integer input.

**Hints (try without first).**
- You may see a *few* deopts very early as the engine settles on types, then
  silence. That early flurry is **warm-up**, and it's normal.
- A storm, by contrast, keeps firing on the *same* function with the *same*
  reason long after warm-up.

**Self-check.**
- [ ] You can distinguish "a few warm-up deopts then quiet" from "repeating."
- [ ] You can articulate why only *repeating* deopts are a problem.

---

## Core

These tasks force specific deopt *reasons* and teach you to read them as
root-cause pointers.

### Task 4: Force a `wrong map` (shape) deopt

**Problem.** Write `pick(o) { return o.value; }`. Warm it with objects of one
shape (`{ value: n }`). Then call it with a *different* shape
(`{ name: 'x', value: n }` — note the extra field changes the hidden class).
Capture the deopt reason.

**Constraints.**
- `node --trace-deopt pick.js`.
- The two object literals must differ in keys or key order, not just values.

**Hints (try without first).**
- The reason will mention `wrong map` (V8 calls hidden classes "maps").
- Same values, different *structure*, is what breaks it — prove this by
  re-running with two objects that have the same keys in the same order and
  observing that the deopt disappears.

**Self-check.**
- [ ] You triggered a `wrong map` deopt and can explain what a "map" is.
- [ ] You can make it go away by unifying the object shape.

---

### Task 5: Force a `not a Smi` / overflow deopt

**Problem.** Write a loop that repeatedly multiplies a number so the result
eventually leaves V8's small-integer (SMI) range. Warm it up with small
inputs first, then run the overflowing case.

**Constraints.**
- `node --trace-deopt overflow.js`.
- The value must actually cross the SMI boundary (multiply aggressively).

**Hints (try without first).**
- The reason will relate to `not a Smi` / lost precision — the no-overflow
  integer bet broke and V8 must widen to doubles.
- The result is still numerically correct; only the representation (and speed)
  changed.

**Self-check.**
- [ ] You forced an overflow-driven deopt and can name the broken bet.
- [ ] You can explain why staying in the SMI range keeps the loop fast.

---

### Task 6: Force an elements-kind (packed → double) deopt

**Problem.** Write `sum(arr)` that adds an array's elements. Warm it on a
packed integer array. Then `push` a floating-point value into the array and
call `sum` again. Capture the deopt.

**Constraints.**
- `node --trace-deopt elements.js`.
- Start with all integers (`PACKED_SMI_ELEMENTS`); the float forces a
  transition.

**Hints (try without first).**
- The array's elements kind transitions from `PACKED_SMI` to `PACKED_DOUBLE`,
  deopting code specialized for the integer representation.
- These transitions are **one-way**: once doubled/holey, it doesn't go back.
- Re-run using a `Float64Array` from the start and observe that the transition
  (and deopt) disappears, because typed arrays have a fixed representation.

**Self-check.**
- [ ] You triggered an elements-kind deopt.
- [ ] You can explain why typed arrays avoid this class of deopt.

---

### Task 7: Build a deliberate deopt storm — then kill it

**Problem.** Write a hot function and a loop that *alternates* the input type
every iteration (integer, then string, then integer…). Confirm via the trace
that it deopts repeatedly. Then refactor so the storm stops, **without**
disabling the optimizer.

**Constraints.**
- `node --trace-deopt storm.js`.
- The fix must be a *structural* change (separate the types), not a flag like
  `--no-opt`.

**Hints (try without first).**
- Alternating types means the function can never settle on one specialization.
- The fix is to stop mixing: route integers to one function and strings to
  another, so each stays monomorphic.
- Compare deopt counts before and after — they should drop from "many" to
  "warm-up only."

**Self-check.**
- [ ] You produced a measurable storm (high, repeating deopt count).
- [ ] Your fix is structural, and the deopt count collapsed.
- [ ] You can explain why disabling the JIT is *not* a fix.

**Sparse solution sketch.**
```js
// Storm: one function, two types alternating.
function f(x) { return x + 1; }            // deopts forever on mixed input
for (let i = 0; i < 1e6; i++) f(i % 2 ? i : String(i));

// Fix: split by type so each site is monomorphic.
function fNum(x) { return x + 1; }
function fStr(x) { return x + '1'; }
for (let i = 0; i < 1e6; i++) (i % 2 ? fNum(i) : fStr(String(i)));
```

---

### Task 8: Read a branch-pruning (uncommon-branch) deopt

**Problem.** Write `f(x)` with a hot branch (`x >= 0`) and a cold branch
(`x < 0`) that's never taken during warm-up. After warming up only with
non-negative inputs, call `f(-1)` once. Capture the deopt that fires when the
pruned branch is finally entered.

**Constraints.**
- `node --trace-deopt prune.js`.
- The cold branch must genuinely never run during warm-up.

**Hints (try without first).**
- The optimizer treats the cold branch as never-taken and traps on entry; the
  first `f(-1)` triggers a deopt to handle it.
- The result of `f(-1)` is still correct after the bailout.

**Self-check.**
- [ ] You forced a branch/`unstable_if`-style deopt by entering a pruned path.
- [ ] You can explain why pruning cold branches is *good* (lean hot path).

---

## Advanced

These require connecting deopt to inlining, escape analysis, and the inline
cache, and reading less-obvious traces.

### Task 9: Observe scalar replacement, then defeat it

**Problem.** On the JVM, write a method that allocates a small object that
never escapes (e.g. a 2-field `Point` used only for arithmetic) inside a hot
loop. Confirm the allocation is eliminated. Then change the code so the object
*escapes* (store it in a static field) and confirm the elimination disappears.

**Constraints.**
- Run with
  `java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations Escape`.
- The "non-escaping" and "escaping" versions should differ only in whether the
  object leaks.

**Hints (try without first).**
- `PrintEliminateAllocations` reports allocations removed by scalar
  replacement.
- Storing the object anywhere reachable after the method (static field,
  return, throw, passing to a non-inlined method) makes it escape.
- Connect this to deopt: if a deopt occurred in the eliminated version, the
  runtime would have to *materialize* the object on the spot.

**Self-check.**
- [ ] You saw an allocation eliminated, then re-appear when it escaped.
- [ ] You can explain what "materialization/reification on deopt" means.

---

### Task 10: Drive an inline cache from monomorphic to megamorphic

**Problem.** Write a property-access function `field(o) { return o.v; }`.
Feed it objects of progressively more distinct shapes (1, then a few, then
many). Using a CPU profile (`node --prof`), find evidence that the access site
lost specialization once it went megamorphic.

**Constraints.**
- `node --prof mega.js`, then `node --prof-process isolate-*.log`.
- Generate genuinely distinct shapes (different sets of own properties).

**Hints (try without first).**
- A monomorphic/poly site inlines; a megamorphic site spends time in generic
  inline-cache builtins (`LoadIC`).
- In the processed profile, look for time attributed to `*IC` builtins rather
  than to inlined optimized frames.
- The crossover from poly to mega happens once the site has seen "too many"
  distinct shapes.

**Self-check.**
- [ ] You can point at `*IC` time in the profile as the megamorphic signature.
- [ ] You can describe how to restructure to keep the site monomorphic.

---

### Task 11: Force a CHA-driven invalidation on the JVM

**Problem.** Write `speak(Animal a) { return a.sound(); }`. Warm it up with
only one concrete subclass (`Dog`). Then, *after* warm-up, introduce a second
type that overrides `sound()` and call `speak` with it. Capture the
invalidation/deopt activity in the compilation log.

**Constraints.**
- `java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation
  -XX:+TraceDeoptimization Devirt`.
- The second type must genuinely be unseen during warm-up.

**Hints (try without first).**
- With only `Dog` seen, CHA may devirtualize/inline `Dog.sound()` under the bet
  "no override exists."
- Introducing a second overriding type breaks that bet → the compiled `speak`
  is invalidated (`made not entrant`) and recompiled as polymorphic.
- Try making `sound()` paths effectively final / using a `final` class and
  observe how the speculation becomes more stable.

**Self-check.**
- [ ] You correlated the new type's introduction with an invalidation event.
- [ ] You can explain why this is *lazy* deopt (event-driven, not value-driven).

---

### Task 12: Assert optimization status in a test

**Problem.** Using V8 intrinsics, write a small test that warms a function,
optimizes it, asserts it's optimized, then breaks its bet (change the input
shape/type) and asserts it deopted.

**Constraints.**
- Run with `node --allow-natives-syntax status.js`.
- Use `%OptimizeFunctionOnNextCall` and `%GetOptimizationStatus`.

**Hints (try without first).**
- `%GetOptimizationStatus` returns a bitmask; you'll need to mask the
  "is optimized" bit (decode against the current V8 status bits).
- This is the seed of a CI regression guard: assert hot functions stay
  optimized, or that a benchmark's deopt count stays under budget.
- Remember reason strings and status bits are **not** a stable API — re-verify
  on Node upgrades.

**Self-check.**
- [ ] Your test passes when the function is optimized and detects the deopt.
- [ ] You can explain how to turn this into a CI gate (and its pitfalls).

---

## Capstone

A single, larger exercise that integrates everything: force, read, classify,
fix, and guard.

### Task 13: The deopt detective

**Problem.** You're given (or you write) a "realistic" hot module — say a tiny
JSON-shaped record processor with a hot `process(record)` function — that has
**three** latent deopt problems planted in it:

1. records are constructed with two different shapes in two code paths
   (`wrong map`);
2. a numeric field occasionally exceeds the SMI range (`not a Smi`);
3. a results array sometimes gets a hole or a float pushed into it
   (elements-kind transition).

Your job: run it under tracing, **classify each deopt by reason**, map each
reason back to the planted cause, fix all three by stabilizing the bets, and
finally add a **deopt-budget regression test** that fails if any of the three
problems is reintroduced.

**Constraints.**
- Drive it with `node --trace-deopt --trace-opt process.js`.
- Each fix must be *structural* (unify shape, fix value domain, keep arrays
  packed/typed) — no `--no-opt`.
- The regression test must parse the trace, count deopts, and fail above a
  warm-up-tolerant budget.

**Hints (try without first).**
- Work one reason at a time: fix the `wrong map`, re-run, confirm that reason
  disappears, move to the next. Don't fix all three blind.
- Unify record construction behind a single factory; clamp/redesign the
  numeric field or accept doubles uniformly; pre-size and homogenize (or use a
  typed array for) the results array.
- For the test, allow a small budget for genuine warm-up deopts, and parse
  loosely (reason strings drift between engine versions).

**Self-check.**
- [ ] You classified all three deopts by reason *before* fixing anything.
- [ ] Each fix targeted the broken bet, not the optimizer.
- [ ] Post-fix deopt count dropped to warm-up levels.
- [ ] Your regression test fails when you re-introduce any one planted problem.
- [ ] You can explain why the program's *output* was correct at every stage,
      even while it was deopting.

**Sparse solution sketch.**
```js
// Fix 1 (wrong map): one factory -> one hidden class everywhere.
const makeRecord = (id, value, tag) => ({ id, value, tag });

// Fix 2 (not a Smi): keep the hot field in-domain (clamp) OR commit to doubles.
const value = clampToInt32(rawValue);   // or: store as double from the start

// Fix 3 (elements kind): pre-sized, homogeneous results — or a typed array.
const out = new Float64Array(n);        // fixed representation, no transitions

// Regression test (conceptual): count deopts under a warm-up-tolerant budget.
//   const deopts = (trace.match(/deoptimizing \(DEOPT/g) || []).length;
//   assert(deopts <= BUDGET, `deopt regression: ${deopts} > ${BUDGET}`);
```

---

## Wrap-Up

If you completed these, you can now: turn on the right tracing on V8 and
HotSpot; force `wrong map`, `not a Smi`, elements-kind, branch-pruning, and
CHA-invalidation deopts on demand; tell warm-up apart from a storm; read a
megamorphic site in a profile; observe scalar replacement and reason about
materialization; and lock fixes in with a regression budget. Most importantly,
you've internalized the rule that survives every one of these experiments:
**deopt is the runtime keeping its promise that the fast path is only ever
taken when it's correct — slower, sometimes; wrong, never.**
