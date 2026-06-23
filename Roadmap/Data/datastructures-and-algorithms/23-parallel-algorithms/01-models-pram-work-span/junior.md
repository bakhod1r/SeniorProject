# Models of Parallel Computation: PRAM and Work–Span — Junior Level

> **Audience:** You know Big-O and basic algorithms, but every algorithm you've analyzed ran on *one* processor doing *one* thing at a time. The idea that many processors could attack the same problem at once — and the question of *how much faster that makes things* — is new.
> **Read time:** ~40 minutes. **Focus:** "If I throw `P` processors at a problem, how much faster does it get — and what cost model lets me *predict* that instead of guessing?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why You Need a Model At All](#why-you-need-a-model-at-all)
5. [The PRAM: A First Picture of Parallel Computing](#the-pram-a-first-picture-of-parallel-computing)
6. [The Read/Write Conflict Rules: EREW, CREW, CRCW](#the-readwrite-conflict-rules-erew-crew-crcw)
7. [The Modern Model: Work and Span](#the-modern-model-work-and-span)
8. [The Computation DAG: A Recipe With Dependencies](#the-computation-dag-a-recipe-with-dependencies)
9. [Parallelism = Work / Span](#parallelism--work--span)
10. [Worked Example: Summing n Numbers](#worked-example-summing-n-numbers)
11. [Speedup and the Brent Bound](#speedup-and-the-brent-bound)
12. [Amdahl's Law: The Serial Part Caps You](#amdahls-law-the-serial-part-caps-you)
13. [Code: A Parallel Sum and Measuring Speedup](#code-a-parallel-sum-and-measuring-speedup)
14. [Code: Computing Work and Span of a DAG](#code-computing-work-and-span-of-a-dag)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Every algorithm you've studied so far ran on a single processor. You counted operations — comparisons, additions, array reads — and each one happened *after* the last, in a single line of execution. The cost model underneath all that Big-O is the **RAM model**: one processor, one operation at a time, every operation costing O(1). It's the lens through which "this is O(n log n)" even means anything.

But real machines stopped being single-processor a long time ago. The laptop you're reading this on has somewhere between 4 and 16 CPU cores. A server has dozens. A GPU has *thousands* of tiny processors. The whole industry pivoted to putting *more* processors on a chip rather than making one processor faster, because making a single core faster hit a wall around 2005. So the central practical question of modern performance is no longer just "how few operations?" — it's **"how much faster does this get if I use all my processors at once?"**

And here's the catch: that question has no answer until you fix a *model*. Just like you can't say binary search is "O(log n)" without agreeing that each comparison costs O(1) (the RAM model), and you can't reason about disk-bound algorithms without the [I/O model](../../24-external-memory-and-cache-aware/01-the-io-model/junior.md), you can't say a parallel algorithm gives "near-linear speedup" without a cost model for *what parallel computers can do and what it costs*. Sentences like "use 8 cores, go 8× faster" are wishful until you have a framework that tells you when that's achievable and when it's mathematically impossible.

This file builds two such models. First, the **PRAM** (Parallel Random Access Machine) — the classic, idealized picture of `P` processors sharing one memory and marching in lockstep. It's the parallel cousin of the RAM model, and it gives us a clean mental image plus a vocabulary for the one genuinely hard part of parallelism: what happens when two processors touch the *same* memory cell at the same instant. Second — and this is the model you'll actually use — the **work–span model** (also called work–depth). It throws out the lockstep picture and instead describes a computation as a graph of tasks with dependencies. From that graph fall two numbers: **work** (total operations, the time on one processor) and **span** (the longest chain of dependencies, the time on infinitely many processors). Their ratio, **parallelism**, tells you the maximum useful speedup *before you've written a line of parallel code*.

We'll define both models carefully, walk fully through the canonical example — summing `n` numbers in `Θ(log n)` span instead of `Θ(n)` — meet the **Brent bound** that connects work and span to your actual processor count, and confront **Amdahl's law**, the sobering result that a small serial fraction caps your speedup no matter how many processors you buy. Then we'll *measure* it: real parallel-sum code in Go and Python, a speedup-vs-processor-count experiment, and a function that computes the work and span of any task graph. By the end, "how much faster in parallel?" will be a number you can predict, not a hope you can voice.

---

## Prerequisites

- **Required:** Big-O basics — what O(1), O(n), O(log n), and O(n log n) mean. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md). We reuse all of this; we just start counting *two* things (work and span) instead of one.
- **Required:** Comfort with a simple loop summing an array, and with the idea of recursion / divide-and-conquer (splitting a problem in half). The sum example leans on a balanced binary tree of additions.
- **Required:** The mental model of the **RAM model** — one processor, one O(1) operation at a time. The whole point is to extend it to many processors.
- **Helpful:** Any exposure to threads, goroutines, or "doing two things at once." We define everything, but a vague picture of "running code in parallel" helps the code sections land.
- **Helpful:** Familiarity with the [I/O model](../../24-external-memory-and-cache-aware/01-the-io-model/junior.md), which trains the same instinct: *to reason about a new kind of cost, you need a model that counts the right thing.*

No knowledge of specific parallel hardware, no calculus, no probability. Every cost here is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **RAM model** | The classic sequential cost model: one processor, one O(1) operation per step. The baseline we generalize. |
| **PRAM** | Parallel Random Access Machine: `P` processors sharing one memory, executing synchronous O(1) steps in lockstep. |
| **Processor (P)** | One independent unit that executes operations. In parallel, `P` of them run at once. |
| **Lockstep / synchronous** | All processors execute one step together, then the next together — like a marching band. |
| **EREW / CREW / CRCW** | PRAM variants by memory-conflict rule (Exclusive/Concurrent Read, Exclusive/Concurrent Write). |
| **Computation DAG** | A directed acyclic graph of tasks; an edge `a → b` means `b` can't start until `a` finishes. |
| **Work (T₁)** | The total number of operations = the running time on **one** processor. |
| **Span (T∞)** | The length of the longest dependency chain (the *critical path*) = the running time on **infinitely many** processors. |
| **Critical path** | The longest chain of must-happen-in-order tasks in the DAG; its length is the span. |
| **T_P** | The running time on exactly `P` processors. |
| **Parallelism** | The ratio `T₁ / T∞` — the maximum useful speedup; the most processors you can keep busy. |
| **Speedup** | `T₁ / T_P` — how many times faster `P` processors run than one. Ideal speedup is `P`. |
| **Brent bound** | `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞` — bounds your real time from the two numbers. |
| **Amdahl's law** | If a fraction `s` of the work is inherently serial, speedup ≤ `1/s`, no matter how many processors. |
| **Reduction tree** | A balanced binary tree of combine-operations (e.g. additions) that turns an `n`-step serial fold into a `log n`-depth parallel one. |

---

## Why You Need a Model At All

Picture someone telling you: "I parallelized the sum. It uses 8 cores now." Your very next question should be: *how much faster did it actually get?* And the honest answer is — **you cannot know without a model.** Maybe it went 8× faster. Maybe 7×. Maybe 1.2× because the cores spent all their time waiting on each other. Maybe it got *slower* because coordinating 8 cores cost more than the work itself. "Uses 8 cores" is a fact about implementation; "8× faster" is a claim about *cost*, and claims about cost require a cost model.

This is exactly the role the **RAM model** plays for sequential algorithms. When you say "merge sort is O(n log n)," you're implicitly agreeing to a contract: one processor, each comparison and array move costs O(1), and we count those operations. The RAM model is so familiar it's invisible — but it's a *choice*, an idealization. It ignores caches (the [I/O model](../../24-external-memory-and-cache-aware/01-the-io-model/junior.md) puts those back), ignores instruction-level details, and pretends every operation costs the same. We accept those simplifications because they let us *compare algorithms* with a clean number.

Parallel computing needs the same kind of contract, and it needs to answer a question the RAM model can't even phrase: **with `P` processors, what's the running time?** To answer that, a model must pin down at least three things:

1. **What can run at the same time?** Which operations are independent (can happen simultaneously) and which must wait for others to finish first?
2. **What does coordination cost?** When two processors need to share a value, or both want to write the same memory cell, what happens — and what does it cost?
3. **How do we turn "P processors" into a running time?** Given the structure of a computation and a processor count, what formula predicts the time?

A good parallel model answers these *abstractly* — without you having to name a specific CPU or count its exact cores — so that you can reason about an algorithm's parallel potential the same way you reason about a sequential algorithm's Big-O: on paper, before writing code, in a way that transfers across machines. We'll build two models. The PRAM gives the cleanest answer to questions 1 and 2; the work–span model gives the most *useful* answer to questions 1 and 3. Together they're your toolkit for the rest of this section.

> **The throughline:** a cost model is not a description of any real machine — it's a deliberate idealization that lets you *predict and compare*. The RAM model does it for sequential time, the I/O model for data movement, and the PRAM / work–span models for parallel time. Each one chooses what to count and what to ignore, and that choice is what makes reasoning possible.

---

## The PRAM: A First Picture of Parallel Computing

The **PRAM** — Parallel Random Access Machine — is the most direct way to imagine parallel computing, and it's the natural generalization of the RAM model. Here's the whole picture:

```
        P processors, all sharing ONE memory:

     ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
     │ P₀  │ │ P₁  │ │ P₂  │ │ P₃  │   ... up to P processors
     └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘
        │       │       │       │
        └───────┴───┬───┴───────┘
                    │   every processor can reach
                    ▼   every memory cell
     ┌───────────────────────────────┐
     │      SHARED MEMORY             │   one big array, visible to all
     └───────────────────────────────┘
```

The rules of the PRAM:

- **`P` processors**, each one essentially a little RAM machine: it can read a memory cell, do an O(1) computation, write a memory cell.
- **One shared memory**, an array of cells that *every* processor can read and write. There's no "my memory" vs "your memory" — it's all common ground.
- **Synchronous lockstep execution.** Time advances in discrete *steps*. In each step, *every* processor does exactly one O(1) operation, all at the same instant, then they all move to the next step together. Think of a marching band: everyone takes one step on the beat, then the next on the next beat. No processor races ahead.
- **The cost of an algorithm** is the **number of steps** until it finishes — because each step is O(1) and `P` processors do `P` operations within it. (We'll often also care about *how many processors* it needed.)

This is a beautiful idealization. Notice what it pretends away: in a real machine, processors don't run in perfect lockstep, shared memory isn't equally fast for everyone, and coordinating thousands of cores is genuinely messy. The PRAM ignores all of that — exactly as the RAM model ignores caches — so that we can reason cleanly about the *essential* structure of a parallel algorithm: which operations can fire simultaneously, and how many steps that takes.

Here's the PRAM in action on a tiny task. Suppose you have an array `A` of `n` numbers and you want to add 1 to each. Sequentially that's `n` steps (a loop). On a PRAM with `n` processors, it's **one step**: processor `i` reads `A[i]`, adds 1, writes `A[i]` — all `n` of them at the same instant. One step instead of `n`. That's the promise of parallelism in its purest form, and the PRAM is the model that lets us state it precisely: *this task takes 1 PRAM step with n processors.*

But that example hid the one genuinely hard question in parallel computing — and the PRAM is famous precisely because it forces us to face it head-on.

---

## The Read/Write Conflict Rules: EREW, CREW, CRCW

The add-1-to-each example was easy because every processor touched a *different* cell — processor `i` only ever touched `A[i]`. No two processors ever wanted the same cell at the same instant. But many algorithms aren't so tidy. What if five processors all want to *read* the same value in the same step? What if two processors want to *write* to the same cell in the same step — with different values? Who wins?

This is the heart of parallel computing's difficulty, and the PRAM model handles it by splitting into **variants**, named by what they allow for concurrent reads and concurrent writes. The names are acronyms built from two choices — Exclusive (E) or Concurrent (C), for Read (R) and Write (W):

- **EREW — Exclusive Read, Exclusive Write.** The strictest. In any single step, **no two processors may touch the same cell** — not even to read it. If two processors both need a value, the algorithm must be designed so they don't ask for it in the same step (e.g. by first copying it to many cells over several steps). This is the most realistic and the hardest to program for, because real hardware genuinely struggles with simultaneous access.

- **CREW — Concurrent Read, Exclusive Write.** The middle ground, and the most commonly used in theory. **Many processors may read the same cell at the same step** (concurrent read is fine — reading doesn't change anything), but **no two may write the same cell** in the same step. This matches a comfortable intuition: everyone can look at a shared value at once, but only one writer at a time.

- **CRCW — Concurrent Read, Concurrent Write.** The most permissive. Processors may both read *and write* the same cell at the same step. But this raises an obvious problem: if two processors write *different* values to the same cell in the same instant, what ends up there? CRCW needs a **tie-breaking rule** to even be well-defined. Common ones: **Common** (all writers must write the *same* value or it's an error), **Arbitrary** (some unspecified writer wins, you can't predict which), **Priority** (the lowest-numbered processor wins). The rule is part of the model.

```
            Concurrent READ?     Concurrent WRITE?
  EREW          NO                    NO            (strictest, most realistic)
  CREW          YES                   NO            (the common theoretical default)
  CRCW          YES                   YES + a tie-break rule  (most powerful)
```

Why do we bother with three variants instead of just picking one? Because they differ in **power**: some problems can be solved in fewer steps on a CRCW PRAM than on an EREW PRAM. Concurrent writes, in particular, let you do things like "compute the OR of `n` bits in a single step" (every processor with a 1 writes 1 to the same cell) that take `Θ(log n)` steps without them. So the variant you assume changes what's achievable — which is why a careful parallel result always states *which* PRAM it's for.

> **Just the intuition for now.** At this junior level, you only need three things: (1) the hard part of parallelism is *memory conflicts* — what happens when processors touch the same cell at once; (2) the variants are ordered EREW (weakest) → CREW → CRCW (strongest) by how much sharing they permit; and (3) more permissive models can be faster but are further from real hardware. The full hierarchy — exactly which problems separate the variants, and how to *simulate* a stronger PRAM on a weaker one with only a `log` slowdown — lives in [the middle-level treatment](./middle.md).

The PRAM gives us a crisp picture and the essential vocabulary of conflicts. But in practice, almost nobody designs algorithms by counting PRAM steps and worrying about EREW-vs-CRCW. There's a cleaner, more portable model that has become the standard — and it's the one you'll use for the rest of your life as a programmer.

---

## The Modern Model: Work and Span

The work–span model (also called **work–depth**) drops the lockstep, fixed-`P`, shared-memory picture and replaces it with something more abstract and more useful: it describes a computation as a **graph of tasks with dependencies**, and then reads off two numbers from that graph.

Forget how many processors you have for a moment. Just look at the *computation itself* and ask two questions:

1. **How much total work is there?** Count every operation the computation performs, ignoring parallelism entirely — as if one processor did all of them, one after another. This number is the **work**, written **`T₁`** (the "1" means *one processor*). It's exactly the sequential running time — the Big-O you already know how to compute.

2. **What's the longest chain of things that *must* happen in order?** Some operations depend on others: you can't add two partial sums until both partial sums exist. Find the *longest* such chain of dependencies — the longest sequence of operations where each one waits for the previous. Its length is the **span**, written **`T∞`** (the "∞" means *infinitely many processors*). Even with unlimited processors, you can't go faster than this chain, because its links *must* happen one after another.

That's the whole model. Two numbers:

```
WORK   T₁  = total number of operations          = time on ONE processor
SPAN   T∞  = length of the longest dependency chain = time on INFINITELY MANY processors
```

Why are these the two numbers that matter? Because they're the two extremes that bracket reality:

- **`T₁` (work) is the worst case for time** — one processor, no parallelism, everything sequential. You can never need *more* time than this (a sane parallel algorithm never does more total work than just running it sequentially... at least not by much).
- **`T∞` (span) is the best case for time** — unlimited processors, so the *only* thing that can slow you down is genuine dependencies. You can never go *faster* than the longest must-happen-in-order chain, no matter how many processors you throw at it. The span is the hard floor.

Your actual running time on `P` processors, `T_P`, lives somewhere between these. And — this is the beautiful part — knowing just these two numbers lets you *predict* `T_P` and decide whether buying more processors will even help. We'll make that precise with the Brent bound shortly. First, let's make the "graph of tasks" concrete, because it's the picture that makes work and span intuitive.

---

## The Computation DAG: A Recipe With Dependencies

The cleanest way to picture work and span is a **DAG** — a Directed Acyclic Graph. Each *node* is a task (an O(1) operation); each *directed edge* `a → b` means "task `b` cannot start until task `a` has finished." It's a **D**irected graph (edges have a direction: dependency points forward in time) that is **A**cyclic (no cycles — nothing can depend on itself, directly or in a loop, or time would have to run backward).

The perfect everyday analogy is **a cooking recipe**. Imagine making pasta:

```
  boil water ──────► cook pasta ──┐
                                  ├──► combine ──► serve
  chop garlic ──► make sauce ─────┘
```

Reading this DAG:

- **Some steps must happen in order.** You can't cook the pasta until the water boils (`boil water → cook pasta`). You can't make the sauce until you've chopped the garlic. You can't combine until *both* the pasta is cooked *and* the sauce is made. These are the **edges** — the dependencies.
- **Some steps can happen at the same time.** "Boil water" and "chop garlic" depend on nothing and on each other not at all — so if you have two cooks, one can boil water while the other chops garlic. They're *independent*. Parallelism lives exactly here: in the parts of the graph with no dependency between them.

Now read the two key numbers off this recipe:

- **Work `T₁`** = total number of tasks = how long it takes if **one cook** does everything alone, one task at a time. Count the nodes: boil, cook, chop, sauce, combine, serve = **6 tasks**. One cook needs 6 time-units.
- **Span `T∞`** = the **longest chain of must-happen-in-order tasks** = how long it takes with **infinitely many cooks**, because even an army of cooks is bottlenecked by the longest dependency chain. Trace the longest path from start to finish: `boil water → cook pasta → combine → serve` is 4 tasks; `chop garlic → make sauce → combine → serve` is also 4 tasks. So the longest chain — the **critical path** — has length **4**. Even with 100 cooks, you need 4 time-units, because nothing can collapse that chain: combining waits for cooking, which waits for boiling.

So this recipe has work 6 and span 4. With one cook: 6 units. With unlimited cooks: 4 units. The most a horde of cooks can save you is the difference between 6 and 4 — and the chain `boil → cook → combine → serve` is the immovable bottleneck.

> **The critical path is everything.** The span is the length of the *longest path* through the DAG — the "critical path." It's the single most important quantity in parallel algorithm design, because **it's the wall you can't get past.** No amount of hardware shortens it. When someone says "we parallelized it but it's still slow," nine times out of ten the answer is "your critical path is long" — there's a chain of dependencies that no number of processors can break. Designing a *good* parallel algorithm is, more than anything, the art of making the span (the critical path) short.

This DAG view is exactly why work–span beats the PRAM in practice: you never have to commit to a processor count or a memory-conflict rule. You just describe the dependency structure of your computation — which the algorithm itself determines — and the two numbers fall out. The model is *portable*: the same `T₁` and `T∞` predict behavior on 4 cores, 64 cores, or a GPU.

---

## Parallelism = Work / Span

Work and span individually are useful, but their *ratio* is the single number that captures "how parallel is this algorithm?":

```
PARALLELISM  =  T₁ / T∞  =  work / span
```

Read it as: **the average amount of work available to do at each step of the critical path.** If there are `T₁` total operations and the critical path has length `T∞`, then on average there are `T₁ / T∞` operations that could be running simultaneously at any moment along that path. That's how many processors you can keep busy — and therefore the **maximum useful speedup**.

The intuition with the pasta recipe: work 6, span 4, parallelism `6/4 = 1.5`. That tiny number says "this computation can keep about 1.5 cooks busy on average." A second cook helps a little (one boils while the other chops), but a third cook would mostly stand around — there just isn't enough independent work. The parallelism `1.5` quantifies that exactly: **beyond ~1.5 processors, you get diminishing returns**, because you'll have processors idling, waiting on the critical path.

This is the number that tells you when to stop buying processors:

```
If your parallelism is T₁/T∞ = 1000, then:
   - up to ~1000 processors can stay busy → near-linear speedup
   - beyond ~1000 processors, extra ones mostly idle (the span is the wall)

If your parallelism is T₁/T∞ = 1.5, then:
   - even 2 processors barely help; this algorithm is essentially serial
```

A *good* parallel algorithm has **high parallelism** — work that vastly exceeds the span, so there's tons of independent work to spread across many processors. As we're about to see, summing `n` numbers has parallelism `Θ(n / log n)` — for a million numbers, that's about 50,000, meaning you could keep tens of thousands of processors busy. That's a great parallel algorithm. A computation that's just a long chain of dependent steps (span ≈ work) has parallelism ≈ 1 — it's hopelessly serial, and no parallel hardware will save it.

> **The mental shorthand:** *work* tells you the total cost, *span* tells you the unavoidable minimum time, and *parallelism = work/span* tells you how many processors are worth having. Compute these three numbers for any parallel algorithm and you know its whole story before running it. Keep span small and work reasonable, and parallelism — your speedup ceiling — soars.

---

## Worked Example: Summing n Numbers

Time to make all of this concrete with the canonical example of the entire field: **summing `n` numbers.** It's simple enough to fully understand, yet it shows the whole framework — and the contrast between the serial and parallel versions is the single most illuminating picture in parallel computing.

### The serial way: a long chain (span n)

Here's how you'd sum an array sequentially — the loop you've written a hundred times:

```
sum = 0
sum = sum + A[0]    ← must finish before...
sum = sum + A[1]    ← ...this, which must finish before...
sum = sum + A[2]    ← ...this, ...
...
sum = sum + A[n-1]
```

Look at the dependency structure. Each addition reads `sum` and writes a new `sum`, so **every step depends on the one before it.** The DAG is a single straight line of `n` nodes — a chain with no branching at all:

```
A[0] → A[1] → A[2] → A[3] → ... → A[n-1]      (each + waits for the previous +)
```

- **Work** `T₁ = Θ(n)` — there are `n` additions. Correct and unavoidable: you must add every number.
- **Span** `T∞ = Θ(n)` — the critical path *is* the whole chain. Every addition waits for its predecessor.
- **Parallelism** `T₁/T∞ = Θ(n)/Θ(n) = Θ(1)` — **about 1.** This algorithm has *no parallelism*. A thousand processors can't help, because there's a chain of `n` dependent additions and you can't break it. The serial loop is the worst possible structure for parallelism: maximum span.

The problem isn't the work — `n` additions is exactly right. The problem is the **shape**: by funneling everything through one running `sum`, we created a dependency chain of length `n`. To parallelize, we must *change the shape* so the additions don't all depend on each other.

### The parallel way: a reduction tree (span log n)

Here's the key insight: **addition is associative**, so we don't have to add the numbers left-to-right. We can pair them up and add the pairs *simultaneously*, then pair up the results, and so on — a balanced binary tree of additions. This is called a **reduction tree** (or just a *reduction*). Picture summing 8 numbers:

```
LEVEL 0:   A   B   C   D   E   F   G   H        8 numbers
            \ /     \ /     \ /     \ /
LEVEL 1:    A+B     C+D     E+F     G+H          4 sums, all done AT ONCE
              \      /         \      /
LEVEL 2:    A+B+C+D         E+F+G+H              2 sums, both done AT ONCE
                  \            /
LEVEL 3:        A+B+C+D+E+F+G+H                  1 final sum
```

Read this DAG carefully — it's the whole lesson:

- At **level 1**, the four additions `A+B`, `C+D`, `E+F`, `G+H` are completely independent of each other (none reads what another writes). So with 4 processors, **all four happen in a single step.**
- At **level 2**, the two additions each need two level-1 results, but those exist now, and the two additions are independent of each other — so **both happen in one step.**
- At **level 3**, one final addition.

Now count the two numbers:

- **Work** `T₁ = Θ(n)` — still `n−1` additions total (4 + 2 + 1 = 7 for n=8, which is n−1). **Same work as the serial loop** — we didn't do any *extra* additions, we just rearranged *when* they happen. This matters: a good parallel algorithm is **work-efficient**, meaning it does the same total work as the best serial one.
- **Span** `T∞ = Θ(log n)` — the critical path runs from a leaf to the root: `A → A+B → A+B+C+D → A+B+C+D+E+F+G+H`, which is the *height of the tree*. A balanced binary tree over `n` leaves has height `log₂ n`. For n=8 that's 3 levels; for n=1,000,000 it's about 20. **That's the magic: we collapsed a chain of length `n` into a chain of length `log n`.**
- **Parallelism** `T₁/T∞ = Θ(n) / Θ(log n) = Θ(n / log n)` — **enormous.** For a million numbers: about `1,000,000 / 20 = 50,000`. You could keep fifty thousand processors busy summing a million numbers.

### The two side by side

```
                    Work T₁     Span T∞     Parallelism T₁/T∞
  serial loop       Θ(n)        Θ(n)        Θ(1)         ← no parallelism
  reduction tree    Θ(n)        Θ(log n)    Θ(n/log n)   ← massively parallel

  Same work. The ONLY difference is span: n  vs  log n.
```

This is the entire art of parallel algorithms in one example. Both versions do the same `n` additions — identical work. But the serial version chains them into a span of `n`, while the reduction tree arranges them into a span of `log n`. **Lowering the span is what creates parallelism**, and you lower it by finding independent work — here, by exploiting associativity to add in a tree instead of a line. This same reduction-tree trick powers parallel sum, max, min, count, and any associative combine; it's developed in depth in [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md), and the closely related "running totals" version is the [Parallel Prefix Sum / Scan](../02-parallel-prefix-sum-scan/junior.md).

> **Remember this example above all others.** "Sum: work `n`, span `log n`, parallelism `n/log n`" is the parallel-computing equivalent of "binary search is `log n`." It's the template — turn a left-to-right fold into a balanced tree and the span collapses from linear to logarithmic. Most fast parallel algorithms are, at heart, a clever way to keep the span polylogarithmic while keeping the work close to the best serial algorithm.

---

## Speedup and the Brent Bound

We have work `T₁` and span `T∞`. The question we actually care about is: **with `P` real processors, how long does it run?** Call that time `T_P`. Two definitions first:

```
SPEEDUP on P processors  =  T₁ / T_P     (how many times faster than one processor)
IDEAL (linear) speedup   =  P            (P processors → P times faster, the dream)
```

Speedup is what you measure and brag about. Speedup of `P` — "linear speedup" — means your `P` processors gave you exactly `P×` the throughput, with zero overhead. It's the best you can hope for, and you rarely hit it exactly. The natural question is: *given `T₁` and `T∞`, what speedup can I count on?* The answer is one of the most useful results in the field.

### The Brent bound (greedy scheduling)

For any computation with work `T₁` and span `T∞`, run on `P` processors by a reasonable ("greedy") scheduler — one that never lets a processor sit idle if there's work it could do — the running time `T_P` satisfies:

```
        ┌─────────────────────────────────────────────────┐
        │   max(T₁/P,  T∞)   ≤   T_P   ≤   T₁/P  +  T∞     │
        └─────────────────────────────────────────────────┘
```

This little inequality is packed with meaning. Take it apart:

**The lower bound, `T_P ≥ max(T₁/P, T∞)`** — you can't beat *either* of two walls:

- `T_P ≥ T₁/P`: with `P` processors doing at most `P` operations per step, finishing `T₁` total operations takes at least `T₁/P` steps. This is the **work wall** — you can't divide work among fewer "slots" than you have. (This is also the ideal: if you hit `T_P = T₁/P` exactly, you got perfect linear speedup.)
- `T_P ≥ T∞`: you can never beat the span, because the critical path's links *must* run in sequence. This is the **span wall** — the dependency floor we keep emphasizing.

So your time is at least the *larger* of "work spread perfectly across P processors" and "the unavoidable critical path."

**The upper bound, `T_P ≤ T₁/P + T∞`** — and this is the genuinely good news. A greedy scheduler *guarantees* you finish within `T₁/P + T∞`. It says: your time is at most "the work spread across P processors" *plus* "one critical path's worth of overhead." When `T₁/P` dominates (i.e. `P` is much less than the parallelism `T₁/T∞`), the `+ T∞` is a small additive term and you get **near-linear speedup**. The bound is the promise that a decent scheduler won't waste your processors.

### What it tells you: speedup until P hits the parallelism

Here's the punchline that ties everything together. Compare `P` to the **parallelism** `T₁/T∞`:

- **When `P ≤ T₁/T∞` (you have fewer processors than the parallelism):** `T₁/P ≥ T∞`, so the `T₁/P` term dominates and `T_P ≈ T₁/P`. You get **near-linear speedup** — roughly `P×` faster. The span overhead is negligible. Adding processors keeps helping.
- **When `P ≫ T₁/T∞` (you have far more processors than the parallelism):** the span `T∞` dominates and `T_P ≈ T∞`. Extra processors **stop helping** — you've hit the span wall, and the added cores just idle. Speedup plateaus at the parallelism `T₁/T∞`.

**So the parallelism `T₁/T∞` is precisely the threshold where speedup stops scaling.** Buy processors up to the parallelism and each one pays off; buy past it and you're wasting money. This is why parallelism — that ratio we computed earlier — is *the* number that matters.

### A worked number

Take the sum of `n = 1,000,000` numbers via the reduction tree: `T₁ ≈ 1,000,000` (work) and `T∞ ≈ 20` (span, since `log₂ 10⁶ ≈ 20`). Parallelism `≈ 50,000`. Now plug into Brent:

```
On P = 100 processors:
   lower bound: max(T₁/P, T∞)   = max(1,000,000/100, 20) = max(10,000, 20) = 10,000
   upper bound: T₁/P + T∞       = 10,000 + 20            = 10,020
   ⇒ T_P is between 10,000 and 10,020 — essentially T₁/P.
   Speedup = T₁/T_P ≈ 1,000,000 / 10,010 ≈ 99.9×   ← near-perfect (ideal was 100×)

On P = 1,000,000 processors (way past the parallelism of 50,000):
   lower bound: max(1, 20) = 20
   ⇒ T_P ≈ 20, no faster than the span.
   Speedup = 1,000,000 / 20 = 50,000×   ← plateaued at the parallelism, NOT 1,000,000×
```

With 100 processors (far below the parallelism of 50,000), you get essentially perfect 100× speedup — the `+20` span term is nothing next to 10,000. With a million processors (far *above* the parallelism), you're stuck at the span of 20, and speedup caps at 50,000× no matter how many more cores you add. The Brent bound predicted both outcomes from just `T₁` and `T∞`. *That's* the power of the model: it told you exactly how many processors are worth buying before you wrote any code.

> **The one-sentence version of Brent:** `T_P ≈ T₁/P + T∞` means you get linear speedup until `P` approaches the parallelism `T₁/T∞`, then you flatline at the span. This same scheduling guarantee is what makes real fork-join runtimes (like the work-stealing schedulers in [Fork-Join and Work-Stealing](../07-fork-join-and-work-stealing/junior.md)) deliver predictable performance.

---

## Amdahl's Law: The Serial Part Caps You

The Brent bound is optimistic — it assumes the *whole* computation can be parallelized down to its span. But many real programs have a chunk that is **inherently serial**: it simply cannot be parallelized, no matter how clever you are. Reading a file from disk one byte stream, initializing some shared state, a phase where each step truly needs the previous one's result — these parts run on one processor while the rest could be spread out. **Amdahl's law** is the sobering result about what that serial chunk does to your speedup, and it's the single most important reality check in parallel computing.

The setup: suppose a fraction **`s`** of the total work is inherently serial (must run sequentially, on one processor), and the remaining **`1 − s`** is perfectly parallelizable. The claim is brutal:

```
                    1
  Speedup(P)  =  ─────────────────         and as P → ∞:    Speedup ≤  1/s
                  s  +  (1−s)/P
```

The intuition is simple arithmetic. Normalize the total serial-time to 1. The serial part always costs `s` (it can't be sped up). The parallel part costs `(1−s)` on one processor, but `(1−s)/P` on `P` processors (it splits perfectly). So total time on `P` processors is `s + (1−s)/P`, and speedup is `1` divided by that. Now push `P` to infinity: the `(1−s)/P` term vanishes, and you're left with time `s` and **speedup `1/s`.** The serial fraction is a hard ceiling.

Let's feel how unforgiving this is. Suppose **only 5% of your work is serial** (`s = 0.05`), which sounds great — 95% parallelizable!

```
   P = 1:     speedup = 1×            (baseline)
   P = 10:    speedup ≈ 6.9×          (not 10× — the serial 5% is already biting)
   P = 100:   speedup ≈ 16.8×         (not 100× — nowhere close)
   P = 1000:  speedup ≈ 19.6×
   P = ∞:     speedup = 1/0.05 = 20×  ← THE WALL. Never faster than 20×, ever.
```

Read that last line again. With 5% of the work serial, **you can never go more than 20× faster, even with infinite processors.** A thousand cores gets you to 19.6×; a million cores gets you to maybe 19.999×. The serial 5% you couldn't parallelize *dominates* once the parallel part has been crushed down to nothing. That's why a "small" serial fraction is so deadly — and why parallel programmers obsess over driving `s` toward zero.

```
   If serial fraction s is...     maximum speedup (1/s), even with infinite processors:
        50%                          2×
        10%                         10×
         5%                         20×
         1%                        100×
         0.1%                     1000×
```

> **The Amdahl reality check.** Before celebrating a parallel speedup, ask: *what fraction of this is inherently serial?* That fraction `s` sets your ceiling at `1/s`, full stop. It's the parallel-computing version of "a chain is only as strong as its weakest link" — here, the serial link caps the whole system's speedup. Notice the deep connection to span: the serial fraction is *part of your critical path*, the part you can't shorten. Amdahl's law and the span wall are two views of the same truth — **dependencies you can't break set a hard floor on time and a hard ceiling on speedup.** (Amdahl assumes a *fixed* problem size; a hopeful counterpoint, Gustafson's law for *growing* problems, appears in [the middle file](./middle.md).)

---

## Code: A Parallel Sum and Measuring Speedup

Enough theory — let's *watch* parallelism happen and measure the speedup. We'll implement the reduction-tree sum (work `n`, span `log n`) by splitting the array into `P` chunks, summing each chunk on its own processor in parallel, then combining the chunk-sums. Then we'll vary `P` and measure how speedup behaves — and watch Amdahl's law and the Brent bound show up in real numbers.

### Go: parallel sum with goroutines

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// parallelSum splits A into `workers` chunks, sums each chunk in its own
// goroutine (in parallel), then adds the partial sums together.
func parallelSum(A []int64, workers int) int64 {
	n := len(A)
	partials := make([]int64, workers) // partials[w] = sum of worker w's chunk
	chunk := (n + workers - 1) / workers

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		lo := w * chunk
		hi := lo + chunk
		if hi > n {
			hi = n
		}
		if lo >= hi {
			continue
		}
		wg.Add(1)
		go func(w, lo, hi int) { // each goroutine = one "processor"
			defer wg.Done()
			var s int64
			for i := lo; i < hi; i++ { // sum this chunk serially
				s += A[i]
			}
			partials[w] = s // write to its OWN cell — no write conflict (EREW-friendly!)
		}(w, lo, hi)
	}
	wg.Wait() // barrier: wait for ALL chunks to finish

	var total int64 // combine step (this small part is serial — hello, Amdahl)
	for _, s := range partials {
		total += s
	}
	return total
}

func serialSum(A []int64) int64 {
	var s int64
	for _, x := range A {
		s += x
	}
	return s
}

func main() {
	const n = 50_000_000
	A := make([]int64, n)
	for i := range A {
		A[i] = int64(i % 7)
	}

	// Baseline: serial time (this is our T_1 in wall-clock).
	start := time.Now()
	want := serialSum(A)
	serialTime := time.Since(start)
	fmt.Printf("serial:           %v  sum=%d\n", serialTime, want)

	// Vary the processor count and measure speedup.
	for _, p := range []int{1, 2, 4, 8, runtime.NumCPU()} {
		start = time.Now()
		got := parallelSum(A, p)
		pt := time.Since(start)
		if got != want {
			panic("wrong sum!")
		}
		fmt.Printf("parallel P=%-2d:    %v  speedup=%.2fx\n",
			p, pt, float64(serialTime)/float64(pt))
	}
}
```

**What it does:** each goroutine is one "processor" summing its own contiguous chunk — and crucially, each writes to its *own* `partials[w]` cell, so there are **no write conflicts** (this is the EREW-friendly design: processors never touch the same memory at once). The `wg.Wait()` is a **barrier** — the parallel phase must fully finish before the serial combine begins, exactly the span structure of a reduction. You'll typically see speedup climb toward the core count for the chunk-summing phase, then plateau — the plateau is the Brent span wall plus the small serial combine (Amdahl's `s`).

### Python: parallel sum with multiprocessing

```python
import time
import os
from multiprocessing import Pool

def chunk_sum(args):
    """One 'processor': sum a slice of the data. Returns its partial sum."""
    data, lo, hi = args
    s = 0
    for i in range(lo, hi):
        s += data[i]
    return s

def parallel_sum(data, workers):
    n = len(data)
    chunk = (n + workers - 1) // workers
    tasks = []
    for w in range(workers):
        lo = w * chunk
        hi = min(lo + chunk, n)
        if lo < hi:
            tasks.append((data, lo, hi))
    with Pool(workers) as pool:
        partials = pool.map(chunk_sum, tasks)  # runs chunks in parallel
    return sum(partials)                        # serial combine (the Amdahl tail)

def serial_sum(data):
    s = 0
    for x in data:
        s += x
    return s

if __name__ == "__main__":
    n = 5_000_000
    data = [i % 7 for i in range(n)]

    start = time.perf_counter()
    want = serial_sum(data)
    serial_time = time.perf_counter() - start
    print(f"serial:        {serial_time:.3f}s  sum={want}")

    for p in [1, 2, 4, os.cpu_count()]:
        start = time.perf_counter()
        got = parallel_sum(data, p)
        pt = time.perf_counter() - start
        assert got == want
        print(f"parallel P={p:<2}: {pt:.3f}s  speedup={serial_time / pt:.2f}x")
```

> **What you'll observe (and why):** speedup rises with `P` but rarely reaches the ideal `P×`. Three culprits, all of which the models predicted. **(1) The Brent `+ T∞` term** — the serial combine step is part of the span and never parallelizes. **(2) Amdahl's law** — that combine, plus setup, is your serial fraction `s`, capping speedup at `1/s`. **(3) Real overhead the models idealize away** — in Python, launching processes and *copying the data to each one* is expensive (it can even make small inputs slower!), which is why the input must be large to see a win. That last point is the practical reminder that the PRAM/work–span models are *idealizations*: they ignore coordination cost, just as the RAM model ignores caches. The models tell you the *ceiling*; real overhead tells you how close you get.

---

## Code: Computing Work and Span of a DAG

The wall-clock demo shows speedup as an *effect*; this one shows the *model directly*. We'll represent a computation as a DAG and compute its **work** (count the nodes) and **span** (the longest path) — exactly the two numbers the work–span model is built on. Then parallelism falls right out as their ratio.

### Python: work and span of a task DAG

```python
def work_and_span(dag, cost):
    """
    dag:  {task: [list of tasks that depend on this task]}  (edges point forward)
    cost: {task: O(1) cost of running that task}  (use 1 for a uniform DAG)
    Returns (work, span):
       work = total cost of all tasks      (= time on ONE processor)
       span = cost of the longest path     (= time on INFINITE processors)
    """
    work = sum(cost[t] for t in dag)        # WORK: just add up every task's cost

    # SPAN = longest-weighted-path. Memoize the longest path STARTING at each task.
    memo = {}
    def longest_from(t):
        if t in memo:
            return memo[t]
        # this task's own cost, plus the worst (longest) path through any successor
        best_successor = 0
        for nxt in dag[t]:
            best_successor = max(best_successor, longest_from(nxt))
        memo[t] = cost[t] + best_successor
        return memo[t]

    span = max(longest_from(t) for t in dag)  # longest path over all start points
    return work, span


# --- The pasta recipe DAG from earlier ---
recipe = {
    "boil_water": ["cook_pasta"],
    "cook_pasta": ["combine"],
    "chop_garlic": ["make_sauce"],
    "make_sauce": ["combine"],
    "combine": ["serve"],
    "serve": [],
}
cost = {t: 1 for t in recipe}   # every step costs 1 time-unit

work, span = work_and_span(recipe, cost)
print(f"recipe:  work={work}  span={span}  parallelism={work/span:.2f}")
# → work=6  span=4  parallelism=1.50   (matches our hand analysis!)


# --- A reduction tree summing 8 numbers (work n, span log n) ---
def reduction_tree(n):
    """Build the DAG of a balanced reduction tree over n leaves."""
    dag, cost = {}, {}
    nodes = [f"leaf{i}" for i in range(n)]
    for leaf in nodes:
        dag[leaf], cost[leaf] = [], 1
    level, nxt_id = nodes, 0
    while len(level) > 1:           # pair up and add, level by level
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 < len(level):
                node = f"add{nxt_id}"; nxt_id += 1
                dag[node], cost[node] = [], 1
                dag[level[i]].append(node)     # both children feed this add...
                dag[level[i + 1]].append(node) # ...so it waits for both
                nxt.append(node)
            else:
                nxt.append(level[i])           # odd one out carries up
        level = nxt
    return dag, cost

dag8, cost8 = reduction_tree(8)
work, span = work_and_span(dag8, cost8)
print(f"sum-tree n=8:  work={work}  span={span}  parallelism={work/span:.2f}")
# → work=15  span=4  (8 leaves + 7 adds = 15 nodes; tree height incl. leaves = 4)
```

Running this prints something like:

```
recipe:  work=6  span=4  parallelism=1.50
sum-tree n=8:  work=15  span=4  parallelism=3.75
```

The numbers fall straight out of the model. For the recipe, work=6 (six tasks) and span=4 (the critical path `boil → cook → combine → serve`) — exactly what we found by hand, and parallelism 1.5 confirms "a second cook helps a little, a third barely." For the 8-leaf reduction tree, the span is the tree height (counting the leaf level, 4) — meaning even with unlimited processors you need 4 steps, while one processor needs 15. Scale `reduction_tree` up to `n = 1024` and you'll see span ≈ 11 (≈ log₂ 1024) against work ≈ 2047 — parallelism ≈ 186 — making the `n/log n` parallelism of summing visible as a number you computed yourself.

> **This little function *is* the model.** `work` is a sum over nodes; `span` is the longest weighted path. Every parallel algorithm in this section can be analyzed by asking "what does its DAG look like, and what are the work and span?" Once you can read those two numbers off a computation's dependency structure, you can predict its speedup with the Brent bound — without owning a single extra processor.

---

## Common Misconceptions

- **"`P` processors always means `P×` faster."** Almost never exactly. The Brent bound says `T_P ≈ T₁/P + T∞`, so the span `T∞` always adds overhead, and you only get near-linear speedup while `P` is below the parallelism `T₁/T∞`. Amdahl's law caps you further at `1/s` if a fraction `s` is serial. "8 cores → 8× faster" is the *dream*, not the rule.

- **"Parallelizing means doing less work."** No — a good parallel algorithm does the *same* total work as the serial one (it's *work-efficient*); it just rearranges *when* operations happen to shorten the span. The reduction-tree sum does the same `n−1` additions as the serial loop; only the span changed (from `n` to `log n`). Sometimes parallel algorithms do *more* total work, which is a real cost to watch.

- **"Span and work are the same thing."** They're different and both matter. Work is *total operations* (sum of all nodes); span is the *longest dependency chain* (longest path). The serial loop has work=span=`n`; the reduction tree has work=`n` but span=`log n`. The gap between them — parallelism — is the whole point.

- **"The PRAM is how real parallel computers work."** No — it's an idealization, like the RAM model. Real machines don't run in perfect lockstep, shared memory isn't uniformly fast, and coordination has real cost. The PRAM (and work–span) deliberately ignore these to expose the *essential* structure. They give you the ceiling; reality has overhead.

- **"A small serial fraction barely matters."** Amdahl's law says the opposite: 5% serial caps you at 20×, 1% serial caps you at 100× — *even with infinite processors*. The serial part dominates once the parallel part is crushed small. A "tiny" serial fraction is the most important number to attack.

- **"CRCW is just a more convenient EREW."** They differ in *power*: some problems are genuinely faster on a CRCW PRAM (concurrent writes can compute an OR of `n` bits in one step). The variant you assume changes what's achievable, which is why results state their PRAM model. (Details in [middle](./middle.md).)

---

## Common Mistakes

- **Reporting speedup without a serial baseline.** Speedup is `T₁/T_P` — you *must* time a real, single-processor run as `T₁`. Comparing "P=8" to "P=1 of the parallel code" hides the overhead the parallel version pays even on one processor. Always baseline against the best *serial* algorithm.

- **Ignoring the critical path (span) and only counting work.** If your algorithm has work `n` but span `n` (a dependency chain), it won't parallelize — and counting only the `n` work won't reveal that. Always ask "what's the longest dependency chain?" The span, not the work, is what limits speedup.

- **Forgetting that overhead is real.** The models idealize coordination to zero, but launching threads, copying data, and synchronizing cost real time. For small inputs this overhead can make the parallel version *slower* than serial. Parallelize only when the work per processor dwarfs the coordination cost.

- **Creating accidental serial bottlenecks (write conflicts).** If many processors update one shared accumulator, they serialize on that cell (and may race). The fix is the reduction pattern: each processor writes its *own* partial, then combine — exactly what the code does with `partials[w]`. Shared mutable state is where parallel speedup goes to die.

- **Confusing span with "the parallel running time."** Span `T∞` is the time on *infinitely many* processors — the ideal floor, not what you'll actually get on 8 cores. Your real time is `T_P`, bounded by Brent between `max(T₁/P, T∞)` and `T₁/P + T∞`. Span is one ingredient, not the answer.

- **Assuming more processors always help.** Past the parallelism `T₁/T∞`, extra processors idle (Brent) and you flatline at the span. And Amdahl caps you at `1/s` regardless. Buying processors beyond the parallelism is wasted money — compute the parallelism first to know when to stop.

---

## Cheat Sheet

```
WHY A MODEL: to predict "how much faster with P processors?" you need a cost model,
  just like the RAM model for sequential and the I/O model for memory movement.

THE PRAM (Parallel Random Access Machine)
  P processors share ONE memory, run in synchronous lockstep, each step = O(1)/proc.
  Variants by memory-conflict rule (weakest → strongest):
    EREW  exclusive read, exclusive write   (no two procs touch same cell — realistic)
    CREW  concurrent read, exclusive write  (read together, write alone — the default)
    CRCW  concurrent read AND write         (needs a tie-break rule — most powerful)

THE WORK–SPAN MODEL (the one you'll use) — model the computation as a DAG of tasks
  WORK  T₁  = total # of operations          = time on ONE processor
  SPAN  T∞  = longest dependency chain        = time on INFINITE processors
              (the "critical path" — the wall no hardware can break)
  PARALLELISM = T₁ / T∞ = max useful speedup = # of processors worth buying

THE BRENT BOUND (greedy scheduling)
  max(T₁/P, T∞)  ≤  T_P  ≤  T₁/P + T∞
  ⇒ near-linear speedup until P ≈ T₁/T∞, then you flatline at the span T∞.

SPEEDUP = T₁ / T_P     (ideal = P, "linear speedup")

AMDAHL'S LAW: if fraction s of the work is inherently serial,
  speedup ≤ 1/s, no matter how many processors.
    s=5% → ≤20×    s=1% → ≤100×    s=0.1% → ≤1000×

THE CANONICAL EXAMPLE — summing n numbers:
  serial loop:    work n,  span n,      parallelism Θ(1)        ← no parallelism
  reduction tree: work n,  span log n,  parallelism Θ(n/log n)  ← massively parallel
  SAME work; the only change is span (n → log n). Lowering span = creating parallelism.

THE ONE BIG IDEA
  Keep the SPAN small (find independent work, build trees not chains) while keeping
  WORK close to the best serial algorithm. High work/span = high speedup ceiling.
```

---

## Summary

To answer "how much faster does this get with `P` processors?" you need a **cost model** — the parallel counterpart of the RAM model that underlies all your sequential Big-O. This file built two.

- **The PRAM** (Parallel Random Access Machine) is the clean idealization: `P` processors sharing one memory, running in **synchronous lockstep**, each step O(1) per processor. Its lasting contribution is forcing us to confront *memory conflicts* — what happens when processors touch the same cell at once — via the variants **EREW** (no sharing, most realistic), **CREW** (read together, write alone — the common default), and **CRCW** (read and write together, needs a tie-break rule, most powerful). More permissive variants can be faster but are further from real hardware.

- **The work–span model** (work–depth) is the practical one. Model the computation as a **DAG of tasks with dependencies**, then read off two numbers: **work `T₁`** (total operations = time on one processor) and **span `T∞`** (the longest dependency chain, the *critical path* = time on infinitely many processors). The span is the wall no amount of hardware can break — making it short is the heart of parallel algorithm design. A cooking recipe is the perfect mental model: total tasks = work, longest must-happen-in-order chain = span.

- **Parallelism = `T₁/T∞`** is the single most important number: the maximum useful speedup, the count of processors worth buying. High parallelism (work ≫ span) means a great parallel algorithm; parallelism ≈ 1 means it's hopelessly serial.

- **The Brent bound** `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞` predicts your real running time from just `T₁` and `T∞`: you get **near-linear speedup until `P` approaches the parallelism `T₁/T∞`**, then you flatline at the span. Speedup is `T₁/T_P`, with the ideal being `P`.

- **Amdahl's law** is the reality check: if a fraction `s` of the work is inherently serial, speedup is capped at `1/s` *no matter how many processors* — 5% serial means never more than 20×. The serial part is part of your critical path; you can't outrun it.

- **The canonical example, summing `n` numbers,** shows it all: the serial loop has work `n` and span `n` (parallelism 1 — useless in parallel), while the **reduction tree** does the *same* `n` additions but arranges them in a balanced tree, span `log n`, parallelism `n/log n` — massively parallel. Same work; only the span changed. **Lowering span is how you create parallelism.**

The big idea to carry forward: parallel speed is governed by *two* numbers, not one. Work tells you the total cost; span tells you the unavoidable minimum time; and their ratio, parallelism, tells you how many processors will actually pay off. Design for **small span and reasonable work**, and the speedup follows.

**Next steps:** [the middle-level treatment](./middle.md) develops the PRAM hierarchy (which problems separate the variants, and simulating a stronger PRAM on a weaker one), proves the Brent bound, and introduces Gustafson's law as the hopeful counterpoint to Amdahl. Then [Parallel Prefix Sum / Scan](../02-parallel-prefix-sum-scan/junior.md) takes the reduction idea further into "running totals" in `log n` span; [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md) generalizes the reduction tree to any associative combine; and [Fork-Join and Work-Stealing](../07-fork-join-and-work-stealing/junior.md) shows how real runtimes schedule a DAG onto `P` processors to deliver the Brent guarantee in practice.

---

## Further Reading

- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Multithreaded Algorithms" chapter** — the standard, accessible treatment of the work–span (work–depth) model, the DAG view, and the Brent bound. The best next read after this file.
- **Blelloch, *Programming Parallel Algorithms* / "Prefix Sums and Their Applications"** — the work–depth model in its natural habitat, with the reduction and scan primitives developed in full.
- **JaJa, *An Introduction to Parallel Algorithms*** — the classic PRAM textbook; the place to study the EREW/CREW/CRCW hierarchy rigorously.
- **Amdahl (1967), "Validity of the single processor approach…"** — the original two-page paper that gave us Amdahl's law. Short and worth reading for its bluntness.
- **Brent (1974), "The parallel evaluation of general arithmetic expressions"** — the source of the scheduling bound that bears his name.
- **[Parallel Prefix Sum / Scan](../02-parallel-prefix-sum-scan/junior.md)**, **[Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)**, and **[Fork-Join and Work-Stealing](../07-fork-join-and-work-stealing/junior.md)** — the rest of this section, where the work–span model is put to work.
- **[The I/O Model](../../24-external-memory-and-cache-aware/01-the-io-model/junior.md)** — the sibling "you need the right cost model" story for data movement; great companion intuition.
- **[Models of Parallel Computation — Middle](./middle.md)** — the PRAM hierarchy, simulation results, a proof of the Brent bound, and Gustafson's law.
