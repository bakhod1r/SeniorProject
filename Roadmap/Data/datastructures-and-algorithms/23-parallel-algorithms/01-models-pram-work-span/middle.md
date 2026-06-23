# Models of Parallel Computation: PRAM and Work–Span — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The PRAM, Restated for Proofs](#the-pram-restated-for-proofs)
   - [The Machine and the Cost Measure](#the-machine-and-the-cost-measure)
   - [The Variant Hierarchy: EREW ⊆ CREW ⊆ CRCW](#the-variant-hierarchy-erew--crew--crcw)
   - [CRCW Write-Resolution Rules](#crcw-write-resolution-rules)
3. [The Power Gap: CRCW Is Strictly Stronger](#the-power-gap-crcw-is-strictly-stronger)
   - [OR of n Bits in O(1) on CRCW](#or-of-n-bits-in-o1-on-crcw)
   - [The Ω(log n) Lower Bound on EREW](#the-ωlog-n-lower-bound-on-erew)
   - [Simulation Cost Between Variants](#simulation-cost-between-variants)
4. [The Work–Span (DAG) Model](#the-workspan-dag-model)
   - [The Computation DAG](#the-computation-dag)
   - [The Work Law and the Span Law](#the-work-law-and-the-span-law)
5. [Brent's Theorem and Greedy Scheduling](#brents-theorem-and-greedy-scheduling)
   - [The Greedy Schedule](#the-greedy-schedule)
   - [Proof of the Brent Bound](#proof-of-the-brent-bound)
   - [Corollaries: 2-Optimality and Linear Speedup](#corollaries-2-optimality-and-linear-speedup)
6. [Work-Efficiency](#work-efficiency)
   - [Why Work Matters More Than Span](#why-work-matters-more-than-span)
   - [Brent's Scheduling Principle: From Work–Span to PRAM](#brents-scheduling-principle-from-workspan-to-pram)
7. [Speedup, Efficiency, Cost, and the Two Laws of Scaling](#speedup-efficiency-cost-and-the-two-laws-of-scaling)
   - [Speedup, Efficiency, Cost](#speedup-efficiency-cost)
   - [Amdahl's Law](#amdahls-law)
   - [Gustafson's Law](#gustafsons-law)
8. [Worked Examples](#worked-examples)
   - [Reduction](#reduction)
   - [Prefix Sum / Scan](#prefix-sum--scan)
   - [Matrix Multiply](#matrix-multiply)
9. [Code: Work–Span Analyzer and Speedup Measurement](#code-workspan-analyzer-and-speedup-measurement)
   - [Go](#go)
   - [Python](#python)
10. [Pitfalls](#pitfalls)
11. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — PRAM variants, work `T₁`, span `T∞`, parallelism `T₁/T∞`, the Brent bound, Amdahl intuition — into rigorous statements you can *derive*. By the end you can prove `T_P ≤ T₁/P + T∞` from greedy scheduling, place the EREW/CREW/CRCW variants in their power hierarchy (and prove the gap with the OR-of-`n`-bits separation), convert any work–span algorithm into a `P`-processor PRAM algorithm via Brent's principle, and derive both Amdahl's and Gustafson's laws.

At the [junior level](./junior.md) you met two idealized models of parallel computation. The **PRAM** (Parallel Random Access Machine) is `P` synchronous processors sharing one memory, stepping in lockstep; it comes in variants — EREW, CREW, CRCW — distinguished by whether concurrent reads and writes to the same cell are allowed. The **work–span model** abstracts a computation as a DAG of unit tasks, with **work** `T₁` (total tasks) and **span** `T∞` (critical-path length); their ratio `T₁/T∞` is the **parallelism**. You saw the Brent bound `T_P ≤ T₁/P + T∞` quoted, and the Amdahl intuition that a serial fraction `s` caps speedup at `1/s`.

This file makes all of that rigorous:

- **PRAM formally.** We fix the cost measure, prove the **power hierarchy** `EREW ⊆ CREW ⊆ CRCW`, catalog the four CRCW **write-resolution rules** (COMMON, ARBITRARY, PRIORITY, COMBINING), and quantify the **simulation cost**: one CRCW step runs on an EREW machine in `O(log P)` steps. We prove the separation is *strict* — OR of `n` bits is `O(1)` on CRCW but `Ω(log n)` on EREW.
- **The work–span model formally.** The computation DAG; `T₁` = number of nodes; `T∞` = longest path. The **Work Law** `T_P ≥ T₁/P` and the **Span Law** `T_P ≥ T∞`.
- **Brent's theorem.** A *greedy* schedule achieves `T_P ≤ T₁/P + T∞`. We **prove** it by counting complete versus incomplete steps. Corollary: greedy is within `2×` of optimal, and you get linear speedup whenever `P ≪ T₁/T∞`.
- **Work-efficiency.** Why `T₁ = Θ(sequential time)` matters *more* than a small span for real-world speedup, and **Brent's scheduling principle** for compiling a work–span algorithm down to a `P`-processor PRAM.
- **Speedup, efficiency, cost; Amdahl vs Gustafson** — both derived, with the regime each one describes.
- **Worked:** reduction, prefix sum (forward link to [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md)), matrix multiply.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `P` | number of processors |
| `T₁` | **work** — total number of unit tasks (= time on 1 processor) |
| `T∞` | **span** (depth, critical-path length) — time on ∞ processors |
| `T_P` | time to run on exactly `P` processors |
| `T₁/T∞` | **parallelism** — the average available parallelism |
| `S_P = T₁/T_P` | **speedup** on `P` processors |
| `E_P = S_P/P` | **efficiency** (utilization) |
| `C_P = P·T_P` | **cost** (processor-time product) |

Throughout, the PRAM is **synchronous** (a global clock; every processor executes one instruction per step) and **idealized**: shared-memory access is unit cost, and there is *no* communication, contention, or synchronization charge. That idealization is the model's whole point and also its central caveat — we return to it in the [pitfalls](#pitfalls).

---

## The PRAM, Restated for Proofs

### The Machine and the Cost Measure

A **PRAM** consists of `P` processors `p₀, …, p_{P−1}`, each a RAM with private local registers, all attached to one unbounded **shared memory**. Execution is **synchronous**: in one **step**, every active processor simultaneously (i) reads from shared memory, (ii) does a local computation, and (iii) writes to shared memory. The **time** `T_P` of a PRAM algorithm on an input is the number of steps until all processors halt; the **work** is the total number of processor-steps performed (`Σ` over steps of the number of active processors).

Two cost numbers describe an algorithm:

- **Time** `T_P` — the step count using `P` processors.
- **Cost** `C_P = P · T_P` — the processor-time product, i.e. the total resource the machine reserves (idle processors still count, because the machine is committed to `P` of them for `T_P` steps).

The model charges *nothing* for memory access beyond one step, *nothing* for communication, and *nothing* for synchronization — every processor is magically in lockstep. This is exactly what makes PRAM a clean *theoretical* model and a poor *predictive* one for real hardware; it isolates the question "how much parallelism does this problem inherently have?" from every hardware artifact.

### The Variant Hierarchy: EREW ⊆ CREW ⊆ CRCW

The variants differ only in what happens when several processors touch the **same** shared-memory cell in the same step:

| Variant | Concurrent Read | Concurrent Write |
|---------|-----------------|------------------|
| **EREW** (Exclusive Read, Exclusive Write) | forbidden | forbidden |
| **CREW** (Concurrent Read, Exclusive Write) | allowed | forbidden |
| **CRCW** (Concurrent Read, Concurrent Write) | allowed | allowed |

"Forbidden" means the algorithm is only legal if it never causes a same-cell collision in a step; "allowed" means the hardware tolerates the collision and resolves it by a rule (for writes, see [below](#crcw-write-resolution-rules)).

These form a **power hierarchy**:

```text
   EREW  ⊆  CREW  ⊆  CRCW          (each is at least as powerful)
```

The containments are immediate and worth stating as a lemma, because they justify "an EREW algorithm runs unchanged on a CRCW machine":

> **Lemma (containment).** Any algorithm legal on a weaker model is legal on a stronger one with the *same* time and processor bounds. An EREW algorithm never issues a concurrent access, so it is a fortiori a legal CREW algorithm; a CREW algorithm never issues a concurrent write, so it is a legal CRCW algorithm.

So an upper bound proved for EREW transfers up the hierarchy for free, and — the contrapositive that does the real work — a *lower bound* proved for the strongest model (CRCW) is the strongest possible statement. The interesting questions are the *reverse* directions: how much does a stronger model actually buy you, and at what simulation cost can a weaker model emulate it? Those are the next two subsections' subjects.

### CRCW Write-Resolution Rules

When CRCW permits several processors to write the *same* cell in one step, it must say *which value lands*. There are four standard rules, in increasing order of strength:

- **COMMON.** All concurrent writers to a cell must write the *same* value; it is the algorithm's responsibility to guarantee this, and the common value is stored. (Writing differing values is illegal.)
- **ARBITRARY.** Any *one* of the competing writes succeeds, chosen adversarially; the algorithm must be correct no matter which writer wins.
- **PRIORITY.** The writer with the smallest processor index (or smallest priority tag) wins. The outcome is deterministic and the algorithm may rely on it.
- **COMBINING.** All written values are combined by a fixed associative operator — sum, max, OR, etc. — and the combined result is stored. (This is the strongest and least hardware-realistic.)

They form their own sub-hierarchy `COMMON ⊆ ARBITRARY ⊆ PRIORITY ⊆ COMBINING`: an algorithm correct under COMMON is correct under ARBITRARY (it never relies on *which* writer wins, since they all agree), and so on up. Combining-CRCW is strongest because it can, for example, sum `n` values into one cell in a single step — a primitive the others cannot match in `O(1)`. Unless stated otherwise, "CRCW" in lower-bound discussions means the **strongest** relevant rule, so the bound is the most pessimistic (hardest to beat).

---

## The Power Gap: CRCW Is Strictly Stronger

The hierarchy `EREW ⊆ CREW ⊆ CRCW` would be uninteresting if the containments were equalities. They are not: CRCW is *strictly* more powerful, and the cleanest witness is the **OR of `n` bits**.

### OR of n Bits in O(1) on CRCW

> **Claim.** On a COMMON-CRCW PRAM with `n` processors, the OR of `n` bits `x₀, …, x_{n−1}` can be computed in `O(1)` time.

**Algorithm.** Use a single shared result cell `R`.

```text
  step 1:  R ← 0                          (one processor initializes)
  step 2:  for each i in parallel:
               if x_i = 1 then  R ← 1      (all writers write the SAME value, 1)
```

In step 2, every processor `i` with `x_i = 1` writes `1` to `R` *simultaneously*. Because they all write the identical value `1`, this is a legal **COMMON** write, resolved to `1`. If at least one bit is set, `R` becomes `1`; if none is set, `R` stays `0`. That is exactly the OR — in **two steps**, i.e. `O(1)`, independent of `n`. The same construction computes AND (write `0` when `x_i = 0`), and with PRIORITY or COMBINING you get max, min, and "find any/first index where `x_i = 1`" in `O(1)` as well.

The magic is the concurrent write: `n` processors collapse `n` values into one cell in a single step.

### The Ω(log n) Lower Bound on EREW

> **Claim.** On an EREW (or CREW) PRAM, computing the OR of `n` bits requires `Ω(log n)` time, no matter how many processors are available.

**Proof (the "knowledge" / fan-in argument).** Consider the cell that holds the final answer. Its value must *depend on* all `n` input bits — flipping any single `x_i` from `0` to `1` can change the OR from `0` to `1`, so the output cell's content is a function of every input. Define, for a memory cell or register at time `t`, the **set of inputs it depends on**. Initially each cell depends on at most one input (the one stored there).

In one EREW step, a processor reads *at most one* cell and writes *at most one* cell (exclusive access forbids it from reading two different processors' cells into the same target in a way that pools their dependencies faster). More carefully: a write to a cell makes that cell depend on the union of (its old dependencies) ∪ (the dependencies of the single cell the processor read) ∪ (the processor's local state). Because reads and writes are *exclusive*, the dependency set of any cell can **at most double** per step — it merges with at most one other set's worth of information.

Let `D(t)` be the maximum size of any cell's dependency set after `t` steps. Then `D(0) = 1` and `D(t) ≤ 2·D(t−1)`, so `D(t) ≤ 2^t`. For the answer cell to depend on all `n` inputs we need `D(t) ≥ n`, hence `2^t ≥ n`, i.e.

```text
  t  ≥  log₂ n  =  Ω(log n).
```

So EREW (and CREW, by the same doubling argument — concurrent *reads* still let a cell absorb only one other cell's dependencies per write) needs `Ω(log n)` steps. ∎

Putting the two together:

```text
  OR of n bits:   CRCW  =  Θ(1)        EREW / CREW  =  Θ(log n)
```

a `Θ(log n)` separation. **CRCW is strictly more powerful than EREW.** The concurrent-write primitive lets information fan in to one cell in a single step; without it, information can only combine at a binary-tree rate, costing `log n` levels. This same `Ω(log n)` barrier is exactly why EREW **reduction** and **scan** are `Θ(log n)`-span, not `O(1)` — see the [worked examples](#worked-examples).

### Simulation Cost Between Variants

The strict gap above means a CRCW step *cannot* always be done in one EREW step. But it can be done in `O(log P)` EREW steps — the variants are equivalent up to a logarithmic factor:

> **Theorem (CRCW → EREW simulation).** One step of a `P`-processor PRIORITY-CRCW PRAM can be simulated by a `P`-processor EREW PRAM in `O(log P)` steps.

**Sketch.** The only obstacles are concurrent reads and concurrent writes; each is resolved by **sorting**. To simulate a concurrent step, each processor `i` that wants to access address `a_i` forms a record `(a_i, i, value_i)` in its own (exclusive) scratch cell. **Sort** these `P` records by address using an EREW sorting network (`O(log P)` time with `P` processors, e.g. via Cole's merge sort or AKS). After sorting, all accesses to the same address are *contiguous*. For a **concurrent read**, the first processor in each address-group reads the cell, then the value is **broadcast** to the rest of its group by a parallel prefix/segmented-copy in `O(log P)` time. For a **concurrent write** under PRIORITY, the first record in each group (smallest index, since the sort can be made stable on index) is the winner and performs the single exclusive write. Each sub-step — sort, segmented broadcast, group-leader write — is `O(log P)` on EREW, so the whole simulation is `O(log P)` per CRCW step. ∎

The consequence is a clean equivalence: any `T`-step CRCW algorithm runs on EREW in `O(T log P)` steps. So the variants are the *same up to a `log` factor* — which is why theorists often design on the convenient CRCW model and then note the (at most) `log P` blow-up to land on the realistic EREW. The strict OR separation says the `log` factor is sometimes *necessary*; the simulation says it is always *sufficient*.

---

## The Work–Span (DAG) Model

The PRAM fixes `P` up front and steps in lockstep. The **work–span model** (also called the **DAG model**, or *multithreaded computation* model) is more flexible: it describes the computation independently of `P`, then asks how it runs for *any* `P`. It is the model behind [fork–join and work-stealing](../07-fork-join-and-work-stealing/middle.md) runtimes, and the one in which Brent's theorem lives.

### The Computation DAG

Model a parallel computation as a **directed acyclic graph** `G = (V, E)`:

- Each **node** `v ∈ V` is a unit-time **task** (one strand of serial work, taking one time step).
- Each **edge** `(u, v) ∈ E` is a **dependency**: task `v` cannot start until task `u` has finished.

A node is **ready** when all its predecessors have completed. The DAG is generated dynamically as the program runs (a `spawn`/`fork` creates new ready nodes; a `sync`/`join` adds dependency edges), but for analysis we treat the whole DAG as a static object. Two numbers summarize it:

> **Work** `T₁ = |V|`, the total number of nodes — equivalently, the time to execute the DAG on **one** processor (which must do every task, one after another).
>
> **Span** `T∞`, the number of nodes on the **longest directed path** in `G` (the *critical path*) — equivalently, the time on **infinitely** many processors, where the only thing that can delay you is a dependency chain.

```text
        ●                  T₁  = 8   (eight nodes total)
       / \                 T∞  = 4   (longest path: top→…→bottom has 4 nodes)
      ●   ●                parallelism = T₁/T∞ = 8/4 = 2
     /|   |\
    ● ●   ● ●
       \ /
        ●
```

The **parallelism** `T₁/T∞` is the *average* width of the DAG: the maximum speedup you could ever hope for, the number of processors beyond which you cannot keep everyone busy. If `P > T₁/T∞`, some processors must idle on average, because the critical path serializes the work no faster than `T∞`.

### The Work Law and the Span Law

Two unconditional lower bounds on `T_P` follow directly from the definitions. They hold for *any* schedule on `P` processors.

> **The Work Law.** `T_P ≥ T₁ / P`.
>
> In `T_P` steps, `P` processors perform at most `P · T_P` unit-tasks. All `T₁` tasks must be done, so `P · T_P ≥ T₁`, i.e. `T_P ≥ T₁/P`. You cannot do `T₁` work faster than dividing it perfectly among `P` workers.

> **The Span Law.** `T_P ≥ T∞`.
>
> The critical path is a chain of `T∞` tasks, each depending on the previous; they must execute one after another *regardless of how many processors you have*. Even infinitely many processors cannot beat `T∞`. Since adding processors never *hurts*, `T_P ≥ T_∞ ≥ ... ` is monotone: `T_∞ ≤ T_P ≤ T_1`.

Combining, for every `P`:

```text
  T_P  ≥  max( T₁/P ,  T∞ ).
```

These two laws bound `T_P` from *below*. Brent's theorem, next, bounds it from *above* by their **sum** — and the gap between `max(a,b)` and `a+b` is at most a factor of `2`, which is precisely why greedy scheduling is within `2×` of optimal.

---

## Brent's Theorem and Greedy Scheduling

### The Greedy Schedule

A scheduler assigns ready tasks to processors at each step. A **greedy** (work-conserving) scheduler obeys one rule:

> **Greedy rule.** At every step, if at least `P` tasks are ready, run any `P` of them (a *complete* step). If fewer than `P` are ready, run *all* of them (an *incomplete* step). Never leave a processor idle while a ready task exists.

The point of greed is that no processor is ever idle when there is work it could do. This is exactly what a [work-stealing](../07-fork-join-and-work-stealing/middle.md) runtime approximates in practice — an idle processor steals a ready task rather than waiting.

### Proof of the Brent Bound

> **Brent's Theorem (greedy scheduling bound).** Any greedy schedule of a DAG with work `T₁` and span `T∞` on `P` processors runs in time
>
> ```text
>   T_P  ≤  T₁ / P  +  T∞.
> ```

**Proof.** Classify every step of the greedy schedule as either **complete** or **incomplete**.

*Complete steps.* A complete step runs exactly `P` tasks. Let there be `c` complete steps. They account for `c · P` tasks, and since the total number of tasks is `T₁`, we have `c · P ≤ T₁`, hence

```text
  (number of complete steps)  c  ≤  T₁ / P.
```

*Incomplete steps.* An incomplete step runs *fewer than* `P` tasks — which, by the greedy rule, means it ran *every* ready task (otherwise a processor sat idle next to a ready task, contradicting greed). We claim each incomplete step **reduces the span of the remaining DAG by exactly 1**.

Here is the key argument. Let `G'` be the sub-DAG of not-yet-executed tasks at the start of an incomplete step, and let `ℓ` be its span (longest path). Every task with **no unexecuted predecessor** is ready; on an incomplete step greed executes *all* ready tasks, i.e. all tasks at "depth 0" of `G'`. Removing the entire set of depth-0 tasks from `G'` removes the first node of every longest path, so the span of what remains is `ℓ − 1`. Thus each incomplete step strictly shortens the remaining critical path by one. The remaining span starts at `T∞` and cannot go below `0`, so there are at most `T∞` incomplete steps:

```text
  (number of incomplete steps)  ≤  T∞.
```

*Total.* Every step is complete or incomplete, so

```text
  T_P  =  (complete steps)  +  (incomplete steps)  ≤  T₁/P  +  T∞.   ∎
```

The two halves of the bound are exactly the two lower-bound laws made into an additive *upper* bound: complete steps charge against the **Work Law** (`T₁/P`), incomplete steps charge against the **Span Law** (`T∞`).

### Corollaries: 2-Optimality and Linear Speedup

> **Corollary 1 (greedy is within 2× of optimal).** Let `T_P*` be the *optimal* schedule's time on `P` processors. By the lower bounds, `T_P* ≥ max(T₁/P, T∞)`. The greedy schedule gives `T_P ≤ T₁/P + T∞ ≤ 2·max(T₁/P, T∞) ≤ 2·T_P*`. So **any greedy schedule is at most twice the optimal** — no scheduler can do more than twice as well, which is why simple greedy/work-stealing schedulers are good enough in practice.

> **Corollary 2 (linear speedup while `P ≪ T₁/T∞`).** Suppose `P ≤ (T₁/T∞)/c` for some `c ≥ 1`, i.e. the parallelism *slackness* `(T₁/T∞)/P ≥ c`. Then `T∞ ≤ T₁/(cP)`, so
>
> ```text
>   T_P  ≤  T₁/P + T∞  ≤  T₁/P + T₁/(cP)  =  (T₁/P)(1 + 1/c).
> ```
>
> The speedup is `S_P = T₁/T_P ≥ P / (1 + 1/c) = P·c/(c+1)`, which `→ P` as the slackness `c → ∞`. **As long as `P` is comfortably below the parallelism `T₁/T∞`, you get near-linear speedup**; the term `T∞` is a negligible additive overhead. The parallelism `T₁/T∞` is thus the processor count up to which the algorithm scales — beyond it, the span term dominates and adding processors stops helping.

This is the practical reading of work–span: design for **high parallelism** (`T₁/T∞ ≫ P`) and the scheduler — any greedy one — does the rest, delivering speedup close to `P`.

---

## Work-Efficiency

### Why Work Matters More Than Span

A parallel algorithm is **work-efficient** if its work matches the best *sequential* algorithm:

> **Definition.** A parallel algorithm is **work-efficient** if `T₁ = Θ(T_seq)`, where `T_seq` is the running time of the best known *sequential* algorithm for the problem.

Work-efficiency is the property beginners undervalue and practitioners obsess over. The reason is the Work Law. Speedup over the *sequential* baseline is `T_seq / T_P`, and by the Work Law `T_P ≥ T₁/P`, so

```text
  speedup over sequential  =  T_seq / T_P  ≤  T_seq / (T₁/P)  =  P · (T_seq / T₁).
```

If the algorithm is work-efficient, `T_seq/T₁ = Θ(1)` and the speedup ceiling is `Θ(P)` — you can actually approach linear speedup. But if the algorithm is **work-*inefficient*** — say `T₁ = Θ(T_seq · log n)` — then the ceiling drops to `Θ(P / log n)`: you are *throwing away a `log n` factor of your processors* before you even start. A work-inefficient algorithm with a beautiful `O(log n)` span can be *slower in wall-clock time* than a work-efficient one with `O(log² n)` span, because the inefficient one wastes processors doing redundant work that the sequential machine never did.

```text
   work-efficient   (T₁ = Θ(T_seq)):       speedup can reach Θ(P).
   work-inefficient (T₁ = Θ(T_seq·log n)): speedup capped at Θ(P/log n) — wasted processors.
```

The slogan: **span buys you latency, work buys you throughput.** A short span is worthless if you bought it by inflating the work, because the inflated work is paid by *every* processor on *every* run. The gold standard is **work-efficient *and* low-span** — the [work-efficient scan](../02-parallel-prefix-sum-scan/middle.md) (work `Θ(n)`, span `Θ(log n)`) is the canonical example, contrasted with the naive scan that is `Θ(n log n)` work and therefore wasteful.

### Brent's Scheduling Principle: From Work–Span to PRAM

How do you *implement* a work–span algorithm on a fixed-`P` PRAM? Brent's theorem gives the recipe, often called **Brent's scheduling principle** (or the *work–time framework*):

> **Brent's Principle.** An algorithm described as a sequence of parallel steps with total work `T₁` and span `T∞` can be executed on a `P`-processor PRAM in time
>
> ```text
>   T_P  =  O( T₁/P  +  T∞ ).
> ```

The idea is to take the work–time description — at each of the `T∞` levels, some number of independent operations `w_t` (with `Σ_t w_t = T₁`) is available — and have the `P` processors **simulate** each level by dividing its `w_t` operations among them in `⌈w_t / P⌉` rounds. Summing over levels:

```text
  T_P  =  Σ_{t=1}^{T∞} ⌈w_t / P⌉  ≤  Σ_t (w_t/P + 1)  =  (Σ_t w_t)/P + T∞  =  T₁/P + T∞.
```

This is *Brent's theorem in algorithm-design clothes*: it tells you that you only ever need to specify the work and the span, and any `P`-processor machine realizes the `T₁/P + T∞` bound. The practical caveats are (1) the per-level work counts `w_t` must be *computable* so processors know their assignments (often itself needing a scan), and (2) the simulation must respect the PRAM variant's read/write rules. But the headline is liberating: **design in the `P`-independent work–span model, and Brent's principle compiles it to every `P`.**

---

## Speedup, Efficiency, Cost, and the Two Laws of Scaling

### Speedup, Efficiency, Cost

Three derived quantities measure how well a parallel algorithm uses its `P` processors:

| Quantity | Definition | Meaning | Range |
|----------|------------|---------|-------|
| **Speedup** | `S_P = T₁ / T_P` | how many times faster than 1 processor | `1 ≤ S_P ≤ P` |
| **Efficiency** | `E_P = S_P / P = T₁/(P·T_P)` | fraction of processors usefully busy | `0 < E_P ≤ 1` |
| **Cost** | `C_P = P · T_P` | total processor-time reserved | `≥ T₁` |

By the Work Law, `T_P ≥ T₁/P`, so `S_P ≤ P` (**linear speedup is the ceiling**) and `E_P ≤ 1`. An algorithm is **cost-optimal** when `C_P = P·T_P = Θ(T₁) = Θ(T_seq)` — it wastes no more than a constant factor of processor-time over the sequential work, equivalently `E_P = Θ(1)`. Cost-optimality and work-efficiency-at-efficiency-`Θ(1)` are the same idea seen from two angles: no processor-time is squandered.

*Superlinear speedup* (`S_P > P`) is occasionally *observed* on real machines — caused by `P` processors' combined caches holding data that overflowed one processor's cache — but it is an artifact of the memory hierarchy, **not** of the PRAM/work–span model, where `S_P ≤ P` is a theorem.

### Amdahl's Law

Suppose a fraction `s` of the computation is inherently **serial** (cannot be parallelized) and the remaining `1 − s` is *perfectly* parallelizable. Normalize the 1-processor time to `1`. On `P` processors the serial part still takes `s`, while the parallel part takes `(1−s)/P`:

```text
  T_P  =  s  +  (1 − s)/P.
```

The speedup is therefore

> **Amdahl's Law.**
> ```text
>            T₁              1
>   S_P  =  ----  =  ------------------- .
>            T_P       s  +  (1 − s)/P
> ```

Take the limit `P → ∞`:

```text
  S_∞  =  lim_{P→∞}  1 / (s + (1−s)/P)  =  1 / s.
```

> **The speedup is capped at `1/s`, no matter how many processors you add.** A program that is `5%` serial (`s = 0.05`) can never run more than `20×` faster, even on a million cores. This is Amdahl's sobering verdict on *fixed-problem-size* parallelism: the serial fraction `s` is a hard ceiling, and the marginal value of each processor collapses as `P` grows.

Connecting to work–span: the serial fraction acts like a mandatory span. If `s` of the work is on the critical path, then `T∞ ≥ s·T₁`, so the parallelism `T₁/T∞ ≤ 1/s` — Amdahl's `1/s` ceiling is *exactly* the parallelism ceiling of a DAG whose critical path carries an `s`-fraction of the work.

### Gustafson's Law

Amdahl fixes the *problem size* and scales the machine. **Gustafson's law** observes that in practice we scale *both* — when you get a bigger machine, you run a *bigger problem* (finer mesh, more data, higher resolution), and the parallel work grows while the serial part stays roughly constant.

Fix the *parallel* run time and ask how long the same work would take on **one** processor. Let `s` be the serial fraction *of the parallel execution* and `1 − s` the parallel fraction. The work that took time `1` on `P` processors would take `s + (1 − s)·P` on one processor (the parallel part, done by `P` workers in parallel time `1−s`, is `(1−s)·P` of serial work). The **scaled speedup** is:

> **Gustafson's Law.**
> ```text
>   S_P  =  s  +  (1 − s)·P  =  P  −  s·(P − 1).
> ```

This is *linear* in `P` (slope `1 − s`), with no fixed ceiling. The contrast is the whole point:

```text
  Amdahl    (fixed problem):   S_P = 1/(s + (1−s)/P)  →  1/s        (bounded)
  Gustafson (scaled problem):  S_P = s + (1−s)·P       →  ∞ as P→∞   (linear)
```

Neither law contradicts the other — they answer different questions. **Amdahl applies when the problem size is fixed** (you want the *same* computation done faster — strong scaling). **Gustafson applies when the problem grows with the machine** (you want a *bigger* computation in the same time — weak scaling). Most large-scale scientific computing lives in Gustafson's world: nobody buys a supercomputer to solve last year's problem 20× faster; they solve a 1000× bigger problem. Quoting Amdahl's pessimistic `1/s` as if it were the final word on parallelism is a classic mistake — it is the right answer to only one of two questions.

---

## Worked Examples

Three canonical algorithms, each analyzed by work and span. All assume an EREW PRAM (or the equivalent DAG).

### Reduction

**Problem.** Combine `n` values with an associative operator (sum, max, …) into one result.

**Algorithm.** A balanced binary tree of combinations: pair up adjacent elements and combine, halving the count each level, for `log₂ n` levels.

```text
   level 0:  x0 x1 x2 x3 x4 x5 x6 x7      (n leaves)
   level 1:   (x0+x1) (x2+x3) (x4+x5) (x6+x7)
   level 2:        (x0..x3)      (x4..x7)
   level 3:             (x0..x7)            (the root = result)
```

**Analysis.** Level `k` does `n/2^{k+1}` combinations; summing over levels, total combinations `= n/2 + n/4 + … + 1 = n − 1`. So **work `T₁ = Θ(n)`** — work-efficient, since sequential reduction is also `Θ(n)`. The tree has `log₂ n` levels, each depending on the one below, so **span `T∞ = Θ(log n)`**. Parallelism `= Θ(n / log n)`. The `Θ(log n)` span is *forced* by the EREW [OR lower bound](#the-ω-log-n-lower-bound-on-erew): combining `n` values into one cannot beat `log n` levels without concurrent writes. Full treatment in [parallel reduce and map](../04-parallel-reduce-and-map/middle.md).

### Prefix Sum / Scan

**Problem.** Given `x₀, …, x_{n−1}`, compute all prefix sums `y_k = x₀ + x₁ + … + x_k` (an *inclusive scan*).

**Naive parallel scan.** The Hillis–Steele algorithm: for `d = 1, 2, 4, …`, every element adds the element `d` positions to its left. This has **span `Θ(log n)`** but does `Θ(n)` work *per level* over `log n` levels — **work `T₁ = Θ(n log n)`**, which is **work-*inefficient*** (sequential scan is `Θ(n)`).

**Work-efficient scan.** The Blelloch algorithm runs an **up-sweep** (a reduction tree, computing partial sums) then a **down-sweep** (pushing prefixes back down), each `Θ(log n)` levels with `Θ(n)` total work across the whole sweep:

```text
  work-efficient scan:  T₁ = Θ(n)   T∞ = Θ(log n)   parallelism = Θ(n/log n)
```

This matches the sequential `Θ(n)` work *and* keeps the `Θ(log n)` span — the best of both, and the reason it is the production algorithm. The full up-sweep/down-sweep derivation, with the work-efficiency proof, is in [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md). Scan is the workhorse primitive behind compaction, sorting, and graph algorithms, which is why getting it work-efficient matters so much.

### Matrix Multiply

**Problem.** `C = A · B` for `n × n` matrices, by the standard triple-loop definition `C[i][j] = Σ_k A[i][k]·B[k][j]`.

**Analysis.** There are `n²` output entries, each a dot product of length `n`. The `n` products for one entry are independent (compute in parallel), and summing them is a **reduction** of `n` terms — span `Θ(log n)`. All `n²` entries are independent of each other. So:

```text
  matrix multiply (definitional):  T₁ = Θ(n³)   T∞ = Θ(log n)   parallelism = Θ(n³/log n)
```

**Work `Θ(n³)`** (the `n³` multiply-adds, work-efficient against the *classical* sequential algorithm — though *not* against Strassen's `Θ(n^{2.807})`), and **span `Θ(log n)`** (the depth of the dot-product reductions; the `n²` entries and the `n` products within each impose no extra depth). The enormous parallelism `Θ(n³/log n)` is why dense matrix multiply is the poster child of parallel computing — for any realistic `P`, you sit far below the parallelism, in the linear-speedup regime of [Corollary 2](#corollaries-2-optimality-and-linear-speedup).

A summary of the three:

| Algorithm | Work `T₁` | Span `T∞` | Parallelism | Work-efficient? |
|-----------|-----------|-----------|-------------|-----------------|
| Reduction | `Θ(n)` | `Θ(log n)` | `Θ(n/log n)` | yes |
| Naive scan (Hillis–Steele) | `Θ(n log n)` | `Θ(log n)` | `Θ(n)` | **no** |
| Work-efficient scan (Blelloch) | `Θ(n)` | `Θ(log n)` | `Θ(n/log n)` | yes |
| Matrix multiply | `Θ(n³)` | `Θ(log n)` | `Θ(n³/log n)` | yes (vs classical) |

---

## Code: Work–Span Analyzer and Speedup Measurement

The theory predicts three measurable facts:

1. For a task DAG, `T₁` is the node count and `T∞` is the longest-path length; parallelism is their ratio.
2. A greedy schedule of that DAG on `P` processors finishes in `≤ T₁/P + T∞` steps (Brent's bound), and the achieved speedup approaches `P` while `P ≪ T₁/T∞`.
3. Amdahl's curve `S_P = 1/(s + (1−s)/P)` flattens toward `1/s`.

The code below (a) computes `T₁, T∞, parallelism` from a DAG by topological longest-path; (b) simulates a greedy schedule and reports the achieved `T_P` against the Brent bound; (c) prints the Amdahl curve.

### Go

```go
package main

import (
	"fmt"
)

// DAG is a task graph: node i depends on every node in deps[i].
type DAG struct {
	n    int
	deps [][]int // deps[i] = predecessors of node i
}

// workSpan returns T1 (work = #nodes), Tinf (span = longest path in nodes),
// and the level of each node (longest distance from a source, 1-based).
func (g *DAG) workSpan() (T1, Tinf int, level []int) {
	level = make([]int, g.n)
	// Process nodes in an order where all predecessors precede a node.
	// Assume input is given in topological order 0..n-1.
	for v := 0; v < g.n; v++ {
		best := 0
		for _, u := range g.deps[v] {
			if level[u] > best {
				best = level[u]
			}
		}
		level[v] = best + 1 // this node sits one below its deepest predecessor
		if level[v] > Tinf {
			Tinf = level[v]
		}
	}
	return g.n, Tinf, level
}

// greedy simulates a greedy schedule on P processors and returns T_P (steps).
// A node becomes ready when all its predecessors have completed.
func (g *DAG) greedy(P int) int {
	done := make([]bool, g.n)
	remaining := make([]int, g.n) // count of unfinished predecessors
	ready := []int{}
	for v := 0; v < g.n; v++ {
		remaining[v] = len(g.deps[v])
		if remaining[v] == 0 {
			ready = append(ready, v)
		}
	}
	// successors[u] = nodes that depend on u
	succ := make([][]int, g.n)
	for v := 0; v < g.n; v++ {
		for _, u := range g.deps[v] {
			succ[u] = append(succ[u], v)
		}
	}

	steps := 0
	for len(ready) > 0 {
		steps++
		take := P
		if len(ready) < P {
			take = len(ready) // incomplete step: run all ready
		}
		batch := ready[:take]
		ready = ready[take:]
		var newlyReady []int
		for _, u := range batch {
			done[u] = true
			for _, w := range succ[u] {
				remaining[w]--
				if remaining[w] == 0 {
					newlyReady = append(newlyReady, w)
				}
			}
		}
		ready = append(ready, newlyReady...)
	}
	return steps
}

func amdahl(s float64, P int) float64 {
	return 1.0 / (s + (1.0-s)/float64(P))
}

func main() {
	// A balanced binary reduction tree over 8 leaves: 15 nodes, span 4.
	// Nodes 0..7 = leaves; 8..11 = level-1; 12,13 = level-2; 14 = root.
	g := &DAG{
		n: 15,
		deps: [][]int{
			{}, {}, {}, {}, {}, {}, {}, {}, // 0..7 leaves
			{0, 1}, {2, 3}, {4, 5}, {6, 7}, // 8..11
			{8, 9}, {10, 11}, // 12,13
			{12, 13}, // 14 root
		},
	}
	T1, Tinf, _ := g.workSpan()
	fmt.Printf("reduction DAG:  T1=%d  Tinf=%d  parallelism=%.2f\n",
		T1, Tinf, float64(T1)/float64(Tinf))

	for _, P := range []int{1, 2, 4, 8} {
		tp := g.greedy(P)
		brent := (T1+P-1)/P + Tinf // ceil(T1/P) + Tinf
		fmt.Printf("  P=%d:  T_P=%d  Brent bound T1/P+Tinf=%d  speedup=%.2f\n",
			P, tp, brent, float64(T1)/float64(tp))
	}

	fmt.Println("Amdahl's law (serial fraction s = 0.05):")
	for _, P := range []int{1, 2, 4, 16, 64, 1024, 1 << 20} {
		fmt.Printf("  P=%-8d speedup=%.2f  (ceiling 1/s = %.1f)\n",
			P, amdahl(0.05, P), 1.0/0.05)
	}
}
```

Expected output:

```text
reduction DAG:  T1=15  Tinf=4  parallelism=3.75
  P=1:  T_P=15  Brent bound T1/P+Tinf=19  speedup=1.00
  P=2:  T_P=8   Brent bound T1/P+Tinf=12  speedup=1.88
  P=4:  T_P=6   Brent bound T1/P+Tinf=8   speedup=2.50
  P=8:  T_P=4   Brent bound T1/P+Tinf=6   speedup=3.75
Amdahl's law (serial fraction s = 0.05):
  P=1        speedup=1.00  (ceiling 1/s = 20.0)
  P=2        speedup=1.90  (ceiling 1/s = 20.0)
  P=4        speedup=3.48  (ceiling 1/s = 20.0)
  P=16       speedup=9.14  (ceiling 1/s = 20.0)
  P=64       speedup=15.42 (ceiling 1/s = 20.0)
  P=1024     speedup=19.62 (ceiling 1/s = 20.0)
  P=1048576  speedup=20.00 (ceiling 1/s = 20.0)
```

Three confirmations: the DAG's `T₁ = 15`, `T∞ = 4` give parallelism `3.75`; for every `P` the simulated greedy `T_P` is comfortably **below** the Brent bound `T₁/P + T∞`, and at `P = 8 ≥ parallelism` the speedup pins at exactly the parallelism `3.75` (more processors cannot help — the span dominates); and Amdahl's speedup climbs but is **strangled by the `1/s = 20` ceiling**, gaining almost nothing from `P = 1024` to `P = 2²⁰`.

### Python

```python
from collections import deque


def work_span(deps):
    """T1 = #nodes, Tinf = longest path (in nodes). Input in topological order."""
    n = len(deps)
    level = [0] * n
    for v in range(n):
        best = max((level[u] for u in deps[v]), default=0)
        level[v] = best + 1
    return n, max(level), level


def greedy(deps, P):
    """Simulate a greedy schedule on P processors; return T_P (steps)."""
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)
    ready = deque(v for v in range(n) if remaining[v] == 0)

    steps = 0
    while ready:
        steps += 1
        take = min(P, len(ready))          # incomplete step runs all ready
        batch = [ready.popleft() for _ in range(take)]
        for u in batch:
            for w in succ[u]:
                remaining[w] -= 1
                if remaining[w] == 0:
                    ready.append(w)
    return steps


def amdahl(s, P):
    return 1.0 / (s + (1.0 - s) / P)


def gustafson(s, P):
    return s + (1.0 - s) * P


def main():
    # Balanced binary reduction tree over 8 leaves: 15 nodes, span 4.
    deps = [
        [], [], [], [], [], [], [], [],   # 0..7 leaves
        [0, 1], [2, 3], [4, 5], [6, 7],   # 8..11
        [8, 9], [10, 11],                 # 12,13
        [12, 13],                         # 14 root
    ]
    T1, Tinf, _ = work_span(deps)
    print(f"reduction DAG:  T1={T1}  Tinf={Tinf}  "
          f"parallelism={T1 / Tinf:.2f}")

    for P in (1, 2, 4, 8):
        tp = greedy(deps, P)
        brent = -(-T1 // P) + Tinf         # ceil(T1/P) + Tinf
        print(f"  P={P}:  T_P={tp}  Brent bound={brent}  "
              f"speedup={T1 / tp:.2f}")

    print("Amdahl vs Gustafson (serial fraction s = 0.05):")
    for P in (1, 4, 16, 64, 1024):
        print(f"  P={P:<6} Amdahl={amdahl(0.05, P):6.2f}   "
              f"Gustafson={gustafson(0.05, P):8.2f}")


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible: `work_span` reads `T₁` and `T∞` straight off the DAG; `greedy` shows the achieved time always satisfies Brent's `T₁/P + T∞` and saturates at the parallelism; and the scaling functions put **Amdahl's bounded `1/s` curve next to Gustafson's unbounded linear one** — the same `s = 0.05` gives a `20×` ceiling under Amdahl but a `≈ 0.95·P` slope under Gustafson, the numerical face of "fixed problem vs scaled problem."

---

## Pitfalls

- **Counting span wrong.** Span is the **longest path** through the DAG, not the number of levels you happen to have drawn, and not `T₁/P` for any `P`. A common slip is to forget that a `sync`/`join` adds dependency edges that *lengthen* the critical path: two parallel branches that both feed a join contribute `max(span of branch)` plus the join, not the sum. Compute `T∞` as a genuine longest-path (the `level[v] = 1 + max over predecessors` recurrence), or you will overstate the parallelism and overpromise speedup.

- **Chasing low span while ignoring work.** A `Θ(log n)`-span algorithm that does `Θ(n log n)` work (the naive Hillis–Steele scan) can be *slower in practice* than an `Θ(log² n)`-span algorithm that does `Θ(n)` work, because the extra `log n` factor of work is paid by every processor on every run. **Work-efficiency `T₁ = Θ(T_seq)` is the first thing to check**; a small span is only valuable on top of efficient work. Speedup over sequential is capped at `P · (T_seq/T₁)`, so a `log n` work blow-up *throws away* a `log n` factor of processors before you start.

- **Forgetting Amdahl's serial fraction.** Optimizing the parallel part while a fixed serial fraction `s` remains is the canonical waste of effort: if `s = 0.1`, no amount of parallelism beats `10×`, so doubling the core count past a point buys nothing. Find and attack the **serial fraction** itself (often I/O, initialization, or a sequential reduction step), not just the already-parallel region. Conversely, do not quote Amdahl's pessimism when the *problem grows with the machine* — that is Gustafson's regime, where speedup is linear.

- **Confusing Amdahl and Gustafson.** They answer different questions. Amdahl: *fixed problem size*, how much faster (strong scaling, ceiling `1/s`). Gustafson: *problem grows with `P`*, how much more work in the same time (weak scaling, linear). Reporting an Amdahl ceiling for a workload that actually scales with the machine understates parallel value; reporting Gustafson linearity for a fixed-size job overstates it. **State which scaling regime you are in.**

- **Treating PRAM as a hardware model.** PRAM charges *nothing* for communication, memory contention, or synchronization — every processor accesses shared memory in unit time, in lockstep. Real machines pay for cache coherence, NUMA distance, network latency, and barrier synchronization, none of which appear in `T_P = T₁/P + T∞`. PRAM and work–span tell you the *inherent* parallelism of a problem (a real and useful thing); they do **not** predict wall-clock time. A high-parallelism algorithm can still be slow if its memory-access pattern thrashes the cache — see the [I/O and cache models](../../24-external-memory-and-cache-aware/01-the-io-model/middle.md) for the cost the PRAM ignores.

- **Assuming `S_P` can exceed `P`.** In the PRAM/work–span model `S_P = T₁/T_P ≤ P` is a theorem (it is the Work Law). *Observed* superlinear speedup on real hardware is a memory-hierarchy artifact (more aggregate cache), not a contradiction — it lives outside the model. If your *model* analysis predicts `S_P > P`, you have a bug, almost always an undercount of `T₁` or an overcount of parallelism.

- **Using `M`, not the right CRCW rule, in a separation.** When you claim a problem is `O(1)` on CRCW, name the **write-resolution rule** (COMMON suffices for OR; you need COMBINING for sum-in-one-step). And when you claim a `log` lower bound, prove it for the **weakest** model you target (EREW), since the bound does not automatically transfer downward from CRCW. Mixing the rules silently changes the power and invalidates the bound.

---

## Summary

- **The PRAM** is `P` synchronous processors on one shared memory, with unit-cost access and **no** communication/contention/synchronization charge. Variants form a power hierarchy **`EREW ⊆ CREW ⊆ CRCW`**; CRCW resolves concurrent writes by **COMMON ⊆ ARBITRARY ⊆ PRIORITY ⊆ COMBINING**. An upper bound flows up the hierarchy for free; a lower bound proved on CRCW is the strongest.

- **CRCW is strictly stronger.** OR of `n` bits is `Θ(1)` on COMMON-CRCW (all set bits write `1` to one cell at once) but `Ω(log n)` on EREW (a cell's dependency set at most *doubles* per step, so reaching all `n` inputs needs `≥ log₂ n` steps). One CRCW step simulates on EREW in **`O(log P)`** via sort-then-broadcast — the variants are equivalent up to a `log` factor.

- **The work–span model** describes a computation as a DAG: **work `T₁`** = node count (1-processor time), **span `T∞`** = longest path (∞-processor time), **parallelism `T₁/T∞`**. The **Work Law** `T_P ≥ T₁/P` and **Span Law** `T_P ≥ T∞` are unconditional lower bounds.

- **Brent's theorem:** a **greedy** schedule achieves `T_P ≤ T₁/P + T∞`. *Proof:* complete steps number `≤ T₁/P` (each uses `P` of the `T₁` tasks); incomplete steps number `≤ T∞` (each shortens the remaining critical path by 1). **Corollary:** greedy is within `2×` of optimal, and speedup is near-linear while `P ≪ T₁/T∞`.

- **Work-efficiency** (`T₁ = Θ(T_seq)`) matters **more** than span: speedup over sequential is capped at `P·(T_seq/T₁)`, so a work blow-up wastes processors. **Brent's scheduling principle** compiles any work–span algorithm to a `P`-processor PRAM in `O(T₁/P + T∞)`.

- **Speedup `S_P = T₁/T_P ≤ P`, efficiency `E_P = S_P/P ≤ 1`, cost `C_P = P·T_P ≥ T₁`.** **Amdahl** (fixed problem): `S_P = 1/(s + (1−s)/P) → 1/s` — a hard ceiling set by the serial fraction. **Gustafson** (scaled problem): `S_P = s + (1−s)·P` — unbounded, linear. They describe strong vs weak scaling; name which you mean.

- **Worked bounds:** reduction `T₁=Θ(n), T∞=Θ(log n)`; work-efficient scan same (vs the wasteful `Θ(n log n)`-work naive scan); matrix multiply `T₁=Θ(n³), T∞=Θ(log n)`. High parallelism + work-efficiency is the goal.

Revisit [junior](./junior.md) for the intuition behind these models; advance to [senior](./senior.md) for the deeper PRAM lower bounds, the BSP/LogP communication-aware models, and randomized work-stealing analysis. Continue to [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md) for the work-efficient scan in full, [parallel reduce and map](../04-parallel-reduce-and-map/middle.md) for the building-block primitives, and [fork–join and work-stealing](../07-fork-join-and-work-stealing/middle.md) for how a real runtime realizes the greedy schedule Brent's theorem assumes.
