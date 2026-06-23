# Imperative & Procedural — Senior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Imperative & Procedural
> *Imperative programming trades reasoning simplicity for control. A senior engineer knows the exact price of that trade — and when paying it is the right call.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Central Trade-Off: Control vs Bookkeeping](#the-central-trade-off-control-vs-bookkeeping)
3. [Why Mutable State Is Hard to Reason About](#why-mutable-state-is-hard-to-reason-about)
4. [Reasoning About Imperative Code: Invariants](#reasoning-about-imperative-code-invariants)
5. [Where Imperative Is the Right Choice](#where-imperative-is-the-right-choice)
6. [The Performance Argument, Made Concrete](#the-performance-argument-made-concrete)
7. [Structured, Unstructured, and the Limits of Structure](#structured-unstructured-and-the-limits-of-structure)
8. [Toward Data-Oriented Design](#toward-data-oriented-design)
9. [Choosing Imperative Deliberately: a Decision Framework](#choosing-imperative-deliberately-a-decision-framework)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the trade-offs, and when do I reach for it on purpose?**

By now the mechanics are not in question — you understand statements, state, scope, the stack, side effects, and how loops become jumps. The senior question is different and harder: **knowing when to choose this paradigm, and what it costs you when you do.**

The imperative paradigm sits at one extreme of the [imperative ↔ declarative spectrum](../01-overview-and-taxonomy/junior.md): **maximum control, maximum responsibility**. You decide every step, every memory access, every mutation — which is exactly why imperative code can be the fastest, most predictable code you can write, *and* exactly why it can be the buggiest and hardest to reason about. There is no free lunch here, only a trade you make with open eyes.

This page is about making that trade well. We'll quantify the cost of mutable state, identify the problem shapes where imperative genuinely wins (and where it's a liability), make the performance argument concrete instead of hand-wavy, and connect imperative thinking to its modern high-performance descendant, [data-oriented design](../10-data-oriented-programming/).

> **The mindset shift:** stop defaulting to imperative because it's familiar, and stop avoiding it because it's "old-fashioned." Both are reflexes. The senior move is to recognize imperative as a *deliberate trade* — control and performance bought with mutation risk and bookkeeping — and to make that trade where the problem shape rewards it.

---

## The Central Trade-Off: Control vs Bookkeeping

Every paradigm makes a bargain. Imperative's bargain is the starkest:

> **You get total control over *how* the computation happens. In exchange, you become responsible for *all* the bookkeeping — every variable's current value, every mutation's ripple, every ordering constraint.**

Declarative code hands the bookkeeping to an engine: you write `SELECT ... WHERE`, and the database decides the loops, the indexes, the order. Functional code minimizes bookkeeping by forbidding mutation: with immutable values, a name means *one* thing forever, so you never have to ask "what is `x` *now*?" Imperative code hands you neither crutch. The payoff is real — you can hand-tune a hot loop the way no query planner ever could — but so is the cost.

| Dimension | Imperative gives you | …at the cost of |
|---|---|---|
| **Control** | exact steps, memory layout, evaluation order | you must *specify* all of it, correctly |
| **Performance** | predictable, tunable, close to the metal | optimization is *your* job, not an engine's |
| **State** | accumulate/update in place, cheaply | every variable can change → harder to reason about |
| **Mental load** | "I can see exactly what runs" | "I must track what *everything* is at this point" |
| **Verbosity** | nothing hidden | more code; the *how* is always spelled out |

The trade is not "imperative is good/bad." It's **"imperative concentrates power and responsibility in your hands."** When the problem rewards fine control (a hot loop, a device driver, an allocator), that concentration is a gift. When the problem is mostly about *expressing intent over data* (a transformation pipeline, a query, a config), that same concentration is just bookkeeping you'd rather not own — and a more declarative or functional style wins.

---

## Why Mutable State Is Hard to Reason About

The deepest cost of imperative programming has a precise name: **mutable state breaks referential transparency and local reasoning.** Unpack what that means, because it's the root of most imperative bugs.

In a world without mutation, a name is a fact: `x` is `5`, here and everywhere, forever. You can reason **locally** — understand a piece of code by reading *just that code*. With mutation, a variable is a *cell whose contents depend on time*, so to know what `x` is at line 40, you must know everything that touched `x` on lines 1–39 — possibly across function boundaries, possibly from another thread. Your reasoning is no longer local; it's a simulation of the entire execution so far.

This produces three concrete failure modes that dominate imperative debugging:

**1. Aliasing — two names, one cell.** When two variables refer to the same mutable object, a change through one silently changes the other. The bug surfaces far from its cause:

```python
config = {"retries": 3}
service_a = config          # alias, not a copy
service_b = config          # another alias to the SAME dict
service_a["retries"] = 99   # looks local to A...
print(service_b["retries"]) # 99 — B changed too. Spooky action at a distance.
```

**2. Temporal coupling — order is invisible but load-bearing.** When correctness depends on doing things in a specific order, but nothing in the code *says* so, a reordering or a missed step is a latent bug:

```python
buf.open()      # if you forget this line, or call write() first,
buf.write(data) # ...the bug isn't here — it's in the ordering you can't see in the types
buf.close()
```

**3. Shared mutable state under concurrency — the data race.** Two threads mutating the same cell without coordination is the single hardest class of bug in software: nondeterministic, often invisible in testing, dependent on timing. `counter++` is *three* machine operations (load, add, store); interleave two threads and increments get lost:

```go
// DATA RACE: two goroutines, one shared mutable counter, no synchronization
counter := 0
go func() { for i := 0; i < 1000; i++ { counter++ } }()
go func() { for i := 0; i < 1000; i++ { counter++ } }()
// final counter is often < 2000 — lost updates from interleaved load/add/store
```

The mechanics of fixing this (mutexes, atomics, channels, memory models) live in [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/concurrency/). The *paradigm-level* point is sharper: **mutable shared state is the thing that makes concurrency hard.** Immutability sidesteps races entirely (you can't have a race on something that never changes), which is the central reason functional and message-passing paradigms gained ground exactly as multicore did. Imperative didn't get worse; the cost of its central liability got more expensive.

> **The senior frame:** imperative's hard part isn't syntax — it's that **state is global to time.** Every mitigation you'll reach for (immutability, narrow scope, encapsulation, `const`/`final`, the "functional core / imperative shell" pattern in [`professional.md`](professional.md)) is fundamentally an attempt to *shrink the region of code where state can change*, recovering local reasoning where it matters most.

---

## Reasoning About Imperative Code: Invariants

If you can't avoid mutable state, you need a *discipline* for reasoning about it — and the classical one, due to Hoare and Dijkstra, is the **invariant**: a condition that is true at a specific program point *every time control passes through it*, regardless of how many times the loop has run or which branch was taken. Invariants are how you reason about mutating code without simulating every step in your head.

The most useful is the **loop invariant** — a property that holds before the loop, is preserved by each iteration, and (combined with the exit condition) guarantees the result:

```c
// Find the max of a non-empty array.
int max = a[0];
int i = 1;
// INVARIANT (true at the top of every iteration):
//   `max` is the maximum of a[0..i-1].
while (i < n) {
    if (a[i] > max) max = a[i];   // re-establishes the invariant for a[0..i]
    i++;
}
// At exit: i == n AND invariant holds → max is the maximum of a[0..n-1]. Done.
```

The reasoning is local and bulletproof: you check three things — the invariant is true *before* the loop (`max` = max of `a[0..0]`), each iteration *preserves* it (after handling `a[i]`, `max` is the max of `a[0..i]`), and on *exit* the invariant plus `i == n` gives the answer. You never trace specific iterations; you prove a property that holds across *all* of them. This is the imperative answer to "state is global to time": you can't eliminate the mutation, but you can pin down an unchanging *truth about* the mutating state at each point.

This matters at the senior level for two reasons. First, it's how you write *correct* tricky imperative code (binary search, in-place partition, sliding window — every subtle loop has a stated or unstated invariant, and the bugs are exactly the iterations that break it). Second, **assertions** are invariants made executable: a well-placed `assert(invariant)` turns a reasoning aid into a runtime check that catches the moment state goes wrong. Strong imperative engineers think in invariants even when they don't write them down — it's the difference between "I ran it and it seemed right" and "I know why it's right."

---

## Where Imperative Is the Right Choice

Despite the costs, imperative is the *correct* paradigm for whole classes of problems. Reach for it deliberately when:

**1. The hot loop.** When a small piece of code runs billions of times, you need control over every memory access and the absence of hidden allocation/indirection. Numeric kernels, codecs, parsers, physics steps, inner loops of any algorithm — imperative with tight mutable locals is where the performance lives. A `for` loop mutating a few registers has *no* abstraction overhead; a chain of allocating functional combinators might.

**2. Systems code — kernels, drivers, allocators, runtimes.** This code *is* state manipulation: poke a hardware register, flip a page-table bit, hand out a block of memory, advance a ring buffer. The domain is inherently about mutating specific bytes in a specific order. The Linux kernel, malloc, the Go runtime, every garbage collector — all procedural C or its equivalent, because the job *is* imperative.

**3. Embedded and real-time.** When you have 4 KB of RAM and a hard deadline, you cannot afford a GC pause, a hidden allocation, or an unpredictable abstraction. Imperative C gives you a model where you can *count the cycles and the bytes*. Determinism beats elegance when a missed deadline crashes a drone.

**4. Performance-critical data transformation over large arrays.** Even in high-level languages, when you're processing millions of rows, an imperative loop that mutates a preallocated buffer often beats an elegant pipeline that allocates intermediate collections at each stage. (This is the doorway to [data-oriented design](#toward-data-oriented-design).)

**5. When the algorithm *is* imperative.** Some algorithms are naturally stateful: in-place sorts (quicksort partitioning), union-find with path compression, dynamic programming filling a table, graph traversals mutating a visited set. Forcing them into a pure style often makes them slower *and* less clear. The paradigm should fit the algorithm's natural shape.

Conversely, imperative is the *wrong* default when the problem is mostly **expressing a transformation or a query over data** (use functional/declarative), when **concurrency with shared state** is central (prefer immutability or message-passing), or when the **domain logic is complex and mutation makes it unreasonable** (a functional core buys you testability). Knowing both lists — where it wins and where it loses — is the senior skill.

---

## The Performance Argument, Made Concrete

"Imperative is fast" is a cliché until you can say *why*. The reasons are mechanical and worth being precise about, because they also tell you *when the advantage actually materializes* (it doesn't always).

**Registers and no indirection.** A tight imperative loop keeps its working set in CPU registers and operates directly. No function-call overhead per element, no boxing, no allocation, no pointer-chasing. The compiler can see the whole loop and optimize it as a unit.

**Cache locality.** This is the big one on modern hardware. A CPU reads memory in **cache lines** (~64 bytes), and a main-memory access costs ~100× a cache hit. Code that walks memory **sequentially** — exactly what an imperative loop over a contiguous array does — lets the hardware **prefetch** the next line before you need it. Pointer-chasing data structures (linked lists, trees of heap objects) defeat this: each `node.next` is a cache miss, and the CPU stalls. Imperative-over-arrays is cache-friendly almost by construction.

```c
// Cache-friendly: sequential walk over a contiguous array.
// The prefetcher feeds the CPU; this saturates memory bandwidth.
long sum = 0;
for (int i = 0; i < n; i++)
    sum += a[i];          // a[i+1] is already on its way to cache
```

**Predictable branches.** A loop's backward branch is taken every iteration except the last; the branch predictor nails it, so the pipeline rarely stalls. Predictable control flow is fast control flow.

**No hidden allocation or GC pressure.** Mutating a preallocated buffer in place creates zero garbage. A functional pipeline that produces a new collection per stage allocates — and those allocations become GC work, cache pollution, and pauses. On a hot path this difference is enormous.

> **The honest caveat — don't over-claim.** This advantage is real *on hot paths* and *evaporates everywhere else*. For 95% of code, the imperative speed edge is invisible: you're I/O-bound, or the code runs once, or the dataset is tiny. Reaching for ugly mutable imperative code "for performance" in cold paths is **premature optimization** — you pay the reasoning cost and get no speed in return. The senior discipline is: **profile first, identify the actual hot path, and apply imperative control surgically there** — keeping the rest of the system in whatever paradigm makes it clearest. Measure, don't assume; the cliché is true only where you've proven the path is hot. Lean on Big-O analysis and profiling practice for the measurement discipline.

---

## Structured, Unstructured, and the Limits of Structure

Structured programming (from [`middle.md`](middle.md)) won decisively — `goto` is gone from mainstream code. But "structured" is a floor, not a ceiling, and seniors should know where even structured imperative code starts to strain.

**Structure tamed control flow, not state.** Böhm–Jacopini fixed the *jumps*; it did nothing about *mutation*. You can write perfectly structured code — every loop single-entry/single-exit — that's still a nightmare because it mutates fifteen shared variables in an order you can't follow. The next frontier after structured control flow was structured *state*: encapsulation (OOP's bundling of state with the code allowed to touch it) and immutability (FP's removal of mutation). Both are responses to the part structured programming left unsolved.

**Where disciplined "unstructured" jumps return.** A few modern constructs are jumps that structured purism would frown on, yet they're *good* engineering because they're constrained and they express intent:

- **Early return / guard clauses** — exit at the top on bad input instead of nesting the whole body in an `if`. A jump to the exit, but it flattens code and is universally endorsed.
- **`break` / `continue` with labels** — exit a specific outer loop. Disciplined (only exits outward).
- **Exceptions** — a *non-local* jump up the call stack, unwinding frames to a handler. Powerful and necessary, but genuinely harder to reason about (control can leave *any* line), which is why some systems languages (Go, Rust, early C) deliberately prefer explicit error *values* over exception jumps. The trade is local-reasoning vs conciseness.
- **Kernel `goto cleanup`** — C's one blessed `goto` pattern: jump forward to a single cleanup/exit point, avoiding deeply nested error handling. Structured in spirit.

The lesson: **structured programming was never about banning all jumps — it was about banning *arbitrary* ones.** Constrained, intention-revealing jumps (early return, `break`, cleanup `goto`) keep the local-reasoning benefit. Know the difference so you neither write spaghetti nor twist code into knots avoiding a clean early return.

---

## Toward Data-Oriented Design

The modern high-performance descendant of imperative thinking is **data-oriented design (DOD)** — important enough to have [its own section](../10-data-oriented-programming/), but its core idea belongs here because it's *imperative reasoning taken to its logical conclusion.*

DOD's premise: on modern hardware, **the bottleneck is memory access, not computation.** So design your program around *how data is laid out and traversed*, not around objects or abstractions. The canonical example is **Array-of-Structs (AoS) vs Struct-of-Arrays (SoA)**:

```c
// Array-of-Structs (AoS) — the natural OOP layout.
// To sum all x's, you stride over y and z too → wasted cache-line bandwidth.
struct Particle { float x, y, z; int id; };
struct Particle ps[N];
for (int i = 0; i < N; i++) total_x += ps[i].x;   // loads x,y,z,id; uses only x

// Struct-of-Arrays (SoA) — DOD layout.
// All x's are contiguous → every cache line is 100% useful → far faster.
struct Particles { float x[N], y[N], z[N]; int id[N]; };
for (int i = 0; i < N; i++) total_x += parts.x[i]; // pure sequential x stream
```

Same computation, same imperative loop — but the **data layout** makes the SoA version dramatically faster because every byte the cache loads is a byte you use. This is why game engines, databases, and high-performance compute use the **Entity-Component-System (ECS)** pattern and columnar storage: they're DOD applied at scale.

The connection to this topic is the whole point: **DOD is what you get when you take imperative's "you control the machine" seriously and apply it to *data layout* specifically.** It keeps the simple imperative loop and changes what the loop walks over. A senior who understands *why* the imperative loop is fast (cache lines, sequential prefetch) already understands the seed of DOD. Full treatment: [10 — Data-Oriented Programming](../10-data-oriented-programming/).

---

## Choosing Imperative Deliberately: a Decision Framework

Pulling it together — a checklist for *when* the imperative trade pays off:

**Lean imperative when:**
- You've **profiled** and found a genuine **hot path** (loop run billions of times, dominates runtime).
- You're writing **systems/embedded/real-time** code where the job *is* mutating specific bytes deterministically.
- **Cache layout and memory traffic** dominate — large sequential data, numeric kernels (→ data-oriented design).
- The **algorithm is intrinsically stateful** (in-place sort, union-find, table-filling DP, graph traversal).
- You need **predictability** (no GC pause, no hidden allocation) more than elegance.

**Lean away from imperative when:**
- The code is **cold** — runs rarely or off the critical path. Clarity beats a speed edge you'll never see.
- The problem is **expressing a transformation/query** over data → functional/declarative reads better.
- **Concurrency with shared state** is central → prefer immutability or message-passing to avoid races.
- The **domain logic is complex** and you want testability → a functional core (pure logic) with a thin imperative shell.

**The synthesis most real systems use:** not "imperative *or* not," but **layered**. A functional/declarative outer layer for clarity and a tight imperative inner layer for the hot path. NumPy is this exactly — a clean declarative-feeling Python API over hand-written imperative C loops. That layering is the subject of [`professional.md`](professional.md).

---

## Mental Models

- **Imperative is a sports car with no driver aids.** Maximum control, maximum performance, *and* maximum responsibility — it'll do exactly what you say, including drive into a wall. Declarative is the self-driving car: you say the destination and trust the system. Pick by whether you need control or convenience for *this* trip.
- **State is global to time.** The hard part of imperative isn't any single line; it's that a variable's meaning depends on *when* you read it, so reasoning requires replaying history. Every mitigation (immutability, narrow scope, encapsulation) is an attempt to shrink the slice of time-and-code over which a thing can change.
- **The cache is the real computer.** Modern CPUs are starved for data, not instructions. Imperative-over-contiguous-arrays is fast not because the *operations* are cheap but because the *memory access pattern* is sequential and prefetchable. Performance is a property of data movement, which is why DOD reframes everything around layout.
- **Structured programming solved jumps, not mutation.** It fixed half the imperative problem. OOP encapsulation and FP immutability are the two great attempts at the other half — taming *state* the way structure tamed *control*.

---

## Common Mistakes

- **Defaulting to imperative everywhere out of habit.** Familiarity isn't a reason. For transformations and queries, a declarative/functional style is often clearer *and* fast enough. Choose, don't drift.
- **Reaching for ugly mutable code "for performance" without profiling.** The speed edge is real only on hot paths. On cold code you pay the reasoning tax and gain nothing — textbook premature optimization.
- **Underestimating aliasing.** Two references to one mutable object is the source of "spooky action at a distance" bugs. Default to copying or immutability across boundaries unless sharing is intentional and documented.
- **Treating "structured" as enough.** Single-entry/single-exit control flow doesn't save code that mutates a dozen shared variables. Structure your *state* — scope it narrowly, encapsulate it, prefer immutability — not just your control flow.
- **Sharing mutable state across threads without coordination.** The hardest bug class in software. If you reach for imperative shared state under concurrency, you're signing up for the full memory-model/synchronization burden — usually better to not share, or not mutate.
- **Forcing naturally-stateful algorithms into a pure style (or vice versa).** An in-place quicksort partition is *meant* to mutate; a tax-rule calculation is *meant* to be pure. Match the paradigm to the algorithm's natural shape, not to dogma.

---

## Test Yourself

1. State imperative's central trade-off in one sentence. What do you get, and what do you pay?
2. Why does mutable state break *local reasoning*? Define aliasing and temporal coupling.
3. Give three problem shapes where imperative is genuinely the *right* choice, and one where it's the wrong default.
4. The performance argument has a mechanical basis. Name three specific reasons a tight imperative loop is fast — and the caveat that limits when it matters.
5. Structured programming "won." What problem did it *not* solve, and what two paradigms attack that remaining problem?
6. Explain AoS vs SoA and why SoA can be dramatically faster for a column-wise operation. How does this connect imperative to data-oriented design?
7. You profile and find one function dominates runtime. How does that change your paradigm choice for *that* function vs the rest of the system?

> If #2 is fuzzy, re-read [Why Mutable State Is Hard](#why-mutable-state-is-hard-to-reason-about); if #6 is fuzzy, re-read [Toward Data-Oriented Design](#toward-data-oriented-design).

---

## Cheat Sheet

```
THE TRADE:  imperative = MAX control + MAX performance, bought with
            MAX bookkeeping + mutation risk. ("power and responsibility concentrated in you")

WHY MUTABLE STATE IS HARD:  state is GLOBAL TO TIME → no local reasoning.
  aliasing          two names, one mutable cell → change here shows up "there"
  temporal coupling correctness depends on order that nothing in the code states
  shared+concurrent the data race — the hardest bug class; immutability sidesteps it

WHEN IMPERATIVE IS RIGHT (choose on purpose):
  hot loops (profiled!) · systems/kernel/driver/allocator · embedded/real-time
  large sequential data (→ DOD) · intrinsically stateful algorithms (in-place sort, union-find, DP)
WHEN IT'S THE WRONG DEFAULT:
  cold paths · transformations/queries (→ functional/declarative)
  shared-state concurrency (→ immutability/messages) · complex domain logic (→ functional core)

WHY THE LOOP IS FAST (and the caveat):
  registers, no indirection · CACHE LOCALITY (sequential = prefetchable; miss ≈ 100× hit)
  predictable branches · no hidden allocation/GC
  CAVEAT: true ONLY on hot paths. Profile first; surgical, not everywhere = premature optimization.

STRUCTURE'S LIMIT:  structured programming tamed CONTROL FLOW, not STATE.
  OOP encapsulation + FP immutability = the two attacks on the leftover (state) problem.
  disciplined jumps survive: early return, break/continue, cleanup-goto, exceptions(non-local).

DOD = imperative taken seriously about DATA LAYOUT:  AoS vs SoA;  loop stays simple, layout changes.
```

---

## Summary

At the senior level, imperative programming is a **deliberate trade, not a default**: you gain total control over steps, memory, and order — and the performance that control enables — in exchange for owning all the bookkeeping and absorbing mutation risk. Its deepest cost is that **mutable state is global to time**, which breaks local reasoning and produces the paradigm's signature bugs: **aliasing**, **temporal coupling**, and the worst class of all, **shared-mutable-state data races** under concurrency. Imperative is nonetheless the *right* choice for **hot loops, systems/embedded/real-time code, large sequential data, and intrinsically stateful algorithms** — and the *wrong* default for cold paths, data transformations, shared-state concurrency, and complex domain logic. Its performance edge is **mechanical and honest**: registers, no indirection, **cache locality**, predictable branches, and no hidden allocation — but it **only materializes on profiled hot paths**, so applying it elsewhere is premature optimization. **Structured programming tamed control flow but not state**; encapsulation and immutability are the two great attacks on what it left behind. And **data-oriented design** is imperative reasoning taken to its conclusion — keep the simple loop, perfect the data layout (AoS→SoA) so every cache line earns its keep. The synthesis real systems use is *layered*: a clear functional/declarative outer skin over a tight imperative hot core — which is exactly where [`professional.md`](professional.md) goes next.

---

## Further Reading

- **"Out of the Tar Pit"** — Moseley & Marks (2006) — the definitive essay on why *state* (not control flow) is the primary source of complexity, and how to minimize it.
- **Data-Oriented Design** — Richard Fabian — the book-length case for designing around data layout and the cache; the bridge from imperative to DOD.
- **What Every Programmer Should Know About Memory** — Ulrich Drepper — the deep reference on caches, prefetching, and why sequential access wins.
- **Computer Systems: A Programmer's Perspective** (CS:APP) — Bryant & O'Hallaron — Ch. 5–6 (optimization, the memory hierarchy) ground the performance claims in hardware.
- **A Discipline of Programming** — Edsger Dijkstra — reasoning about imperative programs via invariants; the rigorous root of "reason about state, not just steps."

---

## Related Topics

- [`middle.md`](middle.md) — the mechanics (scope, frames, pass semantics, side effects) this page evaluates.
- [`professional.md`](professional.md) — the imperative core inside FP/GC runtimes, "functional core / imperative shell," and managing mutation at scale.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — imperative taken to its high-performance, cache-first conclusion.
- [03 — Declarative Programming](../03-declarative-programming/) — the other end of the trade: give up control, gain brevity and an engine.
- [Functional Programming](../../code-craft/functional-programming/) — immutability and purity as the systematic answer to mutable-state bugs.
- [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/concurrency/) — the synchronization machinery shared mutable state forces on you.
