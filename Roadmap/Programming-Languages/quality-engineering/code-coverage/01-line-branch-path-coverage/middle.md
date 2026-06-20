# Line, Branch & Path Coverage — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → Line, Branch & Path Coverage
> *The junior page named the metrics. This page makes them precise: the exact ladder from statement to MC/DC to path, the subsumption rules that say which number implies which, the boolean blind spots short-circuit evaluation hides — and how a tool actually records any of it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Metrics Ladder, Defined Precisely](#the-metrics-ladder-defined-precisely)
4. [The Subsumption Hierarchy](#the-subsumption-hierarchy)
5. [Short-Circuit Evaluation Hides Conditions](#short-circuit-evaluation-hides-conditions)
6. [The Branches You Didn't Write — Implicit Edges](#the-branches-you-didnt-write--implicit-edges)
7. [How Instrumentation Actually Records Coverage](#how-instrumentation-actually-records-coverage)
8. [Go's covermode — count vs set vs atomic](#gos-covermode--count-vs-set-vs-atomic)
9. [Worked Example — Branch vs MC/DC on One Expression](#worked-example--branch-vs-mcdc-on-one-expression)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does each coverage criterion actually count, which one implies which, and how does a tool measure it?**

At the junior level "coverage" is mostly one number: the percentage of lines a test suite touched. That model is enough to spot dead-untested files, but it can't explain *why* a suite at 100% line coverage still misses half the logic in an `if`, *why* avionics certification demands a metric almost nobody else uses, or *why* the same `&&` expression can be "fully covered" by one tool and full of holes by another.

The answers come from three things the line-percentage view flattens. First, coverage is not one metric but a **ladder** of criteria — statement, decision, condition, MC/DC, path — each strictly more demanding than the last. Second, those criteria sit in a **subsumption hierarchy**: satisfying one mathematically guarantees another, which is exactly why "100% line" and "100% branch" are different promises. Third, every percentage is produced by **instrumentation** — counters the tool injects into your code or its compiled form — and the choice of *what* to instrument and *how* to record it (count vs set, source vs IR, thread-safe vs not) decides what the number can even mean. This page makes all three concrete with real code and real numbers.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state what line coverage measures and why "covered ≠ tested."
- **Required:** You can read a boolean expression and reason about `&&` / `||` truth tables.
- **Helpful:** You've run a coverage tool once and seen an HTML report with green/red lines.
- **Helpful:** A rough sense of a control-flow graph — basic blocks joined by edges.

---

## The Metrics Ladder, Defined Precisely

The criteria differ in *what unit they require you to exercise*. Climbing the ladder, each rung demands strictly more test cases than the one below.

| Criterion | Also called | Requires every… | Misses |
|---|---|---|---|
| **Statement / line** | C0 | executable statement run at least once | un-taken branches, untested conditions |
| **Decision / branch** | C1 | branch outcome (each `if` true *and* false) taken | how a *compound* condition reached that outcome |
| **Condition** | — | individual boolean sub-condition evaluated both true and false | whether each condition independently *changed* the decision |
| **Condition/Decision** | C/DC | both of the above together | independence of each condition (can mask each other) |
| **MC/DC** | Modified Condition/Decision Coverage | condition shown to *independently flip* the decision's outcome | inter-condition interactions across decisions; full paths |
| **Path** | C2 | distinct route through the function executed | nothing (it's the ceiling) — but is usually infinite |

A few definitions worth nailing down, because tools and books abuse the words:

- **Statement vs line.** Statement coverage counts *statements*; line coverage counts *source lines*. They diverge when one line holds several statements (`x++; y++;` on one line) or one statement spans several lines. Most tools report "line" but mean "was any instrumented statement on this line executed."
- **Decision vs branch.** A *decision* is a full boolean expression that steers control flow (the whole test of an `if`/`while`). Branch coverage asks: was the decision *true* at least once and *false* at least once? It says nothing about the conditions *inside* it.
- **Condition.** A *condition* is a leaf boolean with no boolean operator inside it — `a`, `b`, `x > 0`. Condition coverage asks each leaf to be observed both true and false.
- **MC/DC.** The strict one: each condition must be shown to **independently** affect the decision's outcome — i.e., there exist two test cases where *only that condition* flips and the decision flips with it. This is the coverage criterion mandated by **DO-178C** for Level A (catastrophic-failure) avionics software, precisely because it forces tests to prove each condition *matters* without the combinatorial blow-up of testing all 2ⁿ combinations.

> **Key insight:** Going up the ladder you are buying *resolution*, not just more tests. Statement coverage sees a function as a list of lines; branch coverage sees its control-flow edges; MC/DC sees the role each individual condition plays in each decision. A higher rung can't be "gamed" by the trick that beats a lower one — you can hit 100% statements while leaving an entire `else` branch and every false-condition untested.

---

## The Subsumption Hierarchy

**Subsumption** is the formal backbone of the ladder: criterion *A* **subsumes** *B* if any test set that achieves 100% *A* automatically achieves 100% *B*. It tells you which numbers are redundant to report and which gaps a high number still hides.

```
        Path coverage            (strongest — usually unachievable)
            │ subsumes
          MC/DC                   (DO-178C Level A)
            │ subsumes
     Condition/Decision
          ╱        ╲ subsumes
   Decision        Condition      (these two do NOT subsume each other)
      │ subsumes
   Statement                      (weakest)
```

Read it as implications, each verifiable from the definitions:

- **Decision subsumes statement.** If you've taken every branch true and false, you've necessarily executed every statement on both sides — so 100% branch ⇒ 100% statement. The converse fails: a single-arm `if (x) doThing();` reaches 100% statement coverage with one test where `x` is true, leaving the *false* branch (fall-through) untaken. **This is the canonical reason 100% line ≠ 100% branch.**
- **Decision and condition are incomparable.** Neither subsumes the other. You can cover both decision outcomes of `a && b` without ever making `b` false (if `a` is false, short-circuit skips `b`); and you can flip every condition without covering both decision outcomes. This gap is exactly why **C/DC** exists — it bolts the two together.
- **MC/DC subsumes C/DC** (hence both condition and decision), and **path subsumes everything**. MC/DC stops short of path because it constrains each *decision* independently, not the *sequence* of decisions across the whole function.

> **Key insight:** Subsumption means you should report the *highest* criterion you measure and treat lower ones as implied. A team that gates on branch coverage is also gating on statement coverage for free; reporting both is noise. Conversely, a glowing 100% *statement* number guarantees almost nothing about branches — it sits at the very bottom of the lattice.

---

## Short-Circuit Evaluation Hides Conditions

In nearly every C-family language, `&&` and `||` are **short-circuit**: the right operand is evaluated *only if* the left didn't already decide the result. This is a correctness feature (`p != nil && p.ok`), but it quietly sabotages coverage measurement, because **an un-evaluated condition can't be a covered condition.**

```go
func grant(user *User, scope string) bool {
    return user != nil && user.Active && hasScope(user, scope)
}
```

If your only test passes `user == nil`, the decision evaluates to `false`. Line coverage: 100% (the one `return` line ran). Branch coverage on the *decision*: only the false outcome — you never returned `true`. And `user.Active` and `hasScope(...)` **were never executed at all** — short-circuit bailed after the first condition. A condition-level tool will show them as never-true *and* never-false; a line-level tool shows the whole line green and tells you nothing.

The trap is sharpest with compound guards:

```go
if a || b { ... }   // if a is true, b is never evaluated
if a && b { ... }   // if a is false, b is never evaluated
```

To cover `b` as a condition you must reach it, which means setting the *other* operand to its non-short-circuiting value first (`a == false` for `||`, `a == true` for `&&`). Decision/branch coverage will happily report 100% on `a || b` from two tests (`a=T` once, `a=F,b=F` once) while `b=true` is never observed. That is the precise hole **condition coverage** and **MC/DC** are built to close.

> **Key insight:** Short-circuiting makes "this line is green" and "every condition on this line was exercised" wildly different claims. Compound boolean expressions are where line coverage's optimism is most dangerous — the percentage looks done while half the logic is unobserved. When a line with `&&`/`||` shows full line coverage, assume conditions are *uncovered* until a branch- or condition-aware tool says otherwise.

---

## The Branches You Didn't Write — Implicit Edges

Branch coverage measures edges in the control-flow graph — and the graph has edges you never typed. Tools that work at the source level often miss these; tools that work at the bytecode/IR level (where the implicit edges are explicit instructions) usually catch them, which is a major source of "why do two tools disagree."

- **The hidden `else`.** A one-armed `if` has a fall-through edge. `if (x) { a(); }` has two branches even though you wrote one block; covering only the true side leaves the implicit `else` untaken. JaCoCo and other bytecode tools count this; many line tools don't.
- **Exception / panic paths.** Any statement that can throw adds an edge to the handler or to function exit. A `try { risky(); } catch (e) { recover(); }` whose `catch` never fires has an uncovered branch — the exceptional edge. These edges are usually invisible in source-level reports and are a classic coverage blind spot.
- **`switch` fall-through and the missing `default`.** Each `case` is a branch; an absent `default` is *still* an implicit edge (the "matched nothing" path). C/Java fall-through (no `break`) creates edges between cases that line coverage flattens. A `switch` over an enum with no `default` can show 100% line coverage while the "unexpected value" path is untested.
- **Boolean operators as branches.** As above, each `&&`/`||` is itself a branch point in the CFG. Bytecode-level tools count these as branches (JaCoCo reports them under "branches"); source-line tools often don't, which is why JaCoCo's branch number for an expression-heavy method is higher — and more honest — than a naive line tool's.

```java
int classify(int n) {
    if (n > 0) return 1;     // implicit else: n <= 0 → falls through
    return -1;               // line coverage 100% with one test (n=5)
}                            // branch coverage 50%: n<=0 edge never taken
```

> **Key insight:** "Branch coverage" is only as complete as the *graph the tool built*. The interesting branches — the missing `else`, the unthrown exception, the absent `default` — are the ones you never typed and a source-level tool may never see. When branch numbers from two tools disagree, the deeper one is almost always counting implicit edges the shallower one ignores.

---

## How Instrumentation Actually Records Coverage

A coverage number is the readout of **counters the tool injected**. There are three broad mechanisms, and which one a tool uses determines what it can measure and what it costs.

**1. Source-level instrumentation.** The tool rewrites your source (or AST) to insert a counter before each instrumentable unit, compiles the instrumented version, runs the tests, and dumps the counters. Go's `go test -cover` works this way: it parses each file, splits it into *basic blocks* (maximal straight-line spans with a single entry and exit), and inserts a counter increment at the top of each block.

```go
// what the tool conceptually injects per basic block
func work(x int) int {
    GoCover.Count[3] = 1          // ← block 3 entered
    if x > 0 {
        GoCover.Count[4] = 1      // ← block 4 entered (the true branch)
        return x
    }
    GoCover.Count[5] = 1          // ← block 5 (fall-through)
    return -x
}
```

Each entry in the report maps a counter back to a source span (file, start line/col, end line/col) and the number of statements in that block. Pro: human-readable, language-aware, easy HTML drill-down. Con: it measures *blocks*, so by default it gives statement/line-ish coverage; getting true branch or condition data needs extra work the tool may not do.

**2. Bytecode / IR instrumentation.** The tool injects probes into compiled bytecode or a compiler IR — JaCoCo into JVM bytecode (often at class-load time via a Java agent), LLVM source-based coverage (`-fprofile-instr-generate -fcoverage-mapping`, used by Clang, Swift, Rust's `-C instrument-coverage`) into the IR with a coverage-mapping section. Because the *implicit* control flow (the hidden `else`, the `&&` short-circuit jump, the exception edge) is **explicit** at this level, these tools naturally report real **branch** coverage and count edges a source tool can't see. Con: probe locations map back to source through debug info, so results can be slightly surprising at the line level, and build flags must be exactly right.

**3. Sampling / runtime tracing.** Instead of injecting per-block counters, a sampler periodically inspects what's executing (or uses kernel/JVMTI events). Cheap and low-overhead — usable in production — but **statistical**: a rarely-hit line may be missed entirely, so it reports a lower bound, not the exact set of executed lines. Useful for "what runs in prod," not for a precise CI gate.

> **Key insight:** The mechanism *is* the metric's ceiling. A block-counting source tool fundamentally reports statement/line coverage; to get honest branch and condition numbers you generally need IR/bytecode instrumentation that can see the implicit edges. "Coverage tool" is not one thing — ask *what* it instruments before trusting *what* it claims to measure.

---

## Go's covermode — count vs set vs atomic

Go's `-covermode` flag is a concrete, important example of *how the counter is recorded* changing what the number means and costs. It picks the **type and update semantics** of each basic-block counter.

| `-covermode` | Counter type / op | Tells you | Cost | Use when |
|---|---|---|---|---|
| `set` | `bool` set to `1` | *whether* each block ran (boolean) | cheapest | default; you only need line/statement coverage |
| `count` | `int` incremented | *how many times* each block ran | a little more | finding hot/cold blocks, never-run vs run-once |
| `atomic` | `int` via `sync/atomic` | same as count, but race-safe under goroutines | most (atomic add per block) | **any test with `-race` or real concurrency** |

```bash
go test -covermode=atomic -coverprofile=cover.out ./...
go tool cover -func=cover.out      # per-function summary
go tool cover -html=cover.out      # source drill-down
```

The trap: with `set` or `count`, two goroutines hitting the same block update a plain variable *without synchronization*. Under the race detector that's a reported data race; without it, increments can be lost, skewing `count`. **`atomic` is mandatory whenever the code under test runs concurrently** — it serializes each counter bump with an atomic add. The first line of every coverage profile is literally `mode: set|count|atomic`, so you can always see which semantics produced a report.

Note what *none* of these modes do: Go's built-in coverage is block-based, so even `atomic` gives you statement/line-grained data, not branch or condition coverage. For branch-level insight on Go you reach for bytecode-style or mutation approaches ([02 — Mutation Coverage](../02-mutation-coverage/middle.md)).

> **Key insight:** `-covermode` doesn't change *what is counted* (basic blocks) — it changes *how the count is stored and updated*. `set` answers "did it run," `count` answers "how often," `atomic` answers "how often, safely under goroutines." Picking `set`/`count` for concurrent tests silently corrupts the data or trips `-race`.

---

## Worked Example — Branch vs MC/DC on One Expression

Take a single decision with three conditions:

```c
if (A && (B || C)) { ... }
```

Let's count the test cases each criterion *demands*, using `(A, B, C)` triples.

**Branch / decision coverage** needs the decision `true` once and `false` once — **2 tests**:

| # | A | B | C | decision | why it's chosen |
|---|---|---|---|---|---|
| 1 | T | T | — | **true**  | makes the whole thing true |
| 2 | F | — | — | **false** | makes it false |

Two tests, 100% branch. Notice the damage: `C` is never evaluated (test 1 short-circuits `B||C` after `B=T`; test 2 short-circuits after `A=F`). `B=false` is never seen. Branch coverage is *satisfied* and the expression is barely exercised.

**MC/DC** requires, for **each** condition, a pair of tests where flipping *only that condition* flips the decision, holding the others fixed. Work it out per condition:

- **A independent:** hold `(B,C)` so the inner `(B||C)` is true, then flip `A`.
  `(T,T,F) → true` vs `(F,T,F) → false`. A flips the result. ✓
- **B independent:** A must be `true` and `C` must be `false` (so `B` alone controls `B||C`), then flip `B`.
  `(T,T,F) → true` vs `(T,F,F) → false`. B flips the result. ✓
- **C independent:** A must be `true` and `B` must be `false` (so `C` alone controls `B||C`), then flip `C`.
  `(T,F,T) → true` vs `(T,F,F) → false`. C flips the result. ✓

Collect the distinct triples used: `(T,T,F)`, `(F,T,F)`, `(T,F,F)`, `(T,F,T)` — **4 tests**.

| # | A | B | C | decision | proves independence of |
|---|---|---|---|---|---|
| 1 | T | T | F | true  | A (with #2), B (with #3) |
| 2 | F | T | F | false | A |
| 3 | T | F | F | false | B, C |
| 4 | T | F | T | true  | C |

So this one expression costs **2 tests for branch coverage but 4 for MC/DC** — and the MC/DC set is the one that actually exercises `B` false, `C` both ways, and proves every condition can change the verdict. The general rule MC/DC is famous for: a decision with *n* conditions is coverable with **n + 1** well-chosen tests (4 = 3 + 1 here), versus the **2ⁿ = 8** you'd need for exhaustive multiple-condition coverage. That linear-not-exponential cost is exactly why DO-178C can mandate MC/DC for life-critical avionics without demanding the impossible.

**Path coverage**, for contrast, would want every distinct route through the surrounding function — and with loops that's unbounded. This is **path explosion**: a function with *k* independent binary branches has up to 2ᵏ paths, and a single loop makes it infinite. Path coverage is the theoretical ceiling and a practical non-starter; MC/DC is the strongest criterion that stays affordable.

---

## Mental Models

- **The ladder is a resolution dial, not a difficulty slider.** Each rung lets the measurement *see* finer structure: lines → CFG edges → the role of each condition. You don't just write more tests going up; you observe more of the logic.

- **Subsumption is "for free" implications.** If 100% *A* always gives you 100% *B*, then *A* is the only number worth gating on, and a high *B* alone (statement!) tells you almost nothing about *A* (branch, MC/DC). Always quote the *highest* criterion you measure.

- **A condition that never evaluated is a condition that never tested.** Short-circuit `&&`/`||` means green lines routinely hide unexecuted conditions. Compound booleans are where line coverage lies most confidently.

- **The CFG has edges you didn't type.** The hidden `else`, the unthrown exception, the absent `default` are real branches. Whether a tool counts them depends on whether it instruments source (often blind) or bytecode/IR (usually sees them).

- **The counter type is part of the metric.** `set` vs `count` vs `atomic` (Go), block vs branch probes (source vs IR) — *how* coverage is recorded bounds what it can mean and whether it's even safe under concurrency.

---

## Common Mistakes

1. **Reading 100% line coverage as 100% branch coverage.** Decision *subsumes* statement, never the reverse. A one-armed `if` hits 100% statements with the false branch untaken. Gate on branch, not line, if you gate at all.

2. **Trusting line coverage on compound booleans.** Short-circuit evaluation leaves conditions in `a && b || c` unevaluated while the line shows green. Use a branch- or condition-aware tool before believing the line is "done."

3. **Forgetting implicit branches.** The missing `else`, the exception edge, the `switch` without `default` are uncovered branches your source-level tool may not even report. Two tools disagreeing on branch % usually means one counts implicit edges and the other doesn't.

4. **Using `set`/`count` covermode under concurrency.** Plain-variable counter bumps from multiple goroutines are a data race — `-race` flags them and `count` values get corrupted. Use `-covermode=atomic` for any concurrent or `-race` test run.

5. **Chasing path coverage.** Loops make paths infinite and *k* branches give up to 2ᵏ routes. Path coverage is a theoretical ceiling; aim for branch or MC/DC, which stay finite (MC/DC needs ~n+1 tests per n-condition decision).

6. **Confusing MC/DC with "test all condition combinations."** MC/DC needs ~n+1 tests proving each condition *independently* flips the decision — not the 2ⁿ exhaustive combinations. Conflating them makes people reject MC/DC as too expensive when it's deliberately linear.

---

## Test Yourself

1. Why does 100% statement coverage *not* imply 100% branch coverage, but 100% branch coverage *does* imply 100% statement coverage?
2. In `if (a && b)`, your tests achieve 100% branch coverage. Can you guarantee `b` was ever evaluated as `false`? Why or why not?
3. State the subsumption relationship between MC/DC, decision, and condition coverage. Which two are incomparable, and what criterion was created to bridge them?
4. A `switch` over an enum has a case per value and no `default`. Line coverage is 100%. What branch might still be untested, and why might your tool not report it?
5. For the decision `A && (B || C)`, how many tests does branch coverage demand, and how many does MC/DC demand? What does the MC/DC set exercise that the branch set doesn't?
6. What is the difference between Go's `-covermode=set`, `count`, and `atomic`, and when is `atomic` mandatory?

<details>
<summary>Answers</summary>

1. **Decision subsumes statement:** taking every branch both true and false necessarily runs every statement on both sides, so 100% branch ⇒ 100% statement. The reverse fails because a single-arm `if` can run all its statements with one test while leaving the implicit false/fall-through branch untaken.
2. **No.** If `a` is `false`, short-circuit evaluation skips `b` entirely. You can hit both decision outcomes (`a=T,b=T` → true; `a=F` → false) without `b` ever being `false` — or even evaluated. That gap is what condition/MC/DC coverage closes.
3. **MC/DC subsumes both decision and condition coverage** (and is itself subsumed by path). **Decision and condition are incomparable** — neither implies the other. **Condition/Decision (C/DC)** coverage was created to require both at once.
4. The **implicit "matched nothing" / default path** (the enum value handled by no case) is an edge in the CFG even with no `default` written. Source-level line tools often don't model that implicit edge, so they show 100% line while the path is untested; a bytecode/IR tool is more likely to count it.
5. **Branch: 2 tests** (one true, one false). **MC/DC: 4 tests** (n+1 for n=3 conditions). The MC/DC set additionally exercises `B=false`, `C` both ways, and proves each of A, B, C can independently flip the decision — none of which the 2-test branch set guarantees.
6. `set` stores a `bool` (did the block run); `count` stores an `int` (how many times); `atomic` stores an `int` updated with `sync/atomic` (race-safe). **`atomic` is mandatory whenever the tested code runs concurrently or you use `-race`** — otherwise concurrent counter updates are a data race and `count` values are corrupted.

</details>

---

## Cheat Sheet

```
THE LADDER (weak → strong)
  statement/line   C0   every statement run
  decision/branch  C1   every if true AND false
  condition             every leaf bool both T and F
  condition/decision    both of the above
  MC/DC                 each condition INDEPENDENTLY flips the decision (DO-178C Level A)
  path             C2   every route (usually infinite — path explosion)

SUBSUMPTION (A ⇒ B means 100% A guarantees 100% B)
  path ⇒ MC/DC ⇒ C/DC ⇒ {decision, condition} ⇒ ... ; decision ⇒ statement
  decision & condition: INCOMPARABLE (C/DC bridges them)
  ⇒ report the HIGHEST criterion; 100% statement implies almost nothing

BLIND SPOTS line coverage hides
  short-circuit:  a && b   (b skipped if a false)   a || b   (b skipped if a true)
  implicit else:  one-armed if has a fall-through branch
  exception edge: any throwing stmt → handler/exit edge
  switch:         absent default is still a branch; fall-through edges

INSTRUMENTATION MECHANISMS
  source-level   inject per-basic-block counter (Go -cover)   → statement/line
  bytecode/IR    probe compiled form (JaCoCo, LLVM -coverage) → real BRANCH, sees implicit edges
  sampling       periodic snapshots                            → cheap, statistical lower bound

GO COVERMODE  (first line of profile = mode: ...)
  set     bool   did block run         cheapest   default
  count   int    how many times                    hot/cold blocks
  atomic  int    race-safe count       priciest    REQUIRED with -race / concurrency

MC/DC COST  n conditions → ~n+1 tests (NOT 2^n)
```

---

## Summary

- Coverage is a **ladder**, not a number: statement → decision/branch → condition → C/DC → **MC/DC** → path, each strictly more demanding. MC/DC — each condition shown to *independently* flip its decision — is the criterion DO-178C mandates for life-critical avionics.
- The **subsumption hierarchy** says which numbers imply which: decision subsumes statement (so 100% line ≠ 100% branch), MC/DC subsumes C/DC and thus both condition and decision, path subsumes all. Decision and condition are incomparable, which is why C/DC exists. Report the *highest* criterion you measure.
- **Short-circuit evaluation** means `&&`/`||` can leave conditions unevaluated — so a green line routinely hides untested conditions, the hole condition and MC/DC coverage close.
- Branch coverage is only as honest as the CFG the tool built: the **implicit else, exception edges, and absent `default`** are real branches that source-level tools often miss and bytecode/IR tools catch.
- A coverage number is the readout of **injected counters** — source-level block counters (statement/line, e.g. Go), bytecode/IR probes (real branch, e.g. JaCoCo/LLVM), or sampling (statistical). The mechanism bounds the metric.
- Go's **`-covermode`** (`set`/`count`/`atomic`) sets *how* each block counter is recorded; `atomic` is mandatory under concurrency or `-race`. And on one expression `A && (B || C)`, branch coverage costs **2 tests**, MC/DC costs **4** (n+1) — the affordable price of proving every condition matters.

---

## Further Reading

- *DO-178C / DO-248C* and the FAA's *"An Investigation of Three Forms of the Modified Condition/Decision Coverage (MCDC) Criterion"* (Chilenski) — the authoritative treatment of MC/DC and its variants.
- *Introduction to Software Testing* — Ammann & Offutt. Chapters on logic coverage define subsumption, condition, and MC/DC rigorously.
- *The Go Blog — "The cover story"* and `go help testflag` — how Go instruments basic blocks and what `-covermode` does.
- *JaCoCo documentation — "Coverage Counters"* — how a bytecode tool counts instructions, branches, and complexity, including implicit branches.
- *Clang/LLVM "Source-based Code Coverage"* — IR-level instrumentation and coverage mapping (the basis for Rust and Swift coverage).

---

## Related Topics

- [junior.md](junior.md) — what line coverage measures and why "covered ≠ tested."
- [senior.md](senior.md) — coverage at scale: gates, diff coverage, and where each criterion pays off.
- [02 — Mutation Coverage](../02-mutation-coverage/middle.md) — the criterion that tests whether your *assertions* (not just your branches) actually catch bugs.
- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/middle.md) — which tools instrument source vs bytecode vs IR, and what each can measure.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/middle.md) — the limits of every criterion on this page, including covered-but-unasserted code.
