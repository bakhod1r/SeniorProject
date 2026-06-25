# Evaluation Order & Sequencing — Professional Level

> **Topic:** [Evaluation Order & Sequencing](README.md)
> **Focus:** The optimizer's mechanics — what reorderings the as-if rule actually permits, how UB from unsequenced side effects gets *exploited*, side-effect hoisting, and the engineering disciplines that keep large polyglot codebases sequencing-safe.

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
13. [Common Mistakes](#common-mistakes)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **What the compiler is actually allowed to do with your unspecified and undefined sequencing — and how to architect a codebase so that freedom never burns you.**

The professional level is where sequencing meets the optimizer and the org chart. Two themes dominate:

1. **The optimizer's actual behavior.** "Unspecified argument order" and "the as-if rule" are not academic. Modern compilers reorder, fuse, eliminate, and reschedule side effects aggressively, and — critically — they *exploit undefined behavior as a license to assume it never happens*. A program with an unsequenced read+write doesn't just produce a "random" answer; the optimizer may delete surrounding code, assume a branch is unreachable, or miscompile in ways that look like the laws of arithmetic broke. Understanding *why* an optimizer does this is the difference between cargo-culting "don't do UB" and being able to predict and diagnose the resulting miscompilations.

2. **Engineering at scale.** In a real codebase — often polyglot, with C/C++ next to Go, Java, Python, Rust, JavaScript — you cannot rely on every engineer to know which language pins evaluation order. The professional response is *systemic*: lint rules, compiler flags treated as errors, code-review checklists, ABI-aware FFI boundaries, and a house style that hoists side effects out of expressions so that order *cannot* matter. The goal is to make sequencing bugs *structurally impossible*, not merely *discouraged*.

> 🎓 **Why this matters at the professional level:** You own the build configuration, the lint policy, and the architectural conventions that hundreds of commits flow through. A single missing `-Werror=sequence-point` or a permissive macro can let a UB landmine sit dormant for years until a compiler upgrade detonates it across a release. Your job is to design the guardrails.

This page covers: concrete reorderings the as-if rule permits, how compilers exploit unsequenced-modification UB (with a real miscompilation flavor), side-effect hoisting and common-subexpression elimination, the cross-ABI argument-order reality at FFI boundaries, `volatile` and atomics in the optimizer's view, and a tooling/policy playbook for keeping a large team safe. The interview drill is in `interview.md`; hands-on exercises in `tasks.md`.

---

## Prerequisites

- **Required:** The senior-level material — sequenced-before/happens-before, init order, the as-if rule, `volatile` vs atomics.
- **Required:** Working knowledge of at least two languages from different sequencing buckets (e.g. C/C++ and Java/Go).
- **Required:** Familiarity with compiler flags and a CI/build pipeline.
- **Helpful:** Having read optimizer output (assembly or IR) at least once.
- **Helpful:** Experience owning an FFI/ABI boundary or a polyglot service.

---

## Glossary

| Term | Definition |
|------|-----------|
| **As-if rule** | The compiler may emit any code with the same observable behavior as the abstract machine. |
| **UB exploitation** | The optimizer assuming undefined behavior cannot occur, then deleting/transforming code based on that assumption. |
| **Common subexpression elimination (CSE)** | Computing a repeated subexpression once. Safe only when the subexpression has no observable side effects. |
| **Side-effect hoisting** | Moving a side-effecting operation out of an expression (or loop) to a fixed, sequenced position. |
| **Strict aliasing** | The rule that lets the compiler assume differently-typed pointers don't alias, enabling reordering of loads/stores. |
| **Sequence-point UB** | UB from modifying a scalar more than once, or read+write without sequencing, in one full expression. |
| **ABI** | Application Binary Interface — defines, among other things, how arguments are passed; influences (but does not standardize) eval order at the boundary. |
| **FFI** | Foreign Function Interface — calling across language boundaries, where argument-order assumptions can silently differ. |
| **Reordering barrier** | A construct (atomic with ordering, fence, `asm volatile("":::"memory")`, function-call boundary in some cases) that restricts the compiler/CPU's freedom to move accesses. |
| **Speculative execution** | CPU executing instructions ahead of knowing they're needed; part of why observed order ≠ program order at the hardware level. |

---

## Core Concepts

### 1. What the as-if rule actually lets the optimizer do

For a single thread, the compiler may, among many transformations:

- **Reorder** two independent operations (`x = a(); y = b();` may emit `b()` before `a()` if neither is observable and they don't depend on each other).
- **Eliminate** redundant loads/stores (CSE, dead-store elimination), assuming no aliasing or `volatile` forbids it.
- **Fuse or split** operations, vectorize loops, unroll, hoist loop-invariant code.
- **Reassociate** arithmetic *only* where the standard allows (integer reassociation is generally fine; floating-point reassociation is *not* unless `-ffast-math`, because it changes observable results).
- **Assume UB never happens** and prune any code path that would require it.

The *observable* behavior it must preserve: volatile accesses, I/O, and synchronization/atomic ordering. Everything else is negotiable. This is why two side-effect-free function calls in a "left to right" *source* may execute right-to-left in the *binary* — and that's conforming, because you can't observe the difference.

### 2. The optimizer exploits unsequenced-modification UB

This is the part professionals must internalize: undefined behavior is not "the result is garbage." It is "the compiler is licensed to assume this code path is unreachable and optimize accordingly." Consider the spirit of a real class of miscompilations:

```c
int i = 0;
int x = i++ + i++;   // UB: two unsequenced modifications of i
```

A naive expectation is `x == 0 + 1 == 1` and `i == 2`. But because this is UB, the optimizer is under *no* obligation to produce any particular value — and aggressive passes have been observed to compute `i++ + i++` as `2*i` then increment `i` once, yielding `x == 0`, `i == 1`; or fold the whole statement away if later analysis proves the value unused. The point is not to memorize a specific compiler's behavior but to accept: **once you write UB, arithmetic identities and your mental model no longer bind the compiler.** Debugging "but `i` should be 2!" is wasted time; the only fix is to remove the UB.

A sharper, scarier flavor: UB *propagates backward*. If the compiler can prove that a code path leads to UB, it may assume that path never executes and delete a null check or a bounds check that "guards" it — turning a benign-looking bug into a security vulnerability. This is why UB is a *severity-one* defect class, not a style nit.

### 3. Side-effect hoisting: making order irrelevant by construction

The professional's structural defense is to *remove* observable side effects from inside expressions and loops, so the optimizer's freedom (and the language's unspecified order) cannot change behavior. Two forms:

**Hoist out of expressions:**

```c
// Order-fragile:
log_use(get_token(), get_token());
// Hoisted — order is now explicit and reorder-proof:
Token a = get_token();
Token b = get_token();
log_use(a, b);
```

**Hoist out of loops (loop-invariant side-effect motion you do by hand):**

```c
// Bad: side-effecting call re-evaluated each iteration, order entangled with loop body.
for (int i = 0; i < n; i++) total += scale() * data[i];
// Good: compute the invariant once; loop body is now pure arithmetic.
double s = scale();
for (int i = 0; i < n; i++) total += s * data[i];
```

The compiler can *sometimes* hoist these for you (loop-invariant code motion) — but only when it can prove the call is side-effect-free. By hoisting manually you both clarify intent and remove the proof obligation, often unlocking further optimization.

### 4. Cross-ABI argument order at FFI boundaries

When you call across languages, the *evaluation* of arguments happens in the *caller's* language (with the caller's order rules), but the *passing* convention is the ABI's. The trap: engineers assume a left-to-right wrapper, but a generated binding or a macro may evaluate arguments in the host language's unspecified order.

- A C function called from C/C++ with `f(next(), next())` evaluates `next()` in unspecified order — independent of the callee's ABI.
- Bindings generated by tools (SWIG, cgo, JNI shims) often expand arguments into temporaries; verify whether your binding evaluates side-effecting arguments once and in a defined order.
- The historical reality (GCC/Clang/MSVC frequently right-to-left on x86-64) means a side-effecting argument list can behave differently across platforms even with the same source.

**Rule at the boundary:** never pass side-effecting expressions directly as FFI arguments; bind them to named temporaries first.

### 5. `volatile`, atomics, and the optimizer

From the optimizer's seat:

- A `volatile` access is an **observable** event: the compiler must keep it, keep its count, and not reorder it relative to other `volatile` accesses. But it may freely reorder *non-volatile* accesses around it (in C/C++), and it emits **no CPU fence**.
- An `std::atomic` access with `seq_cst`/`acq_rel`/`release`/`acquire` is *both* an observable synchronization event *and* a reordering barrier with hardware-fence emission as needed. The optimizer must respect the memory order, and so must the CPU.
- `memory_order_relaxed` is atomic (indivisible) but imposes *no* ordering — the optimizer may reorder surrounding non-atomic accesses, which is exactly why relaxed is a footgun outside counters/flags where ordering is irrelevant.

Knowing which constructs are *reordering barriers* lets you reason about what the optimizer can and cannot move — the core skill behind correct lock-free code.

### 6. Floating-point: a place where order *is* observable

Integer reassociation is generally value-preserving, but floating-point addition is **not associative**: `(a + b) + c ≠ a + (b + c)` in general. So evaluation/association order is *observable* for floats, and the compiler may **not** reorder them — unless you opt into `-ffast-math` / `-funsafe-math-optimizations`, which trade reproducibility for speed and can change results, NaN/inf handling, and even break Kahan summation. Professionals treat `-ffast-math` as a deliberate, documented, per-target decision, never a global default for code that cares about numerical reproducibility.

---

## Real-World Analogies

**The contractor with a results-only contract (as-if).** You hired a contractor and specified the *finished house* (observable behavior), not the build sequence. They may pour the driveway before or after framing, skip a step that doesn't affect the result, or do two independent rooms in parallel — all fine. But the moment you wrote a self-contradictory spec (UB), the contract is void and they may legally do *anything*, including bulldoze the lot. That's UB exploitation: a void contract, not a "random" build.

**Translating an idiom across languages (FFI).** Passing `f(next(), next())` across an FFI boundary is like handing a sentence with an idiom to a translator who resolves word order by *their* native grammar, not yours. Bind the words to fixed positions first (named temporaries) and the translation can't scramble them.

**Two accountants who can add in any order — except cents that don't carry cleanly (FP).** Integer sums come out the same regardless of order. But floating-point sums are like adding amounts where rounding loses fractions of a cent each time — the *order* you add changes the total, so you can't let anyone reshuffle the additions.

---

## Mental Models

### Model 1: UB is a contract void, not a dice roll

```
Defined behavior    → the standard binds the compiler to a result set.
Unspecified         → the standard binds it to a known SET of results; impl picks one.
Implementation-def. → like unspecified, but the impl must DOCUMENT its choice.
Undefined (UB)      → NO binding at all. Optimizer may assume it never happens and
                      transform/delete surrounding code. Reasoning about "the value" is moot.
```

### Model 2: The reorder-barrier map

```
NOT a barrier:   ordinary loads/stores, plain function-internal arithmetic
PARTIAL barrier: volatile (orders volatile-vs-volatile only; no fence)
FULL barrier:    atomic acquire/release/seq_cst, mutex lock/unlock, std::atomic_thread_fence
```

When you need to *stop* the optimizer (or CPU) from moving something, you must use a real barrier — `volatile` is rarely the right one.

### Model 3: Make order structurally irrelevant

The professional default is to *engineer away* the dependence on order:
- Hoist every side effect to its own statement.
- Bind FFI/macro arguments to temporaries.
- Forbid read+write of one scalar per expression via lint.
- Pin FP reproducibility explicitly; never globally enable fast-math by accident.

When order can't be observed, no compiler or platform difference can hurt you.

---

## Code Examples

### Example 1 — The optimizer reordering invisible side-effect-free calls

```c
int a(void) { return expensive1(); }   // pure, no observable effect
int b(void) { return expensive2(); }   // pure
int r = a() + b();
// The compiler may emit b() before a(); you cannot observe it, so it's conforming.
// If a()/b() had observable effects (I/O), in C the ORDER is still unspecified.
```

### Example 2 — UB makes the value unpredictable AND can delete code

```c
int i = 0;
int x = i++ + i++;     // UB. Don't expect 1. Some optimizers yield x==0, i==1.
// Worse pattern: a guard the optimizer deletes because the guarded path is UB.
int* p = get();        // suppose later code does *p with no null check on one path
if (some_ub_path())    // if the optimizer proves this leads to UB, it may assume it
    *p = compute();    // ...is unreachable and remove a downstream null check.
```

### Example 3 — Hoisting for correctness and speed

```c
// Before: order-entangled, re-evaluates config() per call.
render(config(), config());
// After: explicit, reorder-proof, and config() called exactly twice in a known order.
Config c1 = config();
Config c2 = config();
render(c1, c2);
```

### Example 4 — FFI boundary discipline

```c
// Risky: argument order is the host language's unspecified order, then crosses ABI.
foreign_call(pop_queue(), pop_queue());
// Safe: name the temporaries; order is now defined by statement sequencing.
Item first  = pop_queue();
Item second = pop_queue();
foreign_call(first, second);
```

### Example 5 — Floating-point order is observable

```c
// The compiler may NOT reorder these without -ffast-math, because FP add isn't associative.
double s = 0;
for (int i = 0; i < n; i++) s += x[i];   // sequential, reproducible
// Kahan summation relies on the EXACT order/association; -ffast-math can BREAK it.
```

### Example 6 — Choosing the right barrier

```cpp
// volatile: NOT enough to publish 'payload' to another thread.
// atomic release/acquire: correct barrier + fence.
payload = build();
published.store(true, std::memory_order_release);   // reorder barrier + publish
// reader:
if (published.load(std::memory_order_acquire)) consume(payload);
```

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **Trusting the optimizer's freedom** | Significant speedups; you write clear code, it schedules. | Single-thread intuition fails across threads; UB gets exploited. |
| **Manual side-effect hoisting** | Reorder-proof, clearer, often unlocks more optimization. | More lines; mild verbosity. |
| **`-ffast-math`** | Faster FP, vectorizable reductions. | Non-reproducible results; can break numerically careful code. |
| **Lint/flags as errors** | Catches sequencing UB at build time across the whole team. | Upfront config + occasional false-positive triage. |

---

## Use Cases

- **Build-policy ownership:** mandate `-Werror=sequence-point` / `-Werror=unsequenced` and a clang-tidy ruleset across all C/C++ targets.
- **Polyglot service hygiene:** establish the "no side-effecting expression as an argument, especially across FFI" convention and enforce it in review.
- **Numerical code:** make FP reproducibility an explicit, per-module decision; gate `-ffast-math` behind a documented flag.
- **Lock-free fast paths:** reason explicitly about reorder barriers (atomics, fences) rather than `volatile`.
- **Compiler-upgrade readiness:** audit for dormant UB before bumping toolchains, since upgrades frequently start exploiting previously-benign UB.

---

## Coding Patterns

**Pattern: One observable side effect per statement, enforced by lint.**

**Pattern: Temporaries at every boundary** (FFI calls, macros, varargs) so argument order is fixed by statement sequencing.

**Pattern: Reorder barriers are explicit.** When publication or visibility matters, the synchronization construct is *visible in the diff* — never an implicit `volatile`.

**Pattern: FP order is sacred.** Numerically sensitive reductions are written in an explicit order and protected from `-ffast-math` (e.g. compiled in a TU without that flag, or with `#pragma` controls).

---

## Best Practices

1. **Treat UB as a severity-one defect**, not a style issue — the optimizer can turn it into deleted security checks.
2. **Make sequencing bugs structurally impossible**: hoist side effects, forbid read+write of one scalar per expression, bind FFI args to temporaries.
3. **Turn sequencing warnings into errors** in CI for every C/C++ target.
4. **Use real reorder barriers** (atomics, mutexes, fences) for cross-thread ordering; never `volatile`.
5. **Make `-ffast-math` an explicit, documented per-target decision**, never an accidental global.
6. **Audit for dormant UB before toolchain upgrades**, and run UBSan/ASan/TSan in CI.
7. **Write the standard version into your build and your reasoning** — `a[i] = i++` is UB in C/C++14 and defined in C++17; your policy must say which world you're in.

---

## Edge Cases & Pitfalls

- **Dormant UB awakened by an upgrade** — code that "worked" for years miscompiles after a compiler bump that starts exploiting the UB. Audit proactively.
- **Generated FFI bindings** that expand a side-effecting argument multiple times or in an undocumented order.
- **`-ffast-math` set globally** silently breaking Kahan summation, `isnan` checks, and reproducibility across builds.
- **`volatile` used as a memory barrier** — gives no fence, no inter-thread ordering; a perennial legacy mistake.
- **Relaxed atomics** used where release/acquire was needed — atomic but unordered, reintroducing publication races.
- **CSE eliminating a call you thought was a side effect** — if the compiler (wrongly per your intent, rightly per the language) treats a call as pure, it may collapse two calls into one.
- **Macros in varargs** — `printf`-style calls with `i++` arguments multiply the trap by the unspecified arg order *and* potential macro re-expansion.

---

## Common Mistakes

| Mistake | Reality |
|---------|---------|
| "UB just gives a random value" | UB lets the optimizer assume unreachability and delete surrounding code. |
| "The optimizer respects my left-to-right source order for side-effect-free calls" | Only the *observable* result is preserved; it may reorder freely. |
| "`volatile` is a memory barrier" | It orders volatile-vs-volatile only and emits no fence. |
| "FP addition is associative, so order doesn't matter" | It is not; the compiler may not reorder FP without fast-math, and order changes results. |
| "Generated FFI bindings evaluate args left-to-right" | Verify it; many don't, and the host language may not promise it. |
| "Once it compiles clean, the UB is gone" | UB can be invisible until a flag or compiler change exploits it. |

---

## Cheat Sheet

```
AS-IF: compiler may do ANYTHING preserving observable behavior (I/O, volatile, atomics).
UB:    NOT a random value -> a license to assume-unreachable and DELETE code. Sev-1.

REORDER BARRIERS
  none    : plain loads/stores, internal arithmetic
  partial : volatile (volatile-vs-volatile only; NO fence)
  full    : atomic acquire/release/seq_cst, mutex, std::atomic_thread_fence

STRUCTURAL DEFENSES
  - one observable side effect per statement
  - bind FFI/macro/vararg args to named temporaries (fixes unspecified arg order)
  - forbid read+write of one scalar per expression (lint)
  - -Werror=sequence-point / -Werror=unsequenced ; UBSan/TSan in CI

FLOATING POINT
  FP add is NOT associative -> order is OBSERVABLE -> compiler can't reorder
  -ffast-math: faster but non-reproducible; can break Kahan summation. Opt-in, documented.

STANDARD-ERA: a[i]=i++  is UB in C and C++14, DEFINED in C++17. State your era.
```

---

## Summary

The professional level reframes evaluation order as an *optimizer-and-organization* problem. The **as-if rule** lets the compiler reorder, fuse, eliminate, and reschedule anything that preserves observable behavior (I/O, `volatile`, atomics), so source-level left-to-right order for side-effect-free code is *not* a guarantee about the emitted binary. More dangerously, **undefined behavior from unsequenced modifications is not a random value — it is a license for the optimizer to assume the code is unreachable and delete surrounding logic**, including security-relevant checks, which is why UB is a severity-one defect rather than a style nit. The structural defense is to make order *irrelevant by construction*: hoist every observable side effect to its own statement, bind FFI/macro/vararg arguments to named temporaries (neutralizing the still-unspecified, often right-to-left argument order across GCC/Clang/MSVC), and forbid read-plus-write of a single scalar per expression via lint and `-Werror=sequence-point`/`-Werror=unsequenced`. For cross-thread ordering, use *real* reorder barriers — atomics and mutexes — never `volatile`, which orders only volatile-vs-volatile and emits no fence. Floating-point is the one place where association order is *observable* (FP add is not associative), so the compiler may not reorder it without the opt-in, reproducibility-destroying `-ffast-math`. Finally, always pin the **standard era** in both build and reasoning, audit for dormant UB before every toolchain upgrade, and run UBSan/ASan/TSan in CI — because the gap between "compiles clean today" and "miscompiles after the next upgrade" is exactly the dormant sequencing bug you didn't lint away.
