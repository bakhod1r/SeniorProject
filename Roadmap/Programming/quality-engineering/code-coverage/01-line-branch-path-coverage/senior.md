# Line, Branch & Path Coverage — Senior Level

> **Roadmap:** [Code Coverage](../README.md) → Line, Branch & Path Coverage
> *The professional page taught you to read a coverage report and argue about thresholds. This page is about the layer underneath: why full path coverage is provably impossible, what MC/DC actually proves and why a 787 won't fly without it, and how a probe gets physically welded into your bytecode, your IR, or your `.text` section — and what `-O2` does to the line tables that make any of it meaningful.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Coverage Criteria Lattice — Subsumption, Formally](#the-coverage-criteria-lattice--subsumption-formally)
4. [Path Coverage and the Combinatorial Explosion](#path-coverage-and-the-combinatorial-explosion)
5. [Basis-Path Coverage — McCabe's Tractable Approximation](#basis-path-coverage--mccabes-tractable-approximation)
6. [Data-Flow Coverage — def-use, all-uses, all-defs](#data-flow-coverage--def-use-all-uses-all-defs)
7. [MC/DC in Depth — Unique-Cause vs Masking](#mcdc-in-depth--unique-cause-vs-masking)
8. [Instrumentation Internals — Source, Bytecode, IR, Sanitizer](#instrumentation-internals--source-bytecode-ir-sanitizer)
9. [Probe Placement and the Cost/Accuracy Trade](#probe-placement-and-the-costaccuracy-trade)
10. [Optimized Code — Why `-O2` Breaks Attribution](#optimized-code--why--o2-breaks-attribution)
11. [Concurrency Counting Hazards](#concurrency-counting-hazards)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The theory that bounds what coverage can measure, and the instrumentation internals that determine what it actually does measure.**

By the professional level you can wire coverage into CI, distinguish project from patch coverage, and explain to a skeptical PM why 80% is neither a floor of quality nor a ceiling of effort. That's operational fluency. The senior jump is downward, into two layers professionals take on faith.

The first is **the theory of what's even measurable**. "Path coverage" sounds like the natural completion of "branch coverage," but it is *undecidable in general* — and understanding precisely why turns the whole metric hierarchy from a list of buzzwords into a lattice with provable relationships. McCabe's cyclomatic complexity isn't a code-smell number from your linter; it is the *cardinality of a basis* for the cycle space of the control-flow graph, and it tells you exactly how many independent paths a tractable approximation must cover. Data-flow criteria catch a class of bug that 100% branch coverage structurally cannot see. MC/DC isn't bureaucratic gold-plating; it is the criterion that makes testing a 10-condition Boolean expression cost 11 tests instead of 1024, and it is *law* for flight-critical software.

The second layer is **how a counter gets into your code**. A coverage tool must, somehow, record that line 42 ran. *Where* it injects that record — rewriting your source, splicing bytecode at class-load with ASM, emitting counter increments into the compiler's IR, or piggybacking on a sanitizer — determines its overhead, its accuracy, and whether it can survive `-O2` at all. This page is both layers: the math that bounds the metric, and the machine code that implements it.

---

## Prerequisites

- **Required:** You've internalized [professional.md](professional.md) — diff coverage, the ratchet, why coverage is a signal and not a target, and the politics of gates.
- **Required:** You can read a control-flow graph and you're comfortable with basic graph theory (nodes, edges, connected components).
- **Required:** Working familiarity with at least one compiled toolchain's coverage flag — `go test -cover`, `gcc --coverage`, or `clang -fprofile-instr-generate -fcoverage-mapping`.
- **Helpful:** You can read a little x86-64 or LLVM IR; the instrumentation sections show both.
- **Helpful:** A sense of what an optimizing compiler does — inlining, dead-code elimination, basic-block reordering — because that's exactly what fights coverage attribution.

---

## The Coverage Criteria Lattice — Subsumption, Formally

The metrics are not a flat list; they form a **subsumption hierarchy**. Criterion *A* subsumes *B* if every test set that achieves 100% *A* necessarily achieves 100% *B*. This is a precise, provable relation — and it's why "we have 100% line coverage" tells you almost nothing about branch behavior.

| Criterion | The obligation | Subsumes |
|---|---|---|
| **Statement / line** | Every node (statement) executed at least once | — |
| **Branch / decision** | Every CFG *edge* taken — each decision goes both true and false | statement |
| **Condition** | Each *atomic* boolean condition takes both T and F | (not statement!) |
| **Condition/decision** | Branch **and** condition together | branch, condition |
| **MC/DC** | Each condition shown to *independently* affect the decision | condition/decision |
| **Multiple-condition** | Every combination of conditions (full truth table) | MC/DC |
| **Path** | Every executable path through the CFG | branch (and all above except multiple-condition's combos) |

The two facts every senior must be able to derive on a whiteboard:

**100% line coverage does *not* imply 100% branch coverage.** An `if` with no `else` is one statement edge but two decision edges:

```go
func clamp(x int) int {
    if x < 0 {
        x = 0          // one test with x = -1 covers this LINE
    }
    return x           // ...and reaches 100% line coverage
}
// But the FALSE branch of `x < 0` was never taken.
// Branch coverage = 50%. A bug in the implicit "do nothing" path is invisible.
```

**Condition coverage does *not* subsume decision coverage.** This is the surprising one. Consider `a || b`:

```c
if (a || b) { ... }
// Test 1: a=true,  b=false  → condition a covered both? no, only true...
// Test set {a=T,b=F} , {a=F,b=T}:
//   a takes T (test1) and F (test2)  ✓ condition coverage for a
//   b takes F (test1) and T (test2)  ✓ condition coverage for b
//   → 100% CONDITION coverage
// But the decision (a||b) is TRUE in BOTH tests → the FALSE outcome
//   of the whole decision is never exercised. Decision coverage = 50%.
```

This is exactly why the standards reach for **condition/decision** and then **MC/DC**: each plugs a hole the cheaper criterion leaves open.

> **Key insight:** Subsumption is a *guarantee about test sets*, not about bug-finding power in practice. A criterion that subsumes another will catch every structural gap the weaker one catches — but "structural gap covered" is not "bug found," because coverage records *execution*, never *correctness*. The lattice tells you what you're *guaranteed to have exercised*; your assertions decide whether exercising it proved anything.

---

## Path Coverage and the Combinatorial Explosion

Path coverage is the criterion that demands every distinct route through the control-flow graph be executed. It is the strongest *structural* criterion and, for almost all real code, **unachievable** — not merely expensive, but impossible in principle. The argument has two parts.

**Part 1: sequential branches multiply.** A function with *n* sequential, independent binary decisions has up to **2ⁿ** paths, because each decision doubles the route count:

```c
void f(int a, int b, int c, int d) {
    if (a) {...}      // ×2
    if (b) {...}      // ×2   → 4
    if (c) {...}      // ×2   → 8
    if (d) {...}      // ×2   → 16 paths for 4 branches
}
```

Ten sequential `if`s → 1024 paths. Twenty → over a million. This is already enough to make full path coverage economically dead for any nontrivial function: the path count grows exponentially in the number of decisions, while branch coverage grows *linearly* (2*n* edges). That gap — exponential vs linear — is the entire practical case for branch coverage as the default and path coverage as a theoretical ideal.

**Part 2: loops make it infinite.** A single loop whose trip count depends on input has an *unbounded* number of paths — zero iterations, one, two, … — each a distinct path through the CFG:

```c
while (cond(x)) {      // 0 iterations is one path,
    body();            // 1 iteration another,
}                      // 2 iterations another, ... → infinitely many paths
```

You cannot enumerate an infinite set of paths, so full path coverage of any function containing a data-dependent loop is **not finitely achievable**. Worse, *deciding which paths are even executable* is undecidable in general: determining whether a given path is feasible (has any input that drives execution down it) reduces to deciding satisfiability of the path's accumulated branch conditions, which for arbitrary code (think nonlinear arithmetic, unbounded loops) is equivalent to the halting problem. Many syntactic paths are *infeasible* — no input can take them — and you cannot algorithmically separate the feasible from the infeasible in the general case.

So path coverage fails on three counts at once: exponential blow-up (sequential branches), infinitude (loops), and undecidability of feasibility (you can't even list the achievable targets). This is not a tooling gap that a faster machine fixes. It's a property of computation.

> **Key insight:** "100% path coverage" is a category error for general code, the way "the largest integer" is. The useful question is never "can we cover all paths" but "which *small, principled subset* of paths is worth covering" — and that subset is what basis-path coverage formalizes.

---

## Basis-Path Coverage — McCabe's Tractable Approximation

If all paths is impossible, the engineering move is to cover a **basis**: a minimal set of paths from which every other path can be constructed as a linear combination. Thomas McCabe's 1976 insight is that a program's control-flow graph has a *cycle space* — a vector space over GF(2) where each path is a vector of edge-traversal counts — and that space has a finite **dimension**. That dimension is the **cyclomatic complexity**, V(G), and it is exactly the number of independent paths you need.

For a CFG with **E** edges, **N** nodes, and **P** connected components:

```
V(G) = E − N + 2P          (single connected program: P = 1 → E − N + 2)
```

Two equivalent shortcuts that matter in practice:

- **V(G) = (number of binary decision points) + 1.** Each `if`, each `while`/`for` condition, each `case`, each `&&`/`||` (which is a hidden branch) adds one. A straight-line function has V(G) = 1.
- **V(G) = number of bounded regions** in the planar drawing of the CFG, plus one for the outer region.

```go
func categorize(n int) string {        // V(G) walk-through
    if n < 0 {                         // +1
        return "negative"
    }
    if n == 0 {                        // +1
        return "zero"
    }
    if n < 100 && n%2 == 0 {           // +1 for <100, +1 for &&'s second operand
        return "small even"
    }
    return "other"
}
// decisions: (n<0), (n==0), (n<100), (n%2==0)  = 4 decision points
// V(G) = 4 + 1 = 5  →  a basis of 5 independent paths
```

A **basis path set** is then *V(G)* linearly independent paths through the graph. "Independent" means each introduces at least one edge not in the others; any feasible path through the function is expressible as a GF(2) sum of basis paths. Covering the basis is the McCabe testing strategy: it's the smallest path set that touches every edge in a way that exercises each decision's independent effect, and crucially it is **finite and computable** even though full path coverage is neither.

The number does double duty:

- As a **test-design target**: aim for at least V(G) test cases to cover a basis.
- As a **maintainability metric**: V(G) > 10 is McCabe's classic "consider refactoring" threshold; V(G) > 15–20 is where defect density and review time climb sharply. (This is the number your linter reports — but now you know it's a *vector-space dimension*, not a vibe.)

> **Key insight:** Cyclomatic complexity is the bridge between the impossible (all paths) and the practical (a finite basis). It answers, exactly, "how many independent paths must I test to have a basis for the path space?" — converting an undecidable goal into an integer you can put in CI. It does *not* claim that V(G) tests find all bugs; it claims they form a *basis*, which is a far more modest and honest guarantee.

---

## Data-Flow Coverage — def-use, all-uses, all-defs

Control-flow criteria (line, branch, path) ask *did execution traverse this edge?* They are blind to a whole class of defect that lives in the relationship between where a variable is **defined** (assigned) and where it is **used** (read). Data-flow coverage, formalized by Rapps and Weyuker, makes those relationships the coverage targets.

Two kinds of use:

- **c-use** (computation use): the value is read in a computation or output — `y = x + 1`, `return x`.
- **p-use** (predicate use): the value is read in a branch condition — `if (x > 0)`.

A **def-use pair** (**du-pair**) is a (definition, use) of the same variable connected by a **def-clear path** — a path from the def to the use along which the variable is not redefined. The criteria, in increasing strength:

| Criterion | Obligation |
|---|---|
| **all-defs** | For each *definition*, cover at least one def-clear path to *some* use |
| **all-uses** | For each definition, cover a def-clear path to *every* reachable use (every du-pair) |
| **all-du-paths** | Cover *every distinct def-clear path* for every du-pair (closest to path coverage; can re-explode) |

Why this catches what branch coverage misses — the canonical example:

```c
int discount(int qty) {
    int rate;
    if (qty > 100)
        rate = 20;              // def 1 of rate
    else
        rate = 10;              // def 2 of rate
    // ... 30 lines that DO NOT touch rate ...
    return price * rate / 100;  // USE of rate
}
```

Branch coverage here is satisfied by two tests (`qty=200`, `qty=50`) — both branches taken, 100% branch coverage. But suppose the bug is subtler: a third path where `rate` is read **before** any def reaches it (an uninitialized-use), or a def whose value never reaches the use because a redefinition clobbers it on every path (a **dead store**). Consider:

```c
int f(int flag) {
    int x = compute_expensive();  // def of x
    if (flag)
        x = 0;                    // redefinition on the flag=true path
    return g(x);                  // use of x
}
```

The du-pair (def `x = compute_expensive()` → use `g(x)`) is **only exercised when `flag` is false**. A test suite with `flag=true` only achieves 100% line and 100% branch *for the relevant lines that execute*, yet never exercises the path where the expensive computation's value actually flows to the use. all-uses *forces* a test that establishes that def→use flow — catching that the expensive def is dead on the `flag=true` path, and that the only live flow is the `flag=false` one. Data-flow coverage is, in effect, coverage of the program's *value propagation*, and value-propagation bugs (wrong def reaching a use, uninitialized reads, dead stores masking a missing computation) are invisible to pure control-flow criteria.

The cost: du-pairs can be numerous, and `all-du-paths` reintroduces path explosion (every def-clear path for every pair). In practice data-flow coverage is rare in mainstream tools precisely because computing du-pairs requires real def-use analysis, but it's foundational in compiler-grade tooling and a known gap that pure line/branch dashboards quietly hide.

> **Key insight:** Control-flow coverage asks whether you *walked the road*; data-flow coverage asks whether you *delivered the package* — whether a value computed in one place was ever actually consumed in another along a clean path. A suite can walk every road and never deliver a single package the buggy way.

---

## MC/DC in Depth — Unique-Cause vs Masking

**Modified Condition/Decision Coverage** sits between condition/decision and full multiple-condition coverage, and it exists to defeat exactly the combinatorial explosion that kills multiple-condition coverage. For a decision with *n* conditions, multiple-condition coverage needs up to **2ⁿ** tests (the full truth table); MC/DC needs only **n + 1** in the typical case. That linear-vs-exponential collapse is why it is the criterion of choice for safety-critical software.

The defining requirement: **every condition must be shown to *independently* affect the decision's outcome.** Concretely, MC/DC demands:

1. Every entry/exit point invoked,
2. Every condition takes both T and F,
3. Every decision takes both T and F, and
4. **Each condition is shown to independently change the decision outcome** — by finding two tests that differ *only* in that condition and produce *different* decision results.

Requirement 4 is the heart of it. For each condition, you need an **independence pair**: two test vectors identical in every other condition, where flipping *this* condition flips the whole decision. That pair proves the condition is not dead code, not masked, not redundant — it *matters*.

Worked example for `result = A && (B || C)`:

| Test | A | B | C | A&&(B\|\|C) |
|---|---|---|---|---|
| 1 | T | T | F | **T** |
| 2 | F | T | F | **F** |  ← pairs with 1: only A differs, outcome flips → A independent
| 3 | T | T | F | T |
| 4 | T | F | F | **F** |  ← pairs with 3: only B differs, outcome flips → B independent
| 5 | T | F | T | **T** |
| 6 | T | F | F | F |  ← pairs with 5: only C differs, outcome flips → C independent

Deduplicating (tests 1 and 3 are identical), you need **4 tests** to cover 3 conditions — n+1 — versus 2³ = 8 for full multiple-condition. Note also how `&&` and `||` create **masking**: when A=F, the value of (B||C) is irrelevant — A *masks* the rest. That masking is what lets MC/DC be linear: you don't need every combination, only the ones that demonstrate independent effect through the mask.

This is where the **two forms** of MC/DC matter, and the distinction is genuinely load-bearing in certification:

- **Unique-cause MC/DC** (the original, strictest): the independence pair must differ in *only* the condition under test and *nothing else*. Clean and unambiguous — but **impossible when conditions are coupled**, e.g. `(A && B) || (A && !B)` where A appears twice and you cannot vary one occurrence alone.
- **Masking MC/DC** (DO-178C-permitted): the condition under test must be the only one whose change is *allowed to affect the outcome*; other conditions may change as long as they are **masked out** (their effect blocked by the boolean structure) on the path to the output. This handles coupled conditions that unique-cause cannot, and it's the form most certified tools implement.

Why safety standards *mandate* it: **DO-178C** (the avionics software standard) ties required coverage to failure-condition severity via Design Assurance Levels.

| DAL | Failure condition | Coverage required |
|---|---|---|
| **A** | Catastrophic (loss of aircraft) | **MC/DC** + decision + statement |
| **B** | Hazardous | Decision + statement |
| **C** | Major | Statement |
| **D** | Minor | (no structural coverage objective) |
| **E** | No safety effect | none |

For DAL A — the flight-control software whose failure can kill everyone aboard — statement and decision coverage are deemed insufficient *because* of the holes shown earlier (condition coverage missing the whole-decision outcome, branch coverage missing independent condition effects). MC/DC is the regulator's chosen point on the cost/rigor curve: strong enough to prove every condition independently matters, cheap enough (n+1, not 2ⁿ) to be achievable on real avionics code. The same logic appears in **ISO 26262** (automotive, ASIL D), **EN 50128** (rail), and **IEC 61508** (general functional safety) — all recommend or require MC/DC at their highest integrity levels.

> **Key insight:** MC/DC is the answer to a precise economic question: *what is the weakest criterion that still proves every condition independently influences the outcome?* It buys most of multiple-condition coverage's assurance at linear cost by exploiting boolean masking — which is exactly why a regulator who cannot afford 2ⁿ tests but cannot accept a dead condition in a flight computer settled on it.

---

## Instrumentation Internals — Source, Bytecode, IR, Sanitizer

A coverage tool records *that a region executed*. The interesting engineering is **where** the recording instruction is injected. There are four families, each with a distinct cost/accuracy profile.

### 1. Source rewriting (Istanbul/`nyc`, older Coverage.py modes)

The tool parses your source into an AST, inserts counter-increment statements at each statement/branch, and feeds the rewritten source to the normal compiler/interpreter:

```js
// original
function f(x) { if (x) return 1; return 0; }

// instrumented (conceptually, what Istanbul emits)
function f(x) {
  cov.f['f']++;                      // function counter
  cov.s[0]++;                        // statement counter
  if (cov.b[0][x ? 0 : 1]++, x) {    // branch counter, both arms
    cov.s[1]++; return 1;
  }
  cov.s[2]++; return 0;
}
```

Cheap to build, language-portable in principle, and it maps trivially back to source (the probes *are* in source coordinates). But it sees only what the front-end parser sees, it can perturb the very optimizer it feeds (the extra statements change inlining/JIT decisions), and it requires a real parser per language.

### 2. Bytecode instrumentation — JaCoCo's on-the-fly ASM probes

JaCoCo (the JVM standard) never touches your source or your `.class` files on disk. It installs a **Java agent** (`-javaagent:jacocoagent.jar`) that hooks the class loader and, *as each class is loaded*, rewrites its bytecode in memory using the **ASM** library. It inserts **probes**: boolean array stores that record "this instruction sequence executed."

The granularity is the **basic block boundary**. JaCoCo identifies probe-insertion points at the boundaries between basic blocks (specifically, before each branch target and method exit) and injects:

```
// conceptually, at a probe point, JaCoCo inserts the equivalent of:
//   boolean[] probes = <get this class's probe array>;
//   probes[i] = true;
// as raw bytecode:  ALOAD probes; ICONST i; ICONST_1; BASTORE
```

Two consequences fall directly out of this design:

- **JaCoCo computes line coverage *indirectly*.** It counts probe execution at the *bytecode* level, then maps probes back to source lines via the `LineNumberTable` debug attribute in the class file. **No debug info → no line coverage** (you still get instruction/branch coverage). This is why `javac -g` matters and why a stripped/obfuscated jar reports line coverage poorly.
- **It measures *branch coverage on bytecode branches*.** A single source line with `a && b` compiles to two bytecode conditional jumps; JaCoCo correctly reports two branches on that line. Conversely, the compiler may have already collapsed or duplicated branches, so JaCoCo's branch count can diverge from a naive source reading — it's measuring what the JVM will actually execute, which is arguably more honest.

On-the-fly bytecode instrumentation is the sweet spot for the JVM: zero build-step changes, no modified artifacts on disk, and it instruments third-party libraries you don't have source for.

### 3. Compiler-emitted counters — gcov and LLVM source-based coverage

The compiler itself emits the counters, which is the most accurate approach because the compiler knows the *exact* mapping between source regions and generated code.

**GCC `--coverage` (gcov):** `gcc --coverage` is shorthand for `-fprofile-arcs -ftest-coverage`. The compiler instruments the CFG's **arcs (edges)**, not nodes — a deliberate optimization. Using a spanning tree of the CFG, it inserts counters on only a *minimal* subset of edges (the non-tree edges) and *derives* the rest by Kirchhoff's-law arithmetic (flow in = flow out at each node). This is the classic **Knuth/Ball-Larus optimal edge profiling** trick: instrument the fewest edges, compute the rest.

```bash
gcc --coverage -O0 prog.c -o prog     # emits prog.gcno (CFG + line map) at compile
./prog                                  # emits prog.gcda (execution counts) at run
gcov prog.c                             # merges .gcno + .gcda → prog.c.gcov
```

The `.gcno` file (notes, written at compile time) holds the CFG and line mapping; the `.gcda` file (data, written at run via a `__gcov_exit` handler registered with `atexit`) holds the arc counts. Coverage = counts mapped back through the CFG.

**LLVM source-based coverage** (`clang -fprofile-instr-generate -fcoverage-mapping`) is the modern, more precise design. It emits, into the IR, **counter increment intrinsics** (`llvm.instrprof.increment`) keyed to **source code regions** described by a **coverage mapping** — a compact encoding of `(file, start line:col, end line:col) → counter expression`. Crucially, regions are *(line, column)* spans, so it distinguishes multiple regions on one line and even tracks *sub-expression* regions for branch/condition coverage:

```bash
clang -fprofile-instr-generate -fcoverage-mapping -O0 prog.c -o prog
LLVM_PROFILE_FILE=prog.profraw ./prog
llvm-profdata merge -sparse prog.profraw -o prog.profdata
llvm-cov show ./prog -instr-profile=prog.profdata    # region-accurate, column-level
```

Because the counter intrinsics live in the IR *before* most optimization and carry explicit source-region metadata, LLVM coverage survives optimization far better than gcov's CFG-arc model and can report at column granularity (e.g., which operand of `a && b` was the short-circuit point). This is the engine behind Rust's `grcov`/`-C instrument-coverage`, Swift coverage, and `cargo-llvm-cov`.

### 4. Sanitizer / JIT coverage — SanitizerCoverage

For fuzzing and security work, **SanitizerCoverage** (`clang -fsanitize-coverage=trace-pc-guard,trace-cmp,...`) instruments **edges** (basic-block transitions) with callbacks into a runtime — `__sanitizer_cov_trace_pc_guard` per edge — rather than counting for a report. It's the coverage feedback that drives **libFuzzer/AFL++**: the fuzzer reads which new edges a given input reached and steers mutation toward unexplored code. Same underlying idea (instrument CFG edges), entirely different consumer (an evolutionary search loop, not a CI percentage).

| Approach | Where injected | Accuracy | Cost | Sees 3rd-party code? |
|---|---|---|---|---|
| Source rewrite (Istanbul) | AST → source | source-coord, but perturbs optimizer | low build, runtime overhead | only with source |
| Bytecode (JaCoCo/ASM) | class-load, in-memory | bytecode branches; lines need debug info | very low (boolean stores) | **yes** (any class) |
| gcov (`--coverage`) | CFG arcs in compiler | edge-exact; weak under `-O` | counters + I/O | needs recompile |
| LLVM source-based | IR intrinsics + region map | column/region-exact; survives `-O` best | counters | needs recompile |
| SanitizerCoverage | IR, per-edge callbacks | edge-level, for *search* not reporting | callback per edge (high) | needs recompile |

> **Key insight:** The injection site dictates everything downstream. Source-level probes read like your code but lie to your optimizer; bytecode probes are invisible to the build but depend on debug tables to mean anything in source terms; IR-level counters are the most faithful because the compiler is the only component that knows the true source-to-machine mapping — which is also why they're the only ones with a fighting chance under optimization.

---

## Probe Placement and the Cost/Accuracy Trade

You do *not* need a counter on every statement. The number and location of probes is an optimization problem, and the good tools solve it with graph theory.

The key realization: in a **basic block** (a maximal straight-line sequence with one entry and one exit, no internal branches) every instruction executes exactly as often as every other. So **one probe per basic block** suffices for statement coverage — not one per statement. That alone cuts probe count by the average block length (often 3–6×).

You can do better. By the flow-conservation argument gcov uses, if you build a **spanning tree** of the CFG and instrument only the **non-tree (chord) edges**, the counts on all tree edges are *derivable* by arithmetic. For a CFG with *E* edges and *N* nodes you instrument only **E − N + 1** edges — which is, satisfyingly, the cyclomatic complexity again (the cycle-space dimension). The cycle space's dimension is both "independent paths to test" *and* "minimum edges to instrument for full edge counts." That is not a coincidence; both are the rank of the same matroid on the graph.

The trade-offs a senior balances:

- **Fewer probes → lower overhead, coarser data.** Block-level probes give you line/statement coverage cheaply but can't tell you *which* branch of a collapsed expression ran without finer placement.
- **Edge probes → branch coverage** but more instrumentation points and more runtime cost.
- **Counting vs presence.** For a *report* you often only need a boolean "did this run" (JaCoCo's `boolean[]` — a store, no read-modify-write, cheap and contention-tolerant). For *profile-guided optimization* or hit-count reports you need actual counts (read-increment-write), which is more expensive and, critically, **racy under concurrency** (next section).
- **Probe *placement* and the optimizer.** Probes inserted early (in IR, before optimization) get optimized *with* the code and perturb it less per-probe, but the optimizer may then move/merge them, complicating attribution. Probes inserted late (post-optimization, or in bytecode) attribute cleanly but can block optimizations that would otherwise fire.

> **Key insight:** Optimal probe placement is the same mathematics as basis-path testing — both are the dimension of the CFG's cycle space, E − N + 1. The minimum number of counters to reconstruct all edge frequencies equals the minimum number of independent paths to test. Cyclomatic complexity is, quite literally, the budget for *both* sides of coverage: how much to test and how much to instrument.

---

## Optimized Code — Why `-O2` Breaks Attribution

Everything above assumes a faithful map from machine instructions back to source lines. **Optimization shreds that map**, which is why coverage builds almost always disable or reduce optimization, and why coverage of release-optimized binaries is treated with suspicion.

The mechanism is the **line table** (DWARF's `.debug_line`, the JVM's `LineNumberTable`): a mapping from instruction address → (file, line). Coverage tools that work at the machine/bytecode level (gcov mapping arcs to lines, JaCoCo mapping probes to lines) lean entirely on this table. Optimization corrupts it in specific, instructive ways:

- **Inlining** copies a callee's body into N call sites. The callee's lines now appear at N addresses; which call site "owns" the coverage? DWARF represents this with *inlined subroutine* DIEs and the line table can attribute an instruction to an inlined line, but naive tools double-count or mis-attribute. A function shown as 100% covered may have been inlined into one caller and never independently tested.
- **Basic-block reordering and tail merging.** The optimizer reorders blocks for branch-prediction/locality and *merges identical tails* of different branches into one block. Now a single machine block backs *two* source branches — was the branch covered? Both? The line table maps the merged block to *one* line (or emits `is_stmt` markers that flicker), so branch attribution becomes ambiguous.
- **Dead-code elimination and constant folding.** Code the optimizer proved unreachable or folded away has *no instructions* and therefore *no coverage entry* — the line silently vanishes from the report rather than showing as uncovered, which can make a report look better than reality.
- **Loop transformations** (unrolling, vectorization) replicate or restructure the body; the line table maps several unrolled copies back to the same source line, and a partially-covered unrolled remainder loop confuses hit attribution.
- **`is_stmt` and discriminators.** DWARF adds *discriminators* to the line table precisely to disambiguate multiple blocks on the same line (e.g., the two halves of `a && b`), and LLVM coverage uses column info to do better — but tools that ignore discriminators collapse them and lose branch resolution.

```bash
# The standard advice and why:
gcc --coverage -O0 ...        # -O0 keeps a 1:1 statement→instruction map
# At -O2, the .gcno CFG no longer matches the executed code path-for-path;
# gcov can report fractional/garbled line hits or "###### " on folded lines.

# LLVM's coverage degrades more gracefully BECAUSE its regions are source spans
# attached in IR, not arcs reconstructed from optimized machine code:
clang -fprofile-instr-generate -fcoverage-mapping -O2 ...   # usable, but verify
```

This is the senior's reconciliation of two facts: you want to *measure* the code you *ship* (optimized), but the only build whose coverage you can fully trust is the *unoptimized* one. The standard resolution is to run coverage at `-O0`/`-Og` and accept that you're measuring a build that is structurally equivalent but not bit-identical to release — and to be deeply skeptical of any "100% coverage" claim on an `-O2` artifact unless it came from LLVM's region-based engine that was *designed* to survive optimization.

> **Key insight:** Coverage attribution is only as trustworthy as the line table, and optimization exists precisely to *break the line-table's 1:1 assumptions* — inlining destroys "one body, one location," tail-merging destroys "one block, one branch," DCE makes uncovered code *disappear* rather than show red. Coverage at `-O2` isn't wrong so much as *unattributable*; that's why coverage builds turn optimization off.

---

## Concurrency Counting Hazards

The final internals trap: a coverage counter is **shared mutable state**, and incrementing it from multiple threads is a textbook data race. This is most visible in Go, whose tooling makes the trade explicit through `-covermode`.

A naive hit counter compiles to a non-atomic read-modify-write:

```
count = count + 1     →    mov  rax, [count]    ; load
                           inc  rax             ; +1
                           mov  [count], rax    ; store   ← interleaving loses updates
```

Two goroutines hitting the same block can interleave load/load/store/store and **lose increments**. The consequences differ by what you need from the counter:

- If you only need **"was this block executed at least once" (set mode)**, a lost increment is *harmless* — the worst case is two threads both writing `1`, and `1` is the answer either way. A racing boolean store cannot turn a covered block uncovered.
- If you need **accurate hit counts** (`count` mode), the race **corrupts the data** — your "executed 1,000,000 times" might read 600,000 — and, in a language with a race detector, *the coverage instrumentation itself trips the detector*, polluting your race reports with false positives from your own counters.

Go exposes exactly three modes:

| `-covermode` | Counter | Semantics | When |
|---|---|---|---|
| `set` (default) | boolean store | "did this statement run" — no counts | single-threaded *or* you only need executed/not |
| `count` | non-atomic `int` | hit counts, **racy** under goroutines | accurate counts, no concurrency on hot blocks |
| `atomic` | `atomic.AddUint32` | hit counts, **race-free** | concurrent code where counts must be correct |

```bash
go test -covermode=atomic -coverprofile=cov.out ./...
# atomic uses sync/atomic on each counter — correct under concurrency,
# but every probe is now an atomic RMW (LOCK XADD), measurably slower on hot paths.
```

`-covermode=atomic` is **mandatory** when you (a) run tests with the race detector (`-race`), because non-atomic counter writes are themselves races the detector will flag, or (b) actually rely on hit *counts* from concurrent code. The cost is real: each probe becomes a `LOCK`-prefixed atomic add (a serializing, cache-line-bouncing instruction), so hot loops measured under `atomic` run noticeably slower — a coverage-overhead tax you pay for correctness. This is the same set-vs-count distinction from the probe-placement section, now with concurrency as the forcing function: **if presence is all you need, the cheap racy store is actually correct; the moment you need counts under threads, you must pay for atomics.**

The same hazard exists everywhere, just less surfaced: JaCoCo's `boolean[]` probe is a plain store and is *safe by design* precisely because it's set-semantics (a lost write of `true` over `true` is a no-op); LLVM's counter mode (`-fprofile-instr-generate`) uses non-atomic counters by default and offers `-fprofile-update=atomic` for the same reason Go offers `atomic`. The lesson generalizes: **boolean coverage is concurrency-safe for free; counted coverage is not, and the fix is atomics with a throughput cost.**

> **Key insight:** Whether coverage counting is thread-safe depends entirely on whether you're recording *presence* or *frequency*. Presence (a boolean set) is idempotent and race-immune; frequency (an integer increment) is a classic lost-update race that demands atomics. `-covermode=atomic` exists because the moment you combine concurrent code with the race detector or with hit-count reporting, the cheap counter is no longer correct.

---

## Mental Models

- **The criteria form a lattice, and subsumption is a guarantee about test *sets*, not about bugs.** "100% A implies 100% B" is provable graph theory; "100% A finds bug X" is not. Line ⊏ branch ⊏ condition/decision ⊏ MC/DC ⊏ multiple-condition; path subsumes branch but is unreachable. Know which holes each level plugs.

- **Path coverage is impossible the way "the largest integer" is impossible.** Exponential in sequential branches, infinite with loops, undecidable in feasibility. The only sane completion is a *basis*, and cyclomatic complexity is its dimension.

- **V(G) is one number doing three jobs.** Independent paths to test, minimum edges to instrument for full counts, and a maintainability threshold — all the rank of the CFG's cycle space, E − N + 2P. When you see "complexity = 12," read "12-dimensional path space."

- **Control-flow coverage walks roads; data-flow coverage delivers packages.** A suite can traverse every edge and never exercise the def→use flow where the value actually matters. Uninitialized reads and dead stores are value-flow bugs invisible to branch coverage.

- **MC/DC is the linear-cost proof of independent influence.** It buys (most of) multiple-condition assurance at n+1 instead of 2ⁿ by exploiting boolean masking — which is exactly why a regulator who can't afford 2ⁿ but can't accept a dead condition in a flight computer mandated it.

- **The injection site is the whole story for instrumentation.** Source probes lie to the optimizer; bytecode probes need debug tables to mean anything; IR counters are faithful because the compiler owns the true source map. Optimization breaks the line table that all machine-level tools depend on.

- **Presence is free under concurrency; frequency is not.** A boolean "it ran" is idempotent and race-immune; an integer hit count is a lost-update race needing atomics. That single distinction explains `set` vs `count` vs `atomic`.

---

## Common Mistakes

1. **Treating "100% line coverage" as "fully tested."** Line coverage doesn't subsume branch coverage — an `if` with no `else` hits 100% line at 50% branch. Report branch coverage at minimum; line-only dashboards hide the implicit-else holes.

2. **Believing condition coverage implies decision coverage.** It doesn't: `{a=T,b=F},{a=F,b=T}` gives 100% condition coverage of `a||b` while the decision is true in both tests (decision coverage 50%). If you need decision outcomes, ask for condition/**decision** or MC/DC explicitly.

3. **Aiming for "100% path coverage."** It's undecidable and infinite for any loop with a data-dependent trip count. Target a *basis* (V(G) paths); chasing all paths is chasing a non-finite set.

4. **Reading cyclomatic complexity as a mere style nag.** It's the dimension of the path space and the exact number of independent paths a basis must cover — and simultaneously the minimum probes for full edge counts. Use it to *size your test set*, not just to fail a linter.

5. **Trusting coverage from an `-O2` build.** Inlining, tail-merging, and DCE corrupt the line table coverage depends on; dead-folded code *vanishes* from the report instead of showing uncovered. Run coverage at `-O0`/`-Og`, or use LLVM's region-based engine designed to survive optimization.

6. **Stripping debug info, then expecting line coverage.** JaCoCo derives lines from `LineNumberTable` and gcov from `.gcno`/DWARF line tables. No debug info → no line coverage (you keep instruction/branch). Compile coverage builds with `-g`/`javac -g`.

7. **Using `-covermode=count` (or non-atomic LLVM counters) under concurrency or `-race`.** Non-atomic increments are a lost-update race that corrupts counts *and* trips the race detector with false positives from your own probes. Use `-covermode=atomic` (or `-fprofile-update=atomic`) for concurrent, counted coverage.

8. **Assuming branch coverage catches value-flow bugs.** It can't see def→use relationships. A def that's dead on the tested path, or a use that reads the wrong def, passes 100% branch coverage. Data-flow (all-uses) is the criterion that targets those — know that pure line/branch dashboards hide them.

---

## Test Yourself

1. Give a concrete code example where 100% line coverage coexists with 50% branch coverage. Then give one where 100% *condition* coverage coexists with 50% *decision* coverage.
2. A function has 12 sequential, independent binary `if`s and one `while` loop whose trip count depends on input. How many paths does it have, and is full path coverage achievable? Explain precisely why.
3. State the cyclomatic complexity formula and compute V(G) for a function with 4 `if`s, one of which uses `&&` with two operands. What does that number tell you to do, in two different senses?
4. Explain a bug that all-uses data-flow coverage catches but 100% branch coverage cannot, with a code sketch.
5. For `result = A && (B || C)`, construct an MC/DC-satisfying test set and state how many tests it needs versus full multiple-condition coverage. Identify one independence pair.
6. Why does DO-178C require MC/DC for DAL A but only decision+statement for DAL B? What specific structural holes does MC/DC close that decision coverage leaves open?
7. JaCoCo reports 0% line coverage but nonzero instruction coverage for a third-party jar. What's the cause and the fix?
8. Why is `go test -covermode=count` unsafe under `-race`, and what does `atomic` change at the instruction level?

<details>
<summary>Answers</summary>

1. **Line vs branch:** `if x < 0 { x = 0 }; return x` — a test with `x = -1` runs every line (100% line) but never takes the false branch of `x < 0` (50% branch). **Condition vs decision:** for `if (a || b)`, the tests `{a=T,b=F}` and `{a=F,b=T}` give each condition both T and F (100% condition), yet the whole decision `(a||b)` is true in both, so its false outcome is never exercised (50% decision).

2. **2¹² × ∞ = infinite.** The 12 sequential independent branches alone give 2¹² = 4096 path prefixes, and the data-dependent loop multiplies that by an unbounded number of trip counts (0, 1, 2, … iterations are each distinct paths). Full path coverage is **not achievable**: you can't enumerate an infinite set, and deciding which loop-dependent paths are even feasible reduces to the halting problem.

3. **V(G) = E − N + 2P** (for one connected component, E − N + 2), equivalently *(decision points) + 1*. With 4 `if`s where one uses `&&` (the second operand is a hidden 5th decision point): V(G) = 5 + 1 = **6**. Two senses: (a) **test design** — you need ≥ 6 test cases to cover a basis of independent paths; (b) **maintainability** — 6 is well under the ~10 refactor threshold, so complexity is fine.

4. `int x = expensive(); if (flag) x = 0; return g(x);` — the du-pair (def `expensive()` → use `g(x)`) is only exercised when `flag` is false. A suite testing only `flag=true` gets 100% branch coverage for the lines that run, yet never establishes that the expensive value flows to the use; the def is dead on the tested path. all-uses *forces* a `flag=false` test to cover that def→use pair, revealing whether the live flow works (and that the `flag=true` path makes the expensive computation dead).

5. From the worked table: tests `{A=T,B=T,C=F}→T`, `{A=F,B=T,C=F}→F`, `{A=T,B=F,C=F}→F`, `{A=T,B=F,C=T}→T` — **4 tests** (n+1 for n=3) vs **8** (2³) for full multiple-condition. Independence pair for A: `{A=T,B=T,C=F}→T` and `{A=F,B=T,C=F}→F` (only A differs, outcome flips). (For B: tests 1 and 3; for C: tests 3 and 4.)

6. DO-178C ties coverage to failure severity: DAL A is catastrophic (loss of aircraft), so it demands the strongest *practical* structural criterion. MC/DC closes two holes decision coverage leaves: (i) it forces each *condition* (not just each decision) to take both values, and (ii) it proves each condition *independently* affects the outcome via an independence pair — catching dead/masked/redundant conditions inside a compound decision that decision coverage (which only flips the whole decision) never exercises. DAL B (hazardous, not catastrophic) is judged to not warrant MC/DC's extra cost, so decision+statement suffices.

7. JaCoCo counts probes at the bytecode level and maps them to source lines via the class file's `LineNumberTable` debug attribute. The jar was compiled **without debug info** (no `LineNumberTable`), so JaCoCo can still count instructions/branches but has nothing to map them to source lines — hence 0% *line* coverage. Fix: build the dependency with `javac -g` (or its build-tool equivalent) so line numbers are present.

8. `count` mode compiles each probe to a non-atomic load-increment-store. Under concurrency that's a lost-update data race, which (a) corrupts the counts and (b) is itself flagged by `-race`'s detector — your own coverage probes generate false-positive race reports. `atomic` mode replaces each increment with `atomic.AddUint32` (a `LOCK XADD` on x86), making the update race-free at the cost of a serializing, cache-line-contended instruction per probe — correct, but slower on hot paths.

</details>

---

## Cheat Sheet

```
SUBSUMPTION (100% of left ⇒ 100% of right)
  multiple-condition ⊐ MC/DC ⊐ condition/decision ⊐ {branch, condition}
  branch ⊐ statement/line ;  path ⊐ branch  (path = unreachable ideal)
  GOTCHA: condition coverage does NOT subsume decision coverage
          100% line does NOT subsume 100% branch (if-without-else)

PATH EXPLOSION
  n sequential independent binary branches → up to 2^n paths
  any data-dependent loop → infinitely many paths
  full path coverage = undecidable (feasibility ≡ halting); use a BASIS

CYCLOMATIC COMPLEXITY  (one number, three jobs)
  V(G) = E − N + 2P   =   (decision points) + 1   =   #independent basis paths
  also = minimum CFG edges to instrument for full edge counts (E−N+1)
  >10 → consider refactor ;  count &&/|| as decision points

DATA-FLOW (what branch coverage can't see)
  du-pair = (def, use) joined by a def-clear path
  all-defs  ⊏ all-uses ⊏ all-du-paths
  catches: uninitialized read, dead store, wrong def reaching a use

MC/DC  (DO-178C DAL A; ISO 26262 ASIL D; EN 50128)
  ≈ n+1 tests for n conditions  (vs 2^n for multiple-condition)
  each condition: an INDEPENDENCE PAIR — flip only it, outcome flips
  unique-cause (strict, only that condition changes) vs
  masking (others may change if masked out — handles coupled conditions)

INSTRUMENTATION INTERNALS
  source rewrite (Istanbul) : AST→source counters; perturbs optimizer
  bytecode (JaCoCo+ASM)     : class-load probes (boolean[]); lines need LineNumberTable
  gcov (gcc --coverage)     : CFG-ARC counters (.gcno+.gcda); weak under -O
  LLVM (-fcoverage-mapping) : IR intrinsics + (line:col) region map; survives -O best
  SanCov (-fsanitize-coverage): per-edge callbacks → fuzzer feedback (libFuzzer/AFL)

OPTIMIZATION BREAKS ATTRIBUTION (line table = DWARF .debug_line / LineNumberTable)
  inlining → one body at N sites ;  tail-merge → one block, two branches
  DCE/fold → code vanishes (no red, just gone) ;  unroll → N copies, one line
  → run coverage at -O0/-Og ; trust -O2 coverage only from LLVM region engine

CONCURRENCY COUNTING (presence free, frequency costs)
  set    : boolean store    — race-immune (idempotent), no counts
  count  : non-atomic int   — RACY: lost updates + trips -race detector
  atomic : atomic.AddUint32 — race-free, LOCK XADD per probe (slower hot paths)
  use atomic with -race or when counts from concurrent code must be correct
```

---

## Summary

- The coverage criteria form a **subsumption lattice**: line ⊏ branch ⊏ condition/decision ⊏ MC/DC ⊏ multiple-condition, with path subsuming branch but unreachable. Subsumption is a provable guarantee about *test sets*, never about bug-finding — and two non-obvious facts (100% line ≠ 100% branch; condition coverage ⊉ decision coverage) are exactly why standards climb the lattice.
- **Path coverage is impossible in general** — exponential (2ⁿ) in sequential branches, infinite with data-dependent loops, and undecidable in feasibility (it reduces to halting). The tractable substitute is **basis-path coverage**, whose size is the **cyclomatic complexity** V(G) = E − N + 2P: the dimension of the CFG's cycle space, doing triple duty as independent-paths-to-test, minimum-edges-to-instrument, and maintainability threshold.
- **Data-flow coverage** (all-defs ⊏ all-uses ⊏ all-du-paths) targets def→use pairs and catches value-propagation bugs — uninitialized reads, dead stores, wrong-def-reaching-use — that 100% branch coverage structurally cannot see.
- **MC/DC** proves each condition *independently* affects the decision via an independence pair, achieving most of multiple-condition assurance at n+1 rather than 2ⁿ tests by exploiting boolean masking. **DO-178C** mandates it for DAL A (catastrophic) avionics; ISO 26262, EN 50128, and IEC 61508 do likewise at top integrity levels. Its two forms — unique-cause and masking — differ on whether other conditions may vary, with masking handling coupled conditions.
- **Instrumentation** lives at one of four sites — source rewrite (Istanbul), bytecode probes (JaCoCo's on-the-fly ASM `boolean[]` stores), compiler-emitted counters (gcov's CFG arcs, LLVM's IR intrinsics + region map), and sanitizer per-edge callbacks (libFuzzer feedback) — and the **injection site dictates accuracy, overhead, and whether it survives optimization**. Probe placement is itself a graph problem: one probe per basic block, or E − N + 1 chord edges, reconstructs all counts.
- **Optimization breaks attribution** by corrupting the line table all machine-level tools depend on — inlining, tail-merging, and DCE make coverage ambiguous or make code *vanish* — which is why coverage builds run at `-O0`/`-Og`. And **concurrency** makes counted coverage a lost-update race: presence (a boolean) is race-immune, frequency (an integer) needs atomics, which is the whole reason for `-covermode=atomic`.

You now reason about coverage from underneath — the math that bounds the metric and the machine code that implements it. The next topic, [Mutation Coverage](../02-mutation-coverage/senior.md), takes the honest step past structural coverage entirely: instead of asking *did the test run this code*, it asks *would the test notice if this code were wrong*.

---

## Further Reading

- *A Complexity Measure* — Thomas J. McCabe (1976). The original cyclomatic-complexity paper; defines V(G) as the cycle-space dimension and the basis-path testing strategy.
- *Selecting Software Test Data Using Data Flow Information* — Rapps & Weyuker (1985). The foundational data-flow coverage criteria (all-defs, all-uses, all-du-paths).
- *A Practical Tutorial on Modified Condition/Decision Coverage* — Hayhurst, Veerhusen, Chilenski, Rierson (NASA/TM-2001-210876). The definitive plain-English treatment of MC/DC, unique-cause vs masking, and DO-178C.
- *DO-178C / ED-12C* — Software Considerations in Airborne Systems. The standard that ties MC/DC to DAL A; see also the *Structural Coverage Analysis* objectives.
- *Optimally Profiling and Tracing Programs* — Ball & Larus (1994), and Knuth's earlier spanning-tree edge-profiling result. Why you instrument E − N + 1 edges, not all of them.
- *Clang Source-Based Code Coverage* and the *LLVM Coverage Mapping Format* documentation — how region-based, column-accurate coverage is encoded in IR and survives `-O`.
- *JaCoCo documentation* — "Implementation Design" and "Coverage Counters": on-the-fly ASM instrumentation, probes at basic-block boundaries, and line mapping via the `LineNumberTable`.
- *gcov*/`gcc` internals (`-fprofile-arcs`/`-ftest-coverage`, the `.gcno`/`.gcda` format) — CFG-arc counting and flow-conservation reconstruction.

---

## Related Topics

- [junior.md](junior.md) — what line and branch coverage are, reading a coverage report, the basic metrics.
- [middle.md](middle.md) — branch vs condition vs MC/DC at the working level, the subsumption hierarchy in practice, gaming-resistant reading.
- [professional.md](professional.md) — operating coverage in CI: diff/patch coverage, the ratchet, thresholds, and the politics of gates.
- [02 — Mutation Coverage](../02-mutation-coverage/senior.md) — the honest signal of test *quality*: would the suite notice if the code were wrong?
- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/senior.md) — Go `-covermode`, JaCoCo, Coverage.py, gcov/lcov/llvm-cov, tarpaulin/grcov, and merging reports across shards.
- [Formal Methods & Verification](../../formal-methods-and-verification/) — when you need to *prove* properties hold on all paths instead of *sampling* paths with tests — the rigorous answer to path coverage's impossibility.
