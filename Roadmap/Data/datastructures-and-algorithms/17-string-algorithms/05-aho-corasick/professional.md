# Aho-Corasick Multi-Pattern Matching — Mathematical Foundations and Complexity Theory

## Table of Contents
0. Overview and Reading Guide
1. Formal Definitions
2. The goto, fail, and output Functions
3. Correctness of the Failure Function (Longest Proper Suffix that is a Trie Prefix)
4. The BFS Construction and Its Correctness
5. Correctness of Output Links (Reporting All Matches)
6. The Automaton View: Determinization and the goto DFA
7. Linear-Time Search: Amortized Analysis
8. Total Complexity: Build is O(m·σ), Search is O(n + z)
9. Relation to KMP as the Single-Pattern Special Case
10. Lower Bounds and Optimality
11. The Failure Forest and Occurrence Counting
12. Summary

---

## 0. Overview and Reading Guide

This document gives the rigorous foundations of Aho-Corasick: the formal automaton, the correctness of the failure function as the longest proper suffix that is a trie prefix, the inductive correctness of the BFS construction, the output-link correctness for reporting all matches, the amortized linearity of the search, the total `O(m·σ + n + z)` complexity, the reduction to KMP in the single-pattern case, lower bounds, and the fail-tree counting structure. Each algorithmic claim is stated as a theorem with proof and a worked example. The throughline is a single idea: **the automaton's one-integer state losslessly tracks the longest matched suffix**, and everything — linearity, the failure recurrence, output reporting, counting — follows from formalizing that statement (Theorem 3.2). Readers comfortable with KMP (sibling `01-kmp`) will recognize the prefix-function specialized to a branching trie; readers comfortable with tries (sibling `07-tries`) will recognize the trie augmented into a deterministic automaton by suffix (failure) links.

---

## 1. Formal Definitions

Let `Σ` be a finite alphabet, `|Σ| = σ`. Let `P = {p₁, …, p_P}` be a set of nonempty patterns (the **dictionary**) and let `T = t₀t₁…t_{n-1} ∈ Σ*` be the text. Write `m = Σᵢ |pᵢ|` for the total pattern length and `n = |T|`.

**Definition 1.1 (Prefix set).** Let `Pref(P) = { w ∈ Σ* : w is a prefix of some pᵢ }`. The empty string `ε ∈ Pref(P)`.

**Definition 1.2 (Trie / Goto tree).** The trie of `P` is the rooted tree whose node set is exactly `Pref(P)`, with root `ε`, and an edge labeled `c ∈ Σ` from `w` to `wc` whenever `wc ∈ Pref(P)`. We identify each node with the string it spells; `S(u)` denotes that string and `|S(u)|` is the node's depth. There are at most `m + 1` nodes (one per distinct prefix, plus the root), and exactly `m` non-root nodes when no two patterns share a prefix.

**Definition 1.3 (Dictionary / output set).** A node `u` is **terminal** if `S(u) ∈ P` (some pattern ends exactly at `u`). The set of patterns ending at `u` is `Out₀(u) = { pᵢ : pᵢ = S(u) }`.

**Definition 1.4 (Occurrence).** Pattern `pᵢ` **occurs ending at** position `e` in `T` if `T[e−|pᵢ|+1 .. e] = pᵢ`. The output of the algorithm is the set of all `(i, e)` occurrence pairs; `z = |{(i, e)}|` is the number of occurrences.

**Remark.** The whole algorithm is the statement that the set of occurrences can be enumerated in `O(n + z)` after an `O(m·σ)` preprocessing, by reading `T` left to right exactly once and maintaining a single trie node.

**Notation conventions.** Throughout, `u, v, w` are trie nodes (= strings in `Pref(P)`); `c, a, b ∈ Σ` are characters; `r = ε` is the root; `δ` is the goto (transition) function; `f` is the failure function; depth means string length. `xy` denotes concatenation. A *proper* suffix of `w` is a suffix `≠ w`. We write `Suf(w)` for the set of suffixes of `w`.

**Lemma 1.5 (Prefix-closure of the node set).** `Pref(P)` is prefix-closed: if `w ∈ Pref(P)` then every prefix of `w` is in `Pref(P)`. Hence the trie of Definition 1.2 is well-formed — every node's parent (the string with its last character removed) is also a node, so the edge relation is total on non-root nodes.

**Proof.** If `w` is a prefix of some `pᵢ`, then any prefix `w'` of `w` is also a prefix of `pᵢ` (prefix of a prefix), so `w' ∈ Pref(P)`. ∎

**Lemma 1.6 (Node count bound).** The trie has at most `m + 1` nodes, with equality iff no two patterns share a nonempty prefix. In general the count is `1 + |Pref(P) \ {ε}|`, the number of distinct nonempty prefixes plus the root.

**Proof.** Each non-root node is a distinct nonempty prefix of some pattern; there are at most `Σᵢ |pᵢ| = m` such prefixes (pattern `pᵢ` contributes at most `|pᵢ|` of them), and shared prefixes are counted once. Adding the root gives `≤ m + 1`. ∎

---

## 2. The goto, fail, and output Functions

The Aho-Corasick machine is the triple `(δ, f, Out)`.

**Definition 2.1 (Goto / transition function `δ`).** `δ : Nodes × Σ → Nodes` is the *completed* transition function of the automaton, defined in Section 6. The *partial* trie transition `g(u, c)` returns the child `uc` if `uc ∈ Pref(P)`, and is undefined otherwise; `δ` extends `g` to a total function.

**Definition 2.2 (Failure function `f`).** For a non-root node `u`,

```
f(u) = the longest proper suffix of S(u) that belongs to Pref(P),
```

and `f(r) = r` by convention. Equivalently, `f(u)` is the deepest node `v ≠ u` with `S(v) ∈ Suf(S(u))`. Such a `v` always exists because `ε ∈ Pref(P)` is a suffix of every string, so the set of candidate suffix-prefixes is nonempty.

**Definition 2.3 (Output function `Out`).** The full output at a node is

```
Out(u) = { pᵢ ∈ P : pᵢ ∈ Suf(S(u)) },
```

every pattern that is a suffix of `S(u)`. The **dictionary suffix link** `out(u)` is the deepest terminal node strictly above `u` on the failure chain (Section 5), and `Out(u) = Out₀(u) ∪ Out(f(u))` decomposes it recursively.

These three definitions are purely about strings; the algorithm (Sections 4–6) is the claim that they can be *computed* efficiently and that scanning with them enumerates exactly the occurrences (Section 5, 7).

**Lemma 2.4 (Existence and uniqueness of `f`).** For every non-root node `u`, `f(u)` is well-defined and unique.

**Proof.** The set `{ w ∈ Suf(S(u)) : w ≠ S(u), w ∈ Pref(P) }` is nonempty (it contains `ε`) and finite (bounded by `|S(u)|`). A finite nonempty set of strings ordered by length has a unique longest element, *provided* no two distinct suffixes of `S(u)` share the same length — which holds because suffixes of a fixed string are totally ordered by length (each length gives exactly one suffix). Hence the maximum is unique. ∎

