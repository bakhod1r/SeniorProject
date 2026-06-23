# Models of Parallel Computation: PRAM and Work–Span — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [The Bounds: Work, Span, Brent](#the-bounds-work-span-brent)
3. [Amdahl vs Gustafson](#amdahl-vs-gustafson)
4. [Work-Efficiency & Examples](#work-efficiency--examples)
5. [Advanced: NC, P-completeness, Work-Stealing](#advanced-nc-p-completeness-work-stealing)
6. [Gotcha / Trick Questions](#gotcha--trick-questions)
7. [Rapid-Fire Q&A](#rapid-fire-qa)
8. [Common Mistakes](#common-mistakes)
9. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is the PRAM model, and what are its variants? *(Easy)*

**Answer**: The **PRAM** (Parallel Random-Access Machine) is the shared-memory analogue of the RAM model: `P` processors execute in **lockstep synchronous steps**, all reading and writing a single **shared memory** in unit time. It abstracts away communication cost, latency, and synchronization — exactly the way the RAM model abstracts away cache and disk — so you can reason about the *inherent* parallelism of an algorithm.

The variants differ only in **how concurrent access to one memory cell is resolved**:

- **EREW** (Exclusive Read, Exclusive Write) — no two processors may touch the same cell in the same step. The weakest, most realistic model.
- **CREW** (Concurrent Read, Exclusive Write) — simultaneous reads are allowed; writes must be exclusive.
- **CRCW** (Concurrent Read, Concurrent Write) — both allowed. Concurrent writes need a **rule**: *Common* (all writers must agree on the value), *Arbitrary* (one arbitrary writer wins), *Priority* (lowest-indexed processor wins).

### Q2: Define work and span. *(Easy)*

**Answer**: For a parallel computation modeled as a DAG of unit-cost tasks:

- **Work `T₁`** — the total number of operations, i.e. the time on **one** processor (a serial execution). It is the *size* of the DAG.
- **Span `T∞`** (also *depth* or *critical-path length*) — the time on **infinitely many** processors, i.e. the length of the **longest dependency chain** in the DAG. It is what you cannot avoid no matter how many processors you have.

`T_P` denotes the time on `P` processors. By definition `T₁` is the work and `T∞` is the span; the subscript is the processor count.

### Q3: What is parallelism, and what does `T₁/T∞` tell you? *(Medium)*

**Answer**: **Parallelism** is the ratio

```
parallelism = T₁ / T∞.
```

It is the **maximum possible speedup** — the average amount of work available per step along the critical path. Crucially, it tells you the **number of processors beyond which you get diminishing returns**: adding processors past `P ≈ T₁/T∞` cannot help, because the span `T∞` is now the bottleneck, not the lack of processors.

So parallelism is a single number that answers "how many processors can this algorithm actually use?" An algorithm with `T₁ = n` and `T∞ = log n` has parallelism `n/log n` — it scales to nearly `n` processors. One with `T∞ = n` (a serial chain) has parallelism `1` — it cannot be sped up at all.

---

## The Bounds: Work, Span, Brent

### Q4: State and explain the work law and the span law. *(Medium)*

**Answer**: Two lower bounds on `T_P`, the time on `P` processors:

- **Work law**: `T_P ≥ T₁ / P`. With `P` processors you do at most `P` units of work per step, so finishing `T₁` work takes at least `T₁/P` steps. You can never beat perfect division of the total work.
- **Span law**: `T_P ≥ T∞`. Adding processors can never shorten the critical path — its tasks must execute in dependency order — so you can never go faster than the span, regardless of `P`.

Together: `T_P ≥ max(T₁/P, T∞)`. Speedup is capped by whichever bottleneck bites first — not enough processors (work law) or not enough independent work (span law).

### Q5: State Brent's theorem and explain what it implies. *(Hard)*

**Answer**: **Brent's theorem** (the *greedy scheduling bound*) is an **upper** bound matching the two lower bounds within a factor of 2:

```
T_P ≤ T₁/P + T∞.
```

A greedy scheduler — one that never lets a processor idle if a ready task exists — achieves this. Intuition for the proof: classify each step as **complete** (≥ `P` ready tasks, all processors busy) or **incomplete** (< `P` ready tasks). Complete steps number at most `T₁/P` (each retires `P` work). Incomplete steps number at most `T∞` (each such step advances the critical path by one, since every ready task with no waiting work shortens the longest remaining chain). Summing gives `T₁/P + T∞`.

**What it implies**: combined with the lower bounds, `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞`. When `P ≪ T₁/T∞` (parallelism), the `T₁/P` term dominates and `T_P ≈ T₁/P` — you get **near-linear speedup**. Linear speedup persists *until* `P` approaches the parallelism `T₁/T∞`; past that, the `T∞` term dominates and more processors stop helping. The design goal follows directly: **maximize parallelism `T₁/T∞`** so the linear-speedup regime extends as far as possible. See [./middle.md](./middle.md).

### Q6: Why is greedy scheduling within 2× of optimal? *(Medium)*

**Answer**: Brent gives `T_P ≤ T₁/P + T∞`. The optimal `T_P*` satisfies both lower bounds, so `T_P* ≥ max(T₁/P, T∞) ≥ ½(T₁/P + T∞)`. Therefore

```
T_P ≤ T₁/P + T∞ ≤ 2 · max(T₁/P, T∞) ≤ 2 · T_P*.
```

Any greedy schedule is within a factor of **2** of the best possible schedule — a remarkably strong guarantee that requires no global planning, only the local rule "never idle a processor while work is ready." This is why real schedulers (e.g. work-stealing runtimes) are greedy.

---

## Amdahl vs Gustafson

### Q7: Derive Amdahl's law and its `1/s` limit. *(Medium)*

**Answer**: Split a program into a **serial fraction `s`** (inherently sequential) and a parallel fraction `1 − s`, for a **fixed total problem**. On `P` processors the parallel part speeds up by `P`, the serial part does not:

```
T_P = s · T₁ + (1 − s) · T₁ / P,
Speedup(P) = T₁ / T_P = 1 / ( s + (1 − s)/P ).
```

As `P → ∞`, the second term vanishes and

```
Speedup → 1 / s.
```

**Amdahl's bound**: the serial fraction caps speedup at `1/s` no matter how many processors you throw at it. If 5% of the work is serial (`s = 0.05`), the ceiling is `20×` — even with a million processors. This is the pessimistic, fixed-workload view.

### Q8: What does Gustafson's law say, and when does it apply instead? *(Hard)*

**Answer**: **Gustafson's law** observes that in practice we don't fix the problem and add processors — we **scale the problem to fill the processors** (weak scaling). If the serial part stays roughly constant while the parallel part grows with `P`, the *scaled speedup* is

```
Speedup(P) = s + P · (1 − s) = P − s · (P − 1),
```

which grows **linearly in `P`** — no fixed ceiling. The serial fraction shrinks in relative terms as the problem grows.

**Which applies?** It depends on the question, not on physics — the two laws describe different scenarios of the *same* machine:

- **Amdahl (strong scaling)**: fixed problem size, "how much faster with more processors?" Answer: capped at `1/s`.
- **Gustafson (weak scaling)**: problem grows with processors, "how much *more* can I solve in the same time?" Answer: scales linearly.

Most real HPC workloads (simulations, ML training on bigger data) are weak-scaling, which is why supercomputers with millions of cores are useful despite Amdahl's gloomy ceiling.

---

## Work-Efficiency & Examples

### Q9: What is work-efficiency, and why does it often matter more than span? *(Hard)*

**Answer**: A parallel algorithm is **work-efficient** if its work `T₁` matches the best *serial* algorithm's running time asymptotically — i.e. parallelizing didn't inflate the total operation count. A work-*inefficient* algorithm does `ω(serial)` total work; it merely spread extra operations across processors.

Why it matters more than span for **real** speedup: by the work law `T_P ≥ T₁/P`, your wall-clock time is floored by the work divided by `P`. If `T₁` is, say, a `log n` factor larger than the serial cost, then even with infinite processors you've wasted that factor — you need `log n` *times* as many processors just to break even with the serial algorithm. A beautiful `O(log n)` span is worthless if it cost `O(n log n)` work where `O(n)` would do, because real machines have *bounded* `P`. The pragmatic goal: **work-efficient first, low span second.** A work-efficient algorithm with modest span beats a work-inefficient one with tiny span on any real machine.

### Q10: Give the work and span of summing `n` numbers and of prefix-sum. *(Medium)*

**Answer**: Both use a **balanced binary tree** of operations:

- **Sum (reduction)** of `n` numbers: pair up and add in a tree. `T₁ = Θ(n)` (you must touch every element), `T∞ = Θ(log n)` (the tree height). Parallelism `= Θ(n/log n)`. Work-efficient — `Θ(n)` matches the trivial serial loop.
- **Prefix-sum (scan)**: the work-efficient Blelloch up-sweep/down-sweep also achieves `T₁ = Θ(n)`, `T∞ = Θ(log n)`, parallelism `Θ(n/log n)`. The naive Hillis–Steele scan is *not* work-efficient — it does `Θ(n log n)` work for the same `Θ(log n)` span, a classic illustration of Q9.

Memorize: **reduction and scan are both `(work Θ(n), span Θ(log n))`** — the canonical "embarrassingly tree-shaped" primitives. See [../02-parallel-prefix-sum-scan/interview.md](../02-parallel-prefix-sum-scan/interview.md).

---

## Advanced: NC, P-completeness, Work-Stealing

### Q11: What is the class NC? *(Hard)*

**Answer**: **NC** ("Nick's Class") is the class of problems solvable in **polylogarithmic span `O(log^k n)`** using a **polynomial number of processors** (polynomial work). Informally, NC is the set of problems that are **efficiently parallelizable** — they admit a dramatic span reduction without an exponential blow-up in processors. Sorting, matrix multiplication, prefix-sum, and graph connectivity are in NC.

`NC ⊆ P` (polylog time on poly processors implies poly serial time). Whether `NC = P` is open — the parallel analogue of `P vs NP`.

### Q12: What does P-complete mean for parallelizability? *(Hard)*

**Answer**: A problem is **P-complete** if it is in `P` and every problem in `P` reduces to it (under log-space or `NC` reductions). P-complete problems are the **"hardest to parallelize"**: if any P-complete problem were in NC, then `NC = P` — every polynomial-time problem would be efficiently parallelizable. Since that's widely believed false, P-complete problems are regarded as **inherently sequential** — they have no known polylog-span algorithm and likely none exists.

Canonical examples: the **Circuit Value Problem**, **linear programming**, and **lexicographically-first depth-first search**. The practical lesson: not everything parallelizes. If your core computation is P-complete, no amount of cleverness gives you polylog span — the dependency chain is fundamentally long.

### Q13: State the work-stealing time bound. *(Hard)*

**Answer**: A **randomized work-stealing** scheduler (each idle processor steals a task from a random victim's deque) runs a fork-join computation in **expected time**

```
T_P = T₁/P + O(T∞).
```

This matches Brent's greedy bound asymptotically — `T₁/P + O(T∞)` — but achieves it with a **decentralized, low-overhead** scheduler that needs no global view. The `O(T∞)` term bounds the total time lost to steals (each steal is charged against critical-path progress). It also bounds communication and space: expected `O(P · T∞)` total steals, and space `S_P ≤ P · S₁`. This is the theoretical foundation of Cilk, TBB, Go's scheduler, and Java's fork-join pool. See [../07-fork-join-and-work-stealing/interview.md](../07-fork-join-and-work-stealing/interview.md).

---

## Gotcha / Trick Questions

### Q14: "More processors always means faster, right?" *(Medium)*

**Answer**: **No.** Three independent ceilings say otherwise:

1. **Span law** — you can never beat `T∞`. Past `P ≈ T₁/T∞` (the parallelism), extra processors sit idle; the critical path is the bottleneck.
2. **Amdahl** — a serial fraction `s` caps speedup at `1/s` for a fixed problem, regardless of `P`.
3. **Real-machine costs** the PRAM hides — **memory bandwidth**, cache coherence traffic, and synchronization. Even an embarrassingly parallel kernel saturates the memory bus; beyond that point adding cores *slows things down* via contention.

So speedup is bounded by `min(parallelism, 1/s)` in theory, and often by bandwidth in practice. "More processors = faster" holds only inside the linear-speedup regime.

### Q15: "CRCW vs EREW — does the model variant actually matter?" *(Hard)*

**Answer**: **In theory yes, in practice barely.** The PRAM variants form a strict power hierarchy `EREW ≤ CREW ≤ CRCW`: a stronger model can be *more* powerful per step. For example, CRCW-Common finds the OR of `n` bits in **`O(1)`** time (all 1-processors write to one cell), whereas EREW needs **`Ω(log n)`** (information must fan-in through a tree). But the gap is small — any CRCW algorithm can be **simulated on EREW with only an `O(log P)` slowdown** — so the model choice rarely changes a problem's NC-membership.

The bigger caveat: **real machines are not PRAM at all.** There is no unit-cost shared memory; there's a deep cache hierarchy, NUMA, and bus contention. PRAM is a tool for reasoning about *inherent* parallelism (work and span), not a performance predictor. Quote work/span to compare algorithms; don't take the `O(1)` CRCW OR as a literal hardware claim.

### Q16: "Is a low span enough for a fast parallel algorithm?" *(Medium)*

**Answer**: **No — span without work-efficiency is a trap.** By the work law `T_P ≥ T₁/P`, a work-inefficient algorithm (e.g. `Θ(n log n)` work for an `Θ(n)` problem) wastes a `log n` factor of every processor, so on any bounded-`P` machine it can be *slower* than the serial algorithm despite its gorgeous `O(log n)` span. The Hillis–Steele vs Blelloch scan (Q10) is the textbook case. Low span only pays off once work is already efficient — **`T₁` first, `T∞` second.**

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | PRAM stands for? | Parallel Random-Access Machine |
| 2 | The four variants? | EREW, CREW, CRCW (CRCW rules: Common/Arbitrary/Priority) |
| 3 | Work `T₁`? | Total ops = serial time = DAG size |
| 4 | Span `T∞`? | Critical-path length = time on ∞ processors |
| 5 | Parallelism? | `T₁/T∞` — max useful processors / max speedup |
| 6 | Work law? | `T_P ≥ T₁/P` |
| 7 | Span law? | `T_P ≥ T∞` |
| 8 | Brent's bound? | `T_P ≤ T₁/P + T∞` |
| 9 | Greedy schedule optimality? | Within **2×** of optimal |
| 10 | Speedup? | `T₁/T_P` |
| 11 | Efficiency? | Speedup `/ P = T₁/(P·T_P)` |
| 12 | Amdahl limit? | `1/s` (fixed problem) |
| 13 | Gustafson? | `s + P(1−s)` — linear scaled speedup |
| 14 | Work-efficient means? | `T₁` matches best serial cost |
| 15 | Sum / reduction (work, span)? | `(Θ(n), Θ(log n))` |
| 16 | Prefix-sum (work, span)? | `(Θ(n), Θ(log n))` (Blelloch) |
| 17 | NC? | Polylog span, poly processors — efficiently parallelizable |
| 18 | P-complete implies? | Inherently sequential (no known polylog span) |
| 19 | Work-stealing bound? | `T_P = T₁/P + O(T∞)` expected |
| 20 | Linear speedup holds until? | `P ≈ T₁/T∞` (the parallelism) |

---

## Common Mistakes

1. **Confusing work with span.** `T₁` = total operations; `T∞` = longest dependency chain. Parallelism is their *ratio*, not either one alone.
2. **Forgetting the span law.** Speedup is capped at `T₁/T∞`; you can't push `T_P` below `T∞` by adding processors.
3. **Treating low span as sufficient.** Without work-efficiency, the work law `T_P ≥ T₁/P` makes a low-span algorithm slow on bounded `P`. Optimize work first.
4. **Mixing up Amdahl and Gustafson.** Amdahl = fixed problem (ceiling `1/s`); Gustafson = problem scales with `P` (linear). Different questions, same machine.
5. **Taking PRAM as a performance model.** It ignores bandwidth, latency, and contention — use it for *inherent* work/span, not wall-clock prediction.
6. **Overstating CRCW.** The variant hierarchy is real but collapses to `O(log P)` slowdown; real hardware isn't PRAM, so don't bank on `O(1)` concurrent writes.
7. **Computing efficiency wrong.** Efficiency `= speedup/P = T₁/(P·T_P)`, between 0 and 1; `1` means perfect linear speedup.

---

## Tips & Summary

- **Lead with the two quantities**: "I analyze parallel algorithms by **work `T₁`** (total ops) and **span `T∞`** (critical path); their ratio is the parallelism — the most processors I can use." This frames every later answer.
- **Memorize the bound sandwich**: `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞`. The lower half is the work and span laws; the upper half is Brent. Linear speedup until `P ≈ T₁/T∞`.
- **State the 2× greedy guarantee** — it justifies why real runtimes just schedule greedily and why **work-stealing matches Brent** at `T₁/P + O(T∞)`.
- **Contrast Amdahl and Gustafson by scenario**, not formula: fixed problem caps at `1/s`; scaled problem grows linearly. Most HPC is weak-scaling (Gustafson).
- **Champion work-efficiency**: a work-inefficient `O(log n)`-span algorithm loses to the serial code on real, bounded-`P` machines. Reduction and scan are the canonical work-efficient `(Θ(n), Θ(log n))` primitives.
- **Know the complexity landscape**: **NC** = efficiently parallelizable; **P-complete** = inherently sequential. Not everything parallelizes — if the dependency chain is long, no scheduler saves you.

**Related:** [Parallel Prefix-Sum / Scan — Interview](../02-parallel-prefix-sum-scan/interview.md) · [Fork-Join & Work-Stealing — Interview](../07-fork-join-and-work-stealing/interview.md) · [Models, PRAM & Work–Span — Middle](./middle.md)
