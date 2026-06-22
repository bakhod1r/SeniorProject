# Complexity Classes: P and NP — Interview Questions

## Table of Contents

1. [Conceptual Questions](#conceptual-questions)
2. [Classification Drills](#classification-drills)
3. [Verifier & Reduction Questions](#verifier--reduction-questions)
4. [Gotcha / Trick Questions](#gotcha--trick-questions)
5. [Rapid-Fire Q&A](#rapid-fire-qa)
6. [Common Mistakes](#common-mistakes)
7. [Tips & Summary](#tips--summary)

---

## Conceptual Questions

### Q1: Define the class P. *(Easy)*

**Answer**: **P** (polynomial time) is the set of **decision problems** (yes/no questions) solvable by a deterministic algorithm in time `O(n^k)` for some constant `k`, where `n` is the input size. Informally: problems we can *solve* efficiently. Examples: sorting (as a decision problem), shortest path, primality testing (Agrawal–Kayal–Saxena, 2002), 2-SAT, matching.

### Q2: Define the class NP. Nail the verifier definition. *(Medium)*

**Answer**: **NP** (nondeterministic polynomial time) is the set of decision problems for which a **"yes" answer can be *verified* in polynomial time given a certificate (witness)**.

Formally: a language `L ∈ NP` if there is a polynomial-time verifier `V(x, c)` and a polynomial `p` such that:
- if `x ∈ L`, there **exists** a certificate `c` with `|c| ≤ p(|x|)` and `V(x, c) = yes`;
- if `x ∉ L`, then for **all** `c`, `V(x, c) = no`.

The certificate is the "proof" of a yes-instance. For SAT, the certificate is a satisfying assignment; the verifier just plugs it in and checks every clause — clearly polynomial. The equivalent definition is "solvable by a nondeterministic Turing machine in polynomial time," but the **verifier/certificate** framing is the one to lead with in an interview.

### Q3: Does NP stand for "non-polynomial"? *(Easy — the #1 misconception)*

**Answer**: **No.** NP stands for **Nondeterministic Polynomial time**, *not* "non-polynomial." Problems in NP are verifiable in polynomial time. Many NP problems are even *in P* (P ⊆ NP). Calling NP "non-polynomial" is the single most common error and inverts the meaning — get this right immediately.

### Q4: What is the relationship between P and NP? *(Easy)*

**Answer**: **P ⊆ NP.** Every problem solvable in polynomial time is also verifiable in polynomial time — if you can *solve* it from scratch in poly time, you can ignore the certificate and just solve it to verify. Whether the inclusion is strict (`P ≠ NP`) is the famous **open question**. See [Q5](#q5-what-is-the-p-vs-np-question-and-what-would-pnp-imply-medium).

### Q5: What is the P vs NP question, and what would P=NP imply? *(Medium)*

**Answer**: **P vs NP** asks: is every problem whose solution can be *verified* quickly also *solvable* quickly? I.e., does `P = NP`?

If **P = NP**, then every NP problem (including all NP-complete ones — SAT, TSP, etc.) would have a polynomial-time algorithm. Consequences: most public-key cryptography (which relies on certain problems being hard) would break; optimization, theorem-proving, and protein folding would become tractable. The overwhelming consensus is `P ≠ NP`, but it remains **unproven** — it is one of the seven Clay Millennium Prize Problems.

### Q6: Define NP-complete, NP-hard, and how they relate to NP. Describe the Venn diagram. *(Hard)*

**Answer**:
- **NP-hard**: a problem `H` such that **every** problem in NP reduces to `H` in polynomial time. Intuitively "at least as hard as everything in NP." NP-hard problems need **not** be in NP — they need not even be decision problems (e.g., the halting problem is NP-hard) or decidable.
- **NP-complete**: a problem that is **both in NP and NP-hard**. These are the "hardest problems *in* NP." If any one of them has a poly-time algorithm, then `P = NP`.

**Venn picture** (assuming `P ≠ NP`):
- A big oval **NP** containing a smaller oval **P** inside it.
- **NP-complete** sits as a band *inside NP but disjoint from P* (the hardest layer of NP).
- **NP-hard** is a region that *overlaps* NP exactly at NP-complete, but also extends *outside* NP entirely (harder-than-NP and undecidable problems).
- So: NP-complete = NP ∩ NP-hard.

See [reductions & NP-completeness](../07-reductions-and-np-completeness/interview.md) for the reduction machinery.

### Q7: What is co-NP, and why is TAUTOLOGY in co-NP but not obviously in NP? *(Hard)*

**Answer**: **co-NP** is the set of problems whose **"no" answers** have polynomial-time-verifiable certificates — equivalently, the complements of NP languages. Where NP has short proofs of *yes*, co-NP has short proofs of *no*.

**TAUTOLOGY** asks: is a Boolean formula true under *every* assignment? A *counterexample* (one assignment making it false) is a short certificate of a **"no"** answer → TAUTOLOGY ∈ co-NP. But for a **"yes"** (it really is a tautology), the obvious certificate would have to cover *all* `2^n` assignments — no short witness is known, so it is not obviously in NP. TAUTOLOGY is in fact **co-NP-complete**. Note `P ⊆ NP ∩ co-NP`, and whether `NP = co-NP` is another major open question (a proof that `NP ≠ co-NP` would imply `P ≠ NP`).

---

## Classification Drills

> For each: is it in P, NP-complete, or neither? (All P problems are also in NP.)

### Q8: Classify these standard problems. *(Medium)*

| Problem | Class | Why |
|---------|-------|-----|
| **Sorting** a list | **P** | `O(n log n)` deterministic |
| **Shortest path** (single-source, non-negative) | **P** | Dijkstra, `O(E + V log V)` |
| **Primality testing** | **P** | AKS algorithm (2002), polynomial |
| **2-SAT** | **P** | Linear via implication graph SCCs |
| **SAT / 3-SAT** | **NP-complete** | First proven NP-complete (Cook–Levin) |
| **Subset-sum** | **NP-complete** | Verify a subset sums to target in poly time; reduces from 3-SAT |
| **TSP (decision: tour ≤ k?)** | **NP-complete** | Verify a tour's length; reduces from Hamiltonian cycle |
| **Graph coloring (k ≥ 3)** | **NP-complete** | 3-coloring is NP-complete |
| **Hamiltonian cycle** | **NP-complete** | Verify the cycle visits all vertices once |
| **Clique (size ≥ k?)** | **NP-complete** | Verify a `k`-subset is mutually adjacent |
| **Vertex cover (size ≤ k?)** | **NP-complete** | Verify the cover hits every edge |

**Note**: 2-coloring (bipartiteness) is in **P**, but 3-coloring is NP-complete — the boundary can be a single parameter.

### Q9: Is the halting problem in NP? *(Hard — trap)*

**Answer**: **No.** The halting problem is **undecidable** — *no* algorithm decides it at all, in any amount of time. NP (and even NP-hard membership aside) is about problems that are decidable; NP problems have poly-time *verifiers*. An undecidable problem cannot be in NP. The halting problem **is** NP-hard (everything in NP trivially reduces to it), which neatly illustrates why **NP-hard does not imply "in NP"** — see [Q6](#q6-define-np-complete-np-hard-and-how-they-relate-to-np-describe-the-venn-diagram-hard). Watch for this trap: "hard" plus "halting" does not put it in NP.

### Q10: Is integer factorization NP-complete? *(Hard)*

**Answer**: Factorization (decision form: "does `N` have a factor `< k`?") is in **NP ∩ co-NP**, but it is **not known to be NP-complete** and is widely believed not to be. It is also not known to be in P (RSA's security rests on this). It is a candidate "NP-intermediate" problem: if `P ≠ NP`, Ladner's theorem guarantees such intermediate problems exist, neither in P nor NP-complete. Don't reflexively label every "hard-looking" problem NP-complete.

---

## Verifier & Reduction Questions

### Q11: Show that Subset-Sum is in NP by describing its verifier. *(Medium)*

**Answer**: Instance: a set of integers `S` and a target `T`; question: is there a subset summing to `T`?

- **Certificate**: the subset itself (a list of chosen elements, or a bit-mask over `S`). Its size is `≤ |S|` — polynomial.
- **Verifier `V(⟨S,T⟩, c)`**: check that every element of `c` is in `S`, sum them, and confirm the sum equals `T`. This is a single linear pass → polynomial time.

Since a yes-instance has such a certificate and a no-instance has none, Subset-Sum ∈ NP. (Demonstrating a poly-time verifier is the standard recipe for proving NP membership.)

### Q12: What does "reduce A to B" mean, and which direction proves hardness? *(Medium)*

**Answer**: A **polynomial-time (many-one) reduction** `A ≤ₚ B` is a poly-time function `f` mapping instances of `A` to instances of `B` such that `x` is a yes-instance of `A` **iff** `f(x)` is a yes-instance of `B`. It says "`B` is at least as hard as `A`" — a fast solver for `B` yields a fast solver for `A`.

**Direction for hardness proofs**: to prove a *new* problem `B` is NP-hard, reduce a **known** NP-hard problem `A` **to** `B` (`A ≤ₚ B`). The mnemonic: **reduce *from* known-hard *to* your target.** Reducing the other way (`B ≤ₚ A`) proves `B` is *easy* if `A` is, which is the opposite of what you want.

### Q13: If A ≤ₚ B and B ∈ P, what can you conclude about A? *(Easy)*

**Answer**: **A ∈ P.** Solve any instance `x` of `A` by computing `f(x)` (poly time) and running `B`'s poly-time algorithm on it; poly ∘ poly = poly. This is the contrapositive backbone of hardness theory: if `B` were in P, then *every* problem reducing to it would be in P — which is exactly why a poly-time algorithm for *one* NP-complete problem would collapse `P = NP`.

---

## Gotcha / Trick Questions

### Q14: "My problem is NP-hard. Does that mean it's unsolvable?" *(Medium)*

**Answer**: **No.** NP-hard means no *known* polynomial-time algorithm, not that it is unsolvable. Most NP-hard problems are perfectly **decidable** — you can solve them exactly with exponential-time search (e.g., branch-and-bound, DP over subsets). "Hard" is about *scaling*, not *possibility*. (A separate trap: some NP-hard problems, like halting, *are* undecidable — but that's because they're undecidable, not because they're NP-hard.)

### Q15: "NP-complete means no algorithm exists." Correct this. *(Medium)*

**Answer**: Wrong on two counts. (1) Algorithms exist — exact exponential ones always do for decidable problems. (2) Even a *polynomial* algorithm isn't *proven* impossible; we simply have **no known** poly-time algorithm, and finding one would prove `P = NP`. The honest statement is: "no polynomial-time algorithm is *known*, and one existing would be a historic result." Never say "impossible."

### Q16: Your problem is NP-complete and inputs are large. What do you actually do? *(Hard)*

**Answer**: You stop chasing an exact poly-time algorithm and reach for practical responses:
- **Approximation algorithms** with provable ratios (e.g., 2-approximation for Vertex Cover; Christofides for metric TSP).
- **Heuristics / metaheuristics** (greedy, local search, simulated annealing, genetic algorithms) — no guarantee but often excellent in practice.
- **Exact-but-smart** solvers: ILP/SAT/SMT solvers, branch-and-bound, DP — surprisingly fast on real instances despite worst-case exponential.
- **Parameterized / FPT** algorithms when a key parameter `k` is small (e.g., `O(2^k · n)` for Vertex Cover).
- **Restrict the input**: many NP-complete problems become poly-time on trees, planar, or bounded-treewidth graphs.

Naming approximation + ILP/SAT solvers signals engineering maturity beyond the textbook classification.

### Q17: Is every problem in NP either in P or NP-complete? *(Hard)*

**Answer**: **Not necessarily.** If `P ≠ NP`, **Ladner's theorem** proves there exist **NP-intermediate** problems — in NP, not in P, and not NP-complete. Factoring and graph isomorphism are suspected candidates. (If `P = NP`, the question is moot since all three classes coincide.) So the dichotomy "P or NP-complete" is a false one.

---

## Rapid-Fire Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | What does the P in P stand for? | Polynomial (deterministic) time |
| 2 | What does NP stand for? | **Nondeterministic** Polynomial — *not* "non-polynomial" |
| 3 | P vs NP: which inclusion is known? | `P ⊆ NP` |
| 4 | Is `P = NP` proven either way? | No — open (Clay Millennium Problem) |
| 5 | First problem proven NP-complete? | SAT (Cook–Levin theorem) |
| 6 | NP-complete = ? | In NP **and** NP-hard |
| 7 | Are all NP-hard problems in NP? | No (e.g., halting problem) |
| 8 | Is the halting problem in NP? | No — it's undecidable |
| 9 | Is primality in P? | Yes (AKS, 2002) |
| 10 | Is 2-SAT in P? | Yes; 3-SAT is NP-complete |
| 11 | TAUTOLOGY belongs to which class? | co-NP (co-NP-complete) |
| 12 | To prove B is NP-hard, reduce…? | A **known** NP-hard problem *to* B |
| 13 | `A ≤ₚ B` and `B ∈ P` ⇒ ? | `A ∈ P` |
| 14 | One poly-time algorithm for an NP-complete problem implies…? | `P = NP` |
| 15 | What is a certificate? | A short, poly-time-checkable proof of a yes-instance |
| 16 | Is factoring known to be NP-complete? | No — suspected NP-intermediate |
| 17 | NP-intermediate problems exist if…? | `P ≠ NP` (Ladner's theorem) |

---

## Common Mistakes

1. **"NP = non-polynomial."** It means *nondeterministic* polynomial. NP problems are *verifiable* in poly time, and `P ⊆ NP`.
2. **Equating NP-hard with "in NP."** NP-hard can lie outside NP entirely (undecidable problems are NP-hard).
3. **"NP-complete ⇒ no algorithm / unsolvable."** Exact (exponential) algorithms exist; only a *known polynomial* one is missing.
4. **Reducing in the wrong direction.** To prove your problem hard, reduce *from* a known-hard problem *to* it — not the reverse.
5. **Calling the halting problem NP-complete.** It's NP-hard but undecidable, so it cannot be in NP, so it cannot be NP-complete.
6. **Assuming every NP problem is P or NP-complete.** Ladner's theorem gives NP-intermediate problems (if `P ≠ NP`).
7. **Confusing decision and optimization forms.** The classes are defined on **decision** problems; "find the shortest tour" is reframed as "is there a tour `≤ k`?".

---

## Tips & Summary

- **Lead with the verifier definition of NP**: "yes-instances have a short certificate checkable in poly time." It is precise and instantly separates you from candidates who think NP means "hard/non-polynomial."
- **Keep the Venn diagram in your head**: P inside NP; NP-complete = NP ∩ NP-hard; NP-hard spilling outside NP. Most conceptual questions are testing whether you can place a problem correctly.
- **Memorize the canonical NP-complete six**: SAT/3-SAT, Subset-Sum, TSP-decision, Graph Coloring, Hamiltonian Cycle, Clique, Vertex Cover — and the P "near-misses" (2-SAT, 2-coloring, shortest path, primality).
- **When asked to prove membership in NP**, describe the certificate *and* the poly-time verifier — that's the whole proof.
- **When asked what to do about an NP-complete problem**, pivot to approximation, heuristics, ILP/SAT solvers, FPT, and input restrictions — not "it's impossible."
- **Never say "impossible" or "no algorithm exists."** Say "no *known* polynomial-time algorithm, and finding one would prove `P = NP`."

**Related:** [Time vs Space Complexity — Interview](../01-time-vs-space-complexity/interview.md) · [Reductions & NP-Completeness — Interview](../07-reductions-and-np-completeness/interview.md) · [P and NP — Middle](./middle.md) · [P and NP — Senior](./senior.md)