**Lemma 2.5 (Monotone depth along fail chains).** Iterating `f` from any node strictly decreases depth until reaching the root: `depth(u) > depth(f(u)) > depth(f²(u)) > … > depth(r) = 0`. Therefore every fail chain has length `≤ depth(u) ≤ max pattern length`, and the chain terminates.

**Proof.** `f(u)` is a *proper* suffix of `S(u)`, so `|S(f(u))| < |S(u)|`, i.e. depth strictly decreases. Depth is a non-negative integer, so the strictly decreasing sequence terminates, necessarily at `r` (the unique depth-0 node). ∎

---

## 3. Correctness of the Failure Function

The semantic anchor of Aho-Corasick is that the failure function tracks the **longest matched suffix** during the scan.

**Definition 3.1 (Scan state).** Define `state(j)` = the node spelling the **longest suffix of `T[0..j]` that lies in `Pref(P)`**. Set `state(−1) = r`.

**Theorem 3.2 (Invariant of the scan).** For every `j ≥ 0`, `state(j) = δ(state(j−1), t_j)`, where `δ` is the completed transition function. Consequently, maintaining a single node and applying `δ` per character keeps `state(j)` correct.

**Proof.** Let `u = state(j−1)`, so `S(u)` is the longest suffix of `T[0..j−1]` in `Pref(P)`. We must show the longest suffix of `T[0..j] = T[0..j−1]·t_j` in `Pref(P)` equals `δ(u, t_j)`.

Any suffix of `T[0..j]` ending in `t_j` has the form `w·t_j` where `w` is a suffix of `T[0..j−1]`. For `w·t_j ∈ Pref(P)`, we need `w ∈ Pref(P)` (every prefix of a prefix is a prefix) *and* `w·t_j ∈ Pref(P)` (i.e. `g(w, t_j)` defined). Among all suffixes `w` of `T[0..j−1]` in `Pref(P)`, the longest is `S(u)` and the rest are exactly the failure chain `S(u), S(f(u)), S(f²(u)), …, ε` (Lemma 3.3). The longest `w·t_j` in `Pref(P)` is obtained by taking the **first** node on that chain that has a child on `t_j`. That is precisely what `δ(u, t_j)` computes (Definition 6.1: `δ(u, c) = g(u,c)` if defined, else `δ(f(u), c)`). Hence `state(j) = δ(u, t_j)`. The empty suffix `ε` with `g(r, t_j)` (or the root self-loop) guarantees a defined result. ∎

**Lemma 3.3 (The failure chain enumerates suffix-prefixes).** For any node `u`, the set of suffixes of `S(u)` that lie in `Pref(P)` is exactly `{ S(u), S(f(u)), S(f²(u)), …, ε }`, listed in strictly decreasing length.

**Proof.** By Definition 2.2, `f(u)` is the longest *proper* suffix of `S(u)` in `Pref(P)`. Iterating, `f^{k+1}(u) = f(f^k(u))` is the longest proper suffix of `S(f^k(u))`. We show no suffix-prefix is skipped. Suppose `w` is a suffix of `S(u)` in `Pref(P)` with `|S(f^{k+1}(u))| < |w| < |S(f^k(u))|`. Since `w` is a suffix of `S(u)` shorter than `S(f^k(u))`, it is also a suffix of `S(f^k(u))` (suffixes of suffixes), and being in `Pref(P)` it is a *proper* suffix-prefix of `S(f^k(u))` longer than `f(f^k(u)) = f^{k+1}(u)` — contradicting the maximality of `f`. So the chain hits every suffix-prefix, in strictly decreasing length, terminating at `ε = S(r)`. ∎

This is the formal content of "fail links point to the longest proper suffix that is a trie prefix," and it is exactly KMP's prefix-function property specialized to a linear trie (Section 9).

### 3.1 Worked Invariant Trace

Patterns `{he, she, his, hers}`, text `ushers`. We track `state(j)` = longest suffix of `T[0..j]` in `Pref(P)`:

```
j=-1: state = ε (root)
j=0 'u': longest suffix-prefix of "u" = ε        → state = root
j=1 's': longest suffix-prefix of "us" = "s"      → state = node 7 (s)
j=2 'h': longest suffix-prefix of "ush" = "sh"    → state = node 8 (sh)
j=3 'e': longest suffix-prefix of "ushe" = "she"  → state = node 9 (she); Out={she, he}
j=4 'r': longest suffix-prefix of "usher" = "her" → state = node 5 (her); Out={}
j=5 's': longest suffix-prefix of "ushers"="hers" → state = node 6 (hers); Out={hers}
```

At `j=3`, `state(3) = she` and `Out(she) = {she, he}` because `he` is a suffix of `she` and terminal — both fire. At `j=4`, the transition from `she` on `r` is `δ(9,'r') = δ(f(9),'r') = δ(2,'r') = 5` (node `her`): the automaton silently followed the failure link from `she` to `he` to extend by `r`, exactly the invariant of Theorem 3.2 in action. The reported occurrences `she@3, he@3, hers@5` match the brute-force enumeration.

### 3.2 The Invariant Implies Correctness of the Whole Scan

Theorem 3.2 is the linchpin: it says the *single integer* `state(j)` losslessly summarizes everything about `T[0..j]` relevant to future matches — namely the longest currently-matched suffix. No other history is needed because a future pattern match ending at `e > j` depends only on a suffix of `T[0..e]`, and any such suffix in `Pref(P)` is a suffix of `S(state(e))`. This is the formal statement of the algorithm's **memorylessness** (one state, no backtracking buffer), which is what makes it online and `O(1)`-state — and what distinguishes the tractable walk/automaton view from intractable history-dependent matching.

---

## 4. The BFS Construction and Its Correctness

**Algorithm (build).**
```
BUILD(trie):
  for c in Σ:                       # depth-1 nodes
    if g(r, c) defined: f(g(r,c)) = r; enqueue(g(r,c))
    else: δ(r, c) = r
  while queue nonempty:
    u = dequeue()                   # processed in BFS (depth) order
    for c in Σ:
      v = g(u, c)
      if v defined:
        f(v) = δ(f(u), c)           # the failure recurrence
        Out(v) ∪= Out(f(v))         # merge dictionary suffix outputs
        enqueue(v)
      else:
        δ(u, c) = δ(f(u), c)        # complete the transition
```

**Theorem 4.1 (Construction correctness).** After `BUILD`, for every node `v`, `f(v)` equals the longest proper suffix of `S(v)` in `Pref(P)` (Definition 2.2), and `δ` is the total completed transition function (Definition 6.1).

**Proof (induction on depth `d = |S(v)|`, in BFS order).**

*Base `d = 1`.* A depth-1 node `v = g(r, c)` spells a single character `c`. Its only proper suffix is `ε = S(r)`, so `f(v) = r`, which the algorithm sets. ✓

*Inductive step.* Let `v = g(u, c)` with `S(v) = S(u)·c`, depth `d`. By BFS order, `u` (depth `d−1`) and every node of depth `< d` already have correct `f` and complete `δ`. We must show `δ(f(u), c)` is the longest proper suffix of `S(v)` in `Pref(P)`.

