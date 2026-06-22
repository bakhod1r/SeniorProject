# Reductions and NP-Completeness — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Applied: Proving Problems NP-Complete](#applied-proving-problems-np-complete)
3. [Gotcha / Trick Questions](#gotcha--trick-questions)
4. [Rapid-Fire Q&A](#rapid-fire-qa)
5. [Common Mistakes](#common-mistakes)
6. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: What is a polynomial-time many-one reduction? *(Medium)*

**Answer**: A **poly-time many-one (Karp) reduction** `A ≤ₚ B` is a polynomial-time computable function `f` that maps instances of problem `A` to instances of `B` such that:

```
x is a yes-instance of A   ⟺   f(x) is a yes-instance of B
```

The "⟺" (iff) is essential — `f` must preserve the answer in **both** directions, and a *single* call to `B` decides `A`. It reads "`A` is no harder than `B`": any poly-time solver for `B` gives a poly-time solver for `A` (compute `f(x)`, then run `B`). See [./middle.md](./middle.md) for the contrast with Turing/Cook reductions.

### Q2: Which DIRECTION proves hardness? *(Medium — the #1 mistake)*

**Answer**: To prove a **new** problem `B` is NP-hard, you reduce a **known** NP-hard problem `A` **to** `B`, i.e. `A ≤ₚ B`. You are showing "`B` is at least as hard as the already-hard `A`."

Mnemonic: **reduce *FROM* known-hard *TO* your target.** The source of the reduction is the thing you already trust to be hard; the target is the thing you are accusing.

Reducing the *other* way (`B ≤ₚ A`) proves `B` is *easy if `A` is* — the opposite of what you want. Getting this backwards is the single most common reduction error in interviews. See [Q12](#q12-you-reduced-b-to-a-known-np-complete-problem-a-does-that-prove-b-is-hard-medium).

### Q3: Define NP-complete. What is the two-step proof recipe? *(Medium)*

**Answer**: A problem `B` is **NP-complete** if it satisfies two conditions:

1. **`B ∈ NP`** — a yes-instance has a short certificate checkable in poly time.
2. **`B` is NP-hard** — every problem in NP reduces to `B` in poly time.

NP-complete problems are the "hardest problems *in* NP." The **standard proof recipe** to show `B` is NP-complete:

1. **Show `B ∈ NP`**: describe the certificate and a poly-time verifier.
2. **Show `B` is NP-hard**: pick a known NP-complete problem `A` and give a poly-time reduction `A ≤ₚ B`, proving (a) `f` runs in poly time, and (b) `x ∈ A ⟺ f(x) ∈ B`.

Step 2 only needs **one** known-hard source — you do *not* reduce all of NP by hand; transitivity does that for you (if `A` is NP-hard and `A ≤ₚ B`, then `B` is NP-hard).

### Q4: What does the Cook–Levin theorem say, and why does it matter? *(Hard)*

**Answer**: **Cook–Levin (1971)** states that **Boolean satisfiability (SAT) is NP-complete** — it was the *first* problem proven so. The proof shows that for *any* problem in NP, the computation of its poly-time verifier on a guessed certificate can be encoded as a Boolean formula that is satisfiable iff the verifier accepts. So every NP problem reduces to SAT.

Why it matters: it **bootstraps the entire theory.** Before Cook–Levin you would have to reduce all of NP to a new problem from scratch. After it, you only need to reduce *one* known NP-complete problem (SAT, or any of its descendants) to your target — transitivity of `≤ₚ` chains it back to all of NP. SAT is the "root" of the reduction tree.

### Q5: NP-hard vs NP-complete — what's the difference? *(Medium)*

**Answer**:
- **NP-hard**: at least as hard as every problem in NP (everything in NP reduces to it). NP-hard problems need **not** be in NP — they need not even be decision problems or decidable (the halting problem is NP-hard).
- **NP-complete** = **NP-hard AND in NP**. The NP-hardness gives the lower bound; membership in NP caps it as "no harder than the rest of NP."

So **NP-complete ⊆ NP-hard**, and NP-complete = NP-hard ∩ NP. Every NP-complete problem is NP-hard; the converse fails. See [../06-complexity-classes-p-np/interview.md](../06-complexity-classes-p-np/interview.md) for the full Venn picture.

### Q6: Name the canonical "reduction zoo." *(Medium)*

**Answer**: The classic NP-complete problems and the usual reduction chain from SAT:

```
                  SAT  (Cook–Levin)
                   │
                  3-SAT
            ┌──────┼──────────────┐
       Independent Set        3-Coloring
        │        │
   Vertex Cover  Clique
                  
   3-SAT ──→ Subset-Sum ──→ Knapsack (decision)
   3-SAT ──→ Hamiltonian Cycle ──→ TSP (decision)
```

Worth memorizing: **3-SAT, Independent Set, Vertex Cover, Clique, Subset-Sum, Hamiltonian Cycle/Path, 3-Coloring, TSP-decision.** Knowing *which* source each is conventionally reduced from is what lets you tackle a fresh problem fast.

---

## Applied: Proving Problems NP-Complete

### Q7: Prove Independent Set is NP-complete (given 3-SAT is). *(Hard)*

**Answer**: **Independent Set (IS)**: given graph `G` and integer `k`, is there a set of `k` vertices with no edge between any two?

**(1) IS ∈ NP**: certificate = the `k` vertices; verifier checks no edge joins any pair — `O(k²)`, polynomial.

**(2) NP-hard via 3-SAT ≤ₚ IS**: from a 3-SAT formula with `m` clauses, build a *triangle gadget* per clause — one vertex per literal, three vertices joined in a triangle (so at most one literal per clause can be chosen). Then add an edge between every pair of **complementary** literals (`x` and `¬x`) across gadgets (so you can't pick a variable true and false). Set `k = m`.

- A satisfying assignment picks one true literal per clause → `m` vertices, no two adjacent → IS of size `m`.
- An IS of size `m` must take exactly one vertex from each triangle, and the complementary-literal edges guarantee a consistent assignment satisfying every clause.

The construction is polynomial, and the iff holds → IS is NP-complete.

### Q8: Now prove Vertex Cover is NP-complete via Independent Set. *(Medium)*

**Answer**: **Vertex Cover (VC)**: given `G` and `k`, is there a set of `≤ k` vertices touching every edge?

**(1) VC ∈ NP**: certificate = the cover; verify every edge has an endpoint in it — `O(E)`.

**(2) NP-hard via IS ≤ₚ VC**: use the **complementation identity** — `S` is an independent set of `G` **iff** `V ∖ S` is a vertex cover of `G`. So `G` has an independent set of size `k` iff it has a vertex cover of size `n − k`.

The reduction `f` is trivial: keep the *same graph*, map the threshold `k → n − k`. It runs in `O(1)` (no graph change) and the iff is exactly the identity. Therefore IS ≤ₚ VC and VC is NP-complete. (This is the cleanest "free" reduction in the zoo — no gadget at all.)

### Q9: Prove Clique is NP-complete via Independent Set. *(Medium)*

**Answer**: **Clique**: given `G` and `k`, is there a set of `k` mutually adjacent vertices?

**(1) Clique ∈ NP**: certificate = the `k` vertices; verify all `C(k,2)` pairs are edges.

**(2) NP-hard via IS ≤ₚ Clique**: use the **complement graph** `Ḡ` (same vertices; an edge in `Ḡ` exactly where there is none in `G`). A set is independent in `G` **iff** it is a clique in `Ḡ`. So `f(⟨G, k⟩) = ⟨Ḡ, k⟩` — build `Ḡ` (poly time) and keep `k`. `G` has an independent set of size `k` iff `Ḡ` has a clique of size `k`. Hence Clique is NP-complete.

### Q10: Given a *fresh* problem, how do you pick the right source to reduce from? *(Hard)*

**Answer**: Match the **structure** of your problem to the closest zoo member:

- **Choose-a-subset-with-no-conflicts** → Independent Set / Vertex Cover.
- **Choose-a-fully-connected-group** → Clique.
- **Pick numbers hitting an exact total / partition** → Subset-Sum / Partition.
- **Find a tour / path visiting everything** → Hamiltonian Cycle/Path or TSP.
- **Assign one of k labels with adjacency constraints** → 3-Coloring (or k-Coloring).
- **Boolean/logical satisfy-all-constraints** → 3-SAT (the most flexible source; gadgets per clause/variable).

Then design a **gadget**: a small graph/number widget per element of the source instance, wired so a yes-instance of the source maps to a yes-instance of your target and vice versa. When in doubt, **3-SAT** is the workhorse — its clause/variable structure encodes almost anything.

### Q11: Explain "gadget" at a high level. *(Medium)*

**Answer**: A **gadget** is a small, reusable sub-construction that encodes one piece of the source problem inside the target problem's language. In 3-SAT ≤ₚ IS, each *clause* becomes a triangle gadget (enforcing "pick at most one literal here") and each *variable* contributes complementary-literal edges (enforcing "stay consistent"). The full reduction is just many gadgets glued together so that the global yes/no answer is preserved. Good gadgets are **local** (one per source element), **poly-sized**, and enforce exactly the constraint they target — no more, no less.

---

## Gotcha / Trick Questions

### Q12: "You reduced B to a known NP-complete problem A. Does that prove B is hard?" *(Medium)*

**Answer**: **No — wrong direction.** You showed `B ≤ₚ A`, i.e. "`B` is no *harder* than `A`." Since `A` is in NP, this mostly just confirms `B` is solvable given an `A`-solver — it bounds `B` from *above*, not below. It does **not** make `B` NP-hard.

To prove `B` hard you need `A ≤ₚ B` (known-hard `A` *into* your `B`). Reducing your problem *to* SAT is what you do to *solve* it with a SAT solver — the opposite engineering goal from proving it hard.

### Q13: Is every NP-hard problem in NP? *(Medium)*

**Answer**: **No.** NP-hardness is only a *lower bound* ("at least as hard as NP"); it says nothing about membership in NP. The **halting problem** is NP-hard (everything in NP trivially reduces to it) but **undecidable**, so it is not in NP. Likewise, optimization and counting problems (e.g., `#SAT`, computing the *optimal* TSP tour length as a function) can be NP-hard without being NP decision problems. NP-hard ⊋ NP-complete precisely because of these out-of-NP problems.

### Q14: What's the difference between weak and strong NP-hardness — and why does Knapsack have a pseudo-poly DP? *(Hard)*

**Answer**: A reduction can make the *numbers* in the target instance exponentially large in the input length. A problem is **strongly NP-hard** if it stays NP-hard even when all numbers are bounded by a polynomial in the input size (i.e., hardness survives unary encoding). It is **weakly NP-hard** if its hardness *relies* on exponentially large numbers.

**Knapsack / Subset-Sum are only weakly NP-hard.** Their `O(n·W)` DP is **pseudo-polynomial**: polynomial in the *value* `W` of the capacity, but exponential in the number of *bits* needed to write `W` (`log W`). When `W` is small (polynomial in `n`), the DP is genuinely fast. The NP-hardness of Subset-Sum requires targets with `Θ(n)`-bit magnitudes, which is why the DP doesn't contradict it.

By contrast, **TSP, Hamiltonian Cycle, 3-Coloring, Clique are strongly NP-hard** — no pseudo-poly DP exists (unless `P = NP`), because their hardness is structural, not numeric. Practical upshot: a pseudo-poly DP is *only* a hope for weakly NP-hard, number-based problems.

### Q15: "Since SAT is NP-complete, isn't proving a new problem NP-complete hopeless?" *(Easy)*

**Answer**: No — it's the *easier* direction now. Cook–Levin did the hard work once. You never re-reduce all of NP; you reduce *one* convenient known-NP-complete problem to yours and let transitivity (`A` NP-hard, `A ≤ₚ B` ⟹ `B` NP-hard) chain it back to SAT and thus to all of NP. The whole zoo exists so you can pick a structurally-close source and write one gadget.

### Q16: A poly-time algorithm for *one* NP-complete problem — what follows? *(Medium)*

**Answer**: **`P = NP`.** Every NP problem reduces in poly time to that one NP-complete problem; compose the reduction with its poly-time solver to solve *any* NP problem in poly time. That is the entire stakes of the P vs NP question — the NP-complete problems stand or fall together.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | `A ≤ₚ B` reads as…? | "`A` is no harder than `B`" |
| 2 | To prove `B` NP-hard, reduce…? | A **known** NP-hard `A` **to** `B` (`A ≤ₚ B`) |
| 3 | NP-complete = ? | In NP **and** NP-hard |
| 4 | Two-step recipe? | (1) show `B ∈ NP`; (2) reduce known-hard `A` to `B` |
| 5 | First problem proven NP-complete? | SAT (Cook–Levin) |
| 6 | What does Cook–Levin enable? | Reduce *one* problem, not all of NP, by transitivity |
| 7 | Are all NP-hard problems in NP? | No (e.g., halting problem) |
| 8 | IS ≤ₚ VC reduction core? | `S` independent ⟺ `V∖S` is a vertex cover; `k → n−k` |
| 9 | IS ≤ₚ Clique reduction core? | Use complement graph `Ḡ`; same `k` |
| 10 | Most flexible source problem? | 3-SAT |
| 11 | Is Knapsack strongly NP-hard? | No — only weakly; has pseudo-poly DP |
| 12 | Why isn't the `O(nW)` Knapsack DP poly? | Poly in value `W`, exponential in bits `log W` |
| 13 | Is TSP weakly NP-hard? | No — strongly NP-hard (no pseudo-poly DP) |
| 14 | `B ≤ₚ A`, `A` NP-complete — is `B` hard? | No — wrong direction |
| 15 | Poly algo for one NPC problem ⟹ ? | `P = NP` |
| 16 | Reduction must preserve the answer how? | Iff (both directions) |

---

## Common Mistakes

1. **Reducing in the wrong direction.** To prove your problem hard, reduce *from* a known-hard problem *to* it (`A ≤ₚ B`), never `B ≤ₚ A`. This is *the* classic error.
2. **Forgetting to prove membership in NP.** NP-completeness needs *both* NP-hardness *and* `B ∈ NP`. Skipping the verifier step leaves you with only NP-hardness.
3. **Re-reducing all of NP.** You only need *one* known NP-complete source; transitivity handles the rest.
4. **Only proving one direction of the iff.** A valid reduction needs `x ∈ A ⟺ f(x) ∈ B` — both ways, or the answer isn't preserved.
5. **Assuming every NP-hard problem is in NP.** Halting and many optimization/counting problems are NP-hard but not in NP.
6. **Thinking Knapsack's DP refutes its NP-hardness.** The DP is *pseudo*-polynomial (poly in value, not in bits); Knapsack is only *weakly* NP-hard.
7. **Reduction `f` not in poly time.** A gadget construction that blows up super-polynomially is not a valid Karp reduction.

---

## Tips & Summary

- **Burn the direction into memory**: *reduce FROM known-hard TO your target.* Say "`3-SAT ≤ₚ MyProblem`" out loud and check the arrow points *into* your problem. Half of all reduction mistakes vanish if you fix the direction first.
- **State the two-step recipe explicitly** when asked to prove NP-completeness: "First I'll show it's in NP via a certificate, then NP-hard by reducing from [source]." Structure signals competence.
- **Memorize the free reductions**: IS ⟷ VC (complement set, `k → n−k`) and IS ⟷ Clique (complement graph). They come up constantly and need no gadget.
- **Default to 3-SAT** for unfamiliar problems; its clause/variable structure encodes nearly any constraint via gadgets.
- **Always mention weak vs strong NP-hardness** if numbers appear — it's the sophisticated distinction that explains Knapsack's pseudo-poly DP and separates senior candidates.
- **Never confuse "reduce to SAT" with "prove hard."** Reducing your problem *to* SAT is how you *solve* it with a solver; reducing a known-hard problem *to* yours is how you *prove* it hard.

**Related:** [Complexity Classes P and NP — Interview](../06-complexity-classes-p-np/interview.md) · [Reductions & NP-Completeness — Middle](./middle.md) · [Reductions & NP-Completeness — Senior](./senior.md)
