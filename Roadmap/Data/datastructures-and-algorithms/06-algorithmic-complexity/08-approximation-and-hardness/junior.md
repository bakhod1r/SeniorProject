# Approximation Algorithms and Hardness — Junior Level

> **Audience:** You know what P, NP, and "NP-hard" mean (from the previous topics) but have never deliberately *given up on the optimum* and settled for a solution that's *provably close*. That move — and the surprising limits on how close you can get — is what this file teaches.
> **Read time:** ~40 minutes. **Focus:** "What does a 2-approximation actually promise?" and "Why can't we always get arbitrarily close?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Big Idea: When You Can't Win, Don't Lose by Much](#the-big-idea-when-you-cant-win-dont-lose-by-much)
5. [What an Approximation Ratio Actually Means](#what-an-approximation-ratio-actually-means)
6. [The Trick of Bounding OPT From Below](#the-trick-of-bounding-opt-from-below)
7. [Worked Example 1: Vertex Cover, a 2-Approximation](#worked-example-1-vertex-cover-a-2-approximation)
8. [Worked Example 2: Set Cover, the Greedy Logarithm](#worked-example-2-set-cover-the-greedy-logarithm)
9. [Worked Example 3: Metric TSP via the MST](#worked-example-3-metric-tsp-via-the-mst)
10. [A Fourth Quick One: Greedy Load Balancing](#a-fourth-quick-one-greedy-load-balancing)
11. [Can We Always Get Close? The Hardness Teaser](#can-we-always-get-close-the-hardness-teaser)
12. [Code: Measuring the Achieved Ratio](#code-measuring-the-achieved-ratio)
13. [Real-World Analogies](#real-world-analogies)
14. [Why This Matters in Practice](#why-this-matters-in-practice)
15. [Common Misconceptions](#common-misconceptions)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

In the [previous topic](../07-reductions-and-np-completeness/junior.md) you learned how to *recognize* a wall: when your scheduling, packing, or routing problem turns out to be **NP-hard**, you now know — before writing a line — that no fast, exact, general algorithm is known, and you'd be racing the entire field of computer science to find one. That recognition is genuinely useful. But it ends on a cliffhanger. The problem still has to ship. The trucks still have to be routed. So *now what?*

This file is the "now what." When you can't compute the **optimum** (OPT) efficiently, you stop demanding perfection and instead compute a solution that is **provably within a known factor of optimal** — and you *prove* that guarantee holds on *every* input, not just the lucky ones. An algorithm that always returns a solution within a factor **α** of OPT, in polynomial time, is called an **α-approximation algorithm**. The number α is its **approximation ratio**: a promise, in writing, about how far from perfect you can ever be.

The beautiful part is that these guarantees come from short, almost elementary arguments — a maximal matching here, a spanning tree there, a greedy "always grab the most" loop. You will work through three of them *fully*, with diagrams and the ratio-proof intuition, and you'll write code that *measures* the achieved ratio against a brute-force optimum on small instances, so the guarantee stops being a claim and becomes something you can watch happen.

Then comes the twist that makes this a deep subject and not just a bag of tricks. Some NP-hard problems can be approximated **arbitrarily well** — name any tolerance, there's an algorithm that hits it. Others have a **hard floor**: there is a specific ratio you provably *cannot* beat unless P = NP. You can pour a thousand engineer-years into the problem and the wall won't move, because the wall is a theorem. This is **hardness of approximation**, and we'll set it up gently here (the full machinery is a senior topic). By the end you'll know what a ratio promises, how to prove a couple of them, and why "just get a bit closer" is sometimes *forbidden*.

---

## Prerequisites

- **Required:** P, NP, and what "NP-hard" means. See [Reductions and NP-Completeness](../07-reductions-and-np-completeness/junior.md) and [Complexity Classes: P and NP](../06-complexity-classes-p-np/junior.md). The whole motivation here is "the problem is NP-hard, so the exact optimum is out of reach."
- **Required:** Big-O basics — what "polynomial time" means, and why polynomial is "efficient." See [Time vs Space Complexity](../01-time-vs-space-complexity/junior.md).
- **Helpful:** Comfort with simple graphs — vertices, edges, and what it means for an edge to be "covered" or for vertices to "match."
- **Helpful:** A nodding acquaintance with **greedy algorithms** — making the locally best choice at each step. We re-explain what we use, and you can go deeper in [Greedy Algorithms](../../14-greedy-algorithms/). Two of our three flagship algorithms are greedy.

No proofs of NP-hardness are needed — we *take* it as given that these problems are hard and ask what to do about it. No heavy formalism; every ratio argument here fits in a paragraph and a diagram.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Optimization problem** | A problem asking for the *best* solution — the minimum-cost or maximum-value one — not just a yes/no answer. |
| **OPT** | The value of the optimal solution for a given input. Usually unknown and hard to compute (that's the whole problem), but we reason *about* it. |
| **ALG** | The value of the solution our algorithm actually returns. |
| **Approximation ratio (α)** | The guaranteed worst-case ratio between ALG and OPT. For minimization, `ALG ≤ α·OPT` with α ≥ 1; for maximization, `ALG ≥ α·OPT` with α ≤ 1. |
| **α-approximation algorithm** | A polynomial-time algorithm whose output always satisfies the α guarantee, on *every* input. |
| **Lower bound on OPT** | A quantity you can compute that is provably ≤ OPT. The key tool: you compare ALG to this bound, not to the (unknown) OPT. |
| **Matching** | A set of edges with no shared endpoints — edges that don't touch. |
| **Maximal matching** | A matching you can't extend: every remaining edge touches one already chosen. (Not the same as *maximum* — biggest possible.) |
| **Vertex Cover** | A set of vertices touching every edge (each edge has ≥ 1 endpoint in the set). We want the *smallest* such set. |
| **Set Cover** | Given a universe of elements and a family of sets, pick the *fewest* sets whose union is everything. |
| **Metric TSP** | Travelling Salesman where distances satisfy the triangle inequality (`d(a,c) ≤ d(a,b) + d(b,c)`) — like real-world distances. Find the shortest tour visiting all cities. |
| **MST** | Minimum Spanning Tree — the cheapest set of edges connecting all vertices with no cycle. |
| **PTAS** | *Polynomial-Time Approximation Scheme*: a family of algorithms achieving ratio `(1 + ε)` for *any* ε > 0 you choose. "Arbitrarily close." |
| **Hardness of approximation** | A proof that *no* polynomial algorithm can beat some ratio (unless P = NP) — a hard floor on how good any approximation can be. |

---

## The Big Idea: When You Can't Win, Don't Lose by Much

Picture this. You're handed an NP-hard problem in production — say, "cover all these monitored network links by placing sensors on the fewest possible routers." You proved (or recognized) it's **Vertex Cover**, which is NP-hard. The exact optimum is off the table for large inputs. Three bad responses are tempting:

1. **Brute force anyway** — try every subset. Correct, but it grinds to a halt past ~30 routers. Ships never.
2. **Some heuristic that "seems fine"** — grab routers that look busy. Fast, but you have *no idea* how bad it can get. It might use ten times the optimal number on some input and you'd never know.
3. **Give up and over-provision wildly** — buy sensors for everything. Safe, wasteful, and not really an algorithm.

Approximation algorithms are the disciplined fourth option:

> **Compute a solution *fast*, and *prove in advance* that it's never worse than a known factor of the best possible — on every input, including the adversarial ones.**

The difference between option 2 (a heuristic) and an approximation algorithm is the **proof**. A heuristic *hopes*. An approximation algorithm *guarantees*: "I will never use more than twice the optimal number of sensors, ever, no matter what graph you throw at me." That guarantee is a contract you can put in a design doc and defend. It turns "this is probably okay" into "this is provably within 2×."

And here's the part that delights people the first time: the guarantee usually costs almost nothing. The Vertex Cover algorithm you'll see is *six lines*, runs in linear time, and the proof that it's within 2× of optimal is one paragraph. You don't pay for the guarantee with complexity; you pay for it with a clever *argument*.

The rest of this file is about that argument — how to make a promise about a number (OPT) you can't even compute.

---

## What an Approximation Ratio Actually Means

The ratio is the whole point, so let's pin it down with numbers before any algorithms.

There are two flavors, and the direction of the inequality flips between them:

**Minimization** (cost we want *small* — Vertex Cover, Set Cover, TSP). Here `ALG ≥ OPT` always (you can't beat the best), so the ratio is **α ≥ 1**:

> **`ALG ≤ α · OPT`** — "my cost is at most α times the optimal cost."

An α = 2 (a "2-approximation") promises: whatever the true minimum is, I use **at most twice** that. If OPT = 13 sensors, I use **≤ 26**. Maybe I use 13, maybe 18, maybe 26 — but *never 27*.

**Maximization** (value we want *large* — Max-Cut, maximum coverage). Here `ALG ≤ OPT` always, so the ratio is **α ≤ 1**:

> **`ALG ≥ α · OPT`** — "my value is at least α times the optimal value."

An α = 0.5 promises: I capture **at least half** the best achievable value. If OPT = 100, I get **≥ 50**.

> **Convention warning.** Some textbooks write the maximization ratio as ≥ 1 too (e.g. "a 2-approximation for a max problem means OPT/ALG ≤ 2," i.e. ALG ≥ OPT/2). Same promise, flipped fraction. We'll use **α ≥ 1 for minimization, α ≤ 1 for maximization** consistently in this file, and always spell out the inequality so there's no ambiguity. When you read other sources, *check which convention they use.*

Three things the ratio is — and isn't:

- **It's a worst-case promise.** "2-approximation" means *no input* makes it worse than 2×. On most inputs it'll do far better. The ratio is the *guarantee floor*, not the typical case.
- **Smaller-toward-1 is better.** A 1.5-approximation beats a 2-approximation. The dream is α = 1 (exact), which for an NP-hard problem in polynomial time would mean P = NP.
- **It's about the *value*, not the *solution*.** A 2-approximation for Vertex Cover finds a cover of size ≤ 2·OPT. It does *not* find a cover "50% similar" to the optimal one — the actual vertices chosen may be completely different. Only the *count* is bounded.

A tiny numeric drill. Suppose a minimization problem has OPT = 10.

| Algorithm returns | Ratio ALG/OPT | Is it a valid 2-approximation here? |
|-------------------|---------------|-------------------------------------|
| 10 | 1.0 | yes (it's optimal!) |
| 15 | 1.5 | yes (≤ 2·10 = 20) |
| 20 | 2.0 | yes (exactly at the bound) |
| 21 | 2.1 | **no** — exceeds 2·OPT on this input |

But remember: one input doesn't make or break the claim. To *be* a 2-approximation, the algorithm must satisfy `ALG ≤ 2·OPT` on **every** input simultaneously. That's a statement we prove with an argument, never by testing examples — and the next section is the engine of every such argument.

---

## The Trick of Bounding OPT From Below

Here is the conceptual hurdle, and the single idea that clears it. To prove `ALG ≤ α·OPT`, you'd seem to need to know OPT. But OPT is exactly the NP-hard quantity you can't compute! How do you compare your answer to a number you can't find?

> **The trick: never compare ALG to OPT directly. Compare ALG to a quantity `L` you *can* compute, where `L ≤ OPT` is provable. Then show `ALG ≤ α·L ≤ α·OPT`.**

`L` is a **lower bound on OPT** — something you can pin down that the optimum can't sneak below. The genius of the classic approximation algorithms is that each one comes packaged with a natural lower bound, sitting right there in the structure of the algorithm.

```
   You can't reach OPT directly:

        L                OPT              ALG
        |←─── ? ───→|     |←── ≤(α−1)L ──→|
        └───────────┴──────────┘
        computable    unknown    your output
        lower bound

   Strategy:  ALG ≤ α·L   and   L ≤ OPT
   Therefore: ALG ≤ α·L ≤ α·OPT.    Done — without ever knowing OPT.
```

Watch for this pattern in all three worked examples. It's the same move every time, only the choice of `L` changes:

- **Vertex Cover:** `L` = (size of a maximal matching). Every matched edge forces OPT to spend a vertex, so the matching's size ≤ OPT.
- **Set Cover:** `L` is woven in more subtly — we charge costs against elements and compare to OPT's coverage rate.
- **Metric TSP:** `L` = (weight of the MST). Any tour, including the optimal one, contains a spanning structure, so MST ≤ OPT.

If you internalize *just one thing* from this file, make it this: **approximation proofs are lower-bound proofs in disguise.** Find a cheap, computable quantity the optimum can't undercut, then show your algorithm stays within α of *it*. Let's do it three times.

---

## Worked Example 1: Vertex Cover, a 2-Approximation

**The problem.** Given a graph, find the **smallest** set of vertices such that *every edge* has at least one endpoint in the set. (Application: place the fewest guards/sensors so every corridor/link is watched.) This is NP-hard — you met it in the [reductions topic](../07-reductions-and-np-completeness/junior.md).

**The algorithm — astonishingly short:**

> Repeatedly pick *any* uncovered edge `(u, v)`. Add **both** `u` and `v` to your cover. Delete all edges now touched by `u` or `v`. Repeat until no edges remain.

The edges you pick form a **maximal matching** (no two share an endpoint, and you stop only when every remaining edge is already touched). The cover is "both endpoints of every matched edge."

Let's run it on a concrete graph.

```
   Graph G:                Edges: a-b, b-c, c-d, d-e, b-e, a-c

        a───────b
        │ \    /│
        │  \  / │
        │   \/  │
        c───────e
         \      
          \     
           d────(d connects to c and e)

   Step 1: pick edge (a, b).  Add {a, b} to cover.
           Delete every edge touching a or b: a-b, b-c, b-e, a-c gone.
           Remaining edges: c-d, d-e.
   Step 2: pick edge (c, d).  Add {c, d} to cover.
           Delete every edge touching c or d: c-d, d-e gone.
           Remaining edges: none.  STOP.

   Cover returned = {a, b, c, d}, size 4.
   Matching used  = {(a,b), (c,d)}, size 2.
```

Is `{a, b, c, d}` really a valid cover? Check every original edge touches one of them: a-b ✓(a), b-c ✓(b), c-d ✓(c), d-e ✓(d), b-e ✓(b), a-c ✓(a). Every edge covered. ✓ (In fact, the *optimal* cover here is `{b, c, d}` of size 3 — we'll come back to that.)

### Why it's a 2-approximation — the ratio proof

This is the lower-bound trick in its purest form. Two facts do all the work.

**Fact 1 — our cover has size exactly 2× the matching.** We added two vertices per matched edge, and the matched edges share no endpoints, so there's no double-counting: `ALG = 2 · (matching size)`.

**Fact 2 — OPT must spend at least one vertex per matched edge.** The matched edges are pairwise *disjoint* (a matching!). To cover the matched edge `(a,b)`, *any* valid cover — including the optimal one — must include `a` or `b`. To cover `(c,d)`, it must include `c` or `d`. These demands don't overlap, because the matched edges share no vertices. So OPT needs **at least one distinct vertex for each matched edge**:

> **`OPT ≥ (matching size)`.**

That's our lower bound `L = (matching size) ≤ OPT`. Now chain the two facts:

```
   ALG = 2 · (matching size)        (Fact 1)
       = 2 · L
       ≤ 2 · OPT                     (Fact 2:  L ≤ OPT)
```

> **`ALG ≤ 2 · OPT`.** A clean 2-approximation. ∎

Sanity check against our run: matching size = 2, so `L = 2 ≤ OPT`. We returned 4. The true OPT was 3. Indeed `4 ≤ 2·3 = 6` ✓, and even `4 ≤ 2·2 = 4` against the bound. The algorithm overshot (4 vs 3) but *provably never overshoots past double*, on any graph.

### The thing that trips everyone up

It is *deeply* counterintuitive that taking **both** endpoints — seemingly wasteful, you only ever *need* one per edge — gives a guarantee, while the "smarter-looking" greedy of *repeatedly taking the highest-degree vertex* does **not** have a constant ratio (it can be off by a factor of ~ln n). The clumsy-looking algorithm wins because "both endpoints of a matching" hands you the lower bound *for free*: every matched edge simultaneously costs you 2 and costs OPT ≥ 1. The clever-looking algorithm has no such tidy bound. **In approximation, the algorithm that comes with a provable lower bound beats the one that merely looks smart.**

---

## Worked Example 2: Set Cover, the Greedy Logarithm

**The problem.** You have a **universe** of `n` elements and a family of **sets**, each covering some of them. Pick the **fewest sets** whose union is the entire universe. (Application: choose the fewest skills-bundles to cover every required skill; choose the fewest ad placements to reach every demographic.) NP-hard.

**The algorithm — pure greed:**

> Repeatedly pick the set that covers the **most still-uncovered** elements. Mark those covered. Repeat until everything is covered.

Run it on a small instance.

```
   Universe U = {1,2,3,4,5,6,7,8,9,10,11,12}     (n = 12)

   Sets:
     S1 = {1,2,3,4,5,6}        (6 elements)
     S2 = {5,6,7,8,9,10}       (6 elements)
     S3 = {1,2,3,4,5,6,7}      (7 elements)   ← biggest
     S4 = {7,8,9,10,11,12}     (6 elements)
     S5 = {11,12}              (2 elements)

   Greedy:
     Round 1: most-uncovered = S3 (7 new).  Covered = {1..7}.  Pick S3.
     Round 2: uncovered = {8,9,10,11,12}.
              S2 covers {8,9,10}=3 new; S4 covers {8,9,10,11,12}=5 new.
              Pick S4 (5 new).  Covered = {1..12}.  Done.

   Greedy answer: {S3, S4}, size 2.
   Optimal here:  {S3, S4} too — size 2.  (Greedy nailed it on this instance.)
```

On nice instances greedy is often optimal. But its *guarantee* is weaker than Vertex Cover's — and famously so.

### The ratio: H(n) ≈ ln n, not a constant

Greedy Set Cover is an **`H(n)`-approximation**, where `H(n) = 1 + 1/2 + 1/3 + … + 1/n ≈ ln n` is the harmonic number. So:

> **`ALG ≤ H(n) · OPT ≈ (ln n) · OPT`.**

This is *not* a constant — it grows (slowly) with the universe size. For n = 12, `ln 12 ≈ 2.5`; for n = 1000, `ln 1000 ≈ 6.9`. So greedy might use up to ~7× the optimal number of sets on a 1000-element universe. Still polynomial, still bounded, but the guarantee *degrades* with scale.

### The ratio-proof intuition (no heavy algebra)

The argument is a lovely *charging* scheme. Suppose OPT uses `k` sets to cover all `n` elements. Then at *any* moment during greedy, the remaining uncovered elements can *also* be covered by those same `k` optimal sets — so **some** set covers at least a `1/k` fraction of whatever is currently uncovered (if `m` elements remain, one of OPT's `k` sets must contain ≥ `m/k` of them, by pigeonhole). Greedy picks the *most*-covering set, so greedy covers **at least** that `1/k` fraction every round.

```
   Uncovered count, round by round, shrinks by a factor ≥ (1 − 1/k):

     n  →  n(1−1/k)  →  n(1−1/k)²  →  …  →  below 1  →  done

   It takes about  k · ln n  rounds to drive n down to under 1.
   Each round = one set chosen, so ALG ≈ k · ln n = OPT · ln n.
```

Each round shrinks the uncovered set by at least a `(1 − 1/k)` factor, and it takes roughly `k·ln n` such shrinks to get from `n` down below 1. Each shrink is one set picked, so greedy picks ≈ `k·ln n = OPT·ln n` sets. That's the `H(n) ≈ ln n` ratio. The lower bound on OPT is hiding in "OPT covers everything with k sets, so some set always grabs a `1/k` share" — same flavor of trick, charged against coverage rate instead of matched edges.

### Why not a constant, like Vertex Cover?

Because Set Cover is *genuinely harder to approximate*. And this is the first hint of the deep result coming: it's not that we haven't found a constant-factor algorithm for Set Cover — it's that **no polynomial algorithm can beat `(1 − o(1))·ln n` unless P = NP.** Greedy is, up to lower-order terms, *the best possible*. Hold that thought for the [hardness teaser](#can-we-always-get-close-the-hardness-teaser).

---

## Worked Example 3: Metric TSP via the MST

**The problem.** **Travelling Salesman:** visit every city exactly once and return to the start, minimizing total distance. NP-hard in general. We use the **metric** version, where distances obey the **triangle inequality** — `d(a,c) ≤ d(a,b) + d(b,c)`, i.e. a detour is never shorter than going direct. Real-world road/air distances satisfy this. This restriction is what makes a clean 2-approximation possible.

**The algorithm:**

> 1. Build a **Minimum Spanning Tree** (MST) of the cities.
> 2. **Walk the tree** (a depth-first traversal), which crosses every edge twice — a "double-the-tree" tour visiting all cities but repeating some.
> 3. **Shortcut** any repeated city: whenever the walk would revisit a city, skip straight to the next *unvisited* one. The triangle inequality guarantees shortcutting never *lengthens* the tour.

```
   5 cities, MST drawn with edge weights:

           A
          /│
        2/ │3
        /  │
       B   C
            \
            4\   5
              D───E

   MST edges: A-B(2), A-C(3), C-D(4), D-E(5).   MST weight = 2+3+4+5 = 14.

   Double-the-tree DFS from A:
        A → B → A → C → D → E → D → C → A    (every edge twice; length = 28)

   Shortcut repeats (skip already-visited cities, jump to next new one):
        A → B → C → D → E → A
        (B→C replaces B→A→C; E→A replaces E→D→C→A — triangle inequality
         says each shortcut is no longer than the path it replaces.)

   Tour length ≤ 28 = 2 · MST.
```

### Why it's a 2-approximation

Same trick, third time. The lower bound this round is the **MST weight**.

**Fact 1 — the doubled walk costs exactly 2·MST,** and shortcutting only *shrinks* it (triangle inequality), so `ALG ≤ 2 · MST`.

**Fact 2 — `MST ≤ OPT`.** Take the optimal tour and delete any one of its edges: what's left is a path through all cities — a *spanning tree* (it connects everything, no cycle). Its weight is ≤ the full tour's weight (we only removed an edge). And the MST is, by definition, the *minimum*-weight spanning tree, so it's ≤ that path's weight ≤ OPT. Hence:

> **`MST ≤ OPT`.**

Chain them:

```
   ALG ≤ 2 · MST        (Fact 1: double-tree + shortcutting)
       ≤ 2 · OPT         (Fact 2: MST ≤ OPT)
```

> **`ALG ≤ 2 · OPT`.** A 2-approximation for metric TSP. ∎

### Christofides: doing better than 2

There's a celebrated refinement — **Christofides' algorithm (1976)** — that achieves a **1.5-approximation** for metric TSP. Instead of crudely doubling the tree, it adds a clever *minimum-weight matching* on the odd-degree vertices to make the structure traversable more cheaply. The 1.5 ratio stood as the best known for *45 years* until a 2021 breakthrough nudged it microscopically below. The mechanics of Christofides are a middle/senior topic, but the headline is worth carrying: **a smarter lower-bound structure (tree + matching instead of tree + tree) buys a better ratio.** Same philosophy as Vertex Cover — the *quality of your lower bound* is the quality of your guarantee.

---

## A Fourth Quick One: Greedy Load Balancing

One more, fast, because it shows the pattern outside graphs entirely.

**The problem.** You have `m` identical machines and a list of jobs with processing times. Assign every job to a machine to minimize the **makespan** — the finish time of the busiest machine. NP-hard.

**The algorithm (list scheduling):** go through the jobs in any order; assign each to the machine that is *currently least loaded*.

This is a **2-approximation** (actually `2 − 1/m`). The lower-bound trick again, with *two* lower bounds this time:

- `OPT ≥ (total work) / m` — the work can't be spread thinner than perfectly even.
- `OPT ≥ (largest single job)` — one job has to land somewhere, and it takes its full time.

Now look at the machine that finishes last in greedy's schedule, and at the *last job* placed on it. Just before that job was placed, this machine was the *least loaded*, so its load then was ≤ the average load ≤ `OPT`. Adding the last job (≤ largest job ≤ `OPT`) gives a finish time ≤ `OPT + OPT = 2·OPT`. So `ALG ≤ 2·OPT`. The same skeleton — find computable lower bounds OPT can't beat, show your output stays within α of them — works for scheduling exactly as it did for graphs. (More in [Greedy Algorithms](../../14-greedy-algorithms/).)

---

## Can We Always Get Close? The Hardness Teaser

You've now seen three "within-2×" guarantees and one logarithmic one. Natural question: can we *always* tighten the ratio toward 1 if we work harder? Is there a 1.1-approximation for Vertex Cover hiding out there? A 1.01-approximation? Maybe an algorithm that gets within *any* tolerance ε you name?

The astonishing answer is: **it depends on the problem, and for some problems the answer is a flat, provable NO.** Approximability splits NP-hard problems into sharply different worlds:

**World 1 — arbitrarily close (PTAS).** Some NP-hard problems admit a **Polynomial-Time Approximation Scheme**: name *any* `ε > 0`, and there's a polynomial-time algorithm guaranteeing `(1 + ε)·OPT`. Want within 1%? Set ε = 0.01. Within 0.1%? ε = 0.001 (it runs slower, but still polynomial). The **Knapsack** problem is the poster child — you can get as close to optimal as you're willing to pay for in runtime. For these problems, "just get a bit closer" is always available.

**World 2 — a hard floor (hardness of approximation).** Other NP-hard problems have a **specific ratio you cannot beat unless P = NP** — a theorem, not a gap in our cleverness. Examples (stated, not proved, here):

- **Set Cover** cannot be approximated better than `(1 − o(1))·ln n` unless P = NP. Greedy's `≈ ln n` is essentially *optimal*. There is no constant-factor algorithm, ever, barring P = NP.
- **Metric TSP** cannot be approximated better than some constant strictly above 1 (a small fixed number) unless P = NP — so no PTAS exists for it. Christofides' 1.5 lives in a bounded band; you can't drive the ratio to 1.
- **Max-3SAT** can't be beaten past a `7/8` ratio for the maximization (a famous tight result).

```
   The approximability spectrum of NP-hard problems:

   EASIEST to approximate ──────────────────────────► HARDEST

   PTAS                Constant-factor        Logarithmic        No good
   (1+ε), any ε        only (hard floor       only (hard         approx at all
   e.g. Knapsack       above 1)               floor ~ln n)       (hard floor
                       e.g. metric TSP,       e.g. Set Cover      grows with n)
                       Vertex Cover

   "Get arbitrarily   "Get within a fixed    "Can't beat        "Even a rough
    close"             factor, no closer"      ~ln n"             ratio is hard"
```

How is such a *negative* result even possible — how do you prove that *no algorithm whatsoever* can do better? The tool is a souped-up reduction. Recall from the [reductions topic](../07-reductions-and-np-completeness/junior.md) that an ordinary reduction transfers *hardness of solving*. A **gap-preserving** reduction transfers *hardness of approximating*: it maps a yes/no problem into an optimization problem so that "yes" instances become solutions with a *small* OPT and "no" instances become solutions with a *much larger* OPT, with a **gap** in between. If you had an approximation algorithm good enough to land inside that gap, you could read off the yes/no answer to an NP-hard problem — impossible unless P = NP. The deep engine that makes these gaps appear is the **PCP theorem** (and, for the sharpest results, the **Unique Games Conjecture**). That full story is a **senior** topic — see [the middle file](./middle.md) and beyond. For now, carry the headline:

> **Some NP-hard problems can be approximated arbitrarily well; others have a wall at a specific ratio that no polynomial algorithm can climb, ever, unless P = NP. "Just get a little closer" is sometimes mathematically forbidden.**

This is why the ratio you proved matters so much. When you show greedy Set Cover hits `ln n`, you're not just describing one algorithm — you're (nearly) touching the *theoretical ceiling* for the entire problem. That's a remarkable thing for six lines of code to do.

---

## Code: Measuring the Achieved Ratio

A guarantee you can *watch* is a guarantee you believe. Below, we implement the **greedy Vertex Cover** (maximal-matching version) and **greedy Set Cover**, then on *small* instances we compute the true optimum by **brute force** and print the **achieved ratio** `ALG / OPT`. You'll see it stay comfortably under the proven bound — 2 for Vertex Cover, `H(n)` for Set Cover.

### Go

```go
package main

import (
	"fmt"
	"math"
	"math/bits"
)

// ---------- Vertex Cover ----------

// greedyVertexCover: the maximal-matching 2-approximation.
// Pick any uncovered edge, take BOTH endpoints, repeat.
func greedyVertexCover(n int, edges [][2]int) map[int]bool {
	cover := map[int]bool{}
	used := make([]bool, len(edges))
	for i, e := range edges {
		if used[i] {
			continue
		}
		u, v := e[0], e[1]
		if cover[u] || cover[v] {
			continue // edge already covered by an earlier pick
		}
		cover[u], cover[v] = true, true // take BOTH endpoints
		// mark every edge now touched as handled
		for j, f := range edges {
			if f[0] == u || f[1] == u || f[0] == v || f[1] == v {
				used[j] = true
			}
		}
	}
	return cover
}

// bruteForceVertexCover: try every vertex subset, return the smallest valid cover size.
func bruteForceVertexCover(n int, edges [][2]int) int {
	best := n
	for mask := 0; mask < (1 << n); mask++ {
		ok := true
		for _, e := range edges {
			inU := mask&(1<<e[0]) != 0
			inV := mask&(1<<e[1]) != 0
			if !inU && !inV {
				ok = false
				break
			}
		}
		if ok {
			if c := bits.OnesCount(uint(mask)); c < best {
				best = c
			}
		}
	}
	return best
}

// ---------- Set Cover ----------

// greedySetCover: repeatedly take the set covering the most still-uncovered elements.
func greedySetCover(universe int, sets []uint) int {
	covered := uint(0)
	full := uint((1 << universe) - 1)
	picks := 0
	for covered != full {
		bestIdx, bestNew := -1, -1
		for i, s := range sets {
			newCov := bits.OnesCount(s &^ covered) // elements in s not yet covered
			if newCov > bestNew {
				bestNew, bestIdx = newCov, i
			}
		}
		if bestNew <= 0 {
			break // sets can't cover the universe
		}
		covered |= sets[bestIdx]
		picks++
	}
	return picks
}

// bruteForceSetCover: smallest number of sets whose union is the universe.
func bruteForceSetCover(universe int, sets []uint) int {
	full := uint((1 << universe) - 1)
	best := len(sets) + 1
	for mask := 0; mask < (1 << len(sets)); mask++ {
		u := uint(0)
		for i := range sets {
			if mask&(1<<i) != 0 {
				u |= sets[i]
			}
		}
		if u == full {
			if c := bits.OnesCount(uint(mask)); c < best {
				best = c
			}
		}
	}
	return best
}

func main() {
	// --- Vertex Cover instance (the one from the worked example) ---
	n := 5 // vertices 0..4  (a=0,b=1,c=2,d=3,e=4)
	edges := [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 4}, {1, 4}, {0, 2}}

	alg := len(greedyVertexCover(n, edges))
	opt := bruteForceVertexCover(n, edges)
	fmt.Printf("Vertex Cover:  ALG=%d  OPT=%d  ratio=%.2f  (bound: 2.00)\n",
		alg, opt, float64(alg)/float64(opt))

	// --- Set Cover instance ---
	universe := 12 // elements 0..11
	// sets encoded as bitmasks; bit i set means element i is in the set
	mk := func(elems ...int) uint {
		var m uint
		for _, e := range elems {
			m |= 1 << e
		}
		return m
	}
	sets := []uint{
		mk(0, 1, 2, 3, 4, 5),       // S1
		mk(4, 5, 6, 7, 8, 9),       // S2
		mk(0, 1, 2, 3, 4, 5, 6),    // S3
		mk(6, 7, 8, 9, 10, 11),     // S4
		mk(10, 11),                 // S5
	}
	algS := greedySetCover(universe, sets)
	optS := bruteForceSetCover(universe, sets)
	hn := 0.0
	for i := 1; i <= universe; i++ {
		hn += 1.0 / float64(i)
	}
	fmt.Printf("Set Cover:     ALG=%d  OPT=%d  ratio=%.2f  (bound H(%d)=%.2f, ~ln=%.2f)\n",
		algS, optS, float64(algS)/float64(optS), universe, hn, math.Log(float64(universe)))
}
```

Expected output:

```
Vertex Cover:  ALG=4  OPT=3  ratio=1.33  (bound: 2.00)
Set Cover:     ALG=2  OPT=2  ratio=1.00  (bound H(12)=3.10, ~ln=2.48)
```

The ratios sit *under* their proven bounds (1.33 < 2; 1.00 < 3.10), exactly as promised.

### Python

```python
from math import log
from itertools import combinations


# ---------- Vertex Cover ----------

def greedy_vertex_cover(n, edges):
    """Maximal-matching 2-approximation: take BOTH endpoints of uncovered edges."""
    cover = set()
    for (u, v) in edges:
        if u in cover or v in cover:
            continue          # edge already covered
        cover.add(u)
        cover.add(v)          # take both endpoints
    return cover


def brute_force_vertex_cover(n, edges):
    """Smallest vertex set covering every edge (exhaustive)."""
    for k in range(n + 1):                       # try covers of size 0,1,2,...
        for combo in combinations(range(n), k):
            s = set(combo)
            if all(u in s or v in s for (u, v) in edges):
                return k                          # first k that works is optimal
    return n


# ---------- Set Cover ----------

def greedy_set_cover(universe, sets):
    """Repeatedly take the set covering the most still-uncovered elements."""
    uncovered = set(universe)
    picks = 0
    while uncovered:
        best = max(sets, key=lambda s: len(s & uncovered))
        if not (best & uncovered):
            break                                # cannot finish covering
        uncovered -= best
        picks += 1
    return picks


def brute_force_set_cover(universe, sets):
    """Fewest sets whose union is the whole universe (exhaustive)."""
    U = set(universe)
    for k in range(1, len(sets) + 1):
        for combo in combinations(sets, k):
            covered = set().union(*combo)
            if covered >= U:
                return k
    return len(sets)


if __name__ == "__main__":
    # Vertex Cover instance from the worked example (a=0,b=1,c=2,d=3,e=4)
    n = 5
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (1, 4), (0, 2)]
    alg = len(greedy_vertex_cover(n, edges))
    opt = brute_force_vertex_cover(n, edges)
    print(f"Vertex Cover:  ALG={alg}  OPT={opt}  "
          f"ratio={alg/opt:.2f}  (bound: 2.00)")

    # Set Cover instance
    universe = list(range(12))
    sets = [
        {0, 1, 2, 3, 4, 5},        # S1
        {4, 5, 6, 7, 8, 9},        # S2
        {0, 1, 2, 3, 4, 5, 6},     # S3
        {6, 7, 8, 9, 10, 11},      # S4
        {10, 11},                  # S5
    ]
    algS = greedy_set_cover(universe, sets)
    optS = brute_force_set_cover(universe, sets)
    hn = sum(1 / i for i in range(1, len(universe) + 1))
    print(f"Set Cover:     ALG={algS}  OPT={optS}  "
          f"ratio={algS/optS:.2f}  (bound H({len(universe)})={hn:.2f}, "
          f"~ln={log(len(universe)):.2f})")
```

**What the code demonstrates.** The brute-force routines (exponential — fine only because the instances are tiny) compute the *true* OPT, so we can divide and *see* the achieved ratio. On every small instance you try, the printed ratio stays under the theoretical bound — and crucially, the *guarantee* is that it would stay under the bound on **any** instance, even the ones too big to brute-force. Try editing the graphs to hunt for a Vertex Cover input that pushes the ratio toward 2 (cycles and complete bipartite graphs are good hunting grounds); you'll find you can *approach* 2 but never exceed it. **Run:** `go run main.go` | `python approx.py`

---

## Real-World Analogies

**The "good enough by closing time" rule.** A caterer can't compute the *perfect* table arrangement for 300 guests before the wedding — that's an NP-hard seating problem. But they can guarantee "no table will be more than one seat over its ideal load." That's an approximation guarantee: not optimal, but *provably bounded*, and it ships on time. Optimal-but-never beats good-enough-by-deadline every time.

**Measuring against a yardstick you can reach.** You can't directly measure the height of a distant mountain (OPT). But you *can* measure the length of its shadow and the angle of the sun (a computable lower bound `L`), and *bound* the height from that. Approximation proofs do exactly this: they never touch OPT, they touch a shadow of it (a matching, a tree) that they *can* measure.

**Doubling the tree = walking every hallway twice.** A museum guard who walks down every hallway and back covers everything, just at twice the hallway-length. Smart shortcutting (skipping rooms already seen) trims that — but never below the museum's actual layout cost. That's metric TSP's 2-approximation in one image.

**The speed limit you can't legislate away.** Hardness of approximation is like the speed of light. It's not that engineers haven't tried hard enough to send signals faster — it's a *law*. "No polynomial algorithm beats `ln n` for Set Cover unless P = NP" is that kind of law: a ceiling that effort cannot raise, only a revolution (P = NP) could.

**The harmonic toll.** Greedy Set Cover's `ln n` ratio is like a toll that grows with the size of the territory you're covering — slowly (logarithmically), but unboundedly. On a small map it's nearly free; on a continent it's a few-fold tax. And you *cannot* negotiate it down, because it's the legal minimum.

---

## Why This Matters in Practice

You're an engineer. Here's the payoff of knowing approximation exists.

**1. It's the answer to "the problem is NP-hard — now what?"** The previous topic taught you to *recognize* the wall; this one is how you *get over* it without pretending it isn't there. When exact-and-fast is impossible, you reach for approximation, and now you know it can come with a *guarantee* rather than a shrug.

**2. A guarantee is a number you can put in a design doc.** "Our placement uses at most 2× the minimum number of sensors" is defensible engineering. "Our heuristic seems to work on the test cases" is not. The proof turns a hope into a spec, and specs survive code review, audits, and the angry incident postmortem when an adversarial input shows up.

**3. Knowing the *hardness floor* stops doomed optimization.** If you learn Set Cover can't be beaten past `ln n`, you stop assigning engineers to "make the cover 10% tighter in the worst case" — it's *provably impossible* in polynomial time. That redirects effort to what *can* move: exploiting the special structure of *your* instances, caching, or accepting the bound. Knowing the floor is as valuable as knowing the algorithm.

**4. It calibrates ambition.** Some problems (Knapsack-like) you *can* tune arbitrarily close to optimal — so promising "within 1%" is honest. Others have a hard floor — so promising "near-optimal in the worst case" is a lie you'll regret. Knowing which world your problem lives in keeps your promises truthful.

**5. The lower-bound habit transfers.** "Find a computable quantity OPT can't undercut, then bound your output against it" is a *general* design and analysis skill. It shows up in competitive analysis of online algorithms, in proving your heuristic isn't terrible, and in arguing about *any* optimizer's quality. Learn it on Vertex Cover; use it everywhere.

---

## Common Misconceptions

**❌ "A 2-approximation gives a solution 50% similar to the optimal one."**
No — it bounds the *value* (cost/size), not the *structure*. A 2-approximation for Vertex Cover returns a cover of size ≤ 2·OPT; the actual vertices may overlap the optimal set not at all. Only the *number* is guaranteed.

**❌ "The approximation ratio is how it does on average / on typical inputs."**
It's a **worst-case** guarantee — the *worst* it can ever do, over *all* inputs. On typical inputs it's usually far better. "2-approximation" is a ceiling on badness, not a description of the common case.

**❌ "If we just try harder, we can always push the ratio down to 1."**
False for many problems. **Hardness of approximation** proves some problems have a *floor* below which no polynomial algorithm can go (unless P = NP). For Set Cover that floor is ~`ln n`; you cannot beat it by being clever.

**❌ "An approximation algorithm sometimes returns an invalid/incomplete solution."**
No. It always returns a *valid* solution (a real cover, a real tour) — just not necessarily the cheapest one. The "approximation" is in the *optimality*, never in the *validity*.

**❌ "Greedy always gives a good approximation ratio."**
Sometimes (Set Cover's greedy is essentially optimal); sometimes greedy is *terrible* (greedy by highest-degree for Vertex Cover has no constant ratio). Each greedy's ratio must be *proved*, not assumed. Greedy is a strategy, not a guarantee.

**❌ "Taking both endpoints in Vertex Cover is wasteful and obviously suboptimal, so it can't be a good algorithm."**
The "waste" is exactly what *buys* the provable 2-bound: every matched edge costs you 2 and costs OPT ≥ 1. The tidy lower bound is worth the apparent waste. Clever-looking ≠ provably-good.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| Flipping the inequality between min and max | Min wants `ALG ≤ α·OPT` (α≥1); max wants `ALG ≥ α·OPT` (α≤1) | State the problem type first, then write the matching inequality |
| Trying to compare ALG directly to OPT | OPT is the NP-hard quantity you can't compute | Bound OPT with a computable `L ≤ OPT`, then `ALG ≤ α·L ≤ α·OPT` |
| "Proving" a ratio by testing examples | Examples can't establish a *worst-case* guarantee | Prove the inequality holds for *all* inputs via a lower-bound argument |
| Confusing *maximal* matching with *maximum* matching | Maximal = can't extend; maximum = biggest. VC uses *maximal* | Any maximal matching suffices for the 2-bound; you don't need the biggest |
| Assuming a constant ratio exists for every problem | Set Cover has no constant ratio (it's `~ln n`); some have worse | Check the problem's known approximability *class* before promising one |
| Calling a heuristic an "approximation algorithm" | Approximation requires a *proven* worst-case ratio | If there's no proof of a ratio, it's a heuristic — say so |
| Dropping the triangle inequality for the TSP 2-approx | Shortcutting only works because detours aren't shorter | The MST 2-approx needs *metric* TSP; general TSP has *no* constant ratio |

---

## Cheat Sheet

```
APPROXIMATION RATIO α:
  Minimization (cost small):  ALG ≤ α·OPT,  α ≥ 1.   "2-approx" → at most 2×OPT.
  Maximization (value large): ALG ≥ α·OPT,  α ≤ 1.   "0.5-approx" → at least ½ OPT.
  α-approximation = polynomial time AND the guarantee holds on EVERY input.
  Closer to 1 = better; α = 1 in poly time for NP-hard ⇒ P = NP.

THE MASTER TRICK (every proof):
  Don't compare ALG to OPT (unknown). Find computable L with L ≤ OPT.
  Show ALG ≤ α·L.   Then ALG ≤ α·L ≤ α·OPT.   Done.

THREE FLAGSHIP ALGORITHMS:
  VERTEX COVER  — 2-approx.  Take BOTH endpoints of a maximal matching.
     L = matching size ≤ OPT (each disjoint matched edge needs ≥1 vertex).
     ALG = 2·(matching) ≤ 2·OPT.
  SET COVER     — H(n)≈ln n approx.  Greedily take the set covering the most new.
     Each round shrinks uncovered by ≥(1−1/k); ~k·ln n rounds. NEAR-OPTIMAL ratio.
  METRIC TSP    — 2-approx.  Double the MST, DFS-walk, shortcut repeats.
     L = MST ≤ OPT (drop a tour edge → spanning tree). ALG ≤ 2·MST ≤ 2·OPT.
     Christofides (tree + matching) → 1.5-approx.
  LOAD BALANCING — 2-approx.  Put each job on the least-loaded machine.
     L₁ = total/m,  L₂ = max job; both ≤ OPT. ALG ≤ L₁ + L₂ ≤ 2·OPT.

CAN WE ALWAYS GET CLOSE?  No — approximability has classes:
  PTAS         (1+ε) for ANY ε   e.g. Knapsack       "arbitrarily close"
  Constant     fixed α only       e.g. metric TSP, VC "a fixed factor, no closer"
  Logarithmic  ~ln n floor        e.g. Set Cover      "can't beat ln n"
  Hardness of approximation = a PROVEN floor (unless P=NP). Tool: gap-preserving
  reductions + the PCP theorem (senior topic).
```

---

## Summary

- When a problem is **NP-hard**, the exact optimum is out of reach for large inputs — so we compute a **provably-good approximation** instead: a polynomial-time algorithm returning a solution within a guaranteed factor **α** of OPT, on *every* input.
- The **approximation ratio** is a worst-case promise. **Minimization:** `ALG ≤ α·OPT` (α ≥ 1). **Maximization:** `ALG ≥ α·OPT` (α ≤ 1). It bounds the *value*, not the structure, and describes the *worst* case, not the typical one.
- The **master proof trick:** never compare ALG to the unknown OPT. Find a **computable lower bound `L ≤ OPT`**, then show `ALG ≤ α·L ≤ α·OPT`. Approximation proofs are lower-bound proofs in disguise.
- **Vertex Cover (2-approx):** take both endpoints of a **maximal matching**; the matching's size lower-bounds OPT, and ALG = 2·(matching) ≤ 2·OPT.
- **Set Cover (`H(n)≈ln n`):** greedily take the set covering the most uncovered elements; each round shrinks the uncovered set by ≥ `1/k`, giving ≈ `OPT·ln n`. This ratio is essentially **optimal** — no polynomial algorithm beats it unless P = NP.
- **Metric TSP (2-approx):** double the **MST**, walk it, shortcut repeats (triangle inequality); MST ≤ OPT gives ALG ≤ 2·OPT. **Christofides** refines this to **1.5** with a tree-plus-matching structure.
- The **code** measures the achieved ratio `ALG/OPT` against a brute-force optimum on small instances — and it always lands under the proven bound, just as the guarantee requires.
- **Can we always get close? No.** Some NP-hard problems admit a **PTAS** (arbitrarily close), but others have a **hard floor** — a ratio no polynomial algorithm can beat unless P = NP. This is **hardness of approximation**, proved via gap-preserving reductions and the PCP theorem (a senior topic). "Just get a little closer" is sometimes mathematically forbidden.

---

## Further Reading

- [Reductions and NP-Completeness — Junior](../07-reductions-and-np-completeness/junior.md) — the prerequisite: how to *recognize* that your problem is NP-hard in the first place, which is what motivates everything here.
- [Complexity Classes: P and NP — Junior](../06-complexity-classes-p-np/junior.md) — P, NP, and why "P = NP" is the question lurking behind every hardness-of-approximation result.
- [Approximation and Hardness — Middle Level](./middle.md) — the next step: the formal definitions, LP-rounding and primal-dual techniques, PTAS/FPTAS construction, and a first real look at gap-preserving reductions and the PCP theorem.
- [Greedy Algorithms](../../14-greedy-algorithms/) — the design paradigm behind greedy Set Cover and greedy load balancing, and how to prove greedy choices are safe.
- *Introduction to Algorithms* (CLRS), Chapter 35 — the standard textbook treatment of approximation algorithms, including Vertex Cover, Set Cover, and metric TSP with full proofs.
- *The Design of Approximation Algorithms* by Williamson & Shmoys — the modern reference: greedy, LP-rounding, primal-dual, and hardness, freely available online.
- *Approximation Algorithms* by Vijay Vazirani — a classic, rigorous tour from the 2-approximations here all the way to the PCP-based hardness results.