The proper suffixes of `S(v) = S(u)c` ending in `c` are exactly `w·c` for `w` a suffix of `S(u)`. For `w·c ∈ Pref(P)` we need `w ∈ Pref(P)` and `g(w, c)` defined. By Lemma 3.3 the suffixes of `S(u)` in `Pref(P)` are the failure chain of `u`, longest first: `S(u), S(f(u)), …`. But the longest *proper* suffix is `S(f(u))` (we exclude `S(u)` itself since `f(v)` must be proper, and `S(u)c·… ` — note `v` is itself the only node spelling `S(u)c`). The first chain element (starting at `f(u)`) with a `c`-child gives the longest valid `w·c`, and `δ(f(u), c)` returns exactly that first defined transition by Definition 6.1. Since `f(u)` and the `δ` of all shallower nodes are correct by hypothesis, `δ(f(u), c)` is computed correctly, and it equals `f(v)`. ✓

For the `else` branch, `δ(u, c) = δ(f(u), c)` is the definition of the completed transition, valid because `f(u)` is shallower and already finalized. By induction the theorem holds for all depths. ∎

**Why BFS is necessary.** `f(v)` and `δ(v, ·)` depend on `δ(f(u), ·)` where `f(u)` is strictly shallower than `v` (a proper suffix is shorter). Any processing order that touched `v` before all shallower nodes were finalized would read an undefined or stale transition. BFS by depth is the unique simple order guaranteeing all dependencies are ready — this is the formal reason the construction is a breadth-first sweep, not a DFS or insertion-order pass.

### 4.1 Worked Construction Trace

Take `P = {he, she, his, hers}` with the trie node numbering of `junior.md` (root `0`; `1=h, 2=he, 3=hi, 4=his, 5=her, 6=hers, 7=s, 8=sh, 9=she`). BFS processes nodes in depth order. We trace the failure recurrence `f(v) = δ(f(parent), c)`:

```
depth 1: f(1)=0  (h),  f(7)=0  (s)                       [root children → root]
depth 2: f(2)=δ(f(1),'e')=δ(0,'e')=0       (he  → ε)
         f(3)=δ(f(1),'i')=δ(0,'i')=0       (hi  → ε)
         f(8)=δ(f(7),'h')=δ(0,'h')=1       (sh  → h)      ← nontrivial
depth 3: f(4)=δ(f(3),'s')=δ(0,'s')=7       (his → s)
         f(5)=δ(f(2),'r')=δ(0,'r')=0       (her → ε)
         f(9)=δ(f(8),'e')=δ(1,'e')=2       (she → he)     ← suffix "he" is terminal!
depth 4: f(6)=δ(f(5),'s')=δ(0,'s')=7       (hers→ s)
```

The single line `f(9) = δ(f(8), 'e') = δ(1, 'e') = 2` captures the algorithm's power: after matching `she`, the longest proper suffix that is a trie prefix is `he`, and node 2 (`he`) is terminal, so the output of state 9 inherits `he`. The merged output `Out(9) = Out₀(9) ∪ Out(f(9)) = {she} ∪ {he} = {she, he}` — both fire when the scan reaches `she`. Every value used on the right-hand side (`f(8)=1`, `δ(1,'e')=2`) was finalized at a strictly shallower depth, confirming the BFS dependency order.

### 4.2 The Failure Recurrence as a Fixed Point

The recurrence `f(v) = δ(f(parent(v)), c)` is not merely a convenient formula — it is the unique solution of the suffix-link fixed-point equation. Define a candidate map `φ` on nodes by `φ(v) = δ(φ(p), c)` with `φ(r) = r`. Theorem 4.1 shows `φ = f`. Uniqueness follows because the equation is a well-founded recursion on depth: each `φ(v)` is determined by strictly shallower values, so by strong induction there is exactly one consistent assignment. The completed `δ` likewise satisfies `δ(u, c) = δ(f(u), c)` for missing edges, a coupled fixed point resolved in the same single BFS pass — the two functions `f` and `δ` are computed simultaneously precisely because each references the other only at shallower depth.

---

## 5. Correctness of Output Links (Reporting All Matches)

**Theorem 5.1 (Output completeness).** When the scan is at `state(e) = u` after reading `t_e`, the patterns occurring ending at position `e` are exactly `Out(u) = { pᵢ ∈ P : pᵢ ∈ Suf(S(u)) }`, and they are enumerated exactly once by walking the dictionary-suffix-link chain `u → out(u) → out(out(u)) → …`.

**Proof.** Pattern `pᵢ` occurs ending at `e` iff `pᵢ` is a suffix of `T[0..e]`. Since `S(u)` is the **longest** suffix of `T[0..e]` in `Pref(P)` (Theorem 3.2) and every pattern is in `Pref(P)`, `pᵢ` is a suffix of `T[0..e]` and in `Pref(P)` iff `pᵢ ∈ Suf(S(u))` — because any suffix of `T[0..e]` that is in `Pref(P)` is a suffix of the longest such, `S(u)`. Thus the occurrences ending at `e` are exactly `Out(u)`.

By Lemma 3.3, the suffixes of `S(u)` in `Pref(P)` are the failure chain. The **terminal** nodes on that chain are precisely the patterns in `Out(u)`. The dictionary suffix link `out(u)` is defined as the nearest terminal strictly above `u`, and chaining `out` visits each terminal ancestor exactly once, in decreasing length, with no repeats (the chain is strictly shortening). Hence the chain enumerates `Out(u)` exactly once each. ∎

**Corollary 5.2 (Merged-output equivalence).** Precomputing `Out(u) = Out₀(u) ∪ Out(f(u))` during BFS (Section 4) makes the per-position report a single traversal of the stored list, equivalent to walking `out`-links, and is correct because `Out(f(u))` is finalized before `u` in BFS order. The trade-off is `O(Σ_u |Out(u)|)` extra build space versus `out`-link chasing at scan time; the two report identical multisets of occurrences.

**Remark (why two link types are distinct).** `f(u)` is the *transition fallback* used to keep `state(j)` correct — it must be the single longest suffix-prefix. `out(u)` is the *reporting* shortcut that skips non-terminal chain nodes. Using `f` for reporting would force walking every chain node (including non-terminal ones), costing `O(|S(u)|)` per position in the worst case rather than `O(matches here)`.

### 5.1 Worked Output-Link Example

Patterns `{a, bca, caa, aa}`. Consider the node for `caa`. Its proper suffixes in `Pref(P)` are `aa` (terminal), `a` (terminal), `ε`. So `f(caa) = aa`, `f(aa) = a`, `f(a) = ε`. The `out`-chain from `caa` is:

```
caa  → out(caa) = aa   (terminal, report "aa")
aa   → out(aa)  = a    (terminal, report "a")
a    → out(a)   = none (a's only proper suffix-prefix is ε, not terminal)
```

So when the scan reaches `caa`, it reports `caa` (own output), then `aa`, then `a` — three patterns co-terminating at one position, enumerated in `O(3)` by following `out`-links, skipping no terminal and visiting no non-terminal. If we had instead walked the *failure* chain `caa → aa → a → ε`, the work would be the same here, but in general the failure chain can contain long runs of non-terminal nodes between matches; `out`-links collapse those runs, guaranteeing the per-position cost is proportional to matches reported, not chain length. This is the formal payoff of the dictionary-suffix link.

