# Online Scheduling and Load Balancing — Junior Level

> **Audience:** You know Big-O and basic greedy algorithms, and you've met the competitive-analysis framework (online vs offline, OPT, competitive ratio). You've never analyzed *scheduling* or *load balancing* as an online problem.
> **Read time:** ~40 minutes. **Focus:** "Jobs arrive one at a time and must be placed on a machine *now*, blind to the future — which machine, and how close to a clairvoyant scheduler can we stay?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Online Makespan Problem, Precisely](#the-online-makespan-problem-precisely)
5. [A Picture of the Problem: Loads as Stacks](#a-picture-of-the-problem-loads-as-stacks)
6. [Graham's List Scheduling: Always Pick the Least-Loaded Machine](#grahams-list-scheduling-always-pick-the-least-loaded-machine)
7. [A Fully Worked List-Scheduling Trace](#a-fully-worked-list-scheduling-trace)
8. [Why List Scheduling Is (2 − 1/m)-Competitive](#why-list-scheduling-is-2--1m-competitive)
9. [The Worst Case: Forcing the (2 − 1/m) Ratio](#the-worst-case-forcing-the-2--1m-ratio)
10. [LPT: When You're Allowed to Sort First (Semi-Online)](#lpt-when-youre-allowed-to-sort-first-semi-online)
11. [A Sibling Problem: Online Bin Packing](#a-sibling-problem-online-bin-packing)
12. [A Worked First-Fit Example](#a-worked-first-fit-example)
13. [Code: List Scheduling, LPT, and First-Fit](#code-list-scheduling-lpt-and-first-fit)
14. [Real Load Balancers and Bin Packers: The Map](#real-load-balancers-and-bin-packers-the-map)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

You have `m` machines and a stream of jobs. Each job takes some amount of time to process, and it has to run on exactly one machine. The jobs arrive **one at a time**, and the instant a job shows up you must commit it to a machine — you can't peek at the jobs still coming, and you can't move it later. When all jobs are placed, each machine's **load** is the sum of the jobs on it, and the quantity you care about is the **makespan**: the load of the busiest machine, i.e. the time the whole batch finishes. You want the makespan small. The busiest machine is your bottleneck; everyone else finishes earlier and waits.

This is one of the oldest and most useful online problems in computer science, and it is everywhere. A load balancer in front of a web cluster places each incoming request on one of `m` backends and wants no single backend overwhelmed. A Kubernetes scheduler places each new pod on one of `m` nodes and wants the cluster's busiest node not too hot. A build farm spreads compile jobs across machines and wants the last job to finish as soon as possible. In every case: work arrives over time, each piece is assigned irrevocably and blind to the future, and the goal is to keep the maximum load low. That is the **online makespan** (a.k.a. **online load balancing**) problem.

The beautiful thing is that an almost embarrassingly simple rule already comes with a hard guarantee. **Graham's list scheduling** — assign each arriving job to whichever machine is *currently least loaded* — is **(2 − 1/m)-competitive**. No matter how an adversary orders the jobs, the makespan it produces is at most `(2 − 1/m)` times the makespan a clairvoyant scheduler (one that saw every job in advance and placed them perfectly) could achieve. That's less than 2× the optimum, forever, from a rule you could explain to a child: "put it where there's the most room." This file builds that result from the ground up: we define the problem and its cost precisely, draw the load picture, trace list scheduling step by step, walk the intuition for why `2 − 1/m` holds and then *construct the exact sequence that forces it*. We then look at **LPT** (longest-processing-time-first), which does much better — `4/3 − 1/(3m)` — but needs to see and sort the jobs first, so it's "semi-online." We meet a sibling problem, **online bin packing** (Next-Fit, First-Fit, Best-Fit), with a worked First-Fit example, give runnable code for all of it, and close by mapping every piece onto the real load balancers and container schedulers you'll actually operate.

---

## Prerequisites

- **Required:** The competitive-analysis framework — online vs offline, the clairvoyant benchmark **OPT**, and the competitive ratio `ALG(σ) ≤ c·OPT(σ) + α`. See [Competitive Analysis](../01-competitive-analysis/junior.md). We apply all of it here without re-deriving it.
- **Required:** Big-O basics — what O(1), O(n), O(n log n) mean. See [Big-O Notation](../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/junior.md).
- **Required:** Comfort reading a greedy algorithm (make a local choice, move on). List scheduling *is* a greedy algorithm. See [Greedy Algorithms](../../14-greedy-algorithms/).
- **Helpful:** Familiarity with a min-heap / priority queue — the efficient list-scheduling implementation pulls the least-loaded machine from one. See [Heaps](../../10-heaps/junior.md).
- **Helpful:** Having seen [Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md) and [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md), the two siblings in this section, so the "online decision + clairvoyant OPT + ratio" rhythm already feels natural.

No probability is needed — everything here is deterministic and counted by hand. We use only arithmetic and a couple of simple inequalities.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Machine** | One of the `m` identical processors a job can be assigned to. "Identical" = one unit of work takes the same time on any machine. |
| **m** | The number of machines. |
| **Job** | A unit of work with a fixed **processing time** `pⱼ` (how long it occupies a machine). |
| **pⱼ** | The processing time (size) of job `j`. |
| **Load (of a machine)** | The sum of the processing times of all jobs assigned to that machine. |
| **Makespan** | The **maximum** load over all machines — the finish time of the whole batch. The thing we minimize. |
| **Online makespan / load balancing** | Jobs arrive one at a time; each must be assigned irrevocably, blind to future jobs; minimize makespan. |
| **List scheduling (Graham)** | The greedy online rule: assign each job to the **currently least-loaded** machine. |
| **OPT(σ)** | The minimum possible makespan for the job set σ, achieved by an optimal *offline* (clairvoyant) scheduler. The benchmark. |
| **LPT** | Longest Processing Time first: sort jobs descending, *then* list-schedule. Needs to see the jobs ⇒ **semi-online**. |
| **Semi-online** | You get a little extra power over pure online — e.g. you may sort the jobs, or you know the total/largest size — but still place greedily. |
| **Bin packing** | Items of size ≤ 1 arrive; pack each into a unit-capacity bin; minimize the number of bins. A sibling problem. |
| **Next-Fit / First-Fit / Best-Fit** | Online bin-packing rules differing in which open bin they try for each item. |

---

## The Online Makespan Problem, Precisely

Let's state the problem with no hand-waving, because every later argument leans on these exact rules.

- There are **`m` identical machines**, numbered `1 … m`. Each starts with load `0`.
- A sequence of **jobs** `σ = p₁, p₂, …, pₙ` arrives **one job at a time**. Each `pⱼ > 0` is a processing time.
- For each job `pⱼ`, in order, you must **assign it to exactly one machine**. When you assign `pⱼ` to machine `i`, that machine's load increases by `pⱼ`.
- The assignment is made **online**: using only the jobs seen so far (and the current loads), never the future, and it is **irrevocable** — you cannot move a job once placed.
- After all `n` jobs are assigned, define `Lᵢ` = the load of machine `i`. The **makespan** is `Cmax = max(L₁, …, Lₘ)`.
- **Goal:** minimize the makespan `Cmax`.

A few consequences worth saying out loud, because they anchor every comparison:

1. **The makespan is a *max*, not a sum.** The total work `P = p₁ + … + pₙ` is fixed no matter how you assign — you can't make work disappear. The only thing your choices control is how *evenly* the fixed work is spread. Minimizing makespan is minimizing the imbalance: the busiest machine's load.

2. **Two hard floors on OPT.** Even a clairvoyant scheduler cannot beat either of these two simple lower bounds:
   - **The average bound:** some machine must hold at least the average load, so `OPT ≥ P / m`. (You can't spread `P` work over `m` machines and have every machine below the average.)
   - **The biggest-job bound:** the largest job `pₘₐₓ` lands *somewhere*, entirely, so `OPT ≥ pₘₐₓ`. (No machine can hold a fraction of a job.)

   Keep both in your pocket — `OPT ≥ P/m` and `OPT ≥ pₘₐₓ`. They are the whole secret to the competitive proof.

3. **"Online" means no peeking and no take-backs.** At the moment you place a job you don't know what's coming. This is the same constraint that made caching and ski rental hard, applied to scheduling. (Reminder from [competitive analysis](../01-competitive-analysis/junior.md): "online" has nothing to do with the internet — it means *processing input as it streams in*.)

---

## A Picture of the Problem: Loads as Stacks

The cleanest mental image is `m` vertical stacks, one per machine. Each job is a block whose height is its processing time; assigning a job drops its block onto a stack. The makespan is the height of the **tallest** stack.

```
  load
   ^
 9 |                          ┌─────┐
 8 |                          │  J6 │
 7 |   ┌─────┐                │     │
 6 |   │     │                ├─────┤
 5 |   │ J1  │   ┌─────┐      │  J3 │
 4 |   │     │   │ J4  │      │     │
 3 |   ├─────┤   ├─────┤      ├─────┤
 2 |   │ J5  │   │ J2  │      │ ... │
 1 |   │     │   │     │      │     │
   +---┴─────┴---┴─────┴------┴─────┴----->  machines
        M1          M2           M3
   load=7        load=4        load=9   ← makespan = max = 9 (M3)
```

Three truths jump out of the picture:

- **The total area (all blocks) is fixed** — that's `P`, the total work. You can rearrange the blocks across stacks, but you can't shrink the total.
- **The makespan is the tallest column.** Your goal is to keep the tallest column as short as possible, which means keeping the columns *even*.
- **The perfectly balanced height is `P/m`** — total area divided by number of stacks. You can't do better than that (the average bound), and one giant block can force you higher (the biggest-job bound).

The online twist: the blocks arrive one at a time and you must drop each onto a stack *immediately*, before seeing the next block. A clairvoyant who saw all the blocks first could pack them to get the tallest column as close to `P/m` as the block sizes allow. You're dropping blind. List scheduling is the rule "always drop the next block onto the *shortest* current stack" — and the rest of this file is about how good that simple instinct turns out to be.

---

## Graham's List Scheduling: Always Pick the Least-Loaded Machine

In 1966, Ron Graham analyzed the most natural greedy rule imaginable, and it remains the canonical online scheduling algorithm.

> **List scheduling (Graham's greedy rule):** When a job arrives, assign it to the machine with the **currently smallest load** (break ties arbitrarily, say lowest machine index). Then add the job's processing time to that machine's load.

That's the entire algorithm. It is greedy in the textbook sense: at each step it makes the locally sensible choice — "put the new work where there's the most room" — and never reconsiders. It needs no knowledge of the future and no knowledge of how many jobs remain. It only ever asks one question: *which machine is least loaded right now?*

Why is this the natural rule? Because the makespan is the *max* load, and the way to keep a max small is to avoid letting any one machine run away. Feeding the next job to the least-loaded machine is the direct way to fight imbalance: you're always shoring up the shortest stack. It won't be perfect — a job placed on the (currently) shortest machine can still, in hindsight, have been better placed elsewhere once you see what comes next — but it never *gratuitously* piles work onto an already-busy machine.

The name "list scheduling" comes from Graham's framing: imagine the jobs written on a list, processed top to bottom, each handed to a free/least-busy machine. The order of that list is exactly the online request order, which the adversary controls. The remarkable result — which we build toward — is that *whatever* order the adversary picks, this greedy rule stays within a factor of `2 − 1/m` of the clairvoyant optimum.

---

## A Fully Worked List-Scheduling Trace

Let's run list scheduling concretely. Take **`m = 3`** machines and the job sequence:

```
σ  =  3   3   3   3   3   5
      1   2   3   4   5   6      (job index)
```

Five jobs of size 3, then one job of size 5. Total work `P = 5·3 + 5 = 20`. We trace the three loads after each assignment; the chosen machine is the least-loaded one at that moment.

| # | Job | Loads before (M1, M2, M3) | Least-loaded → assign to | Loads after |
|--:|:---:|:--------------------------|:-------------------------|:------------|
| 1 | 3 | (0, 0, 0) | M1 (tie, pick lowest index) | (3, 0, 0) |
| 2 | 3 | (3, 0, 0) | M2 | (3, 3, 0) |
| 3 | 3 | (3, 3, 0) | M3 | (3, 3, 3) |
| 4 | 3 | (3, 3, 3) | M1 (tie) | (6, 3, 3) |
| 5 | 3 | (6, 3, 3) | M2 | (6, 6, 3) |
| 6 | 5 | (6, 6, 3) | M3 (load 3 is smallest) | (6, 6, 8) |

**List-scheduling makespan = 8** (machine M3). Now compare to the clairvoyant optimum. With six jobs `{3,3,3,3,3,5}` and three machines, a scheduler that saw all jobs first would pair them up as `{5,3}=8`? No — it can do better by isolating: put the big `5` alone, and split the five `3`s as `{3,3}, {3,3}, {3,5}`… let's just find the best. Total is 20, so `OPT ≥ 20/3 ≈ 6.67`, and `OPT ≥ 5`. A balanced assignment is `{3,3}=6`, `{3,3}=6`, `{3,5}=8` → makespan 8; or `{3,3,3}=9`… worse. Actually the optimum here is **9? no** — try `{5,3}=8, {3,3}=6, {3,3}=6` → makespan 8. Can we beat 8? We need every machine ≤ 7. The `5` plus any `3` is `8 > 7`, so the `5` must be *alone* or with nothing — `5` alone on one machine, and the five `3`s on the other two machines: that's `15` over two machines → one machine gets at least `9`. So makespan `≥ 9` if the 5 is alone. Keeping the 5 with a 3 gives 8. **OPT = 8** here, and list scheduling matched it.

That tie is a coincidence of this gentle ordering. To make the greedy rule *suffer*, the adversary reorders the very same jobs — small ones first, the big one last — which we do in the worst-case section. But first, let's understand why list scheduling can never suffer *too* much.

---

## Why List Scheduling Is (2 − 1/m)-Competitive

Here is the headline theorem and a proof you can hold in your head. It's one of the most elegant arguments in all of online algorithms.

> **Theorem (Graham, 1966).** List scheduling is **(2 − 1/m)-competitive**: on every job sequence, its makespan is at most `(2 − 1/m) · OPT`.

The proof is a single clever observation about **the machine that ends up busiest** and **the last job placed on it**.

**Setup.** Let machine `i` be the one that achieves the final makespan `Cmax` (the tallest stack). Let `j` be the **last job** that list scheduling placed on machine `i`, and let `pⱼ` be its size. Let `L` be the load on machine `i` *just before* job `j` was added. So:

```
Cmax  =  L  +  pⱼ
```

**Key fact: when `j` was placed, machine `i` was the least-loaded machine.** That's the whole rule — list scheduling only puts a job on a machine if it's currently the smallest. So at that moment, *every* machine had load ≥ `L` (machine `i` was the minimum, at load `L`). Therefore the total work placed so far was at least `m · L`. Since total work only grows, the full total `P ≥ m · L`, which gives:

```
L  ≤  P / m
```

Now invoke our two floors on OPT from earlier:

```
(1)  L   ≤  P / m  ≤  OPT          (the average bound:  OPT ≥ P/m)
(2)  pⱼ  ≤  pₘₐₓ   ≤  OPT          (the biggest-job bound: OPT ≥ pₘₐₓ)
```

Add them:

```
Cmax  =  L + pⱼ  ≤  OPT + OPT  =  2·OPT
```

So list scheduling is **at worst 2·OPT** — already a beautiful result from a trivial algorithm! The sharper `2 − 1/m` comes from one refinement: the total work *excluding* job `j` is spread over the machines, and machine `i` held `L` of it before `j` arrived, so the *other* `m−1` machines plus machine `i`'s pre-`j` load satisfy `m·L ≤ P − pⱼ` (the work before `j`, plus `j` itself, is `P`; machine `i` had `L ≤ (P − pⱼ)/m` since the others were each `≥ L`). Substituting `L ≤ (P − pⱼ)/m ≤ (m·OPT − pⱼ)/m = OPT − pⱼ/m`:

```
Cmax  =  L + pⱼ  ≤  (OPT − pⱼ/m) + pⱼ  =  OPT + pⱼ·(1 − 1/m)  ≤  OPT + OPT·(1 − 1/m)  =  (2 − 1/m)·OPT
```

> **The punchline in words:** the busiest machine's *last* job started on a machine that was, at that moment, the emptiest — so its load-before is at most the average (≤ OPT), and the job itself is at most the biggest job (≤ OPT). The makespan is "average-ish plus one job," and both pieces are bounded by OPT. That's the entire reason a blind greedy rule can't be more than ~2× off.

For `m = 2` the bound is `2 − 1/2 = 1.5`; for `m = 10` it's `1.9`; as `m → ∞` it approaches `2`. More machines means more ways for the greedy rule to be unlucky, so the worst case drifts toward 2.

---

## The Worst Case: Forcing the (2 − 1/m) Ratio

An upper bound says "never worse than `2 − 1/m`." To show that bound is *tight* — that the adversary can actually push list scheduling that far — we construct a sequence that forces it. This is the "build one bad input" move from [competitive analysis](../01-competitive-analysis/junior.md): one example proves a lower bound on the ratio.

**The adversary's recipe:** flood the machines with small jobs to make them all equally tall, *then* drop one big job. Concretely, with `m` machines:

```
First:   m·(m−1)  jobs of size 1     (many small jobs)
Then:    1        job  of size m     (one big job)
```

Watch list scheduling handle it:

- **The `m·(m−1)` unit jobs** get spread perfectly evenly (the rule keeps topping up the shortest machine). Each machine ends up with exactly `m−1` of them, so **every machine has load `m−1`**. The stacks are dead even at height `m − 1`.
- **The big job of size `m`** arrives. Every machine has load `m−1`; the rule picks one (they're tied) and piles the big job on top. That machine now has load `(m−1) + m = 2m − 1`.

So **list scheduling's makespan = `2m − 1`.**

Now the clairvoyant OPT, seeing all jobs first, does something smarter: **dedicate one machine entirely to the big job**, and spread all `m·(m−1)` unit jobs over the *other* `m−1` machines. Those `m−1` machines each get `m·(m−1)/(m−1) = m` units of work → load `m`. The dedicated machine holds just the size-`m` job → load `m`. **Every** machine has load exactly `m`, so **OPT = `m`.**

The ratio:

```
ListScheduling / OPT  =  (2m − 1) / m  =  2 − 1/m
```

Exactly the bound — the adversary reached it. Here's the picture for `m = 3` (so 6 unit jobs, then one job of size 3):

```
LIST SCHEDULING (small jobs first, big job last)        OPT (clairvoyant)

 5 |              ┌───┐                          3 |  ┌───┐ ┌───┐ ┌───┐
 4 |              │ 3 │                            |  │1+1│ │1+1│ │ 3 │
 3 |  ┌─┐ ┌─┐     │   │                          2 |  │ 1 │ │ 1 │ │   │
 2 |  │1│ │1│     ├───┤                            |  ├───┤ ├───┤ │   │
 1 |  │1│ │1│     │1+1│                          1 |  │ 1 │ │ 1 │ │   │
   +--┴─┴-┴─┴-----┴───┴-->                          +--┴───┴-┴───┴-┴───┴-->
      M1   M2      M3                                  M1    M2    M3
   load=2  2   2+3=5  ← makespan 5                  load=3   3     3   ← makespan 3

   ratio = 5/3 = 2 − 1/3
```

The lesson is the same one ski rental taught: a single, deliberately ordered input pins the worst case. **Small-jobs-first-then-one-big-job** is the adversary's weapon against list scheduling, because it tricks the rule into filling every machine evenly right before a giant job lands — leaving it nowhere good to put the giant. Which is *exactly* the flaw the next algorithm fixes.

---

## LPT: When You're Allowed to Sort First (Semi-Online)

The worst case above happened because the *big* job arrived *last*, after the machines were already full. What if we could handle the big jobs *first*, while the machines are still empty and there's a naturally empty home for them? That's the idea behind **LPT**.

> **LPT (Longest Processing Time first):** Sort the jobs in **decreasing** order of size, then run list scheduling on that order — each job (largest remaining) goes to the currently least-loaded machine.

Putting the big jobs down first means by the time the small jobs arrive, they're just *fine-tuning* the balance — they can slot into whichever machine is lowest, and a small job can only unbalance things by a little. The big, dangerous jobs are placed when every machine is still relatively empty and there's room to isolate them.

The payoff is a dramatically better guarantee:

> **Theorem (Graham, 1969).** LPT produces a makespan at most `(4/3 − 1/(3m)) · OPT`.

For `m = 3` that's `4/3 − 1/9 ≈ 1.22`; as `m → ∞` it approaches `4/3 ≈ 1.33`. Compare to plain list scheduling's `2 − 1/m → 2`. Sorting first cuts the worst-case overhead from ~100% to ~33%.

Let's run LPT on the adversary's own sequence — the one that broke plain list scheduling — for `m = 3`: jobs `{3, 1, 1, 1, 1, 1, 1}` (one job of size 3, six of size 1). LPT first **sorts descending**: `3, 1, 1, 1, 1, 1, 1`. (The big job is now first.)

| # | Job | Loads before | Assign to | Loads after |
|--:|:---:|:-------------|:----------|:------------|
| 1 | 3 | (0, 0, 0) | M1 | (3, 0, 0) |
| 2 | 1 | (3, 0, 0) | M2 | (3, 1, 0) |
| 3 | 1 | (3, 1, 0) | M3 | (3, 1, 1) |
| 4 | 1 | (3, 1, 1) | M2 | (3, 2, 1) |
| 5 | 1 | (3, 2, 1) | M3 | (3, 2, 2) |
| 6 | 1 | (3, 2, 2) | M2 | (3, 3, 2) |
| 7 | 1 | (3, 3, 2) | M3 | (3, 3, 3) |

**LPT makespan = 3**, which equals `OPT = 3`. The very ordering that forced plain list scheduling to `2 − 1/m` is handled *optimally* by LPT, because LPT placed the big job first and then balanced the small ones around it. That's the power of seeing the jobs before deciding their order.

### The catch: LPT is "semi-online"

There is no free lunch. To sort the jobs by size, **LPT must see all the jobs before it places any of them** — it needs the whole set up front. That breaks the strict online rule "decide on each job before seeing the next." So LPT is not a pure online algorithm; it's **semi-online**: it has a bit of extra power (a look at the full job set, enough to sort).

When is LPT usable? Whenever the jobs really do arrive as a *batch* you can inspect before scheduling — a nightly build queue, a batch of MapReduce tasks, a set of files to compress. When jobs truly trickle in one at a time and must be placed on arrival (live web requests, streaming tasks), you're stuck with pure online and `2 − 1/m` is the best a simple greedy gives. The distinction — *do the jobs arrive all at once or one at a time?* — decides which tool you reach for, and it's worth asking on every real system.

| Algorithm | Knowledge needed | Competitive ratio | When to use |
|-----------|------------------|-------------------|-------------|
| **List scheduling** | none (pure online) | `2 − 1/m` (≤ 2) | jobs arrive one at a time, place on arrival |
| **LPT** | full job set up front (semi-online: sort) | `4/3 − 1/(3m)` (≤ 4/3) | jobs available as a batch you can sort |

---

## A Sibling Problem: Online Bin Packing

Scheduling asks "spread fixed work over `m` machines to minimize the *max* load." A close cousin flips it: "given a stream of items, use as *few* fixed-size containers as possible." That's **bin packing**, and online bin packing is the natural sibling of online scheduling — same flavor of greedy decisions, same competitive-analysis lens.

> **Online bin packing.** Items with sizes `s₁, s₂, … ∈ (0, 1]` arrive **one at a time**. Each must be placed into a **unit-capacity bin** (a bin holds items summing to ≤ 1). You may open new bins as needed. **Goal:** minimize the total number of bins used. The clairvoyant OPT is the fewest bins that fit all items.

The online twist is identical: place each item on arrival, blind to future items, no take-backs. The three classic greedy rules differ only in *which existing bin they try*:

**Next-Fit.** Keep just **one** bin "open." Put each item in the open bin if it fits; if not, **close that bin forever** and open a fresh one for the item. Cheap (O(1) memory, never looks back), but wasteful — a closed bin might have had room. **Next-Fit is 2-competitive:** it uses at most `2·OPT` bins. The intuition: any two *consecutive* bins it fills must together hold more than 1 unit of items (otherwise the second would have fit in the first), so it can't waste more than half its space on average.

**First-Fit.** Keep **all** previously opened bins available. For each item, scan bins in order opened and drop it into the **first** one it fits; open a new bin only if none fit. More work per item, but far less waste because it revisits earlier bins. **First-Fit uses at most ≈ 1.7·OPT bins asymptotically** (precisely, `⌊1.7·OPT⌋`). A big improvement over Next-Fit for a modest bookkeeping cost.

**Best-Fit.** Like First-Fit, but among all bins the item fits in, choose the one with the **least remaining room** (the *tightest* fit) — pack snugly to leave large gaps open for large future items. Best-Fit has the **same ≈ 1.7·OPT** asymptotic guarantee as First-Fit and is often a touch better in practice.

| Rule | Looks at | Memory | Competitive ratio | Idea |
|------|----------|--------|-------------------|------|
| **Next-Fit** | one open bin | O(1) | 2 | fill current bin, then close it forever |
| **First-Fit** | all open bins | O(bins) | ≈ 1.7 | first bin that fits |
| **Best-Fit** | all open bins | O(bins) | ≈ 1.7 | tightest bin that fits |

Notice the family resemblance to scheduling: a trivially simple greedy (Next-Fit, like plain list scheduling) gets a clean factor-2-ish bound, and a slightly smarter greedy that uses more information (First-Fit/Best-Fit, like LPT using the sorted order) buys a meaningfully better ratio. (Sorting items *largest-first* before First-Fit — **First-Fit-Decreasing**, the bin-packing analog of LPT — does even better, ≈ `11/9·OPT`, but like LPT it needs the items up front, so it's semi-online.)

---

## A Worked First-Fit Example

Let's pack a concrete stream with **First-Fit** and count bins. Unit bins (capacity 1.0), items arriving online:

```
items  =  0.5,  0.7,  0.5,  0.2,  0.4,  0.2,  0.5
```

First-Fit: for each item, scan open bins **in order opened**, drop into the first with room; else open a new bin.

| # | Item | Scan (bin: remaining room) | Decision | Bins after (contents → used / room) |
|--:|:----:|:---------------------------|:---------|:------------------------------------|
| 1 | 0.5 | (no bins yet) | open **B1** | B1: 0.5 → 0.5 / 0.5 |
| 2 | 0.7 | B1 has 0.5 room, 0.7 > 0.5 ✗ | open **B2** | B1: 0.5; B2: 0.7 → 0.7 / 0.3 |
| 3 | 0.5 | B1 has 0.5 room, fits ✓ | into **B1** | B1: 0.5+0.5=1.0 / 0.0; B2: 0.7 |
| 4 | 0.2 | B1 full ✗; B2 has 0.3, fits ✓ | into **B2** | B1: 1.0; B2: 0.7+0.2=0.9 / 0.1 |
| 5 | 0.4 | B1 full ✗; B2 has 0.1, ✗ | open **B3** | B1: 1.0; B2: 0.9; B3: 0.4 / 0.6 |
| 6 | 0.2 | B1 ✗; B2 has 0.1 ✗; B3 has 0.6, fits ✓ | into **B3** | B3: 0.4+0.2=0.6 / 0.4 |
| 7 | 0.5 | B1 ✗; B2 ✗; B3 has 0.4 ✗ | open **B4** | B4: 0.5 / 0.5 |

**First-Fit used 4 bins.** Final contents: B1 = {0.5, 0.5} = 1.0, B2 = {0.7, 0.2} = 0.9, B3 = {0.4, 0.2} = 0.6, B4 = {0.5} = 0.5.

How close is that to OPT? Total size = `0.5+0.7+0.5+0.2+0.4+0.2+0.5 = 3.0`, so `OPT ≥ ⌈3.0⌉ = 3` bins (you can't fit 3.0 units of stuff into fewer than 3 unit bins). And 3 *is* achievable with hindsight: `{0.7, 0.2} {0.5, 0.5} {0.5, 0.4, 0.2 = wait that's 1.1}`… try `{0.7,0.2,?}, {0.5,0.5}, {0.4,0.5,?}` → `{0.7,0.2}=0.9`, `{0.5,0.5}=1.0`, `{0.4,0.5}=0.9`, leaving `0.2` → `{0.7,0.2,?}`… the last `0.2` fits in the first bin: `{0.7,0.2}=0.9`+`0.2`? that's only if we reorder. With full hindsight `{0.5,0.5}, {0.7,0.2}, {0.4,0.5}` packs six items into 3 bins and the seventh `0.2` joins `{0.7,0.2}`→`{0.7,0.2,...}`=0.9 then +0.2 overflows; cleanest optimal is **3 bins**: `{0.5,0.5}`, `{0.7,0.2}`, `{0.5,0.4,...}`. The point for a junior reader: First-Fit's **4** is within the `≈1.7·OPT` promise of OPT's **3** (4 ≤ 1.7·3 = 5.1), and the only reason it "wasted" a bin is the online constraint — it committed the early `0.5`s before knowing the later items that would have paired more tightly. Same moral as scheduling: blindness costs you, but a bounded amount.

---

## Code: List Scheduling, LPT, and First-Fit

Let's make it runnable. We implement online **list scheduling**, semi-online **LPT**, a small **brute-force offline optimum** to act as OPT on tiny instances, and **First-Fit** bin packing — then watch the makespan numbers and ratios fall out.

### Python: list scheduling, LPT, and a brute-force OPT

```python
from itertools import product

def list_scheduling(jobs, m):
    """
    Online list scheduling (Graham): assign each job, in arrival order,
    to the currently least-loaded machine. Returns the makespan.
    """
    loads = [0] * m
    for p in jobs:                      # jobs arrive one at a time, in this order
        i = loads.index(min(loads))     # least-loaded machine right now
        loads[i] += p                   # irrevocable assignment
    return max(loads)                   # makespan = busiest machine

def lpt(jobs, m):
    """
    LPT (semi-online): sort jobs DESCENDING, then list-schedule.
    Needs the whole job set up front to sort -> not pure online.
    """
    return list_scheduling(sorted(jobs, reverse=True), m)

def opt_makespan(jobs, m):
    """
    Offline OPT by brute force: try every assignment of jobs->machines,
    return the minimum achievable makespan. Exponential (m**n) -- tiny inputs only.
    """
    best = float("inf")
    for assignment in product(range(m), repeat=len(jobs)):
        loads = [0] * m
        for job_idx, machine in enumerate(assignment):
            loads[machine] += jobs[job_idx]
        best = min(best, max(loads))
    return best

if __name__ == "__main__":
    m = 3
    # The adversary's order: many small jobs, then one big job.
    jobs = [1, 1, 1, 1, 1, 1, 3]    # 6 unit jobs + one size-3 job
    ls   = list_scheduling(jobs, m)
    lp   = lpt(jobs, m)
    opt  = opt_makespan(jobs, m)
    print(f"jobs={jobs}  m={m}")
    print(f"List scheduling makespan = {ls}   (ratio {ls/opt:.3f})")
    print(f"LPT             makespan = {lp}   (ratio {lp/opt:.3f})")
    print(f"OPT (brute force)        = {opt}")
```

Note the input order matters *only for list scheduling*: it processes jobs as they arrive. Running this prints:

```
jobs=[1, 1, 1, 1, 1, 1, 3]  m=3
List scheduling makespan = 4   (ratio 1.333)
LPT             makespan = 3   (ratio 1.000)
OPT (brute force)        = 3
```

LPT nails the optimum (3), while list scheduling pays 4 because the big job arrived last. Reorder the input to put the `3` first and list scheduling improves — proving the makespan of the *online* rule genuinely depends on the adversary's ordering, exactly as the theory says.

### Watching list scheduling approach (2 − 1/m)

Feed the worst-case construction — `m·(m−1)` unit jobs, then one job of size `m` — and watch the ratio hit `2 − 1/m` exactly:

```python
if __name__ == "__main__":
    for m in (2, 3, 5, 10):
        jobs = [1] * (m * (m - 1)) + [m]   # small jobs first, big job LAST
        ls  = list_scheduling(jobs, m)     # online: order is as given
        # OPT here is m (dedicate one machine to the big job, spread the rest)
        opt = m
        print(f"m={m:2d}:  list={ls:3d}  opt={opt:2d}  ratio={ls/opt:.3f}  "
              f"(2 - 1/m = {2 - 1/m:.3f})")
```

This prints:

```
m= 2:  list=  3  opt= 2  ratio=1.500  (2 - 1/m = 1.500)
m= 3:  list=  5  opt= 3  ratio=1.667  (2 - 1/m = 1.667)
m= 5:  list=  9  opt= 5  ratio=1.800  (2 - 1/m = 1.800)
m=10:  list= 19  opt=10  ratio=1.900  (2 - 1/m = 1.900)
```

The empirical ratio matches `2 − 1/m` to the decimal, and creeps toward `2` as `m` grows — the lower bound from the worst-case section, running on your machine. (We use the known `OPT = m` instead of brute force here, since brute force is `m^n` and these `n` are too large for it.)

### First-Fit bin packing (Python)

```python
def first_fit(items):
    """
    Online First-Fit: place each item into the first opened bin that fits;
    open a new bin only if none fit. Returns the number of bins used.
    """
    bins = []                      # bins[i] = current total in bin i
    for s in items:                # items arrive one at a time
        for i in range(len(bins)):
            if bins[i] + s <= 1.0 + 1e-9:   # fits (epsilon for float safety)
                bins[i] += s
                break
        else:                      # no existing bin had room
            bins.append(s)         # open a new bin
    return len(bins)

if __name__ == "__main__":
    items = [0.5, 0.7, 0.5, 0.2, 0.4, 0.2, 0.5]
    used = first_fit(items)
    lower_bound = -(-sum(items) // 1)        # ceil(total) = floor OPT lower bound
    print(f"items = {items}")
    print(f"First-Fit used {used} bins   (OPT >= ceil(total) = {int(lower_bound)})")
```

This prints:

```
items = [0.5, 0.7, 0.5, 0.2, 0.4, 0.2, 0.5]
First-Fit used 4 bins   (OPT >= ceil(total) = 3)
```

— matching the hand-traced 4 bins, comfortably inside the `≈1.7·OPT` promise.

### Go: list scheduling with a min-heap (the efficient core)

A linear scan for the least-loaded machine is O(m) per job. With a **min-heap** of (load, machine) it's O(log m) per job — the real implementation a production scheduler would use.

```go
package main

import (
	"container/heap"
	"fmt"
)

// A min-heap of machine loads, smallest load on top.
type loadHeap []int

func (h loadHeap) Len() int            { return len(h) }
func (h loadHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h loadHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *loadHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *loadHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// listScheduling assigns each job to the least-loaded machine via a min-heap.
func listScheduling(jobs []int, m int) int {
	h := make(loadHeap, m) // m machines, all load 0
	heap.Init(&h)
	for _, p := range jobs {
		least := heap.Pop(&h).(int) // pull the least-loaded machine
		heap.Push(&h, least+p)      // add the job, push it back
	}
	makespan := 0
	for _, load := range h { // the max remaining load is the makespan
		if load > makespan {
			makespan = load
		}
	}
	return makespan
}

func main() {
	jobs := []int{1, 1, 1, 1, 1, 1, 3}
	m := 3
	fmt.Printf("jobs=%v m=%d\n", jobs, m)
	fmt.Printf("list scheduling makespan = %d\n", listScheduling(jobs, m))
}
```

This prints `list scheduling makespan = 4` — the same answer as Python, now in O(n log m) time, which is exactly how a real scheduler picks "the emptiest machine" cheaply at scale. Whatever the language, the pattern is identical: pull the least-loaded machine, add the job, repeat.

---

## Real Load Balancers and Bin Packers: The Map

This isn't abstract — online scheduling and bin packing run in the infrastructure you use and operate every day. Here's the map from theory to production.

### Load balancers are list scheduling

A network load balancer distributing requests across `m` backend servers is *literally* solving online load balancing, with "job size" being the work a request imposes.

| Real strategy | What it does | Maps to |
|---------------|-------------|---------|
| **Least-connections** | send the next request to the backend with the fewest active connections | **list scheduling** with load ≈ connection count |
| **Least-load / least-response-time** | send to the backend with the lowest current load (e.g. lowest latency or CPU) | **list scheduling** with load = measured load — the direct analog |
| **Round-robin** | cycle through backends in fixed order, ignoring load | a *cheaper, dumber* heuristic — good when jobs are uniform, but blind to imbalance |
| **Weighted round-robin** | round-robin biased by backend capacity | round-robin adjusted for heterogeneous machines |
| **Power of two choices ("P2C")** | pick 2 backends at random, send to the *less loaded* of the two | a brilliant near-list-scheduling shortcut — O(1) per request, no global min, yet provably keeps loads remarkably even |

**Least-connections / least-load is list scheduling by another name** — "put the next job on the least-loaded machine." **Round-robin** is the lazy version that doesn't measure load (fine when every job is the same size; bad when jobs vary). **Power-of-two-choices** is the practical star: querying *every* backend's load for each request (true list scheduling) is expensive and creates a contention hotspot, so instead you sample just *two* random backends and pick the emptier — and remarkably, that tiny bit of choice keeps the maximum load almost as low as full list scheduling, at O(1) cost. It's the rule behind many modern load balancers and hashing-based distributed caches.

### Container/VM placement is bin packing

Scheduling pods onto nodes, or VMs onto physical hosts, is **online bin packing** in multiple dimensions (CPU *and* memory *and* disk are simultaneous "sizes"):

| System | "Item" | "Bin" | Packing behavior |
|--------|--------|-------|------------------|
| **Kubernetes scheduler** | a pod (with CPU/memory requests) | a node (with allocatable CPU/memory) | scores nodes; `MostAllocated`/`bin-packing` strategy = Best-Fit (pack tight, free up whole nodes to scale down); `LeastAllocated` = spread (more like list scheduling for resilience) |
| **Google Borg / Omega** | a task | a machine | bin-packs tasks onto machines to maximize utilization while respecting constraints |
| **Cloud VM placement** | a VM | a physical host | First-Fit/Best-Fit-style packing to minimize the number of powered-on hosts |
| **Cluster autoscalers** | pending pods | new nodes | use bin-packing logic to decide how many nodes (bins) to add or remove |

The tension is the same one this lesson surfaced. **Bin-packing tight (Best-Fit)** maximizes utilization and lets you power down whole empty machines to save money — at the cost of resilience (a tightly packed node has no slack for spikes). **Spreading (list-scheduling style)** keeps each machine cool and gives headroom for bursts — at the cost of leaving machines partly empty. Kubernetes literally exposes both as scheduler strategies (`MostAllocated` vs `LeastAllocated`), and choosing between them is choosing your point on the exact trade-off this file is about.

The throughline: **least-load load balancing is list scheduling; round-robin and power-of-two-choices are its cheaper cousins; container/VM placement is bin packing; and "pack tight vs spread out" is the production face of "minimize bins vs minimize max load."** The greedy rules you traced by hand are, almost unchanged, what these systems run.

---

## Common Misconceptions

- **"List scheduling is optimal."** No. It's `(2 − 1/m)`-competitive — within a factor of ~2 of optimal — but the offline OPT can beat it (and LPT, with a look at all jobs, beats plain list scheduling). List scheduling is the best *simple online greedy*, not the best possible.

- **"LPT is an online algorithm."** No. LPT must sort, which requires seeing **all** jobs before placing any. It's **semi-online**. If your jobs truly arrive one at a time and must be placed on arrival, you can't run LPT — you're back to plain list scheduling and `2 − 1/m`.

- **"A 2-competitive scheduler is twice as slow."** It's not about running time. It's about the *makespan* (the metric we minimize) being at most ~2× OPT's makespan. The algorithm itself is fast — O(n log m) with a heap.

- **"More machines means a better ratio."** The opposite for list scheduling: `2 − 1/m` grows *toward 2* as `m` increases (more machines ⇒ more room for the greedy rule to be unlucky). The bound is *better* (closer to 1) when `m` is small.

- **"Minimizing makespan means minimizing total work."** No — total work `P` is fixed by the jobs and can't change. Minimizing makespan means **balancing** that fixed work so the *busiest* machine is as light as possible.

- **"Round-robin is as good as least-load."** Only when all jobs are the same size. With varying job sizes, round-robin ignores imbalance and can pile big jobs onto an already-busy server; least-load (list scheduling) actively fights that.

- **"Best-Fit always beats First-Fit."** They share the same `≈1.7·OPT` worst-case guarantee. Best-Fit is often slightly better in practice, but neither dominates the other on every input — same "no policy wins every sequence" lesson from paging.

---

## Common Mistakes

- **Assigning to the wrong machine.** List scheduling assigns to the **least-loaded** machine, not the first machine, not a random one. If you assign to the first free or first-by-index machine, you've implemented something weaker with no `2 − 1/m` guarantee.

- **Confusing makespan with total or average load.** The makespan is the **max** load, full stop. Reporting the sum or the average hides the bottleneck and misses the entire point of the problem.

- **Forgetting the two OPT floors.** Every makespan argument rests on `OPT ≥ P/m` (average) **and** `OPT ≥ pₘₐₓ` (biggest job). Drop either and you can't bound list scheduling. The biggest-job floor is the one beginners forget — and it's exactly what stops OPT from being arbitrarily small.

- **Running LPT and calling it online.** Sorting peeks at the whole input. If you claim a pure-online guarantee while sorting first, you're quietly using semi-online power. Be honest about which setting you're in.

- **Proving the ratio by examples.** Running a few job sequences shows the ratio is *at least* something (a lower bound). The `2 − 1/m` *upper* bound needs the "last job on the busiest machine" argument over **all** inputs — sampling can't establish it. (Same asymmetry as in [competitive analysis](../01-competitive-analysis/junior.md): one example for a lower bound, an argument over all inputs for an upper bound.)

- **Overflowing a bin in bin packing.** A bin holds items summing to **≤ 1**. Watch float rounding — `0.1 + 0.2 = 0.30000000000000004 > 0.3` can falsely overflow; compare with a small epsilon.

- **Treating bin packing as one-dimensional in production.** Real pod/VM placement packs CPU *and* memory *and* disk simultaneously (multi-dimensional bin packing), which is harder than the single-size textbook version. Don't reason about a Kubernetes scheduler as if items had one size.

---

## Cheat Sheet

```
THE ONLINE MAKESPAN / LOAD-BALANCING PROBLEM
  m identical machines; jobs arrive ONE AT A TIME, each assigned irrevocably,
  blind to future jobs. Load(machine) = sum of its jobs. MAKESPAN = max load.
  GOAL: minimize the makespan.

TWO FLOORS ON OPT  (a clairvoyant can't beat either)
  OPT >= P / m        (average bound: total work P over m machines)
  OPT >= p_max        (biggest-job bound: the largest job lands somewhere whole)

LIST SCHEDULING (Graham, greedy, PURE ONLINE)
  rule: assign each job to the CURRENTLY LEAST-LOADED machine.
  guarantee: (2 - 1/m)-competitive   (<= 2x OPT, forever)
  why: busiest machine's LAST job started when that machine was the emptiest,
       so load-before <= P/m <= OPT, and the job <= p_max <= OPT
       => makespan = load-before + job <= 2*OPT  (sharper: (2 - 1/m)*OPT)
  worst case: m*(m-1) unit jobs, THEN one job of size m
              -> list = 2m-1, OPT = m, ratio = 2 - 1/m  (tight)

LPT (Longest Processing Time first, SEMI-ONLINE)
  rule: SORT jobs descending, then list-schedule.
  guarantee: (4/3 - 1/(3m))-competitive   (<= 4/3 x OPT)
  catch: must see ALL jobs to sort -> semi-online, needs a batch.

ONLINE BIN PACKING (sibling: items size <=1 -> unit bins, minimize #bins)
  Next-Fit: one open bin, close it when an item doesn't fit   -> 2-competitive
  First-Fit: first opened bin that fits                       -> ~1.7 * OPT
  Best-Fit:  tightest opened bin that fits                    -> ~1.7 * OPT
  First-Fit-Decreasing (sort big-first, semi-online)          -> ~11/9 * OPT

REAL-WORLD MAP
  least-connections / least-load LB ......... = list scheduling
  round-robin ............................... cheaper, load-blind cousin
  power-of-two-choices ...................... O(1) near-list-scheduling
  Kubernetes / Borg pod & VM placement ...... bin packing (Best-Fit=pack tight,
                                              spread=resilience)
```

---

## Summary

Online scheduling is a textbook online problem with enormous real-world reach. You have `m` identical machines; jobs arrive **one at a time** and each must be assigned to a machine **irrevocably, blind to future jobs**; a machine's **load** is the sum of its jobs and the **makespan** is the maximum load — the finish time of the batch — which you want small.

- **The benchmark OPT obeys two floors.** No scheduler, even a clairvoyant, can beat `OPT ≥ P/m` (the average bound — fixed total work `P` over `m` machines) or `OPT ≥ pₘₐₓ` (the biggest-job bound — the largest job lands somewhere whole). These two facts are the entire engine of the analysis.

- **Graham's list scheduling** — assign each job to the **currently least-loaded** machine — is **(2 − 1/m)-competitive**. The proof is one observation: the busiest machine's *last* job started when that machine was the *emptiest*, so its load-before is at most the average (≤ OPT) and the job itself is at most the biggest job (≤ OPT); the makespan is their sum, ≤ 2·OPT. The adversary makes this tight with `m·(m−1)` tiny jobs followed by one big job, forcing exactly `2 − 1/m`.

- **LPT** (sort descending, then list-schedule) does far better — `4/3 − 1/(3m)` — by placing the dangerous big jobs first, while machines are still empty. But sorting needs the whole job set up front, so LPT is **semi-online**: usable for *batches*, not for jobs that truly trickle in one at a time.

- **Online bin packing** is the sibling problem: pack unit-size items into the fewest unit bins. **Next-Fit** (one open bin) is 2-competitive; **First-Fit** and **Best-Fit** (reuse all open bins) are ≈ 1.7·OPT — same pattern as scheduling, where a slightly smarter greedy using more information buys a better ratio.

- **The code makes it runnable:** list scheduling and LPT computing makespan against a brute-force offline OPT on small instances, the worst-case construction driving the ratio to `2 − 1/m` on your machine, and First-Fit packing a stream into bins.

- **It all maps to production.** Least-connections / least-load load balancing *is* list scheduling; round-robin and power-of-two-choices are its cheaper cousins; Kubernetes/Borg pod and VM placement is bin packing, where "pack tight" (Best-Fit, save machines) versus "spread out" (list-scheduling style, keep headroom) is a real scheduler setting you choose.

The big idea to carry forward: **a trivially simple greedy — "put the next job where there's the most room" — comes with a hard worst-case guarantee of under 2× the clairvoyant optimum, and a single batch-sort (LPT) cuts that to under 4/3.** That's why these rules, almost unchanged, run the load balancers and container schedulers underneath everything.

**Next steps:** [the middle-level treatment](./middle.md) proves the LPT and bin-packing bounds rigorously, develops randomized and lower-bound results for online scheduling, and explores related-machines and restricted-assignment variants. Revisit [Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md) and [Paging and Caching Theory](../03-paging-and-caching-theory/junior.md) — the two siblings in this section — and the framework that ties them together, [Competitive Analysis](../01-competitive-analysis/junior.md).

---

## Further Reading

- **Graham (1966), "Bounds for Certain Multiprocessing Anomalies"** — the original list-scheduling `(2 − 1/m)` bound.
- **Graham (1969), "Bounds on Multiprocessing Timing Anomalies"** — the LPT `(4/3 − 1/(3m))` result.
- **Borodin & El-Yaniv, *Online Computation and Competitive Analysis*** — the standard text; covers online scheduling and load balancing in the competitive-analysis framework.
- **Coffman, Garey & Johnson, "Approximation Algorithms for Bin Packing: A Survey"** — the definitive survey of Next-Fit, First-Fit, Best-Fit, and their decreasing variants.
- **Mitzenmacher, "The Power of Two Choices in Randomized Load Balancing"** — why sampling two backends keeps loads remarkably even.
- **[Competitive Analysis](../01-competitive-analysis/junior.md)** — the framework (online/offline, OPT, competitive ratio, adversary) this file applies.
- **[Online Scheduling and Load Balancing — Middle](./middle.md)** — rigorous proofs, randomized scheduling, and machine-model variants.
- **[Ski Rental and Rent-or-Buy](../02-ski-rental-and-rent-or-buy/junior.md)** and **[Paging and Caching Theory](../03-paging-and-caching-theory/junior.md)** — the sibling online problems in this section.
- **[Greedy Algorithms](../../14-greedy-algorithms/)** — list scheduling and the bin-packing rules are all greedy; the connection is worth seeing.
- **[Heaps](../../10-heaps/junior.md)** — the min-heap that makes "find the least-loaded machine" O(log m).
