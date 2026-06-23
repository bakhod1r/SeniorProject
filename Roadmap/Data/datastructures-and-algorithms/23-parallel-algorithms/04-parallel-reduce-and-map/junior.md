# Parallel Reduce and Map — Junior Level

> **Audience:** You know work and span (the two-number cost model from the first topic in this section) and you've seen the reduction tree that sums `n` numbers in `Θ(log n)` span. Now you'll meet the two primitives that *generalize* that picture — **map** (do something to every element) and **reduce** (combine everything into one) — and the **map-reduce** pattern that chains them.
> **Read time:** ~40 minutes. **Focus:** "What are the two most basic parallel building blocks, why is one of them trivially parallel and the other a tree, and how does combining them express a huge fraction of all data-parallel work?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Map: Do Every Element at Once](#map-do-every-element-at-once)
5. [Why Map Is Embarrassingly Parallel](#why-map-is-embarrassingly-parallel)
6. [Reduce: Combine Everything Into One](#reduce-combine-everything-into-one)
7. [The Naive Fold Is a Chain](#the-naive-fold-is-a-chain)
8. [The Reduction Tree, Drawn on 8 Elements](#the-reduction-tree-drawn-on-8-elements)
9. [Why Associativity Lets You Regroup](#why-associativity-lets-you-regroup)
10. [Counting Work and Span of the Tree](#counting-work-and-span-of-the-tree)
11. [The Map-Reduce Pattern](#the-map-reduce-pattern)
12. [Worked Example: Dot Product Is Map-Then-Reduce](#worked-example-dot-product-is-map-then-reduce)
13. [Code: Parallel Map](#code-parallel-map)
14. [Code: Tree Reduce](#code-tree-reduce)
15. [Code: Dot Product as Map + Reduce](#code-dot-product-as-map--reduce)
16. [Common Misconceptions](#common-misconceptions)
17. [Common Mistakes](#common-mistakes)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction

Almost every parallel program you will ever write is built from two operations, and you already half-know both of them from ordinary sequential code. The first is **map**: take a collection and apply some function `f` to every element, independently, producing a new collection. Square every number. Parse every line of a log file. Brighten every pixel in an image. Convert every temperature from Celsius to Fahrenheit. The second is **reduce** (also called **fold**): take a collection and *combine* all of its elements with some operator `⊕` into a single result. Sum them. Find the maximum. Count how many pass a test. AND all the booleans together.

These two primitives — **map** and **reduce** — are the bedrock of data-parallel computing. They are so fundamental that an entire generation of distributed-computing infrastructure (Google's MapReduce, then Hadoop, then Spark) was named after them, and so universal that once you learn to *see* them, you start noticing them inside almost every batch computation you encounter. This file is about understanding both operations from the parallel point of view: *how parallel is each one, and why?*

The answer for **map** is wonderful and simple: it is **embarrassingly parallel.** Because `f` is applied to each element *independently* — `f(a[3])` doesn't need to know anything about `f(a[2])` — all `n` applications can happen at the same instant. There are no dependencies between them at all. In the work–span language from [the first topic](../01-models-pram-work-span/junior.md), map has **work `Θ(n)`** (you must touch every element) but **span `Θ(1)`** (with enough processors, every element is processed in a single step). The DAG is just `n` independent dots — no edges. Map is the purest, easiest form of parallelism there is.

The answer for **reduce** is the more interesting story, and it's the same story you met when summing `n` numbers. The *naive* way to reduce is a left-to-right fold — `(((a₀ ⊕ a₁) ⊕ a₂) ⊕ a₃) ⊕ …` — which threads everything through one accumulator and creates a dependency chain of length `n`: **span `Θ(n)`, no parallelism.** But if `⊕` is **associative**, you're allowed to *regroup* the combinations into a balanced **reduction tree** — pair up neighbors and combine in parallel, then pair up the results, and so on. That collapses the span to **`Θ(log n)`** while keeping the work at **`Θ(n)`**. Sum, max, min, count, AND, OR — all of them reduce in `log n` span, all for the same reason: their operators are associative.

Put them together and you get the **map-reduce pattern**: *transform every element independently, then combine the results associatively.* `dot product = (multiply pairs) then (sum)`. `count-of-evens = (flag each as 0/1) then (sum)`. `does-any-pass = (test each) then (OR)`. This "map then reduce" shape — embarrassingly-parallel transform feeding a log-depth tree — is the backbone of data-parallel programming, and it's the inspiration behind the [MapReduce framework](../06-map-reduce-patterns/junior.md) that scaled this exact idea across thousands of machines.

This file builds the whole picture from the ground up. We'll see map as "do all elements at once" and *why* independence makes it span-`1`; meet reduce, contrast the sequential chain against the tournament-style reduction tree drawn on 8 elements, and pin down exactly why associativity grants the right to regroup; count work and span for both; assemble the map-reduce pattern and work a **dot product** end to end as the canonical "map then reduce." You'll get runnable code for a parallel map (goroutines / multiprocessing), a tree reduce with its work/span intuition, and a dot product built from the two — with a speedup measurement where it's feasible.

---

## Prerequisites

- **Required:** The **work–span model** — what work `T₁` (total operations, time on one processor) and span `T∞` (longest dependency chain, time on infinitely many processors) mean, and that **parallelism = work / span**. All of it is set up in [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md). We use it on every page.
- **Required:** The **reduction tree** for summing `n` numbers in `Θ(log n)` span (also from that first topic). Reduce is exactly that idea generalized from `+` to any associative `⊕`; this file makes the generalization explicit.
- **Required:** Big-O basics — `Θ(n)`, `Θ(log n)` — and comfort reading a simple array loop. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Helpful:** Having seen `map`, `filter`, and `reduce`/`fold` on arrays in any language (Python's `map`, JavaScript's `.map`/`.reduce`, functional folds). The names are the same; we're just looking at them through the parallel lens.
- **Helpful:** A vague picture of "running many threads/goroutines at once." We define the algorithms abstractly and the code keeps the threading minimal, so no deep concurrency knowledge is required.

No calculus, no probability, no specific hardware. Every cost is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Map** | Apply a function `f` to every element of a collection, independently: `[a₀, a₁, …] → [f(a₀), f(a₁), …]`. |
| **Reduce / fold** | Combine all elements with an operator `⊕` into one result: `a₀ ⊕ a₁ ⊕ … ⊕ aₙ₋₁`. |
| **Embarrassingly parallel** | A computation whose pieces are fully independent (no dependencies), so it parallelizes trivially. Map is the textbook example. |
| **Associative operator (`⊕`)** | An operator where `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` — grouping doesn't change the result. Required for the reduction tree. |
| **Commutative operator** | An operator where `a ⊕ b = b ⊕ a` — *order* doesn't change the result. Not required for the tree, but lets you reduce in any order (handy for atomics). |
| **Identity** | The value `e` with `e ⊕ x = x` (e.g. `0` for `+`, `1` for `×`, `−∞` for `max`). The natural "starting value" / answer for an empty reduce. |
| **Reduction tree** | A balanced binary tree of `⊕`-combinations: pair up elements and combine in parallel, repeat. Work `Θ(n)`, span `Θ(log n)`. |
| **Fold / accumulator chain** | The naive left-to-right reduce, threading everything through one running value. Work `Θ(n)`, span `Θ(n)` — no parallelism. |
| **Map-reduce pattern** | Map a transform over the data, then reduce the results: "transform independently, then combine associatively." |
| **Work / Span** | (From the first topic.) Work `T₁` = total operations; span `T∞` = longest dependency chain. Parallelism = `T₁/T∞`. |

---

## Map: Do Every Element at Once

Let's start with the easy one. A **map** takes a collection and a function `f`, and produces a new collection where every element has had `f` applied to it:

```
  map(f, [a₀, a₁, a₂, ..., aₙ₋₁])  =  [ f(a₀), f(a₁), f(a₂), ..., f(aₙ₋₁) ]
```

That's the whole definition. The output has the same length as the input, and position `i` of the output is just `f` applied to position `i` of the input. Concrete examples you've surely written:

```
  square every number:    map(x → x*x,    [1, 2, 3, 4, 5])   = [1, 4, 9, 16, 25]
  parse every line:        map(parse,      [line0, line1, ...]) = [record0, record1, ...]
  brighten every pixel:    map(p → p+20,   [pixels...])         = [brighter pixels...]
  C → F on every reading:  map(c → c*9/5+32, [0, 100, 37])      = [32, 212, 98.6]
```

The crucial property — the one that makes map a *parallel* primitive — is hiding in plain sight: **each `f(aᵢ)` is computed entirely on its own.** Computing `f(a₃)` requires only `a₃`. It does not read `a₂`, does not read `f(a₂)`, does not wait for anything. The five squarings `1*1`, `2*2`, `3*3`, `4*4`, `5*5` have *nothing to do with each other*. There is no order they must happen in, no value they must share.

Picture the dependency DAG. For the serial sum we drew a long chain; for map there are **no edges at all** — just `n` lonely dots, each its own little island:

```
  map's DAG — n completely independent tasks, zero dependencies:

    f(a₀)    f(a₁)    f(a₂)    f(a₃)    ...    f(aₙ₋₁)
     ●        ●        ●        ●               ●
   (no arrows between them — nothing waits for anything)
```

Contrast that with the serial-sum chain `a₀ → a₁ → a₂ → … → aₙ₋₁`, where every node waited for the previous one. Map is the *opposite extreme*: maximal independence. And as the work–span model taught us, **independence is exactly where parallelism lives.** No dependencies means no critical path to speak of — every task can fire at the same instant. That's what we mean when we call map "embarrassingly parallel," and the next section makes the cost precise.

> **The mental model for map:** "do the same thing to every element, all at once." It's the cleanest, most trivially parallel pattern there is — because the elements don't talk to each other, you can spread them across as many processors as you have with no coordination at all. If a problem is "transform each item independently," it's a map, and it's basically free to parallelize.

---

## Why Map Is Embarrassingly Parallel

Let's put the two numbers on map and see why it's the best-case parallel pattern.

- **Work `T₁ = Θ(n)`.** There are `n` elements and you apply `f` to each, so there are `n` applications of `f`. (We're treating each `f` as `O(1)` here; if `f` itself is expensive, multiply through — but the *structure* is still `n` independent pieces.) You can't do fewer than `n` applications: every element needs transforming. This is optimal.

- **Span `T∞ = Θ(1)`.** This is the magic. The span is the *longest dependency chain*, and map has **no dependencies** — so the longest chain through its DAG is a single node. With `n` processors, processor `i` computes `f(aᵢ)` and they all finish in one step. The critical path is length 1. Even with *fewer* processors, there's never any waiting *between* elements; the only limit is how many you can run at once.

- **Parallelism `T₁/T∞ = Θ(n)/Θ(1) = Θ(n)`.** This is as high as parallelism gets. You can usefully employ up to `n` processors — one per element — and each one pays off. For a million-element map, you could keep a million processors busy.

```
                   Work T₁     Span T∞     Parallelism
  map              Θ(n)        Θ(1)        Θ(n)      ← maximal: every element independent
  (serial sum      Θ(n)        Θ(n)        Θ(1))     ← for contrast: a pure chain
```

The term for this — a computation whose pieces are completely independent and so parallelize with zero coordination — is **embarrassingly parallel** (sometimes "perfectly parallel" or "pleasingly parallel"). The "embarrassing" is half-joking: it's *embarrassingly easy* to parallelize, because there's no hard part. No shared state, no dependency chains to break, no clever regrouping needed. You just hand chunk 1 to processor 1, chunk 2 to processor 2, and so on, and collect the results.

This is why so much real parallel speedup comes from finding the map hiding in your workload. Processing a million log lines? That's a map — each line parses independently. Resizing a folder of ten thousand images? A map. Running the same simulation with a thousand different random seeds? A map. Applying a neural-network layer to a batch of inputs? A map. Whenever the work is "do this same independent thing to each of many items," you have the easiest, most scalable parallelism there is.

```
  Map in one picture (n processors, one step):

   inputs:   a₀     a₁     a₂     a₃    ...   aₙ₋₁
              │      │      │      │           │
   apply f:  f()    f()    f()    f()   ...   f()     ← all at the SAME instant
              │      │      │      │           │
   outputs: f(a₀)  f(a₁)  f(a₂)  f(a₃)  ...  f(aₙ₋₁)
```

> **The key insight:** map's span is `Θ(1)` *because* the elements are independent — and independence is the rawest source of parallelism in the work–span model. Map is the benchmark every other pattern is measured against: it's what "perfectly parallel" looks like. Reduce, which we turn to now, is *not* born embarrassingly parallel — it takes a clever trick (the tree) to get there.

---

## Reduce: Combine Everything Into One

Map keeps the collection the same size — `n` in, `n` out. **Reduce** does the opposite: it *collapses* the whole collection down to a **single value**, by combining the elements with a binary operator `⊕`:

```
  reduce(⊕, [a₀, a₁, a₂, ..., aₙ₋₁])  =  a₀ ⊕ a₁ ⊕ a₂ ⊕ ... ⊕ aₙ₋₁
```

Reduce is also called **fold** (because it "folds" the list down to one value) or sometimes **aggregate**. Like map, you've written reductions a thousand times — you just called them by their specific names:

```
  sum:        reduce(+,   [3, 1, 7, 0, 4])  =  3 + 1 + 7 + 0 + 4  =  15
  max:        reduce(max, [3, 1, 7, 0, 4])  =  max(3,1,7,0,4)     =  7
  min:        reduce(min, [3, 1, 7, 0, 4])  =  min(3,1,7,0,4)     =  0
  product:    reduce(×,   [3, 1, 7, 2])     =  3 × 1 × 7 × 2       =  42
  count(p):   reduce(+,   [p(a₀), p(a₁), ...])  (map to 0/1 first, then sum)
  all true:   reduce(AND, [true, true, false]) =  false
  any true:   reduce(OR,  [false, true, false]) = true
```

Every one of these is "combine all the elements into one answer." Sum combines with `+`; max combines with `max`; "are they all true?" combines with logical AND. The operator `⊕` changes, but the *shape* — squeeze `n` values down to `1` — is identical.

Each operator has a natural **identity** value `e`, the value that "does nothing" when combined: `x ⊕ e = x`. For `+` it's `0`; for `×` it's `1`; for `max` it's `−∞`; for `min` it's `+∞`; for AND it's `true`; for OR it's `false`. The identity is what a reduce of an *empty* collection should return (the sum of no numbers is `0`, the max of nothing is `−∞`), and it's a convenient seed when you build the reduction up step by step.

Now the central question: **how parallel is a reduce?** Unlike map, the answer isn't immediately "trivially parallel," because a reduce *does* have a result that depends on all the elements together — you can't compute the sum by looking at each element in isolation; they have to be combined. So there's some genuine combining to coordinate. The naive way to do that combining creates a dependency chain (no parallelism); the clever way — the reduction tree — gets the span down to `log n`. Let's see both.

---

## The Naive Fold Is a Chain

Here's how you'd reduce sequentially — the accumulator loop you've written countless times:

```
  acc = identity            (e.g. 0 for sum)
  acc = acc ⊕ a₀            ← must finish before...
  acc = acc ⊕ a₁            ← ...this, which must finish before...
  acc = acc ⊕ a₂            ← ...this, ...
  ...
  acc = acc ⊕ aₙ₋₁
  return acc
```

This is the **left-to-right fold**. It threads every element through a single running accumulator `acc`. And look at the dependency structure: *each step reads the accumulator that the previous step just wrote.* `acc ⊕ a₂` cannot start until `acc ⊕ a₁` has produced its result. So the DAG is a single straight line of `n` combinations — a chain with no branching at all, exactly like the serial sum from the first topic:

```
  the left-to-right fold is a CHAIN (span n):

   a₀ → ⊕ → ⊕ → ⊕ → ... → ⊕ → result
        a₁   a₂   a₃        aₙ₋₁
   (each ⊕ waits for the previous accumulator)
```

The fully-parenthesized form makes the chain obvious:

```
  ((((a₀ ⊕ a₁) ⊕ a₂) ⊕ a₃) ⊕ a₄)        ← deeply nested on the LEFT, a chain
```

Count the two numbers:

- **Work `T₁ = Θ(n)`** — exactly `n` combinations (or `n−1` if you skip the identity seed). This is optimal; you must touch every element.
- **Span `T∞ = Θ(n)`** — the critical path *is* the whole chain. Every `⊕` waits for the accumulator from the one before it.
- **Parallelism `T₁/T∞ = Θ(n)/Θ(n) = Θ(1)`** — **none.** A thousand processors can't help, because there's a chain of `n` dependent combinations and you can't break it.

This is the *same disappointment* we hit with the serial sum, for the *same reason*: by funneling everything through one accumulator, the fold manufactures a dependency chain of length `n`. The work is fine — `n` combinations is exactly right — but the **shape** is the worst possible for parallelism. As before, the fix is to *change the shape* so the combinations don't all depend on each other. And as before, the key that unlocks it is associativity. Let's draw the tree.

---

## The Reduction Tree, Drawn on 8 Elements

The parallel reduce is a **reduction tree** (also called a *tournament* or *knockout* tree, which is a great mental image). Instead of folding left to right, you run a tournament: pair up neighbors and combine each pair *simultaneously*; that halves the count. Then pair up the winners and combine again; halve again. Keep going until one value remains — the champion is your answer.

Let's reduce these 8 numbers with `+` (so we're computing their sum), and watch the tournament:

```
ROUND 0 (the input, 8 values):
   3     1     7     0     4     1     6     3
```

**Round 1 — pair up neighbors, add each pair at the same instant.** Four additions, all independent (none reads another's result), so all four happen in one step:

```
   3   1   7   0   4   1   6   3
    \ /     \ /     \ /     \ /
   (3+1)   (7+0)   (4+1)   (6+3)        ← 4 additions, ALL AT ONCE
     │       │       │       │
     4       7       5       9          ← 4 values remain
```

**Round 2 — pair up the four winners, add each pair simultaneously.** Two additions, independent, one step:

```
     4       7       5       9
      \      /         \     /
      (4+7)            (5+9)            ← 2 additions, ALL AT ONCE
        │                │
       11               14             ← 2 values remain
```

**Round 3 — one final addition, combining the last two:**

```
       11               14
         \              /
          (11 + 14)                     ← 1 addition
              │
             25                         ← the champion: the total
```

Three rounds — `log₂ 8 = 3` — and the tournament is over. Stack the whole tree to see it at a glance:

```
LEVEL 0:   3   1   7   0   4   1   6   3      8 numbers
            \ /     \ /     \ /     \ /
LEVEL 1:    4       7       5       9         4 sums, all done AT ONCE
              \      /         \     /
LEVEL 2:      11             14               2 sums, both done AT ONCE
                \             /
LEVEL 3:            25                        1 final sum — the answer
```

And the answer, `25`, matches `3 + 1 + 7 + 0 + 4 + 1 + 6 + 3 = 25` — the same total the left-to-right fold would produce, just computed in a tree instead of a chain. The fully-parenthesized form of the tree shows *why* the rounds can run in parallel — the parentheses are balanced, not nested down one side:

```
  ((3 ⊕ 1) ⊕ (7 ⊕ 0))  ⊕  ((4 ⊕ 1) ⊕ (6 ⊕ 3))     ← balanced TREE, not a chain
```

The same tournament works for *any* associative operator. Replace `+` with `max` and the champion is the maximum; replace it with `min` and it's the minimum; with `AND` it's "are they all true?"; with `×` it's the product. The *shape* is identical — only the combine box changes. That's the power of reduce: **one tree structure, parameterized by the operator.**

> **The mental model for reduce:** a **tournament**. Round 1, everyone plays a neighbor and half advance; round 2, the winners play and half advance again; after `log n` rounds, one champion remains. Each round's matches are independent, so they all play at once — which is why the depth (and the span) is only `log n` rounds, even though there are `n` competitors. The "champion" is whatever the operator decides: the sum, the max, the AND.

---

## Why Associativity Lets You Regroup

We've been waving at associativity; let's pin down *exactly* why it's the property that turns the fold's chain into the tree. **Associativity** is the rule `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` — **where you put the parentheses doesn't change the answer.** Addition has it, multiplication has it, `max` and `min` have it, AND/OR have it, string concatenation has it. (Subtraction does *not*: `(5 − 3) − 1 = 1` but `5 − (3 − 1) = 3`. So you can't tree-reduce a running *difference* the same way.)

Why does parenthesis-freedom create parallelism? Because a dependency chain is forced **only when you must evaluate strictly left to right.** Consider combining `a₀ ⊕ a₁ ⊕ a₂ ⊕ a₃`:

```
LEFT-TO-RIGHT grouping (a chain — span 3):
  ((a₀ ⊕ a₁) ⊕ a₂) ⊕ a₃
   step1: a₀ ⊕ a₁      ← must finish first
   step2: (…) ⊕ a₂      ← waits for step1
   step3: (…) ⊕ a₃      ← waits for step2
  Three combinations, each waiting on the last. Span = 3.

TREE grouping (associativity lets us re-parenthesize — span 2):
  (a₀ ⊕ a₁) ⊕ (a₂ ⊕ a₃)
   step1a: a₀ ⊕ a₁  ┐
   step1b: a₂ ⊕ a₃  ┘ ← these two are INDEPENDENT, run AT THE SAME TIME
   step2:  (…) ⊕ (…) ← waits for both, but they finished together
  Still three combinations (same WORK), but span = 2.
```

Associativity *guarantees* both groupings give the **identical result**, so we are **free to choose the tree grouping** — and the tree grouping has the shorter critical path. With `n` elements, the left-to-right chain has span `n−1`, while the balanced tree has span `log₂ n`. The combinations are the same combinations (same work); we only changed *when* they happen relative to one another. The tree lets independent combinations fire simultaneously; the chain forbade it. **Associativity is what turns the chain into a tree.**

A quick note on a *different* property, **commutativity** (`a ⊕ b = b ⊕ a`, *order* doesn't matter). The tree above does **not** need commutativity — it keeps the elements in their original left-to-right positions; it only re-parenthesizes. So even a *non-commutative* associative operator (like matrix multiplication or string concatenation) reduces correctly in a tree, *as long as you keep the order*. Commutativity buys you something *extra*: if your operator is *also* commutative, you can combine elements in *any* order at all — which is handy when many processors race to fold their results into a shared accumulator and you don't want to enforce an order. For now, the rule to remember is simple:

> **The throughline:** the left-to-right fold has span `n` because it *insists* on one grouping. **Associativity** says every grouping gives the same answer — so pick the tree-shaped ones, where independent combinations happen simultaneously, and the span collapses from `n` to `log n`. **Associativity is the permission slip for the reduction tree.** (Commutativity is a bonus that additionally lets you ignore *order* — useful for unordered or atomic reductions, not required for the tree itself.) Operators that lack associativity — subtraction, division — cannot be tree-reduced.

This is the exact same insight that powers the [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/junior.md): scan is "a reduce that keeps all the partial results along the way," and it relies on associativity for the very same reason.

---

## Counting Work and Span of the Tree

Now put the two numbers on the reduction tree and compare it to the naive fold.

- **Work `T₁ = Θ(n)`.** Count the combinations: round 1 does `n/2`, round 2 does `n/4`, round 3 does `n/8`, … all the way down. That's `n/2 + n/4 + n/8 + … = n − 1` total combinations. For `n = 8`: `4 + 2 + 1 = 7 = n − 1`. **Exactly the same work as the left-to-right fold** — we did not add any extra combinations; we only rearranged *when* they happen. Doing the same total work as the best sequential algorithm is called being **work-efficient**, and the reduction tree is work-efficient.

- **Span `T∞ = Θ(log n)`.** The critical path runs from a leaf up to the root — that's the *height* of the tree. A balanced binary tree over `n` leaves has height `log₂ n`. Each round depends on the previous round (round 2 needs round 1's winners), but *within* a round all the combinations are independent and fire at once. So the span is the number of rounds: `log₂ n`. **For n = 8 that's 3; for n = 1,000,000, about 20.** The span collapsed from `n` to `log n` — that's the entire win.

- **Parallelism `T₁/T∞ = Θ(n) / Θ(log n) = Θ(n / log n)`** — enormous. For a million elements, about `1,000,000 / 20 = 50,000`. You can keep tens of thousands of processors busy.

Lay the two side by side:

```
                     Work T₁     Span T∞     Parallelism
  left-to-right fold Θ(n)        Θ(n)        Θ(1)          ← work-optimal, NO parallelism
  reduction tree     Θ(n)        Θ(log n)    Θ(n / log n)  ← same work, massively parallel

  SAME work. The ONLY difference is span:  n  vs  log n.
```

This is the whole art of parallel reduce in one table — and it's deliberately the same shape as the "summing n numbers" table from [the first topic](../01-models-pram-work-span/junior.md), because **summing is just reduce with `⊕ = +`.** Both versions do the same `n−1` combinations; the fold chains them into span `n`, the tree arranges them into span `log n`. **Lowering the span is what creates the parallelism**, and you lower it by exploiting associativity to combine in a tree instead of a line.

One honest practical note: with `P` processors and `n ≫ P` (the usual case — far more data than cores), real implementations don't build a full binary tree. They split the array into `P` chunks, have each processor reduce its chunk *sequentially* (a fast tight loop, work `n/P`), and then combine the `P` partial results with a small tree. That hybrid gets the best of both: the sequential chunk-reduce is cache-friendly and does no extra work, while the final combine over just `P` values is `log P` span. The pure binary tree is the *conceptual* model that explains why reduce is `Θ(log n)` span; the chunk-then-combine version is how you'd actually code it (and it's exactly what the code below does).

> **The takeaway:** reduce is **not** embarrassingly parallel the way map is — a reduce genuinely has to combine everything, so there's a `log n`-deep critical path you can't avoid. But `log n` is tiny: for a billion elements it's about 30. So reduce is *very* nearly as parallel as map, and the only thing standing between "span `n`" and "span `log n`" is whether your operator is associative.

---

## The Map-Reduce Pattern

Now we put the two primitives together, and you get the single most important pattern in data-parallel computing: **map-reduce.** The idea is exactly what its name says — first **map** a transform over every element (independently — embarrassingly parallel, span `1`), then **reduce** the results with an associative operator (a tree — span `log n`):

```
  result  =  reduce( ⊕ , map( f , collection ) )

      ┌──────────── MAP ────────────┐    ┌────── REDUCE ──────┐
      transform each element of      then combine all the
      the collection independently   transformed results with ⊕
      (span O(1), embarrassingly      (span O(log n), a tree)
       parallel)
```

The combined cost is wonderful: span `Θ(1)` for the map plus span `Θ(log n)` for the reduce = **span `Θ(log n)`** overall, with **work `Θ(n)`**. The whole "transform everything, then aggregate" computation is `log n`-deep. That phrase — *transform independently, then combine associatively* — is the heartbeat of an astonishing fraction of all batch and analytics computing.

Here's the pattern recognized in everyday tasks. The trick is to spot the *transform* (the map) and the *combine* (the reduce):

```
  Question                          map f                 reduce ⊕
  ────────────────────────────────  ────────────────────  ─────────
  Sum of squares?                   x → x²                +
  How many are even?                x → (1 if even else 0) +
  Largest absolute value?           x → |x|               max
  Are all positive?                 x → (x > 0)           AND
  Does any contain "ERROR"?         line → "ERROR" in line OR
  Total bytes across files?         file → size(file)     +
  Longest word in the document?     word → len(word)      max
```

Each is "do something to each element, then squeeze the results into one answer." The map handles the per-element work in parallel for free; the reduce handles the aggregation in `log n` span. That's it — that's the pattern that, scaled across a cluster of machines instead of cores, became Google's MapReduce and then Hadoop and Spark. (When the data is spread over thousands of machines you add a *shuffle* step in the middle to group things, but the map-then-reduce skeleton is identical — see [Map-Reduce Patterns](../06-map-reduce-patterns/junior.md).)

```
  Map-reduce in one picture:

  inputs:    a₀   a₁   a₂   a₃   a₄   a₅   a₆   a₇
              │    │    │    │    │    │    │    │
   MAP f:    f()  f()  f()  f()  f()  f()  f()  f()    ← all at once, span O(1)
              │    │    │    │    │    │    │    │
            f(a₀)f(a₁)f(a₂)f(a₃)f(a₄)f(a₅)f(a₆)f(a₇)
              \  /      \  /      \  /      \  /
  REDUCE ⊕:    •          •         •         •        ┐
                \        /           \      /          │ a tree,
                  •                    •               │ span O(log n)
                     \               /                 │
                         final result                  ┘
```

> **The pattern to memorize:** *transform independently (map), then combine associatively (reduce).* The map is free to parallelize (no dependencies); the reduce costs `log n` span (a tree). Together: work `Θ(n)`, span `Θ(log n)`. An enormous fraction of real computations — analytics, aggregations, statistics, search — are secretly a map-reduce, and recognizing the shape is the skill that lets you parallelize them on sight.

---

## Worked Example: Dot Product Is Map-Then-Reduce

The cleanest example of map-then-reduce — and one you'll use constantly in graphics, machine learning, and physics — is the **dot product** of two vectors. Given `a = [a₀, a₁, …, aₙ₋₁]` and `b = [b₀, b₁, …, bₙ₋₁]`, the dot product is:

```
  a · b  =  a₀·b₀ + a₁·b₁ + a₂·b₂ + ... + aₙ₋₁·bₙ₋₁
```

Read that formula and the two phases jump out. First you *multiply* the vectors element-by-element to get the products `[a₀·b₀, a₁·b₁, …]` — that's a **map** (each product is independent, depends only on its own `aᵢ` and `bᵢ`). Then you *sum* all those products into one number — that's a **reduce** with `+`. So:

```
  a · b  =  reduce( + ,  map( (x, y) → x·y ,  zip(a, b) ) )
              └─ sum ─┘    └──── pairwise multiply ────┘
              REDUCE          MAP
```

Let's compute `[1, 3, 5, 7] · [2, 4, 6, 8]` step by step, showing both phases:

```
  STEP 1 — MAP: multiply corresponding elements (all independent, span O(1)):
     a:   1     3     5     7
     b:   2     4     6     8
          │     │     │     │
        1·2   3·4   5·6   7·8        ← four multiplications, ALL AT ONCE
          │     │     │     │
          2    12    30    56        ← the products

  STEP 2 — REDUCE: sum the products in a tree (span O(log n)):
          2    12    30    56
           \   /      \    /
          (2+12)     (30+56)         ← two additions, at once
             │          │
            14         86
              \        /
              (14 + 86)              ← one addition
                  │
                 100                 ← the dot product
```

Check: `1·2 + 3·4 + 5·6 + 7·8 = 2 + 12 + 30 + 56 = 100`. ✓ The map produced four products in one parallel step; the reduce summed them in two tree levels. For `n` elements, the whole dot product is **work `Θ(n)`** (the `n` multiplies plus `n−1` adds) and **span `Θ(log n)`** (constant for the map, `log n` for the sum tree). A dot product over million-element vectors has span ≈ 20 — it's almost entirely parallel.

This "map to products, reduce by sum" shape is everywhere: it's the inner loop of **matrix multiplication** (each output entry is a dot product of a row and a column), of **convolutions** in image processing and neural networks, of computing a **weighted average** or a **vector norm** (`‖a‖ = sqrt(reduce(+, map(x → x², a)))`), and of **cosine similarity** in search and recommendations. Learn to see the map-then-reduce in the dot product and you've learned to see it in a huge swath of numerical computing.

> **Why this example matters:** the dot product is the *minimal* map-reduce — a transform (multiply pairs) feeding an associative combine (sum). It's the template for matrix multiply, convolution, norms, and similarity. Whenever you see `Σ (something_per_element)`, you're looking at `reduce(+, map(...))` — work `Θ(n)`, span `Θ(log n)`, parallel almost for free.

---

## Code: Parallel Map

Let's make all three pieces runnable, starting with map. The whole point is that the elements are independent, so we split the collection into chunks and process each chunk on its own worker — no coordination needed beyond waiting for them all to finish.

### Go: parallel map with goroutines

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// parallelMap applies f to every element of `in`, in parallel, returning a new
// slice. Each output slot out[i] is written by exactly one goroutine, so there
// are NO write conflicts — the essence of an embarrassingly-parallel map.
// Work Θ(n), span Θ(1) with enough processors.
func parallelMap(in []int, f func(int) int, workers int) []int {
	n := len(in)
	out := make([]int, n)
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
		go func(lo, hi int) { // each goroutine = one "processor"
			defer wg.Done()
			for i := lo; i < hi; i++ {
				out[i] = f(in[i]) // independent: out[i] depends ONLY on in[i]
			}
		}(lo, hi)
	}
	wg.Wait() // wait for every chunk to finish
	return out
}

func main() {
	in := []int{1, 2, 3, 4, 5, 6, 7, 8}
	square := func(x int) int { return x * x }

	out := parallelMap(in, square, runtime.NumCPU())
	fmt.Println("in: ", in)  // [1 2 3 4 5 6 7 8]
	fmt.Println("out:", out) // [1 4 9 16 25 36 49 64]
}
```

### Python: parallel map with multiprocessing

```python
import os
from multiprocessing import Pool

def square(x):
    return x * x

def parallel_map(f, data, workers):
    """Apply f to every element of data, in parallel. Embarrassingly parallel:
    each result depends only on its own input, so no coordination is needed."""
    with Pool(workers) as pool:
        return pool.map(f, data)   # Pool.map splits the work across `workers`

if __name__ == "__main__":
    data = list(range(1, 9))
    out = parallel_map(square, data, os.cpu_count())
    print("in: ", data)  # [1, 2, 3, 4, 5, 6, 7, 8]
    print("out:", out)   # [1, 4, 9, 16, 25, 36, 49, 64]
```

**What it does:** both split the collection into chunks (Go does it explicitly; Python's `Pool.map` does it for you) and apply `f` to each chunk on a separate worker. The defining feature is that **`out[i]` is written by exactly one worker and depends only on `in[i]`** — so there are no write conflicts and no dependencies between workers. That's why map is span `Θ(1)`: with `n` workers, every element is processed in a single step. (In real Python, `multiprocessing` pays a cost to launch processes and copy data, so a parallel map only beats a serial one when `f` is genuinely expensive or the data is large — the work–span model gives the *ceiling*; real overhead decides how close you get.)

---

## Code: Tree Reduce

Now the reduction. We'll show two things: a faithful **tree reduce** that mirrors the tournament we drew (so the structure is visible), and the practical **chunk-then-combine** version that's what you'd actually run. We pass the operator in, so the *same* code computes sum, max, min, or any associative reduce.

### Python: tree reduce, showing the tournament

```python
def tree_reduce(data, op, identity):
    """
    Reduce `data` with the associative operator `op`, tournament-style.
    Each pass pairs up neighbors and combines them, halving the count, until
    one value remains. Work Θ(n), span Θ(log n) (each pass is one tree level).
    `identity` is returned for an empty input and pads an odd tail.
    """
    level = list(data)
    if not level:
        return identity
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 < len(level):
                nxt.append(op(level[i], level[i + 1]))  # combine the pair
            else:
                nxt.append(level[i])                    # odd one out advances
        print(f"  level: {level}  ->  {nxt}")           # show the tournament
        level = nxt
    return level[0]


if __name__ == "__main__":
    data = [3, 1, 7, 0, 4, 1, 6, 3]
    print("sum:")
    total = tree_reduce(data, lambda a, b: a + b, 0)
    print("  =", total, "\n")          # 25

    print("max:")
    biggest = tree_reduce(data, max, float("-inf"))
    print("  =", biggest)              # 7
```

Running it prints the tournament levels collapsing toward the answer:

```
sum:
  level: [3, 1, 7, 0, 4, 1, 6, 3]  ->  [4, 7, 5, 9]
  level: [4, 7, 5, 9]  ->  [11, 14]
  level: [11, 14]  ->  [25]
  = 25

max:
  level: [3, 1, 7, 0, 4, 1, 6, 3]  ->  [3, 7, 4, 6]
  level: [3, 7, 4, 6]  ->  [7, 6]
  level: [7, 6]  ->  [7]
  = 7
```

Notice the **same code** computed both sum and max — only the operator changed. And notice the number of levels printed: 3 for 8 elements (`log₂ 8`). That count *is* the span. Swapping `+` for `max` doesn't change the shape at all, because both are associative.

### Go: parallel reduce, chunk-then-combine

This is the version you'd actually run: split into `P` chunks, reduce each chunk sequentially in its own goroutine (a tight fast loop), then combine the `P` partials. Work stays `Θ(n)`; span is `Θ(n/P)` for the chunk phase plus `Θ(log P)` for the final combine.

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// parallelReduce reduces `in` with the associative operator op (identity `id`).
// Each worker reduces its OWN chunk into partials[w] (no write conflict), then
// the small final loop combines the P partial results.
func parallelReduce(in []int, op func(a, b int) int, id int, workers int) int {
	n := len(in)
	if n == 0 {
		return id
	}
	partials := make([]int, workers)
	for i := range partials {
		partials[i] = id
	}
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
		go func(w, lo, hi int) {
			defer wg.Done()
			acc := id
			for i := lo; i < hi; i++ {
				acc = op(acc, in[i]) // reduce this chunk sequentially
			}
			partials[w] = acc // each worker writes its OWN slot — no conflict
		}(w, lo, hi)
	}
	wg.Wait()

	// Combine the P partials (small: a tree here would be log P; a loop is fine).
	result := id
	for _, p := range partials {
		result = op(result, p)
	}
	return result
}

func main() {
	in := []int{3, 1, 7, 0, 4, 1, 6, 3}
	add := func(a, b int) int { return a + b }
	maxOf := func(a, b int) int {
		if a > b {
			return a
		}
		return b
	}
	p := runtime.NumCPU()
	fmt.Println("sum:", parallelReduce(in, add, 0, p))            // 25
	fmt.Println("max:", parallelReduce(in, maxOf, -1<<62, p))     // 7
}
```

> **The crucial detail — each worker writes its own slot.** Just like the parallel sum from the first topic, every goroutine reduces *its* chunk into `partials[w]`, a cell only it touches. There is no shared accumulator that the workers fight over — which would serialize them and reintroduce the chain we worked so hard to escape. The disjoint partials are what keep the parallel phase truly parallel; the final combine over just `P` values is cheap. This chunk-then-combine shape is the real-world face of "work `Θ(n)`, span `Θ(log n)`."

---

## Code: Dot Product as Map + Reduce

Finally, the payoff: the dot product, built explicitly as a map (multiply pairs) followed by a reduce (sum). We'll also do a quick speedup measurement to see the parallelism show up in real numbers.

### Python: dot product = map then reduce, with timing

```python
import time
import os
from multiprocessing import Pool

def _chunk_dot(args):
    """One 'processor': map+reduce over a slice — multiply pairs and sum them.
    This fuses the map (a[i]*b[i]) and the reduce (sum) in a single tight loop,
    which is what you'd really do: no need to materialize the products array."""
    a, b, lo, hi = args
    s = 0
    for i in range(lo, hi):
        s += a[i] * b[i]      # map (multiply) + reduce (add), fused
    return s

def parallel_dot(a, b, workers):
    assert len(a) == len(b)
    n = len(a)
    chunk = (n + workers - 1) // workers
    tasks = []
    for w in range(workers):
        lo = w * chunk
        hi = min(lo + chunk, n)
        if lo < hi:
            tasks.append((a, b, lo, hi))
    with Pool(workers) as pool:
        partials = pool.map(_chunk_dot, tasks)  # each chunk's map+reduce, in parallel
    return sum(partials)                          # combine the partials (the final reduce)

def serial_dot(a, b):
    return sum(x * y for x, y in zip(a, b))       # reduce(+, map(*, zip(a,b)))

if __name__ == "__main__":
    # Small correctness check (the worked example):
    print(serial_dot([1, 3, 5, 7], [2, 4, 6, 8]))  # 100

    # Speedup measurement on big vectors:
    n = 5_000_000
    a = [i % 100 for i in range(n)]
    b = [(i * 3) % 100 for i in range(n)]

    start = time.perf_counter()
    want = serial_dot(a, b)
    serial_time = time.perf_counter() - start
    print(f"serial:        {serial_time:.3f}s  dot={want}")

    for p in [1, 2, 4, os.cpu_count()]:
        start = time.perf_counter()
        got = parallel_dot(a, b, p)
        pt = time.perf_counter() - start
        assert got == want
        print(f"parallel P={p:<2}: {pt:.3f}s  speedup={serial_time / pt:.2f}x")
```

### Go: dot product = map then reduce

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// parallelDot computes a·b = sum(a[i]*b[i]) as a fused map(multiply)+reduce(sum).
// Each worker handles a chunk: it maps (multiplies) and reduces (sums) its slice
// into its own partial, then the partials are summed. Work Θ(n), span Θ(log n).
func parallelDot(a, b []int64, workers int) int64 {
	n := len(a)
	partials := make([]int64, workers)
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
		go func(w, lo, hi int) {
			defer wg.Done()
			var s int64
			for i := lo; i < hi; i++ {
				s += a[i] * b[i] // map (multiply) + reduce (add), fused
			}
			partials[w] = s // own slot — no write conflict
		}(w, lo, hi)
	}
	wg.Wait()

	var total int64 // final reduce over the P partials
	for _, p := range partials {
		total += p
	}
	return total
}

func main() {
	a := []int64{1, 3, 5, 7}
	b := []int64{2, 4, 6, 8}
	fmt.Println("dot:", parallelDot(a, b, runtime.NumCPU())) // 100
}
```

> **Why this is the canonical map-reduce.** The dot product fuses a **map** (multiply each pair) and a **reduce** (sum the products) into one pass — you don't even materialize the products array; you multiply-and-accumulate in a tight loop. Each worker does the full map-reduce on its own chunk, writes its own partial, and a final small reduce combines them. That's `reduce(+, map(×, zip(a, b)))` realized in parallel: work `Θ(n)`, span `Θ(log n)`. You'll see speedup rise with `P` but not hit the ideal `P×` exactly — the final combine is serial (Amdahl's tail) and process/data overhead is real (especially in Python, where copying the vectors to each worker can dominate for cheap operations). The models predict the ceiling; overhead decides how close you get. This same multiply-then-sum is the inner loop of matrix multiply, convolution, and cosine similarity.

---

## Common Misconceptions

- **"Map and reduce are both equally parallel."** Not quite. **Map** is *embarrassingly* parallel — span `Θ(1)`, zero dependencies, every element independent. **Reduce** is *not* born parallel: the elements genuinely have to be combined, so there's a `Θ(log n)`-deep tree you can't avoid. Reduce is *almost* as parallel as map (because `log n` is tiny), but it takes the associativity trick to get there, whereas map needs no trick at all.

- **"Reduce is inherently sequential — you have to fold left to right."** This is the headline misconception. The left-to-right fold is *one* way to reduce, and the worst one for parallelism (a chain of length `n`). Because the operator is associative, you can regroup into a balanced tree and reduce in `Θ(log n)` span. The chain is an artifact of the naive algorithm, not a property of the problem.

- **"Reduce only works for addition."** It works for *any* associative operator with an identity: `+`, `×`, `max`, `min`, `AND`, `OR`, string concatenation, matrix multiply, "keep the better of two records," and many more. The tree shape is identical; only the combine box changes. The one requirement is **associativity** — which is why running *subtraction* or *division* can't be tree-reduced.

- **"You need commutativity for the reduction tree."** No — you need **associativity**. The tree keeps elements in their original order and only re-parenthesizes, so even a non-commutative operator (matrix multiply, string concat) reduces correctly as long as you preserve order. Commutativity is a *bonus* that additionally lets you combine in *any* order — convenient for unordered/atomic reductions, but not required for the tree.

- **"Map-reduce is a specific framework (Hadoop/Spark)."** Those frameworks are *named after* the pattern, but map-reduce is first a **pattern** — transform independently, then combine associatively — that applies just as well to threads on one machine as to a thousand machines. Learn the pattern; the frameworks are one (large-scale) application of it. (See [Map-Reduce Patterns](../06-map-reduce-patterns/junior.md).)

- **"More work always means slower."** In parallel, no. Even when a tree reduce and a serial fold do the *same* `n−1` combinations, the tree finishes far sooner on many processors because its `Θ(log n)` span lets the work spread out. Work and span are different axes; the span is what bounds your time when you have processors to spare.

---

## Common Mistakes

- **Reducing with a non-associative operator.** Subtraction, division, and floating-point operations that you *treat* as exactly associative (FP addition is only *approximately* associative) give different answers when regrouped into a tree versus folded left to right. Confirm `(a⊕b)⊕c = a⊕(b⊕c)` before tree-reducing — and if you're summing floats and need bit-for-bit reproducibility, be aware the tree may differ slightly from the serial sum.

- **Fighting over a shared accumulator.** The classic parallel-reduce bug is having all workers `⊕` into one shared variable. They serialize on that cell (and may race), destroying the parallelism — you've rebuilt the chain. The fix is the partials pattern: each worker reduces into its *own* slot, then combine. Shared mutable state is where parallel speedup goes to die.

- **Forgetting the identity for empty or odd inputs.** A reduce of an empty collection should return the identity (`0` for sum, `−∞` for max), and an odd-length tournament round leaves one element unpaired that must advance unchanged. Seeding with the wrong identity (e.g. `0` for a `max` reduce) silently corrupts the answer. Pick the right identity for your operator.

- **Materializing the map output when you could fuse.** Writing `reduce(+, map(f, data))` as two literal passes builds an intermediate array of all `n` mapped values — extra memory and a second pass over the data. When the map feeds straight into a reduce (like the dot product), **fuse** them: map-and-combine in one loop, never storing the products. Same result, half the memory traffic.

- **Parallelizing a tiny map or reduce.** Launching threads/processes and splitting work has real overhead. For small `n` or a cheap `f`/`⊕`, the coordination costs more than the work, and the parallel version is *slower*. Parallelize only when the per-worker work dwarfs the setup cost (large `n`, or an expensive `f`).

- **Treating the tree's sequential simulation as the algorithm's cost.** The `tree_reduce` code uses a `for` loop per level for clarity, but the *algorithm* has all combinations in a level firing at once. The cost to read off is the **span** (the number of levels, `log n`), not the simulation's loop count. Judge it by the DAG, not the `for`.

---

## Cheat Sheet

```
MAP — apply f to every element, independently
  map(f, [a0, a1, ...]) = [f(a0), f(a1), ...]
  Work Θ(n)   Span Θ(1)   Parallelism Θ(n)   ← EMBARRASSINGLY PARALLEL (no dependencies)
  examples: square each, parse each line, transform each pixel, resize each image

REDUCE / FOLD — combine all elements with associative ⊕ into one value
  reduce(⊕, [a0, a1, ...]) = a0 ⊕ a1 ⊕ ... ⊕ a(n-1)
  examples: sum(+), max, min, product(×), count(map to 0/1 then +), all(AND), any(OR)
  each ⊕ has an IDENTITY: + → 0,  × → 1,  max → -∞,  min → +∞,  AND → true,  OR → false

  NAIVE FOLD (left-to-right):  (((a0 ⊕ a1) ⊕ a2) ⊕ a3) ...
    Work Θ(n)   Span Θ(n)   Parallelism Θ(1)   ← a CHAIN, no parallelism

  REDUCTION TREE (tournament):  ((a0 ⊕ a1) ⊕ (a2 ⊕ a3)) ⊕ ...
    pair up neighbors, combine in parallel, repeat → log n rounds
    Work Θ(n)   Span Θ(log n)   Parallelism Θ(n/log n)   ← same work, massively parallel

WHY THE TREE IS LEGAL: ASSOCIATIVITY  (a⊕b)⊕c = a⊕(b⊕c)
  lets you regroup the chain into a tree (independent combinations fire at once).
  (Commutativity a⊕b = b⊕a is a BONUS: lets you ignore ORDER too. NOT required for the tree.)
  No associativity (subtraction, division) → can't tree-reduce.

MAP-REDUCE PATTERN:  result = reduce(⊕, map(f, data))
  transform independently (map, span 1)  THEN  combine associatively (reduce, span log n)
  total: Work Θ(n), Span Θ(log n). The backbone of data-parallel computing.
  (scaled across machines + a shuffle = the MapReduce framework — see 06-map-reduce-patterns)

DOT PRODUCT = the canonical map-then-reduce:
  a·b = reduce(+, map((x,y)→x·y, zip(a,b)))   ← multiply pairs (map), sum them (reduce)
  Work Θ(n), Span Θ(log n). Inner loop of matrix multiply, convolution, cosine similarity.

REAL-WORLD SHAPE: split into P chunks → each worker reduces its OWN chunk into its OWN
  partial (no shared accumulator!) → combine the P partials. Best of both worlds.
```

---

## Summary

**Map** and **reduce** are the two most fundamental data-parallel primitives, and almost every parallel program is built from them.

- **Map** applies a function `f` to every element of a collection, independently: `[a₀, a₁, …] → [f(a₀), f(a₁), …]`. Because each `f(aᵢ)` depends only on `aᵢ`, map is **embarrassingly parallel** — its DAG has *no edges*, so **work `Θ(n)`, span `Θ(1)`, parallelism `Θ(n)`.** With `n` processors, every element is transformed in a single step. Squaring numbers, parsing lines, transforming pixels, resizing images — any "do the same independent thing to each item" task is a map, and it's the easiest, most scalable parallelism there is.

- **Reduce** (fold) combines all elements with an associative operator `⊕` into a single value: `a₀ ⊕ a₁ ⊕ … ⊕ aₙ₋₁`. The **naive left-to-right fold** threads everything through one accumulator, making a dependency chain of length `n` — **span `Θ(n)`, no parallelism.** But because `⊕` is associative, you can regroup into a **reduction tree** (a tournament: pair up, combine in parallel, repeat), collapsing the span to **`Θ(log n)`** while keeping **work `Θ(n)`** — same work as the fold, just rearranged. Sum, max, min, count, AND, OR all reduce this way; the tree shape is identical, only the operator changes.

- **Associativity is the key.** `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` means regrouping doesn't change the answer, so you're free to pick the tree grouping where independent combinations fire simultaneously — turning the chain (span `n`) into a tree (span `log n`). **Associativity is the permission slip for the reduction tree.** Commutativity is a *bonus* that additionally lets you ignore order (handy for unordered/atomic reductions) but is *not* required for the tree. Operators without associativity — subtraction, division — can't be tree-reduced.

- **The map-reduce pattern** chains them: `reduce(⊕, map(f, data))` — transform every element independently (map, span `1`), then combine the results associatively (reduce, span `log n`). Total: **work `Θ(n)`, span `Θ(log n)`.** This "transform independently, then combine associatively" shape is the backbone of data-parallel computing — sum-of-squares, count-of-matches, largest-value, any-passes — and scaled across a cluster (with a shuffle step added) it's the [MapReduce framework](../06-map-reduce-patterns/junior.md) that named the pattern.

- **The dot product** is the canonical example: `a · b = reduce(+, map((x,y) → x·y, zip(a, b)))` — multiply pairs (a map), then sum the products (a reduce). Work `Θ(n)`, span `Θ(log n)`. It's the inner loop of matrix multiplication, convolution, vector norms, and cosine similarity, and the code fuses the map and reduce into one multiply-and-accumulate loop.

The big idea to carry forward: **map is parallelism for free (independent work), reduce is parallelism via the tree (associativity), and chaining them — map-reduce — expresses an enormous fraction of all batch computation in `Θ(log n)` span.** Learning to spot the map and the reduce inside a problem is the skill that lets you parallelize it on sight.

**Next steps:** [the middle-level treatment](./middle.md) digs into work-efficient and cache-aware reductions, segmented reduce, parallel `reduceByKey`/grouping, floating-point reproducibility, and how real runtimes schedule the tree. Then [Parallel Prefix Sum / Scan](../02-parallel-prefix-sum-scan/junior.md) is "a reduce that keeps all the partial results along the way" (same associativity trick); [Map-Reduce Patterns](../06-map-reduce-patterns/junior.md) scales map-then-reduce across many machines with a shuffle in the middle; and the whole framework rests on the [work–span model](../01-models-pram-work-span/junior.md) from the first topic.

---

## Further Reading

- **Guy Blelloch, *Programming Parallel Algorithms* / "Prefix Sums and Their Applications" (CMU)** — the work–depth model with map, reduce, and scan developed as first-class primitives; the cleanest treatment of "transform then combine."
- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Multithreaded Algorithms"** — the work–span analysis of reductions and parallel loops in the framework used throughout this section.
- **Dean & Ghemawat, "MapReduce: Simplified Data Processing on Large Clusters" (Google, 2004)** — the paper that took map-then-reduce to thousands of machines; reading it after this file makes the cluster-scale version click.
- **McCool, Robison & Reinders, *Structured Parallel Programming*** — map, reduce, and scan presented as reusable parallel "patterns," with practical implementation guidance.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — the work/span model and the reduction tree this topic generalizes.
- **[Parallel Prefix Sum (Scan)](../02-parallel-prefix-sum-scan/junior.md)** — "a reduce that keeps every partial result," relying on the same associativity trick.
- **[Map-Reduce Patterns](../06-map-reduce-patterns/junior.md)** — the map-then-reduce pattern scaled across machines with a shuffle step.
- **[Parallel Reduce and Map — Middle](./middle.md)** — work-efficient and cache-aware reductions, segmented reduce, grouped reductions (`reduceByKey`), and floating-point reproducibility in depth.