### 5.2 Output Multiset and Distinctness

If a pattern appears twice in the dictionary (duplicate), it must be reported twice (or its id list has two entries). `Out₀(u)` is therefore a *multiset* (or a list of ids), and the merge `Out₀(u) ⊎ Out(f(u))` is multiset union, preserving multiplicity. Distinctness of *positions* is automatic — each `(id, e)` pair is emitted once because the scan visits each position once and the `out`-chain has no repeats. The only multiplicity comes from genuinely duplicated patterns, which is the intended semantics.

---

## 6. The Automaton View: Determinization and the goto DFA

**Definition 6.1 (Completed transition).** The Aho-Corasick automaton is the DFA `M = (Q, Σ, δ, q₀, Acc)` where `Q = Pref(P)` (the trie nodes), `q₀ = r`, `Acc = { u : Out(u) ≠ ∅ }`, and

```
δ(u, c) = g(u, c)                if g(u, c) is defined (real trie edge)
δ(u, c) = δ(f(u), c)             otherwise
δ(r, c) = r                      if g(r, c) undefined.
```

`δ` is total (every state has a transition on every character) because the recursion terminates at the root, whose missing edges self-loop.

**Theorem 6.2 (M recognizes "ends with a pattern").** Running `M` on `T` and observing the state sequence `q₀, state(0), …, state(n−1)`, position `e` enters an accepting state iff some pattern occurs ending at `e`. More strongly, `state(e)` is the node whose `Out` set is the full set of patterns ending at `e` (Theorem 5.1).

**Proof.** Immediate from Theorem 3.2 (the state is the longest suffix-prefix after each char) and Theorem 5.1 (its `Out` set is exactly the patterns ending there). Acceptance `Out(state(e)) ≠ ∅` thus coincides with "a pattern ends at `e`." ∎

**Relation to NFA determinization.** The "goto + fail" pair is an NFA: from `u`, on `c`, take the real edge if present, else `ε`-move via `f` and retry. Completing `δ` is the textbook subset/`ε`-closure determinization specialized to this NFA, but it produces **no state blow-up**: the DFA has the same `|Pref(P)| ≤ m+1` states as the trie, because each fail chain is a path, not a branching set. This is why Aho-Corasick avoids the exponential blow-up generic NFA→DFA conversion can suffer — the structure of suffix links keeps the determinized state count linear in `m`.

### 6.1 Why the Subset Construction Collapses

In a generic NFA, a state of the determinized machine is a *set* of NFA states (the reachable subset), and there can be `2^{states}` such subsets. For the Aho-Corasick NFA the reachable subset after reading `T[0..j]` is always exactly `{ state(j), f(state(j)), f²(state(j)), …, r }` — the fail chain of a *single* node. Because every reachable subset is a fail chain, and a fail chain is determined by its deepest element, there is a bijection between reachable subsets and trie nodes. The determinized machine therefore has exactly `|Pref(P)|` reachable states, no more. This is a special property of suffix-link NFAs; it is the formal reason the construction is `O(m·σ)` and not exponential.

### 6.2 Acceptance and the Recognized Language

The DFA `M` with `Acc = { u : Out(u) ≠ ∅ }` recognizes the language `L = Σ* · P = { w : w ends with some pattern }` — all strings having a pattern as a suffix. Running `M` over `T` and recording every position whose state is accepting marks every occurrence *endpoint*. To recover full occurrences (with which patterns), the `Out` annotation supplies the pattern ids. Viewing it as a language-recognition DFA connects Aho-Corasick to the transfer-matrix / automaton path-counting methods (e.g. counting strings that *avoid* all patterns is counting walks that never enter an accepting state), a bridge to combinatorics on words and to sibling matrix-exponentiation techniques.

---

## 7. Linear-Time Search: Amortized Analysis

In the **lazy (NFA) form**, the scan does not precompute `δ`; instead, per character it may walk several failure links. We bound the *total* failure work across the whole scan.

**Theorem 7.1 (Amortized linear scan, lazy form).** Scanning `T` with the lazy automaton performs `O(n)` total failure-link traversals (plus `O(z)` for emitting matches), hence `O(n + z)` total.

**Proof (potential / depth argument).** Let `Φ = depth(current state) ≥ 0` be the potential. Reading a character either:
- **advances** via a real edge: `depth` increases by exactly 1, so `Φ` rises by 1; cost `O(1)`.
- **fails** one step: `depth` strictly *decreases* by at least 1 (since `f(u)` is shallower than `u`), so `Φ` drops by ≥ 1; this "pays" for the failure step.

Across the whole scan there are `n` advance operations, each raising `Φ` by at most 1, so the total increase of `Φ` is `≤ n`. Since `Φ ≥ 0` always and each failure step decreases `Φ` by ≥ 1, the total number of failure steps is `≤` total increase `≤ n`. Therefore advances + failures `≤ 2n = O(n)`. Emitting matches costs `O(z)`. Total `O(n + z)`. ∎

**Corollary 7.2 (Eager / DFA form).** With the completed `δ` (Section 6), each character is a single table lookup (`O(1)`), so the scan is `O(n)` transitions + `O(z)` emissions = `O(n + z)` with the best constant. The `O(n)` failure work of Theorem 7.1 has been pre-paid at build time, becoming part of the `O(m·σ)` construction.

This amortized argument is the multi-pattern generalization of the identical potential argument that proves KMP's scan is `O(n)` (Section 9).

### 7.1 Worst-Case Per-Character vs Amortized

A single character can trigger `Θ(depth)` failure steps in the lazy form — e.g. scanning text `aaaa…ab` against patterns engineered so the long run of `a`s climbs deep and the final `b` forces a long fall. Naively this looks like `O(n · maxdepth)`. The potential argument (Theorem 7.1) shows the *amortized* cost is `O(1)` per character: the deep climb that a single failure cascade unwinds was itself built up by that many prior advances, each of which already paid `O(1)`. The total is bounded by the total potential ever accumulated, which is `O(n)`. This is the textbook distinction between worst-case-per-operation (`Θ(depth)`) and amortized (`O(1)`) — the eager DFA form (Corollary 7.2) eliminates even the worst-case spike by pre-paying all failure work at build time, trading it for the `O(m·σ)` table.

### 7.2 Why Emission Is Separated from Transition

The `O(z)` emission term is deliberately additive and independent of the `O(n)` transition term. A position with no matches costs `O(1)` (one transition, empty output); a position ending `k` patterns costs `O(1 + k)`. Summing over all positions gives `O(n + Σ_e k_e) = O(n + z)`. This separation is what lets the *counting* variant (Section 11) drop the `z` term entirely: by never materializing the per-position outputs and instead aggregating landing frequencies over the fail tree, it pays `O(n)` for the scan and `O(m)` for the aggregation, regardless of how astronomically large `z` becomes.

---

## 8. Total Complexity: Build is O(m·σ), Search is O(n + z)

**Theorem 8.1 (Build complexity).** Constructing the trie, failure links, and completed transition table takes `O(m·σ)` time and `O(m·σ)` space with dense array children; `O(m)` time and space (plus an `O(σ)` factor hidden in map operations) with the lazy/map form.

