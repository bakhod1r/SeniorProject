# Fork-Join and Work-Stealing — Junior Level

> **Audience:** You know the work–span model — work `T₁`, span `T∞`, and that parallelism is their ratio — and you've seen the reduction tree that sums `n` numbers in `Θ(log n)` span. Now you'll learn the *programming model* that lets you write divide-and-conquer parallelism naturally (fork-join), and the beautiful *scheduling* idea (work-stealing) that maps your tasks onto real processors and delivers the Brent guarantee in practice.
> **Read time:** ~40 minutes. **Focus:** "How do I actually *write* parallel divide-and-conquer code, and how does the runtime turn 'thousands of tiny tasks' into 'kept all my cores busy' without a central traffic cop?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Fork and Join: The Two Primitives](#fork-and-join-the-two-primitives)
5. [Parallel Sum as a Fork-Join Tree](#parallel-sum-as-a-fork-join-tree)
6. [Fork-Join Builds the Computation DAG](#fork-join-builds-the-computation-dag)
7. [The Scheduling Problem: Many Tasks, Few Processors](#the-scheduling-problem-many-tasks-few-processors)
8. [Work-Stealing: Idle Workers Steal](#work-stealing-idle-workers-steal)
9. [Why Work-Stealing Is So Good](#why-work-stealing-is-so-good)
10. [Grain Size: The Cutoff That Makes or Breaks It](#grain-size-the-cutoff-that-makes-or-breaks-it)
11. [Real Fork-Join Frameworks](#real-fork-join-frameworks)
12. [Code: Fork-Join Parallel Sum in Go](#code-fork-join-parallel-sum-in-go)
13. [Code: Fork-Join Merge Sort](#code-fork-join-merge-sort)
14. [Code: Watching the Grain Size Matter](#code-watching-the-grain-size-matter)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

You've now seen *what* makes an algorithm parallel: low span. The reduction tree sums `n` numbers in `Θ(log n)` span because it arranges the additions into a balanced tree where independent work can fire at once. But two enormous practical questions have been hovering over every page so far, and this file — the last in the section — finally answers both.

The first question is: **how do I actually write this?** When you summed `n` numbers in a tree, you imagined "all four additions at level 1 happen at once." But you don't have a magic button that says "do these four things simultaneously." You have a programming language, and you need a *way to express* "split this problem in half, do both halves in parallel, then combine." That way is the **fork-join model**, and it is gorgeous in its simplicity: **fork** (also called *spawn*) launches a subtask that *may* run in parallel with the code that follows, and **join** (also called *sync*) waits for a forked subtask to finish before you use its result. Divide-and-conquer — the recursion pattern you already know from merge sort and quicksort — becomes parallel by simply forking the recursive calls and joining before the combine step. Parallel sum: split the array, *fork* the left half, do the right half, *join*, add the two results. That's it. Fork-join is the most natural way humans write parallel code, because it mirrors the recursion we already think in.

The second question is the one this whole section has been building toward: **you write fork/join expressing thousands of potential parallel tasks, but your laptop has 8 cores. Who decides which task runs on which core, and when?** That job belongs to a **scheduler**, and the brilliant answer the industry settled on is **work-stealing**. The idea is almost suspiciously simple: give each worker (each core) its own private queue of tasks. A worker happily runs tasks from its own queue. When a worker runs *out* of work — its queue is empty and it would otherwise sit idle — it doesn't ask a central manager for more; it walks over to a *random busy worker* and **steals** a task from the *back* of that worker's queue. Idle processors find their own work. There's no central dispatcher to become a bottleneck, the load balances itself even on wildly lopsided problems, and — provably — the whole thing runs in about `T₁/P + T∞` time, the very Brent bound you met in [the first topic](../01-models-pram-work-span/junior.md). Work-stealing is *how* real runtimes deliver the speedup the work–span model promised.

There's one knob you must turn correctly to make any of this pay off: **grain size** (the *cutoff*). Forking is not free — every spawn costs a little overhead to create and schedule a task. If you fork all the way down to single elements, you'll spend all your time on spawn bookkeeping and none on real work. So below a threshold — the grain size — you **stop forking and just do the work in a plain serial loop**. Too fine a grain (forking tiny pieces) drowns in overhead; too coarse a grain (forking only a few big pieces) starves your cores of parallelism. Getting the grain right is the single most important tuning decision in fork-join programming, and we'll watch it make or break the speedup in real numbers.

This file builds the whole picture: fork and join as the two primitives; parallel sum and merge sort drawn as fork-join trees; how fork-join *constructs* the computation DAG from the first topic; the scheduling problem and the work-stealing answer (drawn out, with idle workers stealing); why stealing balances load automatically and stays cache-friendly; the grain-size cutoff with its spawn-overhead intuition; and the real frameworks — Cilk, Java's ForkJoinPool, Rust's Rayon, Intel TBB, OpenMP tasks, and Go's goroutines + WaitGroup (whose runtime is itself a work-stealing scheduler). The code forks a parallel sum and a merge sort in Go with a grain-size cutoff, and measures how the cutoff changes everything.

---

## Prerequisites

- **Required:** The **work–span model** — work `T₁` (total operations, time on one processor), span `T∞` (longest dependency chain, time on infinitely many processors), parallelism `= T₁/T∞`, and especially the **computation DAG** (tasks as nodes, dependencies as edges). All of it is in [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md). Fork-join is the *programming model* that *builds* that DAG; work-stealing is the scheduler that runs it.
- **Required:** The **Brent bound** `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞` (also from the first topic). Work-stealing is the practical scheduler that *achieves* this bound — this file shows how.
- **Required:** Comfort with **recursion and divide-and-conquer** — splitting a problem in half, recursing on each half, combining the results. Merge sort is the canonical example. Fork-join is "divide-and-conquer, but fork the recursive calls."
- **Helpful:** The **reduction tree** for summing `n` numbers in `Θ(log n)` span (from the first topic). The fork-join parallel sum *is* that tree, expressed as recursion.
- **Helpful:** Any exposure to threads or goroutines — "running two things at once." We keep the concurrency minimal and explain every piece.

No knowledge of specific runtimes, lock-free queues, or memory models required. We build the intuition from the ground up.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fork / spawn** | Launch a subtask that *may* run in parallel with the code that continues after it. The "divide and go in parallel" half of fork-join. |
| **Join / sync** | Wait for a forked subtask to finish before proceeding (e.g. before combining its result). The synchronization half of fork-join. |
| **Fork-join model** | A way to write parallelism: recursively fork subtasks, then join them and combine. Mirrors divide-and-conquer recursion. |
| **Task** | A unit of work the runtime can schedule onto a processor. Forking creates a task; the scheduler decides where and when it runs. |
| **Scheduler** | The runtime component that maps tasks onto the `P` available processors over time. Work-stealing is one scheduler. |
| **Worker** | A long-lived thread, usually one per core, that executes tasks. Each worker owns a queue. |
| **Work-stealing** | A scheduling strategy: each worker has its own task queue; an idle worker *steals* a task from a busy worker's queue. |
| **Deque (double-ended queue)** | The per-worker queue. The owner pushes/pops one end (its own work); thieves steal from the *other* end. |
| **Grain size / cutoff** | The threshold below which you stop forking and run the rest serially. The key tuning knob. |
| **Spawn overhead** | The fixed cost of creating and scheduling one task. Too many tiny tasks means overhead dominates. |
| **Load balancing** | Keeping all processors busy with roughly equal work. Work-stealing does it automatically and dynamically. |
| **Work-efficient** | A parallel algorithm whose total work `T₁` matches the best serial algorithm's — no wasted operations. |
| **Brent bound** | `T_P ≤ T₁/P + T∞` — the running-time guarantee a good (greedy/work-stealing) scheduler delivers. |

---

## Fork and Join: The Two Primitives

The entire fork-join model is built from exactly two operations. Learn these two and you can express most parallel divide-and-conquer code there is.

**Fork (spawn): "start this, but don't wait for it."** When you `fork` a function call, you're telling the runtime: *this subtask may run in parallel with whatever I do next.* The call is launched as an independent **task**, and your code keeps going immediately instead of blocking until the subtask returns. Forking is how you say "these two pieces of work are independent — feel free to run them at the same time."

**Join (sync): "now wait for what I forked."** When you `join`, you tell the runtime: *I need the forked subtask's result now — block until it has finished.* Join is the synchronization point. After a join, you're guaranteed the forked work is complete, so it's safe to read its result and combine it.

The classic shape of fork-join is *fork one side, do the other side yourself, then join*:

```
  result_left  = FORK   solve(left_half)    ← launch left in parallel, keep going
  result_right =        solve(right_half)   ← do the right half right here, myself
                 JOIN   result_left          ← wait for the left to finish
  combine(result_left, result_right)         ← now both are ready: combine them
```

Read that carefully — it's the heartbeat of every fork-join algorithm:

- You **fork** the left half. The runtime *may* hand it to another processor; meanwhile, you don't wait.
- You **do the right half yourself**, right now, in this thread. (Why do one side yourself instead of forking both? Because *someone* has to do work — forking both and then sitting idle would waste this thread. Forking one and doing the other keeps you productive. This is a small but important idiom.)
- You **join** the left — block until it's done. By the time you call join, the left half has often *already* finished on another core, so the wait is short or zero.
- Now both results exist, so you **combine** them.

```
  TIME ──────────────────────────────────────────►

  this thread:   [fork left]──[ do right half myself ]──[join]──[combine]
                      │                                   ▲
                      │  (handed to another processor)    │
  other proc:         └────[ solve left half ]────────────┘
                              (runs in parallel!)
```

That's the whole model. There's no explicit "thread number," no manual assignment of work to cores, no lock to manage. You just say *what can run in parallel* (fork) and *where you need results* (join), and the scheduler — which we'll meet soon — figures out the rest. This is why fork-join is the most ergonomic parallel model: it's just recursion with two extra keywords.

> **The mental model for fork-join:** *fork* = "you go ahead and do that, I'll keep working," *join* = "okay, I need it now — are you done?" It's exactly how you'd split a chore with a friend: "you wash, I'll dry, tell me when you're done washing so I can put things away." The fork launches independent work; the join is the "tell me when you're done" that lets you safely combine.

---

## Parallel Sum as a Fork-Join Tree

Let's make fork-join concrete with the example you already know cold: **summing `n` numbers**. In [the first topic](../01-models-pram-work-span/junior.md) you saw this as a reduction tree with span `Θ(log n)`. Fork-join is how you *write* that tree as recursion.

The idea: to sum an array, split it in half, **fork** the sum of the left half (let it run in parallel), sum the right half yourself, **join**, and add the two partial sums:

```
  sum(A):
    if A is small:                       ← the GRAIN-SIZE cutoff (more soon)
       return serial_sum(A)              ← just loop, no forking
    mid = len(A) / 2
    left  = FORK sum(A[:mid])            ← left half, in parallel
    right =      sum(A[mid:])            ← right half, myself
    JOIN left
    return left + right                  ← combine the two partial sums
```

Picture the recursion tree for summing 8 numbers (ignoring the cutoff for a moment, forking down to pairs). Each node splits into two forked children; the leaves do the actual element work; the joins-and-adds happen on the way back up:

```
                       sum(A[0..8])                    ← split, fork both halves
                      /            \
            sum(A[0..4])          sum(A[4..8])         ← each splits again
            /        \            /         \
      sum(A[0..2]) sum(A[2..4]) sum(A[4..6]) sum(A[6..8])
        /  \         /  \         /  \         /  \
      a0  a1       a2  a3       a4  a5       a6  a7      ← leaves: the numbers

   DESCENT (forking):  split, split, split — the tree fans OUT
   ASCENT (joining):   add pairs, add pairs, add — the tree folds IN
```

This is *exactly* the reduction tree from the first topic — same shape, same `Θ(log n)` span — but now you can see *how it's written*: as ordinary divide-and-conquer recursion where the recursive calls are **forked** so they can run in parallel. The "all four additions at level 1 happen at once" that you took on faith earlier? It happens because four different `sum` subtasks, forked off independently, get scheduled onto four different cores and run simultaneously.

Trace the two phases:

- **Going down (the forks):** each call splits its range and forks the left half. The tree fans out into independent subtasks — `sum(A[0..4])` and `sum(A[4..8])` have nothing to do with each other, so they can run on different cores. This fan-out is where the parallelism comes from.
- **Coming back up (the joins):** before a node can add its two halves, it must **join** — wait for the forked left half to finish. The additions happen level by level on the way up, exactly like the tree's levels collapsing toward the root. The root's final add produces the total.

The work and span fall out just as before: **work `T₁ = Θ(n)`** (you still do `n−1` additions — no extra work, it's work-efficient), and **span `T∞ = Θ(log n)`** (the critical path is one root-to-leaf descent plus one leaf-to-root ascent, i.e. the tree height). Parallelism `Θ(n / log n)` — massively parallel — and now you know how to *write* it: fork the recursion.

> **The connection to lock in:** a fork-join program *is* a way to describe a computation DAG by writing recursion. Every fork adds a fan-out (two independent children); every join adds a fan-in (the parent waits for a child). The tree-shaped DAG you analyzed abstractly in the first topic is literally the call tree of your forked recursion. Fork-join doesn't *invent* a new kind of parallelism — it's the *syntax* for building reduction-tree-shaped DAGs.

---

## Fork-Join Builds the Computation DAG

Let's make that last point precise, because it's the bridge between everything you learned about work and span and the code you're about to write. **A running fork-join program generates a computation DAG, and it does so by a simple rule:**

- **A `fork` creates a fan-out:** the forked subtask and the code that continues are now two independent strands that can run in parallel. In the DAG, that's one node branching into two.
- **A `join` creates a fan-in:** the continuation waits for the forked subtask before proceeding. In the DAG, that's two strands merging into one node.

So the DAG is assembled *as the program runs*, one fork and one join at a time. Here's the DAG for a single fork-join "fork left, do right, join, combine":

```
              ●  (start)
             / \         ← FORK: branches into two independent strands
            /   \
    [left half] [right half]   ← these two run in parallel (the fan-out)
            \   /
             \ /          ← JOIN: the two strands merge (the fan-in)
              ●  (combine the results)
```

Now nest that recursively — each "half" is itself a fork-join — and you get the full binary-tree DAG of the parallel sum. The beauty is that you never *draw* the DAG; you just write fork/join recursion, and the DAG *is* the trace of how your program forked and joined. The work–span model from the first topic then reads its two numbers right off this generated graph:

```
  WORK  T₁ = total nodes in the generated DAG = the serial running time
  SPAN  T∞ = longest path through it           = the critical path (tree height-ish)
  PARALLELISM = T₁ / T∞                          = how many cores can stay busy
```

This is why fork-join and the work–span model fit together so perfectly: **fork-join is the language for *expressing* a DAG, and work–span is the framework for *analyzing* it.** You write the recursion; the model tells you the speedup ceiling; and — as we'll see next — the scheduler delivers it. A well-designed fork-join algorithm is one whose generated DAG has high parallelism: lots of forks creating independent work (high work `T₁`), but a shallow tree of dependencies (low span `T∞`). That's exactly what divide-and-conquer gives you: each split doubles the available parallelism while adding only one level to the span.

> **The throughline:** you've been analyzing DAGs since the first topic. Fork-join is finally *how you build one in code* — `fork` fans out, `join` fans in, and the recursion's call tree becomes the computation's dependency graph. Keep the recursion balanced and shallow (a tree, not a chain) and the generated DAG has the low span and high parallelism the work–span model rewards.

---

## The Scheduling Problem: Many Tasks, Few Processors

Here's the gap fork-join leaves wide open — and the problem that work-stealing exists to solve. When you fork a parallel sum over a million numbers, you might create *hundreds of thousands* of tasks (one per node of the recursion tree). But your machine has 8 cores. So:

```
  YOU WROTE:        a DAG with, say, 500,000 potential parallel tasks
  YOU HAVE:         8 processors
  SOMEONE MUST:     decide which task runs on which processor, and when
```

That "someone" is the **scheduler**. Its job is to map the tasks of the DAG onto the `P` real processors *over time*, respecting the dependencies (a task can't run before the tasks it joins on have finished). And the scheduler's quality is *everything* — recall the Brent bound from the first topic: a good ("greedy") scheduler guarantees `T_P ≤ T₁/P + T∞`, but a *bad* scheduler can leave processors idling and blow right past that.

What would a *bad* scheduler look like? The obvious naive design is a **single central queue**: every forked task goes into one shared global queue, and every idle worker reaches into that queue for its next task. It sounds reasonable, and it *works*, but it has a fatal flaw at scale:

```
  CENTRAL QUEUE (the naive design — a bottleneck):

      ┌──────────────────────────────────────┐
      │   ONE shared queue of all tasks       │
      └──────────────────────────────────────┘
          ▲     ▲     ▲     ▲     ▲     ▲
          │     │     │     │     │     │
        P0    P1    P2    P3    P4    P5   ← ALL workers hit the SAME queue

   Every worker must lock/coordinate on the one queue for EVERY task.
   With many workers + tiny tasks, they spend their time fighting over the
   queue instead of working. The central queue becomes the bottleneck.
```

The problem is **contention**. Every time any of the 8 workers finishes a task, it must coordinate with all the others to grab the next one from the single shared queue. With tiny tasks (and fork-join makes *lots* of tiny tasks), the workers spend more time elbowing each other at the queue than doing useful work. The central queue is a serial bottleneck — and Amdahl's law tells you a serial bottleneck caps your speedup. A central scheduler doesn't scale.

What we want instead is a scheduler that is **decentralized** (no single point everyone must touch), **self-balancing** (idle workers automatically find work without being told), and **cheap** (a worker mostly touches its own data, not shared data). That is exactly what work-stealing delivers — and the way it does it is genuinely clever.

---

## Work-Stealing: Idle Workers Steal

Here is the idea that powers nearly every modern fork-join runtime. **Give each worker its own private queue.** A worker pushes its forked tasks onto its *own* queue and pulls its next task from its *own* queue — no shared global queue, no contention in the common case. The whole scheme:

```
  WORK-STEALING: each worker has its OWN queue (a deque)

   P0: [t][t][t][t]      P1: [t][t]        P2: (empty!)      P3: [t][t][t]
       └── busy ──┘          └ busy ┘       ↑ IDLE            └── busy ──┘
                                            │
              P2 is out of work, so it STEALS from a busy worker ───┐
                                                                    │
   P2 picks a random busy worker (say P0) and takes a task from the │
   FAR END of P0's queue:                                           ▼
   P0: [t][t][t][ ]  ──────────────────── steal ──────────────►  P2: [t]
       └ keeps working its own end          (P2 now has work again, no idling)
```

The two rules that make it work:

1. **Work your own queue.** A worker treats its own queue like a stack: it **pushes** newly forked tasks onto one end and **pops** its next task from that *same* end (the most recently forked task — the "newest" work). Because only this worker touches that end, there's no coordination cost in the common case. This is the fast path, and it's almost all of the time.

2. **Steal from a stranger when idle.** When a worker's queue goes empty, instead of idling it picks a *random* other worker and **steals a task from the opposite end** of that victim's queue — the *oldest*, "biggest" task at the bottom. Then it runs that stolen task as if it were its own (forking more subtasks onto its own queue). The stolen worker doesn't even notice much — it keeps popping from *its* end.

Why a **deque** (double-ended queue) — owner at one end, thieves at the other? Two reasons, and they're both elegant:

- **No conflict in the common case.** The owner works one end; thieves take the other end. As long as the queue isn't nearly empty, the owner and a thief never touch the same task — so the owner's fast path stays nearly contention-free even while a steal happens.
- **Thieves take the *big* tasks.** The owner pops the *newest* forked task (the smallest, deepest piece of the recursion — most recently split). A thief takes the *oldest* task (the one forked earliest — near the *top* of the recursion tree, representing a *big* chunk of unsplit work). So a single steal hands the thief a large hunk of work that will keep it busy for a while and spawn more subtasks of its own. **Stealing is rare and high-value:** you don't steal one tiny leaf, you steal a whole subtree.

Walk through a parallel sum to see it live. Worker P0 starts `sum(A[0..1,000,000])`. It splits, forks `sum(A[0..500k])` onto its queue, and starts working `sum(A[500k..1m])` itself (which forks again, and again, P0 diving deep into the right side). Meanwhile P1, P2, P3 started idle — so each picks a random victim and steals. P1 steals `sum(A[0..500k])` from the *bottom* of P0's queue — a huge half-the-array task — and starts splitting *it*, forking its own subtasks. Now both P0 and P1 are busy and *generating* more stealable work; P2 and P3 steal from them in turn. Within a few steals, all four cores are busy on different subtrees of the same recursion, and they keep themselves fed by occasionally stealing big chunks from each other. **No central coordinator ever told anyone what to do** — the idle workers found their own work.

> **The mental model for work-stealing:** imagine a workshop where everyone has their own to-do list. You work your own list, newest task first. When your list is empty, you don't stand around or ask the boss — you walk to a random busy coworker and grab the *biggest* untouched job off the bottom of *their* list, then make it your own. There's no manager assigning work; the workers balance themselves. That decentralized "idle workers steal big jobs from busy ones" is the entire trick, and it's why fork-join runtimes scale.

---

## Why Work-Stealing Is So Good

Work-stealing isn't just *a* way to schedule fork-join — it's the one that won, because it's good on every axis that matters. Let's enumerate why, because each property maps onto a parallel-computing idea you already know.

**1. It's decentralized — no bottleneck.** Unlike the central-queue design, no single resource is touched by every worker on every task. In the common case, each worker only touches its *own* queue. Coordination (a steal) happens only when a worker would otherwise be idle, which is *rare* once everyone's busy. There's no serial bottleneck for Amdahl's law to punish — the thing that killed the central queue is gone.

**2. It balances load automatically — even on lopsided problems.** This is the killer feature. Many real divide-and-conquer problems are *unbalanced*: one branch of the recursion has far more work than the other (think quicksort with a skewed pivot, or exploring an irregular tree where some subtrees are huge and others tiny). A static "split the work into P equal pieces up front" scheme fails badly here — some cores finish early and idle while one core grinds on a giant branch. **Work-stealing fixes this for free:** whichever workers finish their piece simply steal from whoever still has work. The load balances *dynamically*, in response to how the computation actually unfolds, with no need to predict the shape in advance. Irregular, unpredictable, unbalanced trees self-balance.

```
  UNBALANCED problem (left branch tiny, right branch huge):

         split
        /     \
    [tiny]   [HUGE........................]

  Static split:  P0 gets [tiny], finishes instantly, then IDLES.
                 P1 gets [HUGE], grinds alone.  →  speedup ≈ 1, terrible.

  Work-stealing: P0 finishes [tiny], STEALS into [HUGE], helps split it.
                 The huge branch gets attacked by all idle workers.  →  balanced.
```

**3. It's cache-friendly.** Because a worker mostly pops from its *own* queue — the tasks *it* just forked — it tends to keep working on data that's related to what it just touched, which is likely still warm in its cache. It dives deep into one subtree (good locality) rather than hopping randomly around the problem. Steals are infrequent, so the cache-cold "work on a stranger's data" case is rare. Contrast a central queue, where a worker grabs whatever random task is next — poor locality. (Cache behavior is its own deep topic; see [the external-memory/cache-aware section](../../24-external-memory-and-cache-aware/01-the-io-model/junior.md) for why locality matters so much.)

**4. It provably hits the Brent bound.** This is the theoretical capstone. A famous result (Blumofe & Leiserson, 1994) proves that a randomized work-stealing scheduler runs a fork-join computation in expected time:

```
  T_P  ≤  T₁/P  +  O(T∞)        ← the Brent bound, achieved in practice
```

That's the *same* `T₁/P + T∞` guarantee from the first topic — work-stealing is the concrete scheduler that *delivers* it. So everything the work–span model promised — near-linear speedup until `P` approaches the parallelism `T₁/T∞`, then flatlining at the span — actually happens when you run fork-join on a work-stealing runtime. The model isn't aspirational; work-stealing makes it real.

> **The summary of why it wins:** work-stealing is **decentralized** (no central bottleneck), **self-balancing** (idle workers find their own work, even on lopsided problems), **cache-friendly** (workers stay in their own subtree), and **provably efficient** (it achieves the `T₁/P + T∞` Brent bound). That combination is why Cilk, Java's ForkJoinPool, Rust's Rayon, Intel TBB, and Go's runtime are *all* built on work-stealing. It is the standard answer to "how do I schedule fork-join onto P cores."

---

## Grain Size: The Cutoff That Makes or Breaks It

Now the one practical knob you *must* get right, or all of the above falls apart: **grain size**, also called the **cutoff** or **threshold**. The issue is simple and unavoidable: **forking is not free.** Every fork creates a task object, pushes it onto a queue, and may later be popped or stolen — all of which costs time. Call that fixed cost the **spawn overhead**. It's small, but it's *per task*, and fork-join makes a *lot* of tasks.

Watch what happens if you fork all the way down to single elements. Summing a million numbers by forking down to individual numbers creates ~2 million tasks, each doing *one addition*. The spawn overhead per task dwarfs the single addition — you'd spend, say, 50× more time on bookkeeping than on the actual arithmetic. The parallel version would be *catastrophically slower* than a simple serial loop. The forks aren't buying you parallelism worth their cost; they're pure overhead at the bottom of the tree, where the pieces are tiny.

The fix: **stop forking once the piece is small enough, and just do it serially.** Pick a grain size `G` (say, a few thousand elements). When a subproblem drops below `G`, abandon the recursion-with-forks and run a plain serial loop over the rest:

```
  sum(A):
    if len(A) <= GRAIN:              ← the CUTOFF
       return serial_sum(A)          ← plain loop, NO forking — cheap and cache-friendly
    mid = len(A) / 2
    left  = FORK sum(A[:mid])
    right =      sum(A[mid:])
    JOIN left
    return left + right
```

The cutoff transforms the recursion tree: instead of forking down to leaves of size 1, you fork down to leaves of size `G`, each of which is handled by a fast serial loop. You get a *few thousand* tasks instead of a *million* — enough to keep all your cores busy, but not so many that overhead dominates.

The tuning is a balance, and both extremes are bad:

```
  GRAIN TOO FINE (G = 1, fork to single elements):
     → millions of tiny tasks → spawn overhead DOMINATES → slower than serial.

  GRAIN TOO COARSE (G = n/2, fork only once or twice):
     → only a handful of tasks → not enough to keep P cores busy → cores idle,
       and one big task can't be split further to balance load → poor speedup.

  GRAIN JUST RIGHT (G = a few thousand, tuned):
     → thousands of tasks → plenty to balance across cores, overhead negligible
       → near-linear speedup.   ← the sweet spot
```

**A good rule of thumb:** pick a grain so that each leaf task does *enough work to dwarf the spawn overhead* (so overhead is, say, < 1% of the task), while still creating *many more tasks than you have cores* (so work-stealing has plenty to balance — a common target is tens of tasks per core). In practice you tune it empirically: try a few values, measure, and pick the one that's fastest on your machine and input. The grain size is the single most impactful number in fork-join performance, and we'll watch it swing the speedup dramatically in the code section.

> **The grain-size intuition:** forking is like delegating a task to a coworker — worth it for a *big* job, absurd for "add these two numbers." You delegate (fork) the big pieces and just *do* the small ones yourself (serial loop below the cutoff). Set the cutoff so each delegated piece is meaty enough that handing it off pays for itself, but small enough that there are plenty of pieces to spread around. Too small and you drown in delegation overhead; too big and your coworkers have nothing to do.

---

## Real Fork-Join Frameworks

Fork-join isn't a toy model — it's how production parallel code is written across every major language. The vocabulary changes (spawn/sync, join, par_iter, task), but the shape is always the same: *fork independent work, join, combine, with a grain-size cutoff.* Here's the landscape so you recognize it in the wild:

- **Cilk (and Cilk Plus / OpenCilk) — the original.** Cilk introduced the model with two keywords: `cilk_spawn` (fork) and `cilk_sync` (join). It also introduced the *randomized work-stealing scheduler* and proved the `T₁/P + T∞` bound. Almost everything else is a descendant. A Cilk parallel sum looks exactly like the pseudocode above, with `cilk_spawn` on the recursive call.

- **Java — `ForkJoinPool` and `parallelStream`.** Java's `java.util.concurrent.ForkJoinPool` is a textbook work-stealing scheduler; you subclass `RecursiveTask` and call `.fork()` and `.join()`. More commonly you use it *implicitly*: `list.parallelStream().map(...).reduce(...)` runs on the common ForkJoinPool under the hood. So `parallelStream` is fork-join with the forks hidden.

- **Rust — Rayon.** Rayon gives you `rayon::join(|| a(), || b())` (fork two closures, join both) and, more idiomatically, `par_iter()`: `v.par_iter().map(...).sum()` parallelizes a map-reduce with a work-stealing scheduler, choosing the grain size for you. Clean, safe, and fast.

- **Intel TBB (Threading Building Blocks) — C++.** TBB offers `parallel_for`, `parallel_reduce`, and a `task_group` for explicit fork-join, all on a work-stealing scheduler. It's the long-standing C++ workhorse for this pattern (now part of oneAPI).

- **OpenMP tasks — C/C++/Fortran.** OpenMP's `#pragma omp task` (fork) and `#pragma omp taskwait` (join) bring fork-join into the pragma-based parallelism world; the runtime schedules tasks (typically with work-stealing).

- **Go — goroutines + `sync.WaitGroup`.** Go doesn't have a `fork`/`join` keyword, but the *shape* is everywhere: launch goroutines (`go f()` — the fork), and wait for them with a `sync.WaitGroup` (`wg.Wait()` — the join). That's fork-join. And here's the lovely part: **Go's runtime scheduler is itself a work-stealing scheduler** — each OS thread (P) has a local run queue of goroutines, and an idle thread steals goroutines from a busy one. So when you write goroutines + WaitGroup, you're writing fork-join *on* a work-stealing runtime, just like Cilk or Rayon. That's exactly what the code below does.

```
  Same model, different vocabulary:

  Cilk:     cilk_spawn f();   ...   cilk_sync;
  Java:     task.fork();      ...   task.join();   (or list.parallelStream())
  Rust:     rayon::join(|| a, || b);               (or v.par_iter()...)
  TBB:      task_group g; g.run([]{...});  g.wait();
  OpenMP:   #pragma omp task   ...   #pragma omp taskwait
  Go:       go f();           ...   wg.Wait();   ← runtime is work-stealing too
```

> **The takeaway:** fork-join + work-stealing is not one library's idea — it's the *industry standard* for divide-and-conquer parallelism, implemented again and again because it's the right answer. Learn the model once (fork, join, grain size) and you can read and write parallel code in Cilk, Java, Rust, C++, or Go. The keywords differ; the picture — fork the halves, join, combine, cutoff at the grain — is identical.

---

## Code: Fork-Join Parallel Sum in Go

Time to write it. We'll sum an array with fork-join recursion: split, fork the left half as a goroutine, do the right half ourselves, wait (join), and add — with a grain-size cutoff that stops forking for small ranges. Go's runtime schedules the goroutines with its own work-stealing scheduler, so this is genuine fork-join on a work-stealing runtime.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// forkJoinSum sums A[lo:hi] by divide-and-conquer.
// Below `grain` elements it sums serially (the CUTOFF — no forking).
// Above it, it FORKS the left half as a goroutine, does the right half
// itself, JOINS (wg.Wait), and combines the two partial sums.
func forkJoinSum(A []int64, lo, hi, grain int) int64 {
	if hi-lo <= grain { // ── the grain-size cutoff ──
		var s int64
		for i := lo; i < hi; i++ { // plain serial loop, no spawn overhead
			s += A[i]
		}
		return s
	}

	mid := lo + (hi-lo)/2
	var left int64

	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // ── FORK: left half runs (maybe) in parallel ──
		defer wg.Done()
		left = forkJoinSum(A, lo, mid, grain)
	}()

	right := forkJoinSum(A, mid, hi, grain) // do the right half MYSELF

	wg.Wait()           // ── JOIN: wait for the forked left half ──
	return left + right // combine the two partial sums
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

	// Baseline: a plain serial sum (this is our T_1 in wall-clock).
	start := time.Now()
	want := serialSum(A)
	serialTime := time.Since(start)
	fmt.Printf("serial:             %v  sum=%d\n", serialTime, want)

	// Fork-join with a sensible grain size (tuned: big enough to amortize spawns).
	const grain = 100_000
	start = time.Now()
	got := forkJoinSum(A, 0, n, grain)
	pt := time.Since(start)
	if got != want {
		panic("wrong sum!")
	}
	fmt.Printf("fork-join (G=%d): %v  speedup=%.2fx\n",
		grain, pt, float64(serialTime)/float64(pt))
}
```

**What it does, line by line of the model:** the cutoff (`hi-lo <= grain`) is where we *stop* forking and run a tight serial loop — this is what keeps spawn overhead negligible. Above the cutoff, `go func(){ ... }()` is the **fork** (launch the left half, possibly on another core), computing the right half in the current goroutine is "do the other side myself," `wg.Wait()` is the **join** (block until the left half finishes), and `left + right` is the **combine**. The recursion builds exactly the binary-tree DAG from the first topic, and Go's work-stealing runtime spreads the forked goroutines across your cores. You'll typically see speedup climb toward your core count — and if you set `grain` to `1`, you'll see it collapse (millions of goroutines, overhead dominates), which is the next experiment.

---

## Code: Fork-Join Merge Sort

Sum has a trivial combine (just `+`). **Merge sort** is the more interesting fork-join example because its combine step — *merging* two sorted halves — is real work, and it's the divide-and-conquer algorithm you already know. Parallelizing it is almost mechanical: fork the two recursive sorts, join, then merge.

```go
package main

import (
	"fmt"
	"sort"
	"sync"
)

// parallelMergeSort sorts a[lo:hi] in place-ish using fork-join.
// Below `grain`, it falls back to a serial sort (the CUTOFF).
// Above it, it FORKS the left-half sort, sorts the right half itself,
// JOINS, then MERGES the two sorted halves (the combine step).
func parallelMergeSort(a []int, grain int) {
	n := len(a)
	if n <= grain { // ── cutoff: small slice → serial sort, no forking ──
		sort.Ints(a)
		return
	}

	mid := n / 2

	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // ── FORK: sort the left half in parallel ──
		defer wg.Done()
		parallelMergeSort(a[:mid], grain)
	}()
	parallelMergeSort(a[mid:], grain) // sort the right half MYSELF

	wg.Wait()      // ── JOIN: both halves are now sorted ──
	merge(a, mid)  // ── COMBINE: merge the two sorted halves ──
}

// merge combines the two sorted runs a[:mid] and a[mid:] into sorted a.
func merge(a []int, mid int) {
	left := make([]int, mid) // copy out the left run so we can overwrite a
	copy(left, a[:mid])
	right := a[mid:]

	i, j, k := 0, 0, 0
	for i < len(left) && j < len(right) {
		if left[i] <= right[j] {
			a[k] = left[i]
			i++
		} else {
			a[k] = right[j]
			j++
		}
		k++
	}
	for i < len(left) { // drain whatever remains
		a[k] = left[i]
		i++
		k++
	}
	// remaining right elements are already in place (a[k:] == right[j:])
	_ = j
}

func main() {
	a := []int{5, 2, 8, 1, 9, 3, 7, 4, 6, 0, 11, 10, 13, 12}
	parallelMergeSort(a, 4) // small grain so the example actually forks
	fmt.Println(a)          // [0 1 2 3 4 5 6 7 8 9 10 11 12 13]

	if !sort.IntsAreSorted(a) {
		panic("not sorted!")
	}
	fmt.Println("sorted:", sort.IntsAreSorted(a))
}
```

**What it does:** the structure is identical to the sum — cutoff, fork-left, do-right, join, combine — but now the **combine is a real `merge`**, the same merge you know from sequential merge sort. The two recursive sorts are independent (they touch disjoint halves of the slice), so forking the left one lets it run in parallel with the right; the `wg.Wait()` join guarantees *both* halves are sorted before we merge them. With a grain-size cutoff, small slices fall back to `sort.Ints` (a fast serial sort), avoiding the spawn-overhead trap at the leaves. This is the standard parallel merge sort, and it's analyzed in depth — span, the merge bottleneck, and the parallel-merge refinement — in [Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md). (A subtlety worth noting: the *merge* step here is itself serial, which limits the span; making the merge *also* parallel is exactly what the sorting topic tackles.)

---

## Code: Watching the Grain Size Matter

The grain size is the make-or-break knob, so let's *measure* it: run the same fork-join sum at several grain sizes and watch the time swing. This is the experiment that turns "grain matters" from a claim into a number you've seen with your own eyes.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func forkJoinSum(A []int64, lo, hi, grain int) int64 {
	if hi-lo <= grain {
		var s int64
		for i := lo; i < hi; i++ {
			s += A[i]
		}
		return s
	}
	mid := lo + (hi-lo)/2
	var left int64
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		left = forkJoinSum(A, lo, mid, grain)
	}()
	right := forkJoinSum(A, mid, hi, grain)
	wg.Wait()
	return left + right
}

func main() {
	const n = 20_000_000
	A := make([]int64, n)
	for i := range A {
		A[i] = int64(i % 7)
	}

	// Sweep the grain size from absurdly fine to very coarse.
	grains := []int{1, 100, 10_000, 100_000, 1_000_000, n} // n = no forking at all
	for _, g := range grains {
		start := time.Now()
		_ = forkJoinSum(A, 0, n, g)
		fmt.Printf("grain=%-10d  time=%v\n", g, time.Since(start))
	}
}
```

**What you'll observe (and why each end is bad):**

```
  grain=1            time=VERY SLOW    ← ~40M goroutines: spawn overhead DOMINATES
  grain=100          time=slow         ← still far too many tiny tasks
  grain=10000        time=fast         ← sweet spot begins: enough tasks, low overhead
  grain=100000       time=fastest      ← plenty of tasks to balance, overhead negligible
  grain=1000000      time=fast-ish     ← getting coarse: only ~20 tasks, cores under-fed
  grain=n            time=serial-speed ← no forking at all: just the serial loop, 1 core
```

The U-shape is the whole lesson. At `grain=1`, you fork down to single additions and create tens of millions of goroutines — the spawn overhead is *thousands of times* the actual work, so it's dramatically slower than serial. At `grain=n`, you never fork at all, so you get exactly serial performance on one core (no parallelism). The fast region in the middle is where each task is big enough that spawn overhead is negligible *and* there are far more tasks than cores so work-stealing can balance them. **The best grain is empirical** — it depends on your machine, your core count, and how expensive the per-element work is — but the shape is universal: too fine drowns in overhead, too coarse starves the cores, and there's a wide, forgiving sweet spot in between that you find by measuring.

> **The experiment's verdict:** the grain size can change your running time by *orders of magnitude*. It is not a detail to leave at `1` "for maximum parallelism" — maximum forking is maximum *overhead*. Set the cutoff so each leaf task does real work (thousands of elements, say) while still producing many more tasks than cores. Then work-stealing does the rest, and you get the near-linear speedup the work–span model promised.

---

## Common Misconceptions

- **"Fork means a new OS thread is created."** No — `fork`/`spawn` creates a lightweight **task**, not an OS thread. The runtime has a small fixed pool of worker threads (usually one per core) that *run* the tasks; forking just adds a task to a queue. Creating a real OS thread per fork would be ruinously expensive — the whole point of the work-stealing pool is to multiplex millions of cheap tasks onto a few threads.

- **"Fork-join needs a special parallel language."** It doesn't — the *shape* (fork independent work, join, combine) is expressible in mainstream languages: Java `ForkJoinPool`, Rust Rayon, C++ TBB, OpenMP tasks, and Go's goroutines + `WaitGroup` all give you fork-join. The keywords differ; the model is the same.

- **"Work-stealing needs a central scheduler to assign work."** That's exactly what it *avoids*. There's no central dispatcher — each worker manages its own queue, and idle workers find work themselves by stealing. The decentralization is the feature: no single point of contention, which is precisely why it scales where a central queue doesn't.

- **"Smaller grain size = more parallelism = faster."** The deadliest fork-join misconception. Smaller grain means more *tasks*, but past a point those tasks are too tiny to be worth their spawn overhead, and you get *slower*. There's a sweet spot — enough tasks to keep cores busy, big enough that overhead is negligible. `grain=1` is almost always the *worst* choice.

- **"Stealing happens constantly and is expensive."** Steals are *rare* — they happen only when a worker would otherwise be idle, and once everyone's busy, steals are infrequent. And each steal grabs a *big* task (a whole subtree near the top of the recursion), so one cheap steal buys a lot of work. The common case is "work your own queue, no coordination"; stealing is the occasional, high-value exception.

- **"Fork-join only works for problems that split evenly."** The opposite — work-stealing *shines* on *unbalanced* problems. Static even-splitting fails when one branch is huge; work-stealing dynamically rebalances by having idle workers steal from whoever still has work, no matter how lopsided the tree. Irregular, unpredictable recursion is exactly where it earns its keep.

---

## Common Mistakes

- **Setting the grain size to 1 (or omitting the cutoff).** Forking down to single elements creates millions of tiny tasks, and spawn overhead dominates — the parallel version runs *slower* than a serial loop. Always have a cutoff, and tune it so each leaf task does substantial work (typically thousands of elements).

- **Forking *both* halves and then idling.** If you fork the left *and* fork the right and then just wait, the current thread does no work while it blocks — wasteful. The idiom is **fork one half, do the other half yourself, then join.** That keeps the current thread productive and halves the number of tasks created.

- **Sharing mutable state across forked tasks (data races).** Forked tasks run in parallel, so if two of them write the same variable without synchronization, you get a race — a corrupted result or a crash. The fork-join discipline avoids this: each task works on a *disjoint* piece (its own slice, its own partial result), and you only combine *after* the join. Forking tasks that touch shared mutable data is asking for trouble.

- **Joining too early (or forgetting to join).** If you read a forked task's result *before* joining, you may read a half-computed value (or garbage). Every fork must be matched by a join *before* you use its result. In Go terms: don't read `left` before `wg.Wait()`.

- **Parallelizing when the input is tiny.** For small arrays, the spawn and scheduling overhead exceeds the work, so fork-join is slower than just looping. The grain-size cutoff handles this automatically (a small whole input falls under the cutoff and runs serially) — but only if you *have* a cutoff. Below the grain, serial is correct *and* fastest.

- **Expecting linear speedup regardless of the combine cost.** If the combine step (like merge sort's merge) is itself serial and significant, it's part of your span and caps your speedup (Amdahl again). A long serial merge limits how parallel the whole sort can be — which is why the [sorting topic](../03-parallel-sorting-and-merging/junior.md) goes on to parallelize the *merge* too. Don't ignore the combine when reasoning about span.

---

## Cheat Sheet

```
FORK-JOIN MODEL — the natural way to write divide-and-conquer parallelism
  FORK (spawn) = launch a subtask that MAY run in parallel; keep going, don't wait
  JOIN (sync)  = wait for a forked subtask to finish before using its result
  IDIOM:  fork the LEFT half → do the RIGHT half yourself → join → combine
          (fork one side, do the other; don't fork both and idle)

  FORK-JOIN BUILDS THE DAG:  fork = fan-out (2 independent strands)
                             join = fan-in  (strands merge)
  → the recursion's call tree IS the computation DAG (work T₁, span T∞ from topic 01)

PARALLEL SUM as fork-join:  split, fork left, sum right, join, add.
  Work Θ(n), span Θ(log n)  ← the reduction tree, written as forked recursion.

THE SCHEDULING PROBLEM:  you write 100,000s of tasks; you have P cores.
  A SCHEDULER maps tasks → processors over time.
  Central queue = BAD (every worker contends on one queue → bottleneck).

WORK-STEALING (the standard scheduler):
  - each worker has its OWN deque of tasks
  - works its own end (newest task) — no contention in the common case
  - when IDLE, steals a task from the FAR end (oldest, BIG task) of a random victim
  WHY IT'S GREAT:
    • decentralized — no central bottleneck
    • self-balancing — idle workers find work, even on UNBALANCED trees
    • cache-friendly — workers stay in their own subtree
    • provably hits the Brent bound:  T_P ≤ T₁/P + O(T∞)

GRAIN SIZE / CUTOFF — the #1 tuning knob (forking isn't free!):
  below threshold G → STOP forking, run a serial loop.
    G too FINE   → millions of tiny tasks → spawn overhead dominates → SLOW
    G too COARSE → few tasks → cores starve, can't balance → poor speedup
    G just right → many more tasks than cores, each task big enough → near-linear
  rule of thumb: each leaf does real work (overhead < ~1%), but tasks ≫ cores. TUNE IT.

REAL FRAMEWORKS (same model, different words):
  Cilk: cilk_spawn/cilk_sync (the original) · Java: ForkJoinPool / parallelStream
  Rust: rayon::join / par_iter · C++: Intel TBB · OpenMP: omp task/taskwait
  Go: goroutines + sync.WaitGroup  ← and Go's runtime is ITSELF work-stealing
```

---

## Summary

This file connected the *analysis* of parallel algorithms (work and span, the DAG, the Brent bound) to the *practice* of writing and running them — through the fork-join programming model and the work-stealing scheduler.

- **Fork-join** is the natural way to express divide-and-conquer parallelism with two primitives: **fork** (spawn) launches a subtask that *may* run in parallel, and **join** (sync) waits for it before combining. The idiom is *fork the left half, do the right half yourself, join, combine* — which keeps the current thread productive. Parallel sum, merge sort, and any divide-and-conquer algorithm become parallel by forking the recursive calls.

- **Fork-join builds the computation DAG** from the first topic: every `fork` is a fan-out (two independent strands), every `join` is a fan-in (strands merge). The recursion's call tree *is* the dependency graph, so the work–span model reads its two numbers — work `T₁`, span `T∞` — right off your forked code. Fork-join is the *syntax* for building reduction-tree-shaped DAGs; work–span is the *analysis*.

- **The scheduling problem:** you write hundreds of thousands of tasks but have only `P` cores, so a **scheduler** must map tasks onto processors. A naive **central queue** becomes a contention bottleneck — a serial point that Amdahl's law punishes.

- **Work-stealing** is the standard answer: each worker has its **own deque**; it works its own end (newest tasks, no contention) and, when idle, **steals a big task from the far end of a random busy worker's queue.** It's **decentralized** (no bottleneck), **self-balancing** (idle workers find work, even on wildly unbalanced trees), **cache-friendly** (workers stay in their own subtree), and **provably efficient** — it achieves the Brent bound `T_P ≤ T₁/P + O(T∞)`, delivering in practice exactly the speedup the work–span model promised.

- **Grain size (the cutoff)** is the single most important tuning knob, because **forking isn't free** — each spawn has overhead. Below a threshold you stop forking and run a serial loop. Too fine a grain drowns in spawn overhead (millions of tiny tasks, slower than serial); too coarse a grain starves the cores (too few tasks to balance). The sweet spot — many more tasks than cores, each big enough that overhead is negligible — is found by measuring, and it can swing your running time by orders of magnitude.

- **Real frameworks** all implement this exact model: Cilk's `spawn`/`sync` (the original, with the original work-stealing proof), Java's `ForkJoinPool` and `parallelStream`, Rust's Rayon (`join`/`par_iter`), Intel TBB, OpenMP tasks, and Go's goroutines + `sync.WaitGroup` — with Go's runtime *itself* being a work-stealing scheduler. Learn the model once; read parallel code in any of them.

The big idea to carry forward: **fork-join is how you *write* a parallel DAG (fork = fan-out, join = fan-in), work-stealing is how the runtime *runs* it efficiently (idle workers steal big tasks, no central coordinator), and the grain-size cutoff is what you *tune* to make it pay off.** Together they turn the work–span model's promise — near-linear speedup up to the parallelism — into real speedup on real cores.

**Where this section ends:** you now have the full junior arc of parallel algorithms — the [work–span cost model](../01-models-pram-work-span/junior.md) that predicts speedup, the [reduce and map](../04-parallel-reduce-and-map/junior.md) primitives that express data-parallel work, the [parallel sorting and merging](../03-parallel-sorting-and-merging/junior.md) that the fork-join merge sort here previews, and now the fork-join model and work-stealing scheduler that *implement* it all on real hardware. The [middle-level treatment](./middle.md) goes deeper: the randomized work-stealing analysis and its bound, the THE protocol and lock-free deques, continuation-stealing vs child-stealing, false sharing and locality in schedulers, and how to tune grain size systematically.

---

## Further Reading

- **Blumofe & Leiserson, "Scheduling Multithreaded Computations by Work Stealing" (1999)** — the foundational paper that introduced randomized work-stealing and proved the `T₁/P + O(T∞)` bound. The source of nearly every modern fork-join runtime.
- **Frigo, Leiserson & Randall, "The Implementation of the Cilk-5 Multithreaded Language" (1998)** — how the original `spawn`/`sync` and its work-stealing deque (the THE protocol) actually work. The blueprint everyone copied.
- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Multithreaded Algorithms"** — fork-join (`spawn`/`sync`) presented in the work–span framework used throughout this section, with parallel sum and merge sort worked out.
- **Doug Lea, "A Java Fork/Join Framework" (2000)** — the design of Java's `ForkJoinPool`; a clear, practical read on building a real work-stealing scheduler.
- **The Rayon (Rust) and Intel TBB documentation** — modern, accessible takes on `join` / `par_iter` and `parallel_for` / `parallel_reduce`; great for seeing the model in production APIs.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — the work/span model and Brent bound that fork-join builds and work-stealing achieves.
- **[Parallel Reduce and Map](../04-parallel-reduce-and-map/junior.md)** — the data-parallel primitives, many of which `par_iter`-style APIs implement on a fork-join runtime.
- **[Parallel Sorting and Merging](../03-parallel-sorting-and-merging/junior.md)** — the fork-join merge sort here, taken further (including parallelizing the merge itself).
- **[Fork-Join and Work-Stealing — Middle](./middle.md)** — the work-stealing analysis, lock-free deques, continuation- vs child-stealing, locality, and systematic grain-size tuning.
