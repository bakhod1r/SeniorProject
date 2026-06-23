# Parallel Prefix Sum (Scan) — Junior Level

> **Audience:** You know work and span (the two-number cost model from the previous topic) and you've seen the reduction tree that sums `n` numbers in `log n` span. Now you want *all* the running totals, not just the final one — and the shocking fact that this can *also* be done in `log n` span, even though it looks hopelessly sequential.
> **Read time:** ~40 minutes. **Focus:** "Each prefix sum seems to need the one before it — so how on earth is this a *parallel* primitive with `Θ(log n)` span? And once I have it, what does it let me build?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Scan Operation: Inclusive and Exclusive](#the-scan-operation-inclusive-and-exclusive)
5. [The Surprise: It Looks Sequential but Isn't](#the-surprise-it-looks-sequential-but-isnt)
6. [Why Associativity Lets You Regroup](#why-associativity-lets-you-regroup)
7. [The Sequential Scan: Work n, Span n](#the-sequential-scan-work-n-span-n)
8. [The Hillis–Steele Scan, Drawn Step by Step](#the-hillissteele-scan-drawn-step-by-step)
9. [Counting Work and Span of Hillis–Steele](#counting-work-and-span-of-hillissteele)
10. [Why It Matters: Stream Compaction](#why-it-matters-stream-compaction)
11. [More Things That Are Secretly a Scan](#more-things-that-are-secretly-a-scan)
12. [Code: Sequential Scan](#code-sequential-scan)
13. [Code: Hillis–Steele Scan, Round by Round](#code-hillissteele-scan-round-by-round)
14. [Code: Stream Compaction with Scan](#code-stream-compaction-with-scan)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

In the previous topic you met the **reduction tree**: summing `n` numbers in `Θ(log n)` span instead of `Θ(n)`, by adding them in a balanced tree rather than a left-to-right chain. That gave you *one* number — the grand total. But a huge number of real computations need something subtler: not just the total, but **every running total along the way.** Given `[3, 1, 7, 0, 4, 1, 6, 3]`, you want `[3, 4, 11, 11, 15, 16, 22, 25]` — the sum of the first element, then the first two, then the first three, and so on. That operation is called a **prefix sum**, or more generally a **scan**, and it is one of the most important parallel primitives there is.

Here's the catch that makes scan fascinating. Look at that output array: each entry is the previous entry plus the next input. `11 = 4 + 7`, `15 = 11 + 4`, `25 = 22 + 3`. *Every output seems to depend on the one before it.* It looks like the most stubbornly sequential thing imaginable — a chain of dependencies of length `n`, exactly the shape we learned creates **zero parallelism**. If you'd never seen the trick, you'd swear prefix sum cannot be parallelized at all.

And yet it can. Prefix sum has **`Θ(log n)` span** with **`Θ(n)` (or `Θ(n log n)`) work** — it is a genuinely, deeply parallel operation. The reason is the same magic that powered the reduction tree: **associativity**. Because `(a + b) + c = a + (b + c)`, you're allowed to regroup the additions, and that freedom lets you compute all `n` prefixes through a tree of combinations instead of a chain. This is the single most counterintuitive and useful result in introductory parallel algorithms, and once it clicks, you start seeing scans *everywhere*.

Why care so much about running totals? Because scan is the **Swiss Army knife of parallel programming**. The headline application is **stream compaction** — filtering an array in parallel. If you mark which elements to keep with a 0/1 flag array, a scan of those flags tells each kept element *exactly where it should go* in the output, so all the survivors can be written simultaneously with no collisions. That one trick — flags → scan → output positions — is how parallel `filter`, parallel quicksort partitioning, radix-sort bucketing, run-length encoding, and line-of-sight all work. The saying in the field is blunt: **"If you can phrase it as a scan, you can parallelize it."**

This file builds the whole picture from scratch. We'll pin down **inclusive** vs **exclusive** scan on a worked array; sit with the "looks sequential but isn't" surprise; see precisely how associativity buys us the right to regroup; contrast the **sequential scan** (work `n`, span `n`) with the **Hillis–Steele** parallel scan drawn step by step on 8 elements (work `n log n`, span `log n`); and then work **stream compaction** end to end. You'll get runnable code for all three: the sequential scan, a step-simulated Hillis–Steele that prints every round, and a parallel-filter built on scan. The work-efficient **Blelloch up-sweep/down-sweep** scan — which gets the work back down to `Θ(n)` — is introduced in [the middle-level treatment](./middle.md); here we focus on the simplest parallel scan and the intuition that makes it click.

---

## Prerequisites

- **Required:** The **work–span model** — what work `T₁` (total operations, time on one processor) and span `T∞` (longest dependency chain, time on infinitely many processors) mean, and that **parallelism = work / span**. All of it is set up in [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md). We lean on it constantly.
- **Required:** The **reduction tree** for summing `n` numbers in `Θ(log n)` span (also from that file). Scan is its close cousin — same associativity trick, but keeping *all* the partial results.
- **Required:** Big-O basics — `Θ(n)`, `Θ(log n)`, `Θ(n log n)` — and comfort reading a simple array loop. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Helpful:** A vague picture of "running many threads/goroutines at once." We define the algorithm abstractly and simulate the rounds, so no real threading is required to follow it.
- **Helpful:** Having seen `filter`/`map` on arrays in any language — stream compaction is just a parallel `filter`, and the connection lands faster if `filter` is familiar.

No calculus, no probability, no specific hardware. Every cost is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Scan** | Given a sequence and an associative operator `⊕`, produce all the prefix combinations (every running total). |
| **Prefix sum** | A scan where `⊕` is `+`. The most common scan; "prefix sum" and "scan" are often used interchangeably. |
| **Inclusive scan** | Output `i` includes input `i`: `out[i] = a₀ ⊕ a₁ ⊕ … ⊕ aᵢ`. |
| **Exclusive scan** | Output `i` excludes input `i`: `out[0] = identity`, `out[i] = a₀ ⊕ … ⊕ aᵢ₋₁`. Each output is "the combination of everything *before* me." |
| **Associative operator (`⊕`)** | An operator where `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` — grouping doesn't change the result. Required for scan to parallelize. |
| **Identity** | The value `e` with `e ⊕ x = x` (e.g. `0` for `+`, `1` for `×`, `−∞` for `max`). The first element of an exclusive scan. |
| **Hillis–Steele scan** | A simple parallel scan: in round `d`, each element adds the element `2ᵈ` positions back. Span `log n`, work `n log n`. |
| **Blelloch scan** | A *work-efficient* parallel scan (up-sweep + down-sweep), work `Θ(n)`, span `Θ(log n)`. Covered in [middle](./middle.md). |
| **Work-efficient** | Doing the same total work `Θ(n)` as the best sequential algorithm (not more). Hillis–Steele is *not* work-efficient; Blelloch is. |
| **Stream compaction** | Filtering an array in parallel: keep the elements passing a predicate, packed contiguously, using a scan to compute output positions. |
| **Flag array** | A 0/1 array marking which elements to keep (1) or drop (0). Scanning it gives each survivor its output index. |
| **Work / Span** | (From the previous topic.) Work `T₁` = total operations; span `T∞` = longest dependency chain. Parallelism = `T₁/T∞`. |

---

## The Scan Operation: Inclusive and Exclusive

Let's nail down exactly what scan produces, because the two flavors trip people up constantly. Start with an input array and an **associative operator** `⊕`. For prefix *sum*, `⊕` is `+`, so we'll use that throughout. Take this 8-element array:

```
input:   [ 3,  1,  7,  0,  4,  1,  6,  3 ]
index:     0   1   2   3   4   5   6   7
```

**Inclusive scan** produces, at each position `i`, the combination of all inputs **from 0 through `i`, including `i` itself**:

```
out[0] = 3                          = 3
out[1] = 3 + 1                      = 4
out[2] = 3 + 1 + 7                  = 11
out[3] = 3 + 1 + 7 + 0             = 11
out[4] = 3 + 1 + 7 + 0 + 4         = 15
out[5] = 3 + 1 + 7 + 0 + 4 + 1     = 16
out[6] = 3 + 1 + 7 + 0 + 4 + 1 + 6 = 22
out[7] = 3 + 1 + 7 + … + 3         = 25

INCLUSIVE:  [ 3,  4, 11, 11, 15, 16, 22, 25 ]
```

Notice the very last entry, `25`, is the **grand total** — an inclusive scan always *ends* with the full reduction. So a scan is "a reduction that shows its work": you get the final sum *and* every partial sum on the way.

**Exclusive scan** produces, at each position `i`, the combination of all inputs **strictly before `i`** (not including `i`). Position 0 has nothing before it, so it gets the **identity** (for `+`, that's `0`):

```
out[0] = (identity)                = 0
out[1] = 3                          = 3
out[2] = 3 + 1                      = 4
out[3] = 3 + 1 + 7                  = 11
out[4] = 3 + 1 + 7 + 0             = 11
out[5] = 3 + 1 + 7 + 0 + 4         = 15
out[6] = 3 + 1 + 7 + 0 + 4 + 1     = 16
out[7] = 3 + 1 + 7 + 0 + 4 + 1 + 6 = 22

EXCLUSIVE:  [ 0,  3,  4, 11, 11, 15, 16, 22 ]
```

Put them side by side and the relationship is clean:

```
input:     [ 3,  1,  7,  0,  4,  1,  6,  3 ]
inclusive: [ 3,  4, 11, 11, 15, 16, 22, 25 ]   ← out[i] includes a[i]
exclusive: [ 0,  3,  4, 11, 11, 15, 16, 22 ]   ← out[i] excludes a[i]; starts at identity
```

The exclusive scan is just the inclusive scan **shifted right by one**, with the identity slotted into position 0 and the grand total falling off the end. Both carry the same information; which one you want depends on the application. **Exclusive scan is the one you'll reach for most**, because of what it means: `exclusive[i]` answers "how much came *before* element `i`?" — and in stream compaction, that's *exactly* the output index for element `i` (the number of survivors before it). Keep that interpretation in your back pocket; it's why scan is so useful.

> **The mental model:** an **inclusive** scan answers "running total *up to and including* me," and an **exclusive** scan answers "running total of everything *before* me." Inclusive ends with the grand total; exclusive starts with the identity. They're a one-position shift apart, and you can convert either to the other trivially.

---

## The Surprise: It Looks Sequential but Isn't

Now stare at the inclusive scan output and ask: *how would I compute this?* The obvious way is to keep a running total and sweep left to right:

```
running = 0
out[0] = running = running + 3   → 3
out[1] = running = running + 1   → 4
out[2] = running = running + 7   → 11
...
```

Each `out[i]` is `out[i-1] + a[i]`. **Every output reads the previous output.** That is a dependency chain of length `n` — the *exact* shape the previous topic identified as the worst case for parallelism: work `n`, span `n`, parallelism `Θ(1)`. By that reasoning, scan should be impossible to parallelize. A thousand processors couldn't help, because `out[5]` can't be computed until `out[4]` exists, which can't be computed until `out[3]` exists…

This is the surprise at the heart of this whole topic, so let's say it loudly:

> **Scan *looks* inherently sequential — each prefix seems to need the previous one — but it is one of the most parallel operations there is, with `Θ(log n)` span.**

How can both be true? Because the left-to-right running total is just **one particular way** to compute scan — and it happens to be the worst possible way for parallelism. It artificially threads everything through a single accumulator, manufacturing a chain that *doesn't have to be there*. The values `out[i]` are defined by the inputs; they are *facts about the input array*, not facts that must be discovered in order. The dependency chain is an artifact of the algorithm, not of the problem.

The key realization: `out[5] = a₀ + a₁ + a₂ + a₃ + a₄ + a₅` is just a **sum of six numbers**. We already know how to sum numbers fast — with a *tree*, in `log n` span, thanks to associativity. We don't have to compute it as `out[4] + a₅`; we can compute it directly from the inputs by tree-combining. The trick of the parallel scan is to compute *all* these prefix-sums together, sharing the tree-combinations between them so we don't redo work. The chain dissolves. Let's see exactly why associativity grants this freedom.

---

## Why Associativity Lets You Regroup

Associativity is the property `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` — **where you put the parentheses doesn't change the answer.** Addition has it, multiplication has it, `max` and `min` have it, string concatenation has it, "take the last non-null" has it. (Subtraction does *not*: `(5 − 3) − 1 = 1` but `5 − (3 − 1) = 3`. This is why you can't parallelize a running *difference* the same way.)

Why does regrouping freedom create parallelism? Because a dependency chain is forced **only when you must evaluate strictly left to right.** Consider computing `a₀ + a₁ + a₂ + a₃`:

```
SEQUENTIAL grouping (a chain — span 3):
  ((a₀ + a₁) + a₂) + a₃
   step1: a₀ + a₁      ← must finish first
   step2: (…) + a₂      ← waits for step1
   step3: (…) + a₃      ← waits for step2
  Three additions, each waiting on the last. Span = 3.

TREE grouping (associativity lets us re-parenthesize — span 2):
  (a₀ + a₁) + (a₂ + a₃)
   step1a: a₀ + a₁  ┐
   step1b: a₂ + a₃  ┘ ← these two are INDEPENDENT, run AT THE SAME TIME
   step2:  (…) + (…) ← waits for both, but they finished together
  Still three additions (same WORK), but span = 2.
```

Associativity guarantees both groupings give the *identical* result, so we are **free to choose the tree grouping** — and the tree grouping has the shorter critical path. With `n` numbers, the chain has span `n−1` while the balanced tree has span `log₂ n`. That's precisely the reduction-tree result from the previous topic.

For *scan*, we want every prefix `out[0], out[1], …, out[n−1]`, each of which is a prefix-combination of inputs. Each one individually could be computed by a tree in `log n` span. The cleverness of a parallel scan algorithm is to compute **all of them at once**, reusing the intermediate tree-sums so the total work stays reasonable. Associativity is the permission slip for *all* of it: it lets each prefix be regrouped into a tree, and it lets different prefixes share the same partial sums. Without associativity, none of this is legal — you'd be stuck with the left-to-right chain.

> **The throughline:** the left-to-right scan has span `n` because it *insists* on one grouping. Associativity says every grouping is equally valid — so pick the tree-shaped ones, where independent combinations happen simultaneously, and the span collapses to `log n`. **Associativity is what turns the chain into a tree.** Everything in this topic flows from that one property.

---

## The Sequential Scan: Work n, Span n

Before the parallel version, let's be precise about the baseline — the running-total loop — because it's both the simplest correct scan and the one we want to *beat* in span (while not losing too badly in work).

```
sequential inclusive scan:
  out[0] = a[0]
  for i = 1 to n-1:
      out[i] = out[i-1] + a[i]      ← reads the PREVIOUS output
```

Analyze it with the two-number model:

- **Work `T₁ = Θ(n)`** — exactly `n−1` additions. This is optimal: any scan must at least look at every element, and you can't beat `n` additions. The sequential scan is **work-optimal**.
- **Span `T∞ = Θ(n)`** — the dependency chain. `out[i]` reads `out[i-1]`, so the critical path runs straight through all `n` outputs, one after another. No regrouping is attempted.
- **Parallelism `T₁/T∞ = Θ(n)/Θ(n) = Θ(1)`** — **none.** As written, this algorithm cannot use more than one processor.

```
DAG of the sequential scan — a pure chain:

  a₀ → out₀ → out₁ → out₂ → out₃ → … → outₙ₋₁
              (each output waits for the previous one)
```

So the sequential scan is *perfect on work and terrible on span*. Its only flaw is that it commits to one left-to-right grouping. Our goal for the parallel version: **collapse the span to `Θ(log n)`** by regrouping into a tree — ideally without inflating the work too much. The first and simplest algorithm that does this is Hillis–Steele.

---

## The Hillis–Steele Scan, Drawn Step by Step

The **Hillis–Steele** scan (named for Danny Hillis and Guy Steele, who used it on the Connection Machine) is the simplest parallel scan, and its rule is almost shockingly short:

> **For `log₂ n` rounds, numbered `d = 0, 1, 2, …`: in round `d`, every element at position `i` adds to itself the element `2ᵈ` positions to its left** (if that position exists). All elements update *simultaneously* within a round.

That's the whole algorithm. The "stride" doubles every round: `1, 2, 4, 8, …`. After `log₂ n` rounds, every position holds its inclusive prefix sum. Let's watch it happen on our 8-element array. (Each round reads the *previous* round's array and writes a fresh one — every position updates at the same instant.)

```
START (round -1, the input):
  pos:    0    1    2    3    4    5    6    7
        [ 3 ][ 1 ][ 7 ][ 0 ][ 4 ][ 1 ][ 6 ][ 3 ]
```

**Round d = 0, stride 1:** each position adds the element 1 to its left. Position 0 has nothing 1 to its left, so it's unchanged.

```
  pos 0: 3                     (no left neighbor) → 3
  pos 1: 1 + 3                                    → 4
  pos 2: 7 + 1                                    → 8
  pos 3: 0 + 7                                    → 7
  pos 4: 4 + 0                                    → 4
  pos 5: 1 + 4                                    → 5
  pos 6: 6 + 1                                    → 7
  pos 7: 3 + 6                                    → 9

  after round 0 (stride 1):
        [ 3 ][ 4 ][ 8 ][ 7 ][ 4 ][ 5 ][ 7 ][ 9 ]
   each cell now holds the sum of a span of 2 inputs (where it can)
```

**Round d = 1, stride 2:** each position adds the element 2 to its left. Positions 0 and 1 have no element 2 to the left, so they're unchanged.

```
  pos 0: 3                     (none) → 3
  pos 1: 4                     (none) → 4
  pos 2: 8 + 3                        → 11
  pos 3: 7 + 4                        → 11
  pos 4: 4 + 8                        → 12
  pos 5: 5 + 7                        → 12
  pos 6: 7 + 4                        → 11
  pos 7: 9 + 5                        → 14

  after round 1 (stride 2):
        [ 3 ][ 4 ][ 11 ][ 11 ][ 12 ][ 12 ][ 11 ][ 14 ]
   each cell now holds the sum of a span of 4 inputs (where it can)
```

**Round d = 2, stride 4:** each position adds the element 4 to its left. Positions 0–3 have no element 4 to the left, so they're unchanged.

```
  pos 0: 3                       (none) → 3
  pos 1: 4                       (none) → 4
  pos 2: 11                      (none) → 11
  pos 3: 11                      (none) → 11
  pos 4: 12 + 3                         → 15
  pos 5: 12 + 4                         → 16
  pos 6: 11 + 11                        → 22
  pos 7: 14 + 11                        → 25

  after round 2 (stride 4):
        [ 3 ][ 4 ][ 11 ][ 11 ][ 15 ][ 16 ][ 22 ][ 25 ]
```

Compare that final row to the inclusive scan we computed by hand earlier:

```
  Hillis–Steele result:  [ 3, 4, 11, 11, 15, 16, 22, 25 ]
  hand-computed scan:    [ 3, 4, 11, 11, 15, 16, 22, 25 ]   ✓ identical
```

**Three rounds — `log₂ 8 = 3` — and we're done.** Why does the doubling stride work? Track how wide a "window" each cell covers. After round 0, each cell holds the sum of (up to) **2** consecutive inputs ending at its position. After round 1, when it adds the cell 2 to its left — which itself covers 2 inputs — it now covers **4**. After round 2, adding the cell 4 to its left (covering 4 inputs) makes it cover **8**. The covered window *doubles* each round, so after `log₂ n` rounds every cell covers all the inputs up to and including itself — which is exactly its inclusive prefix sum.

```
  window covered by each cell, doubling every round:
    round 0 → width 2
    round 1 → width 4
    round 2 → width 8
    …
    round d → width 2^(d+1)
  after log₂ n rounds → width n  → full prefix at every position
```

This is the reduction-tree idea applied *at every position simultaneously*, with the partial sums shared across positions. That sharing is exactly the "compute all prefixes at once" cleverness we promised.

---

## Counting Work and Span of Hillis–Steele

Now put the two numbers on it.

- **Span `T∞ = Θ(log n)`.** There are `log₂ n` rounds, and within a round every position updates *independently and simultaneously* (each reads the old array, writes the new — no position waits for another within the round). So the critical path is just "round 0 → round 1 → … → round log n", a chain of `log₂ n` steps. **For n = 8, that's 3; for n = 1,000,000, about 20.** The span collapsed from `n` to `log n` — exactly the win we wanted.

- **Work `T₁ = Θ(n log n)`.** Each of the `log₂ n` rounds does up to `n` additions (one per position). So total work is about `n · log₂ n`. For `n = 1,000,000` that's about `20,000,000` additions — versus the sequential scan's `1,000,000`. **Hillis–Steele does a factor of `log n` *more* total work** than the sequential scan.

- **Parallelism `T₁/T∞ = Θ(n log n) / Θ(log n) = Θ(n)`** — enormous. You can keep `Θ(n)` processors busy.

Lay it next to the sequential scan and the reduction tree:

```
                       Work T₁      Span T∞     Parallelism
  sequential scan      Θ(n)         Θ(n)        Θ(1)         ← work-optimal, no parallelism
  Hillis–Steele scan   Θ(n log n)   Θ(log n)    Θ(n)         ← tiny span, but extra work
  (reduction, sum only Θ(n)         Θ(log n)    Θ(n/log n))  ← for comparison: just the total
```

So Hillis–Steele made a **trade**: it crushed the span from `n` to `log n` (great), but paid for it with a factor of `log n` *more work* (the `n log n` instead of `n`). That extra work is real — on a machine with few processors it can make Hillis–Steele *slower* than the sequential loop, because the loop does less total arithmetic. An algorithm that does the same `Θ(n)` work as the best sequential one is called **work-efficient**, and Hillis–Steele is *not* work-efficient.

> **The honest trade-off:** Hillis–Steele is the *simplest* parallel scan and the easiest to understand, but it is **not work-efficient** — it does `Θ(n log n)` work for a `Θ(n)` problem. The **Blelloch scan** (an up-sweep building a reduction tree, then a down-sweep distributing the partials) achieves the same `Θ(log n)` span with only `Θ(n)` work — the best of both worlds. That algorithm, and *when* the extra work of Hillis–Steele is worth its simplicity, is the subject of [the middle file](./middle.md). For now, the lesson is: **scan is `Θ(log n)` span — provably parallel — and Hillis–Steele is the clearest proof of it.**

---

## Why It Matters: Stream Compaction

Time for the application that makes people fall in love with scan: **stream compaction**, which is just *parallel filter*. You have an array and a predicate ("keep the even numbers," "keep the rows matching this query," "keep the live particles"), and you want an output array containing only the survivors, **packed contiguously**, computed in parallel.

The sequential version is trivial: walk the array, and whenever an element passes, append it. But "append" hides a serial dependency — *where* each survivor goes depends on how many survivors came before it. With many processors all trying to write survivors at once, they'd collide: two processors might both think their element goes at output index 0. We need each survivor to know its **exact output position** without talking to the others. **That's an exclusive scan of a flag array.** Here's the recipe, step by step.

Suppose we want to keep the **even** numbers from this array:

```
STEP 1 — input array:
  index:    0    1    2    3    4    5    6    7
  value:  [ 5 ][ 2 ][ 8 ][ 3 ][ 6 ][ 1 ][ 4 ][ 7 ]
  keep?    no   yes  yes  no   yes  no   yes  no    (keep evens)
```

```
STEP 2 — build the FLAG array: 1 if we keep the element, 0 if we drop it.
  flags:  [ 0 ][ 1 ][ 1 ][ 0 ][ 1 ][ 0 ][ 1 ][ 0 ]

  This step is embarrassingly parallel — each element decides its own flag
  independently, with no dependencies. Span O(1) with n processors.
```

```
STEP 3 — EXCLUSIVE SCAN the flags. This is the heart of the trick.
  flags:     [ 0 ][ 1 ][ 1 ][ 0 ][ 1 ][ 0 ][ 1 ][ 0 ]
  excl scan: [ 0 ][ 0 ][ 1 ][ 2 ][ 2 ][ 3 ][ 3 ][ 4 ]
                                                    ↑
  This last "fell off" value (4) = total number of survivors = output size.

  Read each scanned value as: "how many survivors are STRICTLY BEFORE me?"
  For a survivor, that count IS its output index!
```

```
STEP 4 — SCATTER: each survivor writes itself to output[scan_value], in parallel.
  Every survivor (flag == 1) copies its value to out[ exclusive_scan[i] ].

  index 1 (value 2): flag=1, scan=0 → out[0] = 2
  index 2 (value 8): flag=1, scan=1 → out[1] = 8
  index 4 (value 6): flag=1, scan=2 → out[2] = 6
  index 6 (value 4): flag=1, scan=3 → out[3] = 4

  output: [ 2 ][ 8 ][ 6 ][ 4 ]      ← the evens, packed, in original order
```

Look at what just happened. The exclusive scan told **every survivor exactly where to go** — and because each survivor's destination is *different* (the scan values for survivors are `0, 1, 2, 3` — distinct!), **all four writes can happen simultaneously with no collisions.** No appending, no shared counter, no processor waiting for another. The entire filter is:

```
  flags  (parallel, O(1) span)
    → exclusive scan  (the only non-trivial part: O(log n) span)
    → scatter         (parallel, O(1) span)
  TOTAL SPAN: O(log n), dominated by the scan.
```

A filter — which feels inherently sequential because "where does the next survivor go?" depends on history — becomes a `Θ(log n)`-span parallel operation, entirely because the scan computes all those "how many before me" answers at once. **This is *the* reason scan is a fundamental primitive.** It converts "position depends on what came before" — the essence of sequential — into a parallel lookup.

> **The pattern to memorize:** *parallel filter = flags → exclusive-scan → scatter.* The scan turns each survivor's "I go after everyone before me" into a concrete, collision-free index. Once you see this, you'll recognize it inside parallel quicksort, radix sort, sparse-matrix building, and a dozen other algorithms — they're all "compute positions with a scan, then scatter."

---

## More Things That Are Secretly a Scan

Stream compaction is the gateway, but the same "phrase it as a scan" move unlocks a surprising range of problems. A quick tour, so you start recognizing the shape:

- **Parallel quicksort / radix partition positions.** Partitioning around a pivot means putting all the "less than pivot" elements on the left and the rest on the right — *contiguously*. That's two stream compactions (one for each side), so it's two scans. Radix sort's bucketing is the same idea generalized to `k` buckets: a scan of per-bucket counts gives each element its destination. Parallel sorting leans on scan heavily — see [Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md).

- **Run-length encoding (RLE).** To compress `AAABBC` into `(A,3)(B,2)(C,1)`, you first mark where each "run" starts (a flag: 1 if this element differs from the previous), then a scan assigns each run an index, and a scatter writes the run records. Same flags → scan → scatter skeleton.

- **Line-of-sight.** Standing at the left of a terrain, which points can you see? A point is visible if its viewing angle exceeds the maximum angle of everything before it — that's a **scan with `max`** as the operator (`max` is associative, identity `−∞`). The running maximum is a prefix-max, computed in `log n` span exactly like prefix-sum.

- **Bucketing / histogram offsets.** When binning `n` items into buckets, a scan over the bucket counts gives the starting offset of each bucket in the output array — so every item can be placed in parallel without a shared per-bucket counter.

- **Counting / allocation.** Any time many parallel tasks each need a distinct slice of an output array sized to *their* contribution, an exclusive scan over "how much each task needs" hands every task its starting offset. ("I produce 3 results, you produce 5" → scan → "you start at index 3.")

The unifying insight is the field's mantra:

> **"If you can phrase it as a scan, you can parallelize it."** Whenever a computation has the flavor "each element's result depends on an accumulation of everything before it" — a running total, a running max, a position that depends on prior counts — it is *probably* a scan in disguise, which means it has `Θ(log n)` span and is parallelizable. Learning to *spot* the scan is the skill. The reduction-tree generalization to any associative combine is in [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md).

---

## Code: Sequential Scan

Let's make all three pieces runnable, starting with the baseline. The sequential scan is the simplest correct implementation and the reference we check the parallel versions against. We'll write both inclusive and exclusive.

### Go: sequential inclusive and exclusive scan

```go
package main

import "fmt"

// inclusiveScan returns the running totals INCLUDING each element.
// out[i] = a[0] + a[1] + ... + a[i].  Work Θ(n), span Θ(n) (the running total chain).
func inclusiveScan(a []int) []int {
	out := make([]int, len(a))
	if len(a) == 0 {
		return out
	}
	out[0] = a[0]
	for i := 1; i < len(a); i++ {
		out[i] = out[i-1] + a[i] // each output reads the PREVIOUS output — the chain
	}
	return out
}

// exclusiveScan returns the running totals EXCLUDING each element.
// out[0] = 0 (the identity for +); out[i] = a[0] + ... + a[i-1].
func exclusiveScan(a []int) []int {
	out := make([]int, len(a))
	running := 0 // identity for +
	for i := 0; i < len(a); i++ {
		out[i] = running // record total of everything BEFORE i...
		running += a[i]  // ...then fold in a[i] for the next position
	}
	return out
}

func main() {
	a := []int{3, 1, 7, 0, 4, 1, 6, 3}
	fmt.Println("input:    ", a)
	fmt.Println("inclusive:", inclusiveScan(a)) // [3 4 11 11 15 16 22 25]
	fmt.Println("exclusive:", exclusiveScan(a)) // [0 3 4 11 11 15 16 22]
}
```

### Python: sequential inclusive and exclusive scan

```python
def inclusive_scan(a):
    """out[i] = a[0] + ... + a[i].  The grand total ends the array."""
    out = []
    running = 0
    for x in a:
        running += x        # include this element...
        out.append(running) # ...then record the running total
    return out

def exclusive_scan(a):
    """out[0] = identity (0); out[i] = a[0] + ... + a[i-1]."""
    out = []
    running = 0  # identity for +
    for x in a:
        out.append(running)  # record total BEFORE this element...
        running += x         # ...then fold this element in
    return out

if __name__ == "__main__":
    a = [3, 1, 7, 0, 4, 1, 6, 3]
    print("input:    ", a)
    print("inclusive:", inclusive_scan(a))  # [3, 4, 11, 11, 15, 16, 22, 25]
    print("exclusive:", exclusive_scan(a))  # [0, 3, 4, 11, 11, 15, 16, 22]
```

**What it does:** both are the running-total loop — work `Θ(n)`, span `Θ(n)`. The only difference between inclusive and exclusive is *when* you record the running total relative to folding in the current element: exclusive records *before* (so position 0 gets the identity), inclusive records *after* (so the last position gets the grand total). These are our ground-truth implementations; the parallel scan below must produce the identical inclusive array.

---

## Code: Hillis–Steele Scan, Round by Round

Now the parallel algorithm. We can't easily show `n` processors literally firing at once in a junior-level snippet, but we can **simulate the rounds faithfully**: each round reads the previous round's array in full and writes a brand-new array, which is exactly the "all positions update simultaneously" semantics. Printing each round makes the doubling-stride window growth visible — you'll watch the prefix sums assemble.

### Python: Hillis–Steele scan, printing every round

```python
def hillis_steele_scan(a, verbose=True):
    """
    Parallel INCLUSIVE scan, Hillis–Steele style.
    log2(n) rounds; in round d, position i adds the element 2^d to its left.
    Span Θ(log n), work Θ(n log n).

    We model "all positions update at once" by reading `cur` (the previous
    round) and writing a fresh `nxt` — no position sees another's update
    within the same round.
    """
    cur = list(a)
    n = len(cur)
    if verbose:
        print(f"start:           {cur}")
    stride = 1
    rnd = 0
    while stride < n:
        nxt = list(cur)  # fresh array for this round's results
        for i in range(n):
            if i >= stride:
                # add the element `stride` positions to the left (from the OLD array)
                nxt[i] = cur[i] + cur[i - stride]
            # else: no element `stride` to the left → value carries unchanged
        cur = nxt
        if verbose:
            print(f"after round {rnd} (stride {stride}): {cur}")
        stride *= 2
        rnd += 1
    return cur


if __name__ == "__main__":
    a = [3, 1, 7, 0, 4, 1, 6, 3]
    result = hillis_steele_scan(a)
    print(f"\ninclusive scan:  {result}")
```

Running it prints the exact rounds we drew by hand:

```
start:           [3, 1, 7, 0, 4, 1, 6, 3]
after round 0 (stride 1): [3, 4, 8, 7, 4, 5, 7, 9]
after round 1 (stride 2): [3, 4, 11, 11, 12, 12, 11, 14]
after round 2 (stride 4): [3, 4, 11, 11, 15, 16, 22, 25]

inclusive scan:  [3, 4, 11, 11, 15, 16, 22, 25]
```

### Go: Hillis–Steele scan

```go
package main

import "fmt"

// hillisSteeleScan computes an inclusive scan in log2(n) rounds.
// Round d: position i adds the element `stride = 2^d` positions to its left.
// Within a round, every position reads `cur` (the old array) and writes `nxt`,
// modeling simultaneous updates.  Span Θ(log n), work Θ(n log n).
func hillisSteeleScan(a []int) []int {
	n := len(a)
	cur := make([]int, n)
	copy(cur, a)
	for stride := 1; stride < n; stride *= 2 {
		nxt := make([]int, n)
		copy(nxt, cur)
		for i := stride; i < n; i++ {
			nxt[i] = cur[i] + cur[i-stride] // read OLD array, write fresh one
		}
		cur = nxt
	}
	return cur
}

func main() {
	a := []int{3, 1, 7, 0, 4, 1, 6, 3}
	fmt.Println("input:         ", a)
	fmt.Println("inclusive scan:", hillisSteeleScan(a)) // [3 4 11 11 15 16 22 25]
}
```

> **The crucial detail — read-old, write-new.** Each round must read the *previous* round's array and write a *separate* fresh array. If you updated in place, a position might add a neighbor that was *already updated this round*, double-counting and corrupting the result. The "fresh `nxt` array" is what makes every position's update independent within a round — which is *why* the round has `O(1)` span (no position waits for another) and the whole scan has `O(log n)` span. The number of rounds is `⌈log₂ n⌉`; you can literally count the printed rounds to confirm the span.

---

## Code: Stream Compaction with Scan

Finally, the payoff: parallel filter built from a scan. We follow the flags → exclusive-scan → scatter recipe exactly. The scatter step is where the magic shows — each survivor writes to a *distinct* index handed to it by the scan, so the writes never collide.

### Python: stream compaction (parallel filter)

```python
def exclusive_scan(flags):
    """Exclusive scan of the 0/1 flag array. flags[i]'s output = #survivors before i."""
    out, running = [], 0
    for f in flags:
        out.append(running)
        running += f
    return out, running  # also return the total = output size

def stream_compact(a, keep):
    """
    Parallel-filter skeleton: keep elements where keep(x) is True, packed
    contiguously in original order.
    Steps:  flags  →  exclusive scan  →  scatter.
    """
    # STEP 1: flags — each element decides independently (embarrassingly parallel).
    flags = [1 if keep(x) else 0 for x in a]

    # STEP 2: exclusive scan of flags — the only O(log n)-span step.
    #         positions[i] = how many survivors are strictly before index i.
    positions, total = exclusive_scan(flags)

    # STEP 3: scatter — every survivor writes itself to its OWN slot, in parallel.
    out = [None] * total
    for i, x in enumerate(a):
        if flags[i] == 1:
            out[positions[i]] = x  # distinct index per survivor → no collisions
    return out


if __name__ == "__main__":
    a = [5, 2, 8, 3, 6, 1, 4, 7]
    flags = [1 if x % 2 == 0 else 0 for x in a]
    positions, total = exclusive_scan(flags)
    print("input:    ", a)
    print("flags:    ", flags)      # [0, 1, 1, 0, 1, 0, 1, 0]
    print("scan:     ", positions)  # [0, 0, 1, 2, 2, 3, 3, 4]
    print("survivors:", total)      # 4
    print("output:   ", stream_compact(a, lambda x: x % 2 == 0))  # [2, 8, 6, 4]
```

### Go: stream compaction

```go
package main

import "fmt"

// exclusiveScan returns the per-position "survivors before me" array and the total.
func exclusiveScan(flags []int) ([]int, int) {
	out := make([]int, len(flags))
	running := 0
	for i, f := range flags {
		out[i] = running
		running += f
	}
	return out, running
}

// streamCompact keeps elements where pred(x) is true, packed contiguously.
// flags → exclusive scan → scatter. The scatter writes are collision-free
// because each survivor's destination index (from the scan) is distinct.
func streamCompact(a []int, pred func(int) bool) []int {
	flags := make([]int, len(a))
	for i, x := range a {
		if pred(x) {
			flags[i] = 1
		}
	}
	positions, total := exclusiveScan(flags)

	out := make([]int, total)
	for i, x := range a {
		if flags[i] == 1 {
			out[positions[i]] = x // distinct slot per survivor — parallel-safe
		}
	}
	return out
}

func main() {
	a := []int{5, 2, 8, 3, 6, 1, 4, 7}
	even := func(x int) bool { return x%2 == 0 }
	fmt.Println("input: ", a)
	fmt.Println("output:", streamCompact(a, even)) // [2 8 6 4]
}
```

> **Why this is genuinely parallel.** Steps 1 (flags) and 3 (scatter) are *embarrassingly parallel* — every element acts independently, `O(1)` span with `n` processors. The only step with any dependency is step 2, the scan, at `O(log n)` span. So the whole filter is `O(log n)` span. The scatter is safe **because the scan guarantees distinct destinations**: survivors get scan values `0, 1, 2, 3, …` (each survivor increments the running count by exactly 1), so no two survivors ever target the same output slot. We simulate the scatter with a sequential loop here, but on real hardware all those writes fire at once — that's the point. Swap the sequential `exclusiveScan` for the Hillis–Steele scan above and you have a fully `O(log n)`-span filter.

---

## Common Misconceptions

- **"Prefix sum is inherently sequential — each output needs the previous one."** This is the headline misconception the whole topic exists to demolish. The left-to-right running total is *one* way to compute scan, and the worst one for parallelism. Because addition is associative, the prefixes can be regrouped into trees and computed in `Θ(log n)` span. The chain is an artifact of the naive algorithm, not the problem.

- **"Inclusive and exclusive scan are basically the same, so it doesn't matter which I use."** They differ by a one-position shift, but the *meaning* differs and it matters a lot in practice. **Exclusive** scan gives "total of everything *before* me," which is exactly an output index in stream compaction; **inclusive** ends with the grand total. Reach for the right one — using inclusive where you needed exclusive shifts every output position by one and breaks the scatter.

- **"Hillis–Steele is the best parallel scan."** It's the *simplest*, not the best. It does `Θ(n log n)` work — a factor of `log n` more than the sequential scan — so it's **not work-efficient**. The Blelloch up-sweep/down-sweep scan matches its `Θ(log n)` span with only `Θ(n)` work. Hillis–Steele wins on *simplicity*, not on work. (See [middle](./middle.md).)

- **"Scan only works for addition."** It works for *any associative operator* with an identity: `+`, `×`, `max`, `min`, `OR`, `AND`, string concatenation, "last non-null," matrix multiply, and many more. Prefix-*max* powers line-of-sight; prefix-OR appears in bit tricks. The one requirement is **associativity** — which is why running *subtraction* or *division* can't be scanned the same way.

- **"The scatter in stream compaction needs locking, since many writers run at once."** No — and that's the beauty of it. The scan hands each survivor a *distinct* destination index, so the parallel writes never target the same slot. No locks, no atomics, no contention. The scan *manufactured* the disjointness.

- **"More work always means slower."** Not in the parallel world. Hillis–Steele does *more* total work than the sequential scan, yet on a machine with many processors it finishes far sooner, because its `Θ(log n)` span lets all that work spread out. Work and span are different axes; the right trade depends on how many processors you have.

---

## Common Mistakes

- **Updating in place during a Hillis–Steele round.** If a round reads neighbors from the array it's currently writing, some positions add an *already-updated* value and double-count. Always read the previous round's array and write a fresh one (the read-old/write-new rule). This is the single most common bug when first coding the algorithm.

- **Off-by-one between inclusive and exclusive scan.** Mixing them up — recording the running total *after* folding in the element when you wanted it *before*, or vice versa — shifts every position by one. In stream compaction this silently misplaces every survivor. Decide which scan you need (for compaction: *exclusive*) and double-check position 0 (identity for exclusive, `a[0]` for inclusive).

- **Forgetting the operator must be associative (and have an identity).** Scan's parallelism *depends* on associativity. Trying to "scan" with subtraction, division, or any non-associative combine gives wrong answers when regrouped. Confirm `(a⊕b)⊕c = a⊕(b⊕c)` before reaching for a parallel scan.

- **Using Hillis–Steele when work-efficiency matters.** On few processors, its extra `log n` factor of work can make it *slower* than the plain sequential loop. If total work is your bottleneck (limited cores, large `n`), use the work-efficient Blelloch scan instead — same span, `Θ(n)` work.

- **Building stream compaction with a shared output counter.** The naive "atomically increment a global `next` index and write there" serializes all the writers on that one counter — destroying the parallelism. The whole point of the scan is to *replace* that shared counter with precomputed, distinct, per-element indices. Never reintroduce the counter.

- **Assuming the simulation's sequential loops mean the algorithm is sequential.** The code simulates each round / the scatter with a `for` loop for clarity, but the *algorithm* has the positions updating simultaneously. The cost to read off is the **span** (rounds for the scan, `O(1)` for flags/scatter), not the simulation's loop count. Judge it by the DAG, not the `for`.

---

## Cheat Sheet

```
THE SCAN OPERATION (associative ⊕, identity e)
  input:      [ a0, a1, a2, ... ]
  INCLUSIVE:  out[i] = a0 ⊕ a1 ⊕ ... ⊕ ai      (includes ai; ends with grand total)
  EXCLUSIVE:  out[0] = e; out[i] = a0 ⊕ ... ⊕ ai-1  (excludes ai; "total before me")
  PREFIX SUM = scan with ⊕ = +.   exclusive = inclusive shifted right by one.

THE SURPRISE
  Scan LOOKS sequential (each output = previous output ⊕ next input → chain, span n)
  but it's a PARALLEL primitive: span Θ(log n).  Associativity lets you regroup the
  chain into a TREE.  The left-to-right chain is the algorithm's fault, not the problem's.

SEQUENTIAL SCAN
  running total loop.  Work Θ(n) (optimal), Span Θ(n) (a chain), Parallelism Θ(1).

HILLIS–STEELE SCAN (the simplest parallel scan)
  for d = 0,1,2,...,log2(n)-1:  position i  +=  element (2^d) to its left
  (all positions update at once: read OLD array, write fresh array)
  windows double each round → after log n rounds, every cell holds its prefix.
  Span  Θ(log n)        ← the win
  Work  Θ(n log n)      ← a log n factor MORE than sequential → NOT work-efficient
  Parallelism Θ(n)
  (Blelloch up/down-sweep scan: same Θ(log n) span, Θ(n) work — see middle.md)

STREAM COMPACTION = PARALLEL FILTER  (the killer app)
  1. FLAGS:    flag[i] = 1 if keep(a[i]) else 0     (parallel, O(1) span)
  2. EX-SCAN:  pos = exclusive_scan(flags)          (the O(log n) step)
               pos[i] = # survivors before i = survivor i's OUTPUT INDEX
  3. SCATTER:  if flag[i]: out[pos[i]] = a[i]        (parallel, distinct slots → no locks)
  total span O(log n).  The scan turns "where do I go?" into a collision-free index.

WORKS FOR ANY ASSOCIATIVE ⊕:  + × max min OR AND concat ...   (NOT subtraction!)
ALSO A SCAN: quicksort/radix partition, run-length encoding, line-of-sight (prefix-max),
             histogram offsets, allocation offsets.

THE MANTRA:  "If you can phrase it as a scan, you can parallelize it."
```

---

## Summary

A **scan** takes a sequence and an associative operator `⊕` and produces *all* the prefix combinations — every running total. **Inclusive** scan includes each element (`out[i] = a₀ ⊕ … ⊕ aᵢ`, ending with the grand total); **exclusive** scan excludes it (`out[0] = identity`, `out[i] = a₀ ⊕ … ⊕ aᵢ₋₁`, meaning "the combination of everything before me"). **Prefix sum** is scan with `+`. The two flavors differ by a one-position shift, and exclusive scan's "what came before me" reading is what makes it so useful.

- **The central surprise:** scan *looks* hopelessly sequential — each output appears to need the previous one, a dependency chain of length `n` — yet it is one of the most parallel operations there is, with **`Θ(log n)` span**. The chain is an artifact of the naive running-total algorithm, not a property of the problem.

- **Why it's possible: associativity.** Because `(a⊕b)⊕c = a⊕(b⊕c)`, you're free to regroup the combinations from a left-to-right chain (span `n`) into a balanced tree (span `log n`), and to share partial results across the different prefixes. Associativity is the permission slip that turns the chain into a tree. (Operators without it — like subtraction — can't be scanned this way.)

- **The sequential scan** is a running-total loop: work `Θ(n)` (optimal) but span `Θ(n)` (a chain), so parallelism `Θ(1)`. Its only flaw is committing to one left-to-right grouping.

- **The Hillis–Steele scan** is the simplest parallel scan: for `log₂ n` rounds, each position adds the element `2ᵈ` positions to its left, with all positions updating simultaneously (read-old, write-new). The covered window doubles each round, so after `log n` rounds every position holds its prefix. **Span `Θ(log n)`** (the win) but **work `Θ(n log n)`** — a `log n` factor more than sequential, so it is *not work-efficient*. The work-efficient **Blelloch** scan (up-sweep/down-sweep) achieves `Θ(log n)` span with `Θ(n)` work and lives in [the middle file](./middle.md).

- **Why it matters: stream compaction** (parallel filter) is the headline application. Build a 0/1 **flag** array (parallel), **exclusive-scan** it so each survivor learns how many survivors precede it (its output index), then **scatter** every survivor to its distinct slot (parallel, collision-free). A filter — seemingly sequential because each survivor's position depends on history — becomes `Θ(log n)` span. The same flags → scan → scatter pattern powers parallel quicksort/radix partitioning, run-length encoding, line-of-sight (prefix-max), and bucketing.

The big idea to carry forward: **scan converts "my result depends on the accumulation of everything before me" — the very definition of sequential — into a parallel, `Θ(log n)`-span lookup.** That's why the field's mantra is *"if you can phrase it as a scan, you can parallelize it."* Learning to *spot* the scan inside a problem is the skill.

**Next steps:** [the middle-level treatment](./middle.md) builds the **work-efficient Blelloch scan** (up-sweep reduction tree + down-sweep distribution) that gets the work back to `Θ(n)`, and discusses *when* Hillis–Steele's simplicity is worth its extra work. Then [Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md) generalizes the reduction-and-scan idea to any associative combine; [Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md) shows scan powering partition and bucket positions; and the whole framework rests on the [work–span model](../01-models-pram-work-span/junior.md) from the previous topic.

---

## Further Reading

- **Guy Blelloch, *Prefix Sums and Their Applications* (CMU technical report, 1990)** — the definitive treatment of scan as a primitive, with the work-efficient algorithm and a tour of applications (compaction, sorting, line-of-sight). The single best next read.
- **Hillis & Steele, "Data Parallel Algorithms" (*Communications of the ACM*, 1986)** — the original presentation of the simple doubling-stride scan, in the context of the Connection Machine.
- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Multithreaded Algorithms"** — the work–span analysis of scan-like computations in the same framework used throughout this section.
- **Mark Harris et al., "Parallel Prefix Sum (Scan) with CUDA" (GPU Gems 3)** — a vivid, picture-heavy walkthrough of both Hillis–Steele and the work-efficient Blelloch scan on real GPU hardware, including why work-efficiency matters in practice.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — the work/span model and the reduction tree this topic builds on.
- **[Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)** and **[Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md)** — where scan is generalized and put to work.
- **[Parallel Prefix Sum (Scan) — Middle](./middle.md)** — the work-efficient Blelloch up-sweep/down-sweep scan, segmented scan, and the work-vs-simplicity trade-off in depth.