**Proof.** The trie has `≤ m+1` nodes; insertion is `O(m)`. The BFS visits each node once and, for each, iterates over all `σ` characters to set `δ(v, ·)` and compute `f` for real children. That is `Σ_nodes σ = O(m·σ)` work. Each `δ(f(u), c)` is an `O(1)` table lookup (the dense array). Output merging copies `Out(f(u))` into `Out(u)`; summed over the BFS this is `O(Σ_u |Out₀(u)|·depth) = O(m + total reported terminals)` in the worst case, dominated by `O(m·σ)` or bounded separately if outputs are stored as links rather than merged lists. Space is the `m·σ` transition table. ∎

**Theorem 8.2 (Search complexity).** After building, reporting all occurrences in `T` takes `O(n + z)` time and `O(1)` working space (beyond the read-only automaton).

**Proof.** Eager form: `n` `O(1)` transitions (Corollary 7.2) plus `O(z)` emissions (Theorem 5.1 enumerates each occurrence once). Lazy form: `O(n)` amortized transitions (Theorem 7.1) plus `O(z)`. Either way `O(n + z)`. Working space is the single state integer (and an offset/counter), `O(1)`. ∎

**Theorem 8.3 (End-to-end).** Total time to match `P` patterns against `T` is `O(m·σ + n + z)`. With alphabet reduction to the `σ' ≤ σ` characters actually used, it is `O(m·σ' + n + z)`. This is independent of the **number** of patterns `P` beyond their total length `m` — the defining advantage over running a single-pattern matcher `P` times.

### 8.1 The Output-Merging Cost, Bounded Carefully

