# Complexity Classes: P and NP — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Machine Model and Polynomial Time](#the-machine-model-and-polynomial-time)
3. [Problems as Formal Languages](#problems-as-formal-languages)
4. [Decision, Search, and Optimization](#decision-search-and-optimization)
5. [The Class P](#the-class-p)
6. [The Class NP — Two Definitions](#the-class-np--two-definitions)
7. [Why the Two Definitions Are Equivalent](#why-the-two-definitions-are-equivalent)
8. [co-NP and the NP vs co-NP Question](#co-np-and-the-np-vs-co-np-question)
9. [Class Containments and What We Actually Know](#class-containments-and-what-we-actually-know)
10. [NP-Completeness, Properly Stated](#np-completeness-properly-stated)
11. [Worked Example: 3-COLORING ∈ NP](#worked-example-3-coloring--np)
12. [Worked Example: Decision ⇒ Search for SAT](#worked-example-decision--search-for-sat)
13. [Code: A Polynomial Verifier and a Brute-Force Simulation](#code-a-polynomial-verifier-and-a-brute-force-simulation)
14. [Pitfalls](#pitfalls)
15. [Summary](#summary)

---

## Introduction

> Focus: turn the junior slogans into definitions you could defend in a proof.

At the junior level you learned the shorthand: **P** is "solvable in polynomial time," **NP** is "checkable in polynomial time," P ⊆ NP, and whether the inclusion is strict is the famous open problem. Those slogans are correct but imprecise. A senior engineer who reasons about NP-hardness — to justify "we will use a heuristic, not an exact algorithm" — needs the slogans to rest on *definitions*: a fixed machine model, a precise meaning of "polynomial time," problems recast as formal languages, and the verifier/certificate machinery stated carefully enough that "verify in polynomial time" is unambiguous.

This file makes the four foundational classes — **P, NP, co-NP** — rigorous, proves the equivalence of NP's two definitions, maps the containment lattice (separating what we *know* from what is *open*), and introduces **NP-completeness** as a definition. The Cook–Levin theorem and the reduction zoo are deferred to [reductions and NP-completeness](../07-reductions-and-np-completeness/middle.md); the consequences for getting *good-enough* answers to hard problems live in [approximation and hardness](../08-approximation-and-hardness/middle.md).

If you have not read the [junior level](./junior.md), do so first — this file continues from it without re-deriving the intuition.

---

## The Machine Model and Polynomial Time

Complexity is only well-defined relative to a **model of computation**. The standard reference model is the **deterministic Turing machine (DTM)**: a finite control, one or more infinite tapes, a head per tape, and a transition function `δ` that, given the current state and the symbols under the heads, writes symbols, moves the heads left/right, and changes state. "Deterministic" means `δ` is a function — exactly one next configuration for each configuration.

We measure **running time** as the number of transition steps the machine takes before halting, as a function of the **input length** `n = |x|` (the number of symbols on the input tape). A machine `M` runs in time `t(n)` if for every input of length `n` it halts within `t(n)` steps.

**Polynomial time** means: there exist constants `c` and `k` such that `M` halts within `c·n^k` steps on every input of length `n`. Equivalently, `t(n) = O(n^k)` for some fixed `k`.

Why fixate on polynomials? Two reasons, both load-bearing:

- **Robustness (the invariance thesis).** "Polynomial" is invariant across all reasonable deterministic models: a single-tape DTM, a multi-tape DTM, and a RAM machine simulate one another with at most polynomial overhead (e.g., a `k`-tape machine running in time `t` is simulated by a single-tape machine in `O(t²)`). So "solvable in polynomial time" is a property of the *problem*, not of the *machine*. This is why we can reason about complexity in terms of pseudocode or Go/Java without committing to tape mechanics.
- **Closure.** Polynomials are closed under addition, multiplication, and composition. A polynomial-time routine that calls a polynomial-time subroutine a polynomial number of times is still polynomial. This makes "polynomial time" a stable notion of *tractability* you can build with.

```text
Reasonable deterministic models, pairwise polynomial overhead:

  single-tape DTM  ──O(t²)──▶  (slower but poly-equivalent)
  multi-tape DTM   ──O(t·log t)──▶ single-tape
  RAM (unit cost)  ──poly──▶ multi-tape DTM

  => "runs in polynomial time" is model-independent.
```

A caveat that matters at this level: "polynomial in the **input length**" is measured in *bits*, not in the *value* of a number. An algorithm on an integer `N` that runs in `O(N)` is **exponential** in the input size, because writing `N` takes only `n ≈ log₂ N` bits, and `N = 2^n`. This is exactly why trial-division primality testing is not a polynomial-time algorithm. See [time vs space complexity](../01-time-vs-space-complexity/middle.md) for the bit-length vs value distinction.

---

## Problems as Formal Languages

To classify problems by complexity, we standardize them. Fix a finite alphabet `Σ` (e.g., `{0,1}`). A **string** is a finite sequence over `Σ`; `Σ*` is the set of all strings. A **language** is any subset `L ⊆ Σ*`.

A **decision problem** is a yes/no question about an input, and we identify it with the language of its YES-instances:

```text
L = { x ∈ Σ* : the answer for x is YES }
```

To **decide** `L` is to build a machine `M` that, for every `x`, halts and outputs `1` if `x ∈ L` and `0` if `x ∉ L`. (Contrast with merely *recognizing* `L`, where the machine may loop forever on `x ∉ L`. Every problem we discuss is decidable; we only argue about *how fast*.)

Encoding turns rich objects — graphs, formulas, matrices — into strings. As long as the encoding is *reasonable* (the natural binary or adjacency-list encoding, not a unary blow-up), the choice of encoding changes the input length only polynomially and so does not affect membership in P or NP. Throughout, `⟨G⟩` denotes a reasonable string encoding of object `G`.

Two canonical languages we use repeatedly:

```text
SAT  = { ⟨φ⟩ : φ is a satisfiable Boolean formula in CNF }
3COL = { ⟨G⟩ : G is an undirected graph with a proper 3-coloring }
```

---

## Decision, Search, and Optimization

The same underlying problem appears in three guises. Take graph coloring:

| Version | Question | Output |
|---|---|---|
| **Decision** | Is `G` 3-colorable? | yes / no |
| **Search** | Give a proper 3-coloring of `G`, or report none exists. | a coloring (the witness) |
| **Optimization** | What is the chromatic number `χ(G)`? | an integer |

Complexity theory is built on the **decision** version because languages and the verifier definition are cleanest there. The natural worry is that decision is *weaker* than search or optimization — knowing *whether* a coloring exists seems less than *producing* one. For most natural problems this gap is illusory:

- **Optimization ⟺ decision via binary search.** Given a decision oracle for "is `χ(G) ≤ k?`, you find `χ(G)` with `O(log V)` oracle calls — a polynomial blow-up. So the optimization and decision versions are **polynomially equivalent**: one is in P iff the other is.
- **Search ⟺ decision via self-reducibility.** For SAT, a decision oracle that only answers satisfiable/unsatisfiable lets you *construct* a satisfying assignment in polynomial time, by fixing variables one at a time. This is the property of **self-reducibility**, and we prove it concretely in [the SAT worked example](#worked-example-decision--search-for-sat) below.

The payoff: by studying the *decision* class NP, we lose almost nothing. A polynomial algorithm for the decision version of an NP-complete problem yields polynomial algorithms for its search and optimization versions too — so "P = NP" really would collapse all three for every NP problem.

---

## The Class P

> **P** is the class of languages decidable by a deterministic Turing machine in polynomial time.

```text
P = { L ⊆ Σ* : some DTM decides L in time O(n^k) for a fixed k }
```

P is our formal stand-in for **tractable** — the problems we consider efficiently solvable. Members you have already met:

- **Reachability / shortest paths** — BFS, Dijkstra: `O(V + E)`, `O((V+E) log V)`.
- **Sorting** — `O(n log n)`.
- **2-SAT** — satisfiability of CNF with ≤ 2 literals per clause: `O(n + m)` via implication-graph SCCs. (Note the contrast: **3**-SAT is NP-complete; the jump from 2 to 3 literals per clause crosses the tractability boundary.)
- **Primality** — `PRIMES ∈ P` since the AKS algorithm (2002); see [co-NP](#co-np-and-the-np-vs-co-np-question).
- **Maximum matching, linear programming, minimum spanning tree** — all in P.

P is closed under complement: if `M` decides `L` in polynomial time, swapping its accept/reject outputs decides `L̄` (the complement) in the same time. Keep this fact in hand — it is exactly what fails (as far as we know) for NP.

---

## The Class NP — Two Definitions

NP has two standard definitions. Both are correct and equivalent; you should be fluent in switching between them, because each makes different proofs easy.

### Definition 1 — The verifier (certificate) definition

> `L ∈ NP` iff there is a polynomial-time **verifier** `V` and a polynomial `p` such that, for all `x`:
>
> ```text
> x ∈ L   ⟺   ∃ c with |c| ≤ p(|x|)  such that  V(x, c) = 1
> ```

Read it precisely:

- `c` is the **certificate** (a.k.a. witness, proof). It is a string that *attests* membership.
- The certificate is **short**: its length is polynomially bounded in `|x|`.
- The verifier `V` is an ordinary deterministic polynomial-time algorithm taking *two* inputs — the instance `x` and the candidate certificate `c` — and outputs accept/reject.
- The condition is **asymmetric**: for a YES-instance, *some* certificate makes `V` accept; for a NO-instance, *every* certificate makes `V` reject. NP only promises easy proofs of **YES** answers.

For SAT, the certificate is a satisfying assignment; `V` plugs it into `φ` and evaluates — linear in the formula size. For 3COL, the certificate is a coloring; `V` checks every edge has differently-colored endpoints. The instance "is hard to solve" but "easy to check given the answer," which is exactly the verifier definition.

### Definition 2 — The nondeterministic Turing machine definition

> `L ∈ NP` iff some **nondeterministic Turing machine (NTM)** decides `L` in polynomial time.

An NTM's transition relation may offer *several* legal next configurations at each step — think of it as branching. An NTM **accepts** `x` if *at least one* computation branch reaches an accepting state. It decides `L` in time `t(n)` if for every `x` of length `n`, every branch halts within `t(n)` steps, and `x ∈ L` iff some branch accepts.

"NP" literally abbreviates **N**ondeterministic **P**olynomial time. (A frequent beginner error: NP does *not* mean "non-polynomial.")

```text
NTM computation on input x  =  a TREE of configurations
   accept x  ⟺  some leaf is an accepting state
   reject x  ⟺  every leaf rejects

P:   the tree is a single path (deterministic)
NP:  the tree may branch; one good path suffices
```

---

## Why the Two Definitions Are Equivalent

This equivalence is the conceptual heart of NP. We sketch both directions.

**(⇐) Nondeterministic ⟹ Verifier.** Suppose an NTM `N` decides `L` in time `p(n)`. At each step `N` chooses among a bounded number `b` of options. A full accepting computation is determined by the *sequence of choices* it makes — at most `p(n)` choices, each from `b` options, so the choice-sequence is a string `c` of length `O(p(n))` over an alphabet of size `b`. Define a deterministic verifier `V(x, c)`: simulate `N` on `x`, but whenever `N` faces a nondeterministic choice, take the option dictated by the next symbol of `c`; accept iff this single simulated branch accepts. `V` runs in polynomial time (one deterministic simulation of `p(n)` steps). Now:

- If `x ∈ L`, some branch of `N` accepts; let `c` encode that branch's choices — then `V(x, c) = 1`. The certificate **is** the accepting computation path.
- If `x ∉ L`, no branch accepts, so for *every* `c` the simulated branch rejects, hence `V(x, c) = 0`.

That is exactly the verifier definition, with `c` = "the lucky sequence of guesses."

**(⇒) Verifier ⟹ Nondeterministic.** Suppose `V` and polynomial `p` witness `L ∈ NP` under Definition 1. Build an NTM `N` that, on input `x`, first **nondeterministically guesses** a certificate `c` of length ≤ `p(|x|)` — branching at each of the `p(|x|)` positions over the certificate alphabet — and then **deterministically runs** `V(x, c)`, accepting iff `V` accepts. Guessing costs `O(p(|x|))` steps; running `V` is polynomial; so `N` is polynomial-time. And `N` has an accepting branch iff some `c` makes `V(x, c) = 1`, i.e. iff `x ∈ L`. So `N` decides `L` in polynomial time. ∎

The slogan to remember:

```text
nondeterminism  =  guess a certificate  +  verify it deterministically

The NTM "guesses" the proof; the verifier "checks" the guess.
Same class, two viewpoints.
```

With either definition, **P ⊆ NP** is immediate: if `L ∈ P`, take a verifier `V(x, c)` that *ignores* `c` and just decides `x` directly (use the empty certificate, `p ≡ 0`). Membership of `x` needs no nontrivial witness because we can compute it ourselves. The open question is whether the inclusion is **strict** — whether having to *find* a witness is fundamentally harder than *checking* one.

---

## co-NP and the NP vs co-NP Question

NP's asymmetry — short proofs for YES, no promise for NO — has a mirror class.

> **co-NP** is the class of languages whose **complements** are in NP. Equivalently, `L ∈ co-NP` iff there is a polynomial-time verifier `V` and polynomial `p` such that:
>
> ```text
> x ∈ L   ⟺   ∀ c with |c| ≤ p(|x|),  V(x, c) = 1
> ```

So co-NP problems have short *disqualifications* — short certificates of **NO** answers, with a *universal* (∀) quantifier replacing NP's existential (∃) one.

Canonical members:

- **UNSAT** = `{ ⟨φ⟩ : φ has no satisfying assignment }`. To certify a YES (unsatisfiable) instance would require ruling out *all* assignments — no short witness is known. But UNSAT is the complement of SAT (modulo well-formedness), and SAT ∈ NP, so **UNSAT ∈ co-NP**.
- **TAUTOLOGY** = `{ ⟨φ⟩ : φ is true under every assignment }`. A *counterexample* (one falsifying assignment) is a short NO-certificate, so TAUTOLOGY ∈ co-NP. It is in fact co-NP-complete.

**Is NP = co-NP?** Open. Just as we cannot prove P ≠ NP, we cannot prove NP ≠ co-NP. The intuition: a short *proof that a formula is satisfiable* (exhibit an assignment) is easy; a short *proof that it is unsatisfiable* seems to require something like a polynomial-size proof of unsatisfiability, which we do not know how to produce. If NP ≠ co-NP, then P ≠ NP (since P = co-P, so P ⊆ NP ∩ co-NP; if P were NP, then NP = co-NP). The contrapositive is a common exam fact: **proving NP ≠ co-NP would prove P ≠ NP.**

**NP ∩ co-NP** holds the problems with *both* short YES-proofs and short NO-proofs. P ⊆ NP ∩ co-NP always. Two historically important inhabitants:

- **PRIMES / COMPOSITES.** A composite number has a short YES-witness (a nontrivial factor — checkable by division), and Pratt's certificate gives a short YES-witness of *primality*, so both PRIMES and COMPOSITES sat in NP ∩ co-NP for decades — strong evidence they were "probably easy" *before* AKS (2002) finally placed PRIMES in **P**.
- **FACTORING (decision form)**, e.g. `{ ⟨N, k⟩ : N has a prime factor ≤ k }`. It lies in NP ∩ co-NP (the factorization is the witness for both directions) but is *not known* to be in P. Its presumed hardness underpins RSA. Crucially, FACTORING is **not believed to be NP-complete** — a problem in NP ∩ co-NP being NP-complete would imply NP = co-NP. This is why factoring is "hard but special": hard enough for cryptography, but not NP-complete.

```text
                       NP
                  ┌──────────┐
                  │   SAT    │   (NP-complete: YES-certs only, no known NO-certs)
        ┌─────────┼──────────┼─────────┐
        │   FACTORING, PRIMES (pre-AKS) │   <- NP ∩ co-NP
        │         ┌──────────┐          │
        │         │    P     │  PRIMES (post-AKS), matching, 2-SAT
        │         └──────────┘          │
        └─────────┼──────────┼─────────┘
                  │  UNSAT   │   (co-NP-complete)
                  └──────────┘
                     co-NP
```

---

## Class Containments and What We Actually Know

Stack the time- and space-bounded classes:

```text
   P  ⊆  NP  ⊆  PSPACE  ⊆  EXP
   │           │           │
   └─ P ⊆ co-NP ⊆ PSPACE   │
                            └─ P ⊊ EXP   (STRICT — proven)
```

Definitions of the new classes:

- **PSPACE** — languages decidable by a DTM using polynomially many tape cells (time unbounded). Both NP and co-NP sit inside PSPACE: a deterministic machine can *reuse space* to try every one of the (exponentially many) certificates one at a time, never storing more than one at once. Polynomial space, exponential time.
- **EXP** — languages decidable in deterministic time `2^(n^k)` for some `k`. Brute force over all polynomially-bounded certificates fits here, so NP ⊆ EXP; in fact PSPACE ⊆ EXP.

The honest accounting of **knowledge vs conjecture**:

| Relation | Status |
|---|---|
| P ⊆ NP | **Known** (verifier ignores certificate) |
| P ⊆ co-NP | **Known** (P closed under complement) |
| NP ⊆ PSPACE | **Known** (reuse space over certificates) |
| PSPACE ⊆ EXP | **Known** (a poly-space machine has only `2^O(n^k)` distinct configurations) |
| **P ⊊ EXP** | **Known and STRICT** (Time Hierarchy Theorem) |
| P = NP ? | **Open** |
| NP = co-NP ? | **Open** |
| NP = PSPACE ? | **Open** |
| P = PSPACE ? | **Open** |

The one **proven strict** separation in this chain is **P ⊊ EXP**, from the **Time Hierarchy Theorem**: with strictly more time you can decide strictly more languages (the diagonalization-based proof constructs a language decidable in `2^n` but not in any fixed polynomial `n^k`). Because `P ⊆ NP ⊆ PSPACE ⊆ EXP` and the two *ends* are provably different, **at least one** of the intermediate inclusions must be strict — we just cannot prove *which*. It is consistent with current knowledge that P = NP = PSPACE (all collapse) as long as that collapsed class is still ⊊ EXP; it is also consistent that every inclusion shown is strict. Settling any of the open rows is a major open problem (P vs NP is one of the Clay Millennium Prize problems).

---

## NP-Completeness, Properly Stated

NP-completeness pinpoints the **hardest** problems in NP. The tool is a **polynomial-time reduction**.

> A **polynomial-time (many-one / Karp) reduction** from language `A` to language `B`, written `A ≤ₚ B`, is a polynomial-time computable function `f : Σ* → Σ*` such that for all `x`:
>
> ```text
> x ∈ A   ⟺   f(x) ∈ B
> ```

Intuition: `f` *transforms* instances of `A` into instances of `B`, preserving the yes/no answer. If you can solve `B`, you can solve `A`: compute `f(x)`, then run `B`'s decider. Two facts you must internalize:

- **Reductions compose** and respect tractability: if `A ≤ₚ B` and `B ∈ P`, then `A ∈ P` (run `f`, then `B`'s polynomial decider — polynomial ∘ polynomial = polynomial). The reduction direction matters: `A ≤ₚ B` means "`A` is no harder than `B`."

Now the two definitions:

> `B` is **NP-hard** iff `A ≤ₚ B` for *every* `A ∈ NP`.
>
> `B` is **NP-complete** iff `B ∈ NP` **and** `B` is NP-hard.

NP-complete problems are simultaneously *in* NP and *at least as hard as everything in* NP — the maximal elements under `≤ₚ`. The keystone consequence:

> If **any** NP-complete problem is in P, then **P = NP**.

Proof in one line: let `B` be NP-complete and `B ∈ P`. Take any `A ∈ NP`. Since `B` is NP-hard, `A ≤ₚ B`; since `B ∈ P`, composing gives `A ∈ P`. So NP ⊆ P, and with P ⊆ NP we get P = NP. ∎

This is why NP-completeness is the working engineer's "proof of intractability." Showing your problem is NP-complete is strong evidence that **no polynomial exact algorithm exists** — because finding one would solve thousands of other famous problems at once. The rational response is to stop looking for an exact polynomial algorithm and reach for [approximation, heuristics, or hardness-aware design](../08-approximation-and-hardness/middle.md).

Two things we **defer**:

- That NP-complete problems *exist at all* — i.e. that SAT is NP-complete — is the **Cook–Levin theorem**. Its proof (encoding an arbitrary NTM's accepting computation as a satisfiable formula) lives in [reductions and NP-completeness](../07-reductions-and-np-completeness/middle.md).
- The **reduction zoo** — how 3-SAT, CLIQUE, VERTEX-COVER, HAMILTONIAN-CYCLE, SUBSET-SUM, and friends are shown NP-complete by chaining reductions from SAT — is also there.

For now, hold the *shape* of the definition; the next file fills in the machinery.

---

## Worked Example: 3-COLORING ∈ NP

Let us discharge an NP-membership claim end to end, using **Definition 1**, so the verifier definition stops being abstract.

**Problem.** `3COL = { ⟨G⟩ : the undirected graph G = (V, E) has a proper 3-coloring }`, where a proper 3-coloring is a map `χ : V → {1, 2, 3}` with `χ(u) ≠ χ(v)` for every edge `(u, v)`.

**Certificate.** A candidate coloring: a list assigning each of the `|V|` vertices a color in `{1, 2, 3}`. Its length is `O(|V|)` symbols — polynomial in `|⟨G⟩|`. ✔ (short certificate)

**Verifier `V(⟨G⟩, χ)`:**

```text
1. Parse χ as an array of |V| color values.
2. Check the certificate is well-formed:
      length == |V|  AND  every χ[v] ∈ {1, 2, 3}.       reject if not
3. For each edge (u, v) ∈ E:
      if χ[u] == χ[v]:  reject     # adjacent vertices share a color
4. accept
```

**Running time.** Steps 2–3 scan the certificate (`O(V)`) and every edge once (`O(E)`), so `V` runs in `O(V + E)` — polynomial in the input length. ✔ (polynomial verifier)

**Correctness of the certificate relation.**

- If `⟨G⟩ ∈ 3COL`, a proper 3-coloring exists; supply it as `χ` and `V` accepts (no edge is monochromatic). So `∃χ. V(⟨G⟩, χ) = 1`.
- If `⟨G⟩ ∉ 3COL`, *no* proper 3-coloring exists; every well-formed `χ` has at least one monochromatic edge, and ill-formed `χ` fail step 2 — so `V` rejects on *every* `χ`. Hence `¬∃χ. V(⟨G⟩, χ) = 1`.

Both directions match the definition `x ∈ L ⟺ ∃c, |c| ≤ p(|x|), V(x,c)=1`, with `p(n) = O(n)`. Therefore **3COL ∈ NP**. ∎

Notice what we did *not* do: we never explained how to *find* a coloring. That is the whole point — NP membership only requires *checking* a supplied one. (Finding it is hard: 3COL is NP-complete, shown in the next file. But that is a separate claim from membership.)

---

## Worked Example: Decision ⇒ Search for SAT

This makes "self-reducibility" concrete and justifies why studying the decision class loses nothing for SAT. We are given a **decision oracle** `SAT?(φ)` returning only `true`/`false`, and we build a polynomial-time algorithm that *outputs an actual satisfying assignment* (or "UNSAT").

The idea: fix variables one at a time, using the oracle to keep us on a satisfiable branch.

```text
FindAssignment(φ over variables x1..xn):
  if SAT?(φ) is false:
      return "UNSATISFIABLE"
  assignment = {}
  for i = 1 to n:
      # try forcing xi = true
      φ_true = φ with xi substituted by TRUE (simplify)
      if SAT?(φ_true):
          assignment[xi] = true
          φ = φ_true
      else:
          # φ is satisfiable but not with xi=true, so xi=false must work
          assignment[xi] = false
          φ = φ with xi substituted by FALSE (simplify)
  return assignment
```

**Why it is correct.** We maintain the invariant *"the current `φ` is satisfiable."* The first oracle call establishes it. At iteration `i`, the current `φ` is satisfiable, so it has a satisfying assignment in which `xi` is either true or false; therefore at least one of `φ_true`, `φ_false` is satisfiable. The oracle tells us which, and we move there, preserving the invariant. After processing all `n` variables, `φ` has no free variables left and is still satisfiable — so it has simplified to the constant `TRUE`, and the choices we recorded form a genuine satisfying assignment of the original formula.

**Why it is polynomial.** Exactly `1 + n` oracle calls (`O(n)`), each preceded by a substitute-and-simplify step that is linear in the formula size. So search costs only a polynomial factor over decision: `SAT-search ≤ₚ SAT-decision`.

**Consequence.** SAT's decision, search, and optimization-flavored versions are polynomial-time equivalent. If `SAT ∈ P`, you can *produce* satisfying assignments in polynomial time, not merely answer yes/no. This is the property of **self-reducibility**, and most natural NP problems have it — which is why the decision-centric theory of P vs NP is not a loss of generality.

---

## Code: A Polynomial Verifier and a Brute-Force Simulation

Two contrasting programs make the asymmetry tangible. The **verifier** is polynomial: given a certificate, it checks in linear time. The **nondeterministic-simulation** is a deterministic stand-in for an NTM — it *searches* all certificates, which is exponential. The gap between them is, informally, the gap between NP and P.

We use SAT: a CNF formula is a list of clauses; each clause is a list of integer literals (`+k` = variable `k` true, `-k` = variable `k` false).

### Go

```go
package main

import (
	"fmt"
)

// Formula: clauses; each clause is a slice of literals.
// Literal +k means variable k is true, -k means variable k is false.
type Formula struct {
	NumVars int
	Clauses [][]int
}

// ---- Polynomial-time VERIFIER -------------------------------------------
// Given an instance and a certificate (assignment), check in O(total literals).
// assign[k] is the truth value of variable k (1-indexed).
func verify(f Formula, assign []bool) bool {
	for _, clause := range f.Clauses {
		satisfied := false
		for _, lit := range clause {
			v := lit
			if v < 0 {
				v = -v
			}
			want := lit > 0           // does this literal want the var TRUE?
			if assign[v] == want {     // literal is satisfied
				satisfied = true
				break
			}
		}
		if !satisfied {
			return false // an unsatisfied clause => assignment fails
		}
	}
	return true // every clause satisfied
}

// ---- Exponential NONDETERMINISM SIMULATION ------------------------------
// A real NTM "guesses" one assignment. A deterministic machine must try them
// all: 2^n certificates. This is the brute-force decider for SAT.
func bruteForceSAT(f Formula) ([]bool, bool) {
	n := f.NumVars
	for mask := 0; mask < (1 << n); mask++ {
		assign := make([]bool, n+1) // 1-indexed
		for k := 1; k <= n; k++ {
			assign[k] = mask&(1<<(k-1)) != 0
		}
		if verify(f, assign) { // reuse the polynomial verifier as the check
			return assign, true
		}
	}
	return nil, false
}

func main() {
	// (x1 ∨ x2) ∧ (¬x1 ∨ x3) ∧ (¬x2 ∨ ¬x3)
	f := Formula{
		NumVars: 3,
		Clauses: [][]int{{1, 2}, {-1, 3}, {-2, -3}},
	}

	// Verifier: O(size) given a candidate certificate.
	cand := []bool{false, true, false, false} // x1=F, x2=F, x3=F (index 0 unused)
	fmt.Println("verify(all-false):", verify(f, cand)) // false: clause (x1∨x2) fails

	// Brute force: 2^n work to FIND a witness (NTM simulation).
	if assign, ok := bruteForceSAT(f); ok {
		fmt.Printf("SAT: x1=%v x2=%v x3=%v\n", assign[1], assign[2], assign[3])
	} else {
		fmt.Println("UNSAT")
	}
}
```

### Java

```java
import java.util.*;

public class SatVerifier {

    // Formula = list of clauses; each clause is an int[] of literals.
    // +k => variable k true, -k => variable k false.
    static final class Formula {
        final int numVars;
        final int[][] clauses;
        Formula(int numVars, int[][] clauses) {
            this.numVars = numVars;
            this.clauses = clauses;
        }
    }

    // ---- Polynomial-time VERIFIER: O(total literals) -------------------
    // assign[k] is the truth value of variable k (1-indexed; index 0 unused).
    static boolean verify(Formula f, boolean[] assign) {
        for (int[] clause : f.clauses) {
            boolean satisfied = false;
            for (int lit : clause) {
                int v = Math.abs(lit);
                boolean want = lit > 0;      // literal wants the variable TRUE?
                if (assign[v] == want) {     // this literal is satisfied
                    satisfied = true;
                    break;
                }
            }
            if (!satisfied) return false;    // a clause with no satisfied literal
        }
        return true;
    }

    // ---- Exponential NONDETERMINISM SIMULATION: try all 2^n certificates
    static boolean[] bruteForceSAT(Formula f) {
        int n = f.numVars;
        for (long mask = 0; mask < (1L << n); mask++) {
            boolean[] assign = new boolean[n + 1]; // 1-indexed
            for (int k = 1; k <= n; k++) {
                assign[k] = (mask & (1L << (k - 1))) != 0;
            }
            if (verify(f, assign)) return assign;  // verifier as the per-branch check
        }
        return null; // no certificate works => UNSAT
    }

    public static void main(String[] args) {
        // (x1 ∨ x2) ∧ (¬x1 ∨ x3) ∧ (¬x2 ∨ ¬x3)
        Formula f = new Formula(3, new int[][]{ {1, 2}, {-1, 3}, {-2, -3} });

        // Verifier: cheap, given a candidate certificate.
        boolean[] cand = { false, false, false, false }; // all false
        System.out.println("verify(all-false): " + verify(f, cand)); // false

        // Brute force: 2^n to FIND a witness (NTM simulation).
        boolean[] a = bruteForceSAT(f);
        if (a != null) {
            System.out.printf("SAT: x1=%b x2=%b x3=%b%n", a[1], a[2], a[3]);
        } else {
            System.out.println("UNSAT");
        }
    }
}
```

The structural lesson is in how the two pieces relate. `bruteForceSAT` *is* the NTM-as-deterministic-search: the NTM would **guess** one `mask` (one certificate) on a lucky branch; the deterministic program must **enumerate** all `2^n` of them, calling the *same* polynomial `verify` on each. NP is "there exists a good mask, checkable fast"; the exponential cost is entirely in the *search* for that mask, not in the *check*. If someone discovered a polynomial way to find the right mask without enumeration, that would be a step toward P = NP.

---

## Pitfalls

**1. "NP means non-polynomial."** No. NP is **N**ondeterministic **P**olynomial. P ⊆ NP — every polynomial-time problem is in NP. The class of "definitely not polynomial" problems is something else entirely (and we cannot even prove any NP-complete problem is non-polynomial — that *is* P vs NP).

**2. Conflating NP with NP-complete.** NP is a huge class; NP-complete problems are only its *hardest* members. Problems in P (like sorting, 2-SAT, shortest path) are in NP but are **not** NP-complete (unless P = NP). FACTORING is in NP but is **not believed** NP-complete. Saying "my problem is in NP" says almost nothing about its difficulty — most easy problems are in NP too.

**3. Forgetting input length is measured in bits.** An `O(N)` loop over an integer `N` is **exponential** in the input size `n = log N`. This is why "pseudo-polynomial" dynamic programs (e.g. SUBSET-SUM in `O(n·W)`) do *not* place NP-complete problems in P — `W` is exponential in its bit-length.

**4. Getting the reduction direction backwards.** `A ≤ₚ B` means "`A` reduces to `B`," i.e. `A` is **no harder than** `B`. To prove `B` is NP-hard you reduce a *known hard* problem **to** `B` (`known ≤ₚ B`), not `B` to something. Reversing the arrow proves nothing.

**5. Thinking the verifier gets to *find* the certificate.** The verifier is *given* the certificate for free and only checks it. The "hard" part — producing the witness — is hidden inside the existential `∃c`. A verifier that had to *search* for `c` would not be polynomial.

**6. Assuming NP is closed under complement.** P is closed under complement; NP is *not known* to be. That asymmetry is precisely the NP vs co-NP question. So `L ∈ NP` does **not** give you `L̄ ∈ NP`.

**7. Believing P ⊊ EXP "proves something is intractable."** The proven separation P ⊊ EXP does not tell you *which* NP problems are outside P — it only forces *some* inclusion in the chain to be strict. NP-completeness is *evidence*, not *proof*, of intractability; "NP-complete ⟹ no polynomial algorithm" is conditional on P ≠ NP.

---

## Summary

- The reference model is the **deterministic Turing machine**; **polynomial time** means `O(n^k)` steps for a fixed `k`, measured against the **bit-length** of the input. Polynomial time is robust across reasonable models and closed under composition, which is why it formalizes "tractable."
- Problems become **formal languages** (`L` = set of YES-instances). A problem's **decision, search, and optimization** versions are typically polynomial-time equivalent — decision via binary search gives optimization; **self-reducibility** (proven for SAT above) gives search from decision. So the decision-centric theory loses nothing.
- **P** = languages decidable in deterministic polynomial time. **NP** has two equivalent definitions: the **verifier** definition (`x ∈ L ⟺ ∃` short certificate `c`, `V(x,c)=1`, with `V` polynomial) and the **nondeterministic-TM** definition. They are equal because *nondeterminism = guess a certificate + verify it deterministically* — we sketched both directions.
- **co-NP** = complements of NP languages = short certificates for **NO**-answers (TAUTOLOGY, UNSAT). **NP vs co-NP** is open; proving them unequal would prove P ≠ NP. **NP ∩ co-NP** holds FACTORING and (pre-AKS) PRIMES — believed hard but *not* NP-complete (NP-completeness there would force NP = co-NP).
- Containments: `P ⊆ NP ⊆ PSPACE ⊆ EXP` and `P ⊆ co-NP ⊆ PSPACE`, all **known**. The only **proven strict** separation in the chain is **P ⊊ EXP** (Time Hierarchy Theorem), which forces *some* inclusion to be strict without revealing which. P = NP, NP = co-NP, NP = PSPACE are all **open**.
- **NP-completeness**: `B` is NP-complete iff `B ∈ NP` and every NP language reduces to `B` via `≤ₚ`. The keystone: **one** NP-complete problem in P collapses **P = NP**. We worked **3COL ∈ NP** by exhibiting its verifier. That NP-complete problems *exist* (Cook–Levin) and the **reduction zoo** are deferred to [reductions and NP-completeness](../07-reductions-and-np-completeness/middle.md); coping with hardness is [approximation and hardness](../08-approximation-and-hardness/middle.md).

Continue to the [senior level](./senior.md) for oracle/relativization barriers, the polynomial hierarchy, randomized classes (BPP, RP), and why proving P ≠ NP is so resistant. Back to the [junior level](./junior.md) for the ground-floor intuition, or to [time vs space complexity](../01-time-vs-space-complexity/middle.md) for the resource-measurement foundations these classes rest on.