The one subtlety in Theorem 8.1 is the cost of merged outputs `Out(u) = Out₀(u) ∪ Out(f(u))`. Naively copying lists can be quadratic if many patterns nest as suffixes of one another (e.g. patterns `a, ba, cba, dcba, …`, where the deepest node's merged output has size `Θ(P)`). The total merged-output size is `Σ_u |Out(u)|`, which in the worst case is `Θ(m)` distinct (pattern, node) incidences but can blow up to `Θ(P · maxdepth)` if stored as fully materialized lists. Two clean fixes preserve linearity:

- **Store `out`-links, not merged lists.** Each node keeps a single pointer to the nearest terminal ancestor; reporting walks the `out`-chain at scan time. Build space is `O(m)`; report time is `O(matches)`, paid only when matches occur.
- **Report during the scan, never store.** Emit `Out₀` at each fail-chain node lazily. This is the lazy form and keeps build at `O(m·σ)` without the merge blow-up.

The choice is a space–time trade-off: merged lists give the fastest per-position report (one contiguous walk) at the risk of superlinear build space; `out`-links bound build space at `O(m)` at the cost of pointer chasing during reporting.

### 8.2 Worked Complexity Accounting

For `P = 10^4` patterns of average length 10 (`m = 10^5`), lowercase alphabet (`σ = 26`): the trie has ≤ `10^5 + 1` nodes; the dense transition table is `≈ 26 × 10^5 = 2.6 × 10^6` integers (~10 MB at 32-bit). Building is `2.6 × 10^6` `O(1)` operations. Scanning a `10^6`-character text is `10^6` array lookups plus `z` emissions. Running KMP per pattern instead would cost `≈ P · n = 10^4 × 10^6 = 10^{10}` character comparisons — four orders of magnitude more. The accounting makes the `P`-independence of the scan concrete.

---

## 9. Relation to KMP as the Single-Pattern Special Case

**Proposition 9.1.** For a single pattern `p` of length `ℓ` (`P = {p}`, `m = ℓ`), the Aho-Corasick trie is the **path** `r = u₀ → u₁ → … → u_ℓ`, where `u_k` spells `p[0..k−1]`. The failure function restricted to this path is exactly the KMP prefix function:

```
f(u_k) = u_{π[k]},   where π[k] = length of the longest proper prefix of p[0..k−1] that is also a suffix.
```

**Proof.** On a single-pattern path, `S(u_k) = p[0..k−1]`. By Definition 2.2, `f(u_k)` is the longest proper suffix of `p[0..k−1]` in `Pref({p})`. But `Pref({p})` is exactly the set of prefixes of `p`, so `f(u_k)` is the longest proper suffix of `p[0..k−1]` that is also a prefix of `p` — verbatim the KMP prefix-function value `π[k]`. The Aho-Corasick BFS recurrence `f(u_k) = δ(f(u_{k−1}), p[k−1])` reduces, on the path, to KMP's `π[k] = goto(π[k−1], p[k−1])`. ∎

**Corollary 9.2 (Algorithmic specialization).** Aho-Corasick search on a single pattern is KMP search: the automaton state is the count of matched characters, a failure step is a `π`-jump, and a terminal state at `u_ℓ` is a full match. Thus KMP (sibling `01-kmp`) is the `P = 1` instance, and Aho-Corasick is the genuine generalization "KMP over a trie of many patterns." The amortized `O(n)` scan (Theorem 7.1) is the same potential argument that proves KMP linear; the `O(m)` (here `O(ℓ)`) prefix-function build is the same BFS along a degenerate (linear) trie.

### 9.1 Worked KMP Equivalence

Take `p = ababa` (`ℓ = 5`). The trie is the path `0→1(a)→2(ab)→3(aba)→4(abab)→5(ababa)`. The KMP prefix function is `π = [0,0,1,2,3]` for prefixes of lengths 1..5. The Aho-Corasick failure links match exactly:

```
f(u₁)=0  (a:    no proper suffix-prefix)
f(u₂)=0  (ab:   "b" not a prefix)
f(u₃)=u₁ (aba:  longest suffix-prefix "a", length 1 = π[3])
f(u₄)=u₂ (abab: longest suffix-prefix "ab", length 2 = π[4])
f(u₅)=u₃ (ababa:longest suffix-prefix "aba", length 3 = π[5])
```

Scanning a text with this single-pattern automaton is byte-for-byte KMP: on a mismatch at `u_k`, the automaton jumps to `f(u_k) = u_{π[k]}`, exactly the KMP shift. This is the cleanest way to *see* that Aho-Corasick contains KMP: the branching trie collapses to a line and the suffix-link recurrence collapses to the prefix-function recurrence.

### 9.2 What the Generalization Adds

The single-pattern case has a *linear* fail chain (each node fails to exactly one shallower node on the same path). The multi-pattern case has a fail chain that can cross between different patterns' branches — `f(she-node) = he-node` jumps from the `s…` subtree to the `h…` subtree. This cross-branch jumping is precisely what lets one scan detect patterns from *different* branches sharing a suffix, and it is the structural feature absent from KMP. The output-link layer (Section 5) is also new: a single pattern has at most one match ending at each position, so KMP needs no dictionary-suffix links; multiple patterns can co-terminate, which is why Aho-Corasick adds them.

---

## 10. Lower Bounds and Optimality

**Theorem 10.1 (Search optimality).** Any algorithm that reports all `z` occurrences of the patterns in `T` must take `Ω(n + z)` time in the comparison model: `Ω(n)` to read the text (an unread character could hide or destroy a match), and `Ω(z)` to emit the occurrences. Hence Aho-Corasick's `O(n + z)` search is optimal.

**Proof.** Reading: if some `t_j` is never examined, an adversary can set it to create or remove an occurrence undetected, so all `n` characters must be read, `Ω(n)`. Emitting: the output has size `z`, requiring `Ω(z)` to write. The two are additive lower bounds. ∎

**Theorem 10.2 (Build space).** Storing a structure that answers `δ(u, c)` in `O(1)` for all `(u, c)` requires `Ω(m)` space (one must at least encode the `m` distinct prefixes / trie nodes). The dense table uses `Θ(m·σ)`; compressed representations (double-array, default transitions; see `senior.md`) approach `Θ(m)` while preserving near-`O(1)` lookup, so the `σ` factor is an implementation/space–time trade-off, not an inherent lower bound on the *information* `Ω(m)`. ∎

**Remark (counting vs reporting).** Counting all occurrences (Section 11) avoids the `Ω(z)` emission bound and runs in `O(n + m)` regardless of how large `z` is, because it never materializes individual occurrences. This separation — `O(n + z)` to report, `O(n + m)` to count — is the formal reason the counting variant exists.

### 10.1 How Large Can z Be?

The number of occurrences `z` is not bounded by `n`; it can be `Θ(n · √m)` or worse. Consider patterns `{a, aa, aaa, …, a^k}` (total length `m = Θ(k²)`) scanned against text `a^n`. At each of the `n` positions, every pattern of length `≤` the current prefix ends, so the position at index `i` contributes `min(i+1, k)` matches. Summing gives `z = Θ(n·k) = Θ(n√m)`. This shows the `Ω(z)` term in Theorem 10.1 is genuinely unbounded in `n` and is exactly why the counting variant (which is `O(n + m)`, independent of `z`) is indispensable for adversarial or highly self-similar inputs — and why a reporting service must treat `z` as attacker-controlled (`senior.md` §10.7).

### 10.2 Optimality Caveats and Models

Theorem 10.1's `Ω(n)` lower bound is in the model where the algorithm must certify the *absence* of matches in unread regions. Sublinear *expected* time is achievable for some inputs by Boyer-Moore-style skipping (Commentz-Walter is the multi-pattern Boyer-Moore-Horspool variant), which can skip characters when a mismatch guarantees no pattern can end nearby. Such methods beat `O(n)` in the average case for long patterns over large alphabets but have `O(n·maxlen)` worst case — Aho-Corasick's `O(n)` worst case is the guarantee they trade away. The choice between Aho-Corasick and Commentz-Walter is therefore worst-case-linear-guarantee versus average-case-sublinear-hope.

---

## 11. The Failure Forest and Occurrence Counting

**Definition 11.1 (Failure forest / tree).** Since `f(u)` is strictly shallower than `u` for every non-root `u`, and `f(r) = r`, the relation `u → f(u)` defines a tree rooted at `r` (the **fail tree**, or **suffix-link tree**). `v` is an ancestor of `u` in this tree iff `S(v) ∈ Suf(S(u))`.

**Theorem 11.2 (Subtree-sum counting).** Let `cnt₀(u)` = number of positions `e` with `state(e) = u` (raw landing counts from the scan). Then for any node `w`,

```
occ(w) := Σ_{u in fail-subtree of w} cnt₀(u)
```

equals the number of text positions `e` such that `S(w) ∈ Suf(S(state(e)))`. If `w` is terminal for pattern `pᵢ`, then `occ(w)` is exactly the number of occurrences of `pᵢ` in `T`.

**Proof.** By Theorem 5.1, `pᵢ = S(w)` occurs ending at `e` iff `S(w) ∈ Suf(S(state(e)))`, i.e. iff `w` is an ancestor of `state(e)` in the fail tree (Definition 11.1), i.e. iff `state(e)` lies in the fail-subtree of `w`. Summing the landing counts over that subtree counts exactly those positions. ∎

**Corollary 11.3 (Linear counting).** Computing `occ(w)` for all `w` is a single subtree-sum over the fail tree, done by processing nodes in **reverse BFS order** (children before parents) with `cnt₀[f(u)] += cnt₀[u]`. With the `O(n)` scan to gather `cnt₀`, the total is `O(n + m)`, independent of `z`. ∎

This is the formal justification for the counting algorithm in [`middle.md`](./middle.md): the fail tree is the suffix-link tree, and occurrence counts are subtree sums of landing frequencies.

### 11.1 Worked Counting Trace

Patterns `{a, aa}`, text `aaaa`. The trie is `0 →a→ 1 (a*) →a→ 2 (aa*)`. Failure links: `f(1)=0`, `f(2)=1`. The fail tree is `0 ← 1 ← 2` (a path). Scanning `aaaa` lands the state as: position 0 → state 1, positions 1,2,3 → state 2 (since `aa` keeps matching). Raw landing counts:

```
cnt₀[1] = 1   (only position 0)
cnt₀[2] = 3   (positions 1, 2, 3)
```

Process in reverse BFS order (deepest first): push `cnt₀[2]` to its fail parent `1`: `cnt₀[1] += cnt₀[2]` → `cnt₀[1] = 1 + 3 = 4`. Now `occ(a) = cnt₀[1] = 4` and `occ(aa) = cnt₀[2] = 3`. Both correct: `a` occurs at ends 0,1,2,3 (four times); `aa` at ends 1,2,3 (three times). No individual occurrence was enumerated — the `z = 7` matches were counted by two subtree sums.

### 11.2 The Fail Tree as a Generalized Suffix-Link Tree

The fail tree coincides with the **suffix-link tree** of the set of trie strings: `f(u)` is the longest proper suffix of `S(u)` present as a node, so ancestors in the fail tree are exactly the suffix-nodes of `S(u)`. This identifies Aho-Corasick's counting structure with the suffix-automaton / suffix-tree machinery used elsewhere in string processing: occurrence counting is a subtree (or weighted-ancestor) query in both. The practical upshot is that any "for each pattern, aggregate something over the positions where it ends" query — count, first/last position, set of containing documents — reduces to a tree aggregation over the fail tree, computable in one reverse-BFS pass. This is why the fail tree, not the raw automaton, is the right object for the whole family of counting/locating variants.

### 11.3 Beyond Counting: Weighted and Document Queries

Replace the scalar `cnt₀` with any monoid value and the same subtree sum computes the corresponding aggregate: a *set* of document ids gives "which documents contain each pattern" (set union up the tree); a *min* gives the earliest end position; a *count of distinct documents* gives document frequency for an inverted-index-style query. The only requirement is that the aggregation operator be associative and commutative so the reverse-BFS fold is well-defined. This generality is the formal reason Aho-Corasick underlies multi-keyword search engines and bibliographic indexing — its original 1975 application.

---

## 11b. Invariants, Variants, and Equivalences

This section collects the structural invariants a correct implementation must maintain, the standard variants, and their formal equivalences — useful both as a verification checklist and as a map of the design space.

### 11b.0 Why the Invariants Are Worth Stating

Each invariant below corresponds to a theorem proved earlier *and* to a specific bug that violating it produces. In a verified implementation, these become runtime assertions (in tests) or static arguments (in proofs of correctness). They are stated together because, empirically, every real Aho-Corasick defect traces to violating exactly one of them — making the list a complete diagnostic checklist. The pattern recurs across string algorithms: a small set of local invariants on a preprocessed structure implies global correctness of the linear scan.

### 11b.1 Implementation Invariants (proof obligations)

A correct automaton satisfies all of the following; each is a theorem proved above, restated as a checkable invariant.

- **I1 (root self-link).** `f(r) = r`. Without it the failure recursion has no base and Lemma 3.3's termination fails.
- **I2 (shallower fail).** For non-root `u`, `depth(f(u)) < depth(u)`. This makes `u → f(u)` a tree (Definition 11.1) and underlies the BFS order (Section 4) and the potential argument (Section 7).
- **I3 (totality of δ).** `δ(u, c)` is defined for all `(u, c)` (Definition 6.1), via the root self-loop on missing edges. A violated I3 is the classic crash on the first unmatched character.
- **I4 (suffix-prefix maximality).** `S(f(u))` is the *longest* proper suffix of `S(u)` in `Pref(P)` (Definition 2.2, Theorem 4.1). A merely-some-suffix link would still terminate but would miss intermediate matches.
- **I5 (output completeness).** `Out(u) = Out₀(u) ∪ Out(f(u))` (Corollary 5.2). Violating it (forgetting the union) is the overlap-miss bug.

### 11b.2 Eager vs Lazy Equivalence

**Proposition 11b.6.** The eager (precomputed `δ`) and lazy (failure-walk) automata produce identical state sequences `state(0), …, state(n−1)` on any text, hence identical match sets.

**Proof.** Both compute `state(j) = δ(state(j−1), t_j)` (Theorem 3.2). The lazy form computes `δ(u, c)` on demand by walking `u, f(u), f²(u), …` until a real `c`-edge (or root) is found; the eager form stored exactly that result during BFS (the `else` branch of Section 4). The values are equal by construction, so the state sequences coincide. ∎

The only difference is *when* the failure work is done: build time (eager, `O(m·σ)` table) versus scan time (lazy, `O(n)` amortized, `O(m)` table). This is a pure time–space trade-off with identical semantics, formalizing the `senior.md` discussion of DFA vs NFA form.

### 11b.3 Counting–Reporting Equivalence

**Proposition 11b.7.** The reporting algorithm (walk `out`-links per position) and the counting algorithm (fail-tree subtree sums) agree: for each pattern `pᵢ`, the number of `(i, e)` pairs reported equals `occ(end-node of pᵢ)`.

**Proof.** Reporting emits `pᵢ` at position `e` iff `end-node(pᵢ) ∈ out`-chain of `state(e)` iff `end-node(pᵢ)` is a terminal ancestor of `state(e)` in the fail tree (Theorem 5.1). The number of such `e` is `|{e : state(e) in fail-subtree of end-node(pᵢ)}| = occ(end-node(pᵢ))` (Theorem 11.2). ∎

This closes the loop: reporting and counting are two evaluations of the same fail-tree ancestor relation — one enumerates the pairs (`O(n + z)`), the other sums them (`O(n + m)`).

---

## 11c. The Original goto/fail/output Formulation and Avoidance Counting

### 11c.1 The 1975 three-function machine

Aho and Corasick's original presentation defines three functions explicitly rather than a single completed `δ`: the partial **goto** `g` (real trie edges, with `g(r, c) = r` for missing root edges only), the **failure** `f`, and the **output**. The search loop is:

```
SEARCH(T):
  s := r
  for j in 0..n-1:
    while g(s, t_j) is undefined: s := f(s)   # follow failures
    s := g(s, t_j)
    for each pattern p in output(s): report (p, j)
```

This is the **lazy** form (Section 7): the `while` loop walks failures at scan time. Theorem 7.1 bounds the total `while`-iterations by `O(n)`. The *completed* `δ` of Section 6 is the optimization that absorbs the `while` loop into a precomputed table — historically a later refinement, but semantically identical (Proposition 11b.6). Stating the algorithm with three separate functions makes the failure mechanism explicit and is the form in which the original `O(n + m + z)` bound was proved.

### 11c.2 Counting strings that avoid all patterns

A dual problem with a clean automaton characterization: *count strings of length `L` over `Σ` that contain none of the patterns as a substring.* Build the Aho-Corasick DFA, mark every accepting state (those with nonempty `Out`) and every state whose fail-ancestors include an accepting state as **dead** (a pattern has occurred). A length-`L` string avoids all patterns iff its run never enters a dead state. The count is the number of length-`L` walks in the automaton restricted to live states, starting at the root:

```
avoid(L) = Σ_{live states q} (number of length-L walks root ⇝ q over live states)
```

This is a transfer-matrix computation: let `B` be the `|live| × |live|` transition-count matrix over live states; then `avoid(L) = (row of B^L for the root) summed over live columns`. Powering `B` by binary exponentiation gives `avoid(L)` for astronomically large `L` in `O(|live|³ log L)` — connecting Aho-Corasick directly to the matrix-exponentiation walk-counting machinery. The forbidden-substring counting problem is thus solved by composing this topic with fixed-length walk counting, a standard competitive-programming and combinatorics-on-words technique.

### 11c.3 Why the dead-state reduction is correct

**Proposition 11c.1.** A string `w` contains some pattern as a substring iff the automaton run on `w` enters an accepting state at some prefix.

**Proof.** `w` contains `pᵢ` iff `pᵢ` is a suffix of some prefix `w[0..e]` of `w`, iff `state(e)` has `pᵢ ∈ Out(state(e))` (Theorem 5.1), iff `state(e)` is accepting. So "contains a pattern" ⟺ "visits an accepting state." Marking accepting states (and propagating via `Out`) as dead and forbidding them is therefore exactly "avoid all patterns." ∎

Once a run hits a dead state it can never matter again (the substring already occurred), so collapsing all dead states into one absorbing sink does not change `avoid(L)` and shrinks the transfer matrix — the same state-minimization lever discussed in `senior.md`.

### 11c.4 Worked Avoidance Example

Patterns `{aa}` over `Σ = {a, b}`. The trie: `0 →a→ 1 (a) →a→ 2 (aa*)`. Failure: `f(1) = 0`, `f(2) = 1`. Completed transitions: `δ(0,a)=1, δ(0,b)=0, δ(1,a)=2, δ(1,b)=0, δ(2,·)=` dead (accepting). Live states are `{0, 1}`. The live transition-count matrix over `{0, 1}` (rows = from, columns = to, counting characters that stay live):

```
        to 0   to 1
from 0 [  1     1  ]   (b stays at 0; a goes to 1)
from 1 [  1     0  ]   (b returns to 0; a would reach dead state 2 — excluded)
```

`avoid(L)` = sum of row-0 of `B^L`. `B = [[1,1],[1,0]]` is the Fibonacci matrix, so `avoid(L) = F_{L+2}` — the count of binary strings of length `L` with no `aa`, the classic Fibonacci result. This concretely shows Aho-Corasick's automaton feeding a matrix-exponentiation walk count, and it is the same `[[1,1],[1,0]]` transfer matrix that the sibling fixed-length-walks topic studies.

---

## 12. Summary

- **Definitions.** The trie nodes are exactly the prefixes `Pref(P)`; `f(u)` is the longest proper suffix of `S(u)` in `Pref(P)`; `Out(u)` is every pattern that is a suffix of `S(u)`.
- **Failure correctness (Section 3).** The scan invariant — `state(j)` is the longest suffix of `T[0..j]` in `Pref(P)`, and `state(j) = δ(state(j−1), t_j)` — is the semantic anchor; the failure chain enumerates all suffix-prefixes in decreasing length (Lemma 3.3).
- **BFS construction (Section 4).** `f(v) = δ(f(parent), c)`, proved correct by induction on depth; BFS order is forced because `f(v)` depends on strictly shallower nodes.
- **Output correctness (Section 5).** Patterns ending at `e` are exactly the terminal nodes on `state(e)`'s failure chain; the dictionary-suffix-link chain (or merged `Out`) enumerates them once each.
- **Automaton view (Section 6).** Completing `δ` determinizes the goto+fail NFA into a DFA with no state blow-up — still `≤ m+1` states — because suffix links are paths, not branching sets.
- **Linear search (Section 7).** A potential argument on state depth bounds total failure work by `O(n)` (lazy form), or `O(1)` per char (eager DFA), giving `O(n + z)` — the same amortized argument that proves KMP linear.
- **Complexity (Section 8).** Build `O(m·σ)` (or `O(m·σ')` with alphabet reduction), search `O(n + z)`, independent of the pattern *count* `P`.
- **KMP specialization (Section 9).** On one pattern the trie is a path and `f` is exactly the KMP prefix function; Aho-Corasick is "KMP over a trie."
- **Optimality (Section 10).** Search is `Ω(n + z)`-optimal; counting sidesteps `Ω(z)` to run in `O(n + m)`.
- **Fail tree (Section 11).** `u → f(u)` is the suffix-link tree; occurrence counts are subtree sums of landing frequencies, computable in `O(n + m)`.

### Complexity Cheat Table

| Task | Time | Space | Tight? |
|------|------|-------|--------|
| Build trie | `O(m)` | `O(m)` | `Ω(m)` |
| Build fail + complete δ (dense) | `O(m·σ)` | `O(m·σ)` | `Ω(m)` info; `σ` is space–time trade-off |
| Build (lazy/map) | `O(m)` expected | `O(m)` | — |
| Report all occurrences | `O(n + z)` | `O(1)` working | `Ω(n + z)` optimal |
| Count all occurrences | `O(n + m)` | `O(m)` | avoids `Ω(z)` |
| Single pattern (= KMP) | `O(ℓ + n)` | `O(ℓ)` | optimal |

### Closing Notes

- **Failure = longest suffix-prefix** (Section 3) is the one fact that makes everything else follow; it is KMP's prefix-function property generalized from a string to a branching trie.
- **BFS by depth** (Section 4) is mathematically forced by the suffix (shorter-string) dependency of `f` and `δ`.
- **Two link types** (Section 5): `f` keeps the scan state correct; `out` reports matches efficiently — conflating them costs correctness or a linear factor per position.
- **No determinization blow-up** (Section 6) distinguishes this from generic NFA→DFA: the linear suffix-link structure caps states at `O(m)`.
- **Counting via the fail tree** (Section 11) trades the `Ω(z)` reporting bound for an `O(n + m)` subtree sum.
- **Avoidance counting** (Section 11c) composes the automaton with fixed-length walk counting: a transfer matrix over live states, powered to `L`, counts strings of length `L` that contain no pattern — linking this topic to matrix exponentiation.
- **Implementation invariants** (Section 11b): root self-link, shallower-fail, total `δ`, suffix-prefix maximality, and output completeness are the five proof obligations a correct automaton must satisfy; each maps to a theorem and a classic bug class.

### The one-sentence theory

`(δ, f, Out)` is the determinization of the suffix-link NFA of `Pref(P)`; its single-integer state losslessly tracks the longest matched suffix, making multi-pattern matching online, linear (`O(n + z)`), and optimal — with KMP the `P = 1` degenerate case and the fail tree the suffix-link tree underlying all counting/locating variants.

### Connections to Sibling Topics

- **KMP (`01-kmp`).** The single-pattern special case (Section 9): the trie degenerates to a path and `f` becomes the prefix function. Aho-Corasick is its multi-pattern generalization, and the linear-scan proof is the identical potential argument.
- **Tries (`07-tries`).** The base data structure (Section 1): Aho-Corasick is a trie augmented with failure and output links to become a deterministic automaton. Every node-count and prefix-sharing fact about tries carries over verbatim.
- **Fixed-length walk counting (matrix exponentiation).** The avoidance-counting reduction (Section 11c) feeds the live-state transfer matrix to binary exponentiation, computing the number of length-`L` strings avoiding all patterns in `O(|live|³ log L)`.
- **Suffix structures.** The fail tree is the suffix-link tree (Section 11.2); occurrence counting is a subtree/ancestor query, the same primitive used over suffix trees and suffix automata.

These connections are why Aho-Corasick is a hub topic in string algorithms: it sits at the intersection of prefix structures (tries), the single-pattern theory (KMP), and the algebraic counting machinery (transfer matrices).

### A Note on Proof Strategy

Almost every theorem here was proved by **induction on string length / trie depth**, reflecting the recursive structure of the failure function (a node's properties depend only on strictly shallower nodes). This is not incidental: the entire algorithm is correct *because* the suffix relation is a well-founded partial order on `Pref(P)`, and BFS is the topological sort that respects it. When extending Aho-Corasick (weighted outputs, approximate variants, compressed automata), the same depth-induction template applies — establish the invariant at the root, show it is preserved when extending by one character through the failure recurrence, and linearity plus correctness follow. Keeping this template in mind turns the seemingly intricate construction into a routine structural induction.

### Open Directions and Extensions

- **Dynamic dictionaries.** The static automaton forces rebuilds on insertion; persistent/dynamic variants (e.g. maintaining a logarithmic collection of automata, à la the static-to-dynamic transformation) support incremental updates at an `O(log)` amortized factor, at the cost of querying several structures per scan.
- **Approximate matching.** Combining Aho-Corasick with the dynamic-programming edit-distance recurrence yields multi-pattern approximate matching; the automaton supplies the exact-match backbone over which a small error budget is tracked.
- **Compressed and external-memory automata.** Double-array tries and succinct encodings (Section 10.2, `senior.md`) push the `Θ(m·σ)` table toward the `Ω(m)` information lower bound while preserving near-`O(1)` lookup, enabling billion-edge automata on disk via `mmap`.

Each of these builds on the same `(δ, f, Out)` core proved correct above; the foundations in this document are exactly what a correctness proof of any extension must preserve.

Foundational references: Aho & Corasick (1975), *Efficient string matching: an aid to bibliographic search* (CACM); Knuth, Morris & Pratt (1977) for the single-pattern prefix function; Crochemore & Rytter, *Jewels of Stringology*; Gusfield, *Algorithms on Strings, Trees, and Sequences*; Aoe (1989) for double-array tries. Sibling topics: `01-kmp` (single-pattern special case) and `07-tries` (the underlying data structure).
