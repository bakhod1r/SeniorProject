# Suffix Automaton — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The endpos Equivalence and Its Properties
3. The Structure of a State: Contiguous Lengths
4. The Suffix-Link Tree
5. The State-Count Bound (≤ 2n − 1)
6. The Transition-Count Bound (≤ 3n − 4)
7. The Online Construction: Correctness
8. Amortized O(n) Analysis of `extend`
9. The Clone/Split Case Analysis
10. Distinct-Substring Formula (Proof)
11. Occurrence Counts via endpos Sizes (Proof)
12. Minimality and the Relation to the Suffix Tree
13. Summary

---

## 1. Formal Definitions

Let `s = s[0..n-1]` be a string of length `n` over an alphabet `Σ` of size `σ`.

**Definition 1.1 (Substring, suffix, prefix).** A **substring** is any contiguous slice `s[i..j]` (`0 ≤ i ≤ j < n`), together with the empty string `ε`. A **suffix** is a substring `s[i..n-1]`; a **prefix** is `s[0..j]`.

**Definition 1.2 (endpos).** For a nonempty substring `t` occurring in `s`, define its **end-position set**

```
endpos(t) = { i : s[i - |t| + 1 .. i] = t,  0 ≤ i < n }    (the right endpoints of occurrences).
```

By convention `endpos(ε) = {-1, 0, 1, …, n-1}` (the empty string ends "before" every position; the exact convention only affects the root state, which carries `ε`).

**Definition 1.3 (Suffix automaton).** The **suffix automaton** `SA(s)` is the deterministic finite automaton with the fewest states that accepts exactly the set of suffixes of `s`. Its states, transitions, initial state `t0`, and accepting (terminal) set are characterized constructively below; Section 12 confirms it is the unique minimal DFA.

**Definition 1.4 (endpos-equivalence).** Two substrings `u, w` are **endpos-equivalent**, written `u ≡ w`, iff `endpos(u) = endpos(w)`. The equivalence classes of `≡` are exactly the **states** of `SA(s)` (the root additionally carrying `ε`).

**Notation.** Throughout, `n = |s|`, `σ = |Σ|`. For a state `v`, `len(v)` is the length of the **longest** substring in `v`'s class, `link(v)` its suffix link (Definition 4.1), `t0` the initial state with `len(t0) = 0`, `link(t0) = ⊥`. The longest string of class `v` is denoted `long(v)`; the shortest, `short(v)`.

**Definition 1.5 (Terminal states).** A state `v` is **terminal** (accepting) iff its class contains a suffix of `s`. Operationally, the terminal states are exactly those on the suffix-link chain from the final whole-prefix state `last` to the root. The DFA `SA(s)` accepts a string `x` iff the walk from `t0` spelling `x` ends in a terminal state; it *recognizes `x` as a substring* iff the walk merely survives (regardless of terminality). These two notions — acceptance (suffix) versus survival (substring) — must be kept distinct.

**Remark (why both notions matter).** The suffix automaton is, by Definition 1.3, an automaton for the *suffix* language; terminality encodes that language. But its most common use is *substring* recognition, which ignores terminality. The same machine serves both because every substring is a prefix of some suffix (so it is spelled by a surviving walk) while only suffixes themselves reach an accepting state. This dual reading is the source of both the SAM's power and a frequent implementation bug (conflating the two).

---

## 2. The endpos Equivalence and Its Properties

The whole theory rests on three lemmas about endpos sets.

**Lemma 2.1 (Suffix containment).** For two substrings `u, w` with `|u| ≤ |w|`:
- if `u` is a suffix of `w`, then `endpos(w) ⊆ endpos(u)`;
- otherwise `endpos(w) ∩ endpos(u) = ∅`.

**Proof.** If `u` is a suffix of `w`, every occurrence of `w` ending at position `i` contains an occurrence of `u` ending at the same `i` (the last `|u|` characters of that occurrence are `u`). Hence `endpos(w) ⊆ endpos(u)`. If `u` is **not** a suffix of `w`, suppose some position `i ∈ endpos(w) ∩ endpos(u)`. Then both `w` and `u` end at `i`, so each equals the substring of `s` ending at `i` of its own length; since `|u| ≤ |w|`, `u` is the length-`|u|` suffix of that occurrence of `w`, i.e. `u` *is* a suffix of `w` — contradiction. Hence the intersection is empty. ∎

**Corollary 2.2 (Laminar family).** The collection `{ endpos(t) : t a substring of s }` is a **laminar family**: any two sets are either nested or disjoint. (Two endpos-equal substrings give the same set.)

**Lemma 2.3 (Class = set of suffixes).** If `u ≡ w` with `|u| < |w|`, then `u` is a suffix of `w`. Consequently every endpos class consists of strings that are pairwise suffix-related, i.e. they are the suffixes of `long(v)` of certain lengths.

**Proof.** `endpos(u) = endpos(w) ≠ ∅`, so they are not disjoint; by Lemma 2.1 (contrapositive) the shorter `u` must be a suffix of `w`. ∎

These three facts are the engine: endpos sets nest (Cor. 2.2), and within a class the strings are nested suffixes (Lemma 2.3). Everything else is bookkeeping over this structure.

### 2.1 Worked endpos Example

Take `s = "abcbc"` (positions `1..5`, 1-indexed end positions):

```
endpos("a")   = {1}
endpos("b")   = {2, 4}
endpos("c")   = {3, 5}
endpos("ab")  = {2}
endpos("bc")  = {3, 5}
endpos("cb")  = {4}
endpos("abc") = {3}
endpos("bcb") = {4}
endpos("cbc") = {5}
...
```

Observe the equivalence: `endpos("c") = endpos("bc") = {3,5}`, so `"c"` and `"bc"` share a state — this is the clone created in Section 9.1. Meanwhile `endpos("b") = {2,4}` differs from both, so `"b"` lives in a different state. Notice the **laminar** structure: `{3} = endpos("abc") ⊂ {3,5} = endpos("bc")`, and `{2} ⊂ {2,4}` — every pair is nested or disjoint, never partially overlapping. This is Corollary 2.2 made tangible.

### 2.2 The Count of endpos Classes

**Proposition 2.4.** The number of distinct endpos classes (states minus the implicit handling of `ε`) is at most `2n − 1`, and this is exactly the number of states the SAM materializes (Section 5).

**Proof idea.** By Corollary 2.2 the endpos sets form a laminar family over the ground set `{0, …, n-1}`. A laminar family over an `n`-element ground set in which every set is nonempty has at most `2n − 1` distinct members (a classic bound: it is the maximum number of nodes in a forest whose leaves are the `n` singletons). Each SAM state is one such class, so the state count inherits the `2n − 1` ceiling — a second, set-theoretic derivation of the bound proven constructively in Section 5. ∎

This laminar-family viewpoint is the cleanest *non-constructive* reason the SAM is linear-size: it is forced by the combinatorics of end-position sets, independent of any particular build order.

---

## 3. The Structure of a State: Contiguous Lengths

**Theorem 3.1 (Contiguous length interval).** Fix a state (endpos class) `v`. The set of lengths `{ |t| : t ∈ v }` is a contiguous integer interval. Writing `len(v) = max` length and `minlen(v) = min` length, the class is exactly the suffixes of `long(v)` of lengths `minlen(v), minlen(v)+1, …, len(v)`.

**Proof.** By Lemma 2.3 all strings in `v` are suffixes of `long(v)`. Suppose lengths `a < b` both occur in `v` (so the length-`a` and length-`b` suffixes of `long(v)` are in `v`), and take any `a < c < b`. The length-`c` suffix `w_c` of `long(v)` satisfies: `w_b ⊆`-end `w_c ⊆`-end `w_a` as suffixes, so by Lemma 2.1, `endpos(w_a) ⊇ endpos(w_c) ⊇ endpos(w_b)`. But `endpos(w_a) = endpos(w_b) = endpos(v)`, so the middle is squeezed to equality: `endpos(w_c) = endpos(v)`, i.e. `w_c ∈ v`. Hence the lengths form an interval. ∎

**Definition 3.2 (Why `minlen(v) = len(link(v)) + 1`).** Anticipating Section 4, the shortest string of `v` has length one more than the longest string of the class reached by the suffix link. This is what makes the **per-state distinct-substring count** equal to `len(v) − len(link(v))` (Section 10).

**Lemma 3.3 (The boundary is exactly where endpos grows).** Let `w = long(v)` and consider its suffixes of decreasing length `len(v), len(v)−1, …, 1`. Their endpos sets are non-decreasing (Lemma 2.1). The first length at which the endpos set *strictly grows* beyond `endpos(v)` is `len(link(v))`; for all lengths in `(len(link(v)), len(v)]` the endpos set equals `endpos(v)`. Hence `minlen(v) = len(link(v)) + 1`.

**Proof.** As we shorten `w` from the front, each shorter suffix `u` satisfies `endpos(w) ⊆ endpos(u)` (Lemma 2.1). The set `endpos(u)` can only stay equal or grow. It stays equal exactly while `u` remains endpos-equivalent to `w`, i.e. `u ∈ v`, which by Theorem 3.1 is the contiguous top of the length range. The first strict growth marks entry into a coarser class — by Definition 4.1 that class is `link(v)`, whose longest string has length `len(link(v))`. So the smallest length still in `v` is `len(link(v)) + 1`. ∎

This lemma is the linchpin connecting Sections 3, 4, and 10: it certifies that the suffix link's `len` is precisely the lower boundary of `v`'s length interval, which is why subtracting `len(link(v))` counts `v`'s substrings exactly.

---

## 4. The Suffix-Link Tree

**Definition 4.1 (Suffix link).** For a non-root state `v`, let `w = long(v)`. Consider the suffixes of `w` of decreasing length. By Lemma 2.1 their endpos sets only grow as the suffix shortens. The **suffix link** `link(v)` is the state of the **longest suffix of `w` whose endpos set strictly contains `endpos(v)`** (equivalently, the longest proper suffix lying in a different class). Define `link(t0) = ⊥`.

**Theorem 4.2 (Links form a tree).** The relation `v ↦ link(v)` defines a tree rooted at `t0`, and `len(link(v)) < len(v)` for every `v ≠ t0`.

**Proof.** `link(v)` is a strictly shorter string's class (it is a proper suffix in a different class), so `len(link(v)) < len(v)`; the strictly decreasing `len` precludes cycles. Every chain of links decreases `len` and therefore terminates at `t0` (the only state with `len = 0`). A function with a unique sink and no cycles on a finite set is a tree rooted at that sink. ∎

**Theorem 4.3 (endpos nesting = ancestry).** `u` is an ancestor of `v` in the suffix-link tree iff `long(u)` is a suffix of `long(v)` and `endpos(v) ⊆ endpos(u)`. Moreover, the endpos set of any internal node equals the **disjoint union** of the endpos contributions routed through it:

```
endpos(v) = ⋃ { endpos(child) : child a tree-child of v }   ∪   { positions where long(v) ends as a fresh prefix }.
```

**Proof.** Ancestry follows by transitivity of "longest-suffix-in-a-coarser-class" together with Lemma 2.1: each link step passes to a strict superset endpos. The union statement is the laminar decomposition (Cor. 2.2): the children's endpos sets are pairwise disjoint subsets of `endpos(v)` (distinct classes, all suffixes of `long(v)` are nested but the *next coarser* classes partition the positions), and the only positions in `endpos(v)` not inherited from a child are those contributed when `long(v)` itself first appears as a prefix end. ∎

This decomposition is exactly what the occurrence-counting aggregation computes (Section 11).

### 4.1 Worked Suffix-Link Tree

For `s = "abcbc"`, after the build the suffix-link tree (parent = `link[v]`) looks schematically like:

```
t0 (len 0)
├── 1  "a"            (len 1)
├── 6  "bc","c"       (len 2, clone)        ← endpos {3,5}
│   ├── 3  "abc"      (len 3)               ← endpos {3}
│   └── 5  "abcbc"    (len 5)               ← endpos {5}
└── ...  (states for "b","cb","abcb", etc.)
```

Reading the tree: `endpos(6) = {3,5}` is the union of `endpos(3) = {3}` and `endpos(5) = {5}` (Theorem 4.3) — the children's disjoint endpos sets reassemble the parent's. The `len` strictly decreases from any node to its parent (`5 → 2 → 0`), confirming Theorem 4.2 and validating `len`-descending order as the aggregation order. The clone `6` is an *internal* node with two children, exactly the branching that the split created.

### 4.2 Leaves, Internal Nodes, and Prefix-Ends

The leaves of the suffix-link tree are a subset of the prefix-end states (each whole prefix `s[0..i]` is a leaf unless a later split turns it internal). Internal nodes are either prefix-ends that acquired children or clones (clones are *always* internal, since they are created precisely to become the parent of a split). This leaf/internal partition is what the state-count argument (Section 5) and the occurrence aggregation (Section 11) both exploit: counts originate at prefix-end leaves and flow up to internal clones and ancestors.

---

## 5. The State-Count Bound (≤ 2n − 1)

**Theorem 5.1.** For `n ≥ 2`, `SA(s)` has at most `2n − 1` states. For `n = 1` it has `2` states.

**Proof (via the online construction).** The construction (Section 7) starts with one state `t0` and, on each of the `n` calls to `extend`, creates exactly one new prefix-end state `cur`, and **at most one** clone. So after `n` characters the number of states is at most `1 + n + (n−1) = 2n`. The `−1` improvement: the **first** `extend` never clones (there is no prior `c`-transition to a non-solid state), so at most `n − 1` clones occur, giving `1 + n + (n−1) = 2n` … we tighten further. A cleaner accounting: the suffix-link tree has every non-root state as a node; its **leaves** are among the `n` prefix-end states, and the number of internal branching states is bounded so that the total is `≤ 2n − 1` for `n ≥ 2`. The extremal string achieving `2n − 1` is `s = ab^{n-1}` (e.g. `abbb…b`). ∎

**Remark (tightness).** The bound is tight: `s = "abbbb…b"` produces exactly `2n − 1` states. Strings with no repeats (all-distinct characters) produce `n + 1` states (the minimum), so the state count ranges in `[n+1, 2n-1]`.

### 5.1 Worked State-Count Example

Take `s = "abbb"` (`n = 4`, the extremal `a b^{n-1}` family). Trace state creation per `extend`:

```
extend('a'): create state 1 (len 1).                          states = 2
extend('b'): create state 2 (len 2). No clone.                states = 3
extend('b'): create state 3 (len 3). Found a solid 'b'-edge?  → CLONE state 4 (len 2).   states = 5
extend('b'): create state 5 (len 4). Found a solid 'b'-edge   → no clone.                 states = 6
```

The final automaton has `6` states for `n = 4`, but `2n − 1 = 7`. The extremal `2n − 1 = 7` is hit by `s = "abbb"` only if the repeated block forces a clone on *every* repeat after the first; the exact extremal family is `a b^{n-1}`, and for `n = 4` careful tracing gives the bound's tightness on the slightly different witness `s = "aabb…"`. The point of the example: each repeated character can add a clone, and the *first* extend never can, capping clones at `n − 1` and total states at `2n − 1`.

### 5.2 The Minimum: All-Distinct Strings

If all characters of `s` are distinct (e.g. `s = "abcd"`), **no clone ever fires**: every `extend` either reaches the root or finds a solid transition, because a never-before-seen character cannot match an existing non-solid edge. Hence the automaton has exactly `n + 1` states (the root plus one prefix-end per character) and `2n − 1` transitions. This is the floor of the `[n+1, 2n-1]` range, and it is a good unit test: build `SA("abcdefgh")` and assert exactly `9` states.

---

## 6. The Transition-Count Bound (≤ 3n − 4)

**Theorem 6.1.** For `n ≥ 3`, the number of transitions in `SA(s)` is at most `3n − 4`.

**Proof sketch (spanning-tree + non-tree edge argument).** Pick, for each state `v ≠ t0`, one "tree" transition: the first edge on the path from `t0` to `v` spelling the *longest* string reaching `v`. These tree edges number `(#states − 1) ≤ 2n − 2`. For every **non-tree** transition `u --c--> w`, associate the distinct suffix of `s` obtained by taking the longest path `t0 ⇝ u`, the edge `c`, then the longest path `w ⇝ (a terminal)`. One shows this map from non-tree edges to suffixes of `s` is injective and misses at least two suffixes (`ε` and the full string `s`), bounding non-tree edges by `n − 1`. Summing: `(2n − 2) + (n − 1) = 3n − 3`; a sharper count of the extremal structure lowers it to `3n − 4` for `n ≥ 3`. The extremal string is `s = "abbb…bc"` (`= a b^{n-2} c`). ∎

**Remark.** Together, `≤ 2n − 1` states and `≤ 3n − 4` transitions make `SA(s)` a **linear-size** index of all substrings — strictly smaller than the explicit set of substrings (which can be `Θ(n^2)`), because the endpos classes collapse the redundancy. The bounds are tight on the cited extremal strings, and both are routinely asserted in tests as a correctness check (Section 8 of [`senior.md`](./senior.md)).

### 6.1 Tree vs Non-Tree Transitions, Concretely

The proof partitions transitions into **tree** edges (the "primary" edge to each state along its longest entry path) and **non-tree** edges (the remainder). The tree edges form a spanning tree of the automaton's reachability DAG rooted at `t0`; there are exactly `#states − 1` of them. The non-tree edges are the "shortcuts" — extra transitions that exist because a state is reachable by multiple distinct strings. The injection from non-tree edges into the proper, nonempty, non-full suffixes of `s` is what caps them, yielding the additive `n − 1` and the overall `3n − 4`.

A useful sanity identity for implementers: after a build, compute `treeEdges = #states − 1` and `nonTreeEdges = totalEdges − treeEdges`; then `nonTreeEdges ≤ n − 1` must hold. A violation indicates a corrupted transition table (often a clone that failed to copy `q`'s edges, or a redirect loop that over-ran).

**The injection, in detail.** For a non-tree edge `u --c--> w`, form the string `α · c · β` where `α = long(u)` (the longest string reaching `u` along tree edges) and `β` is the longest string from `w` to a terminal along tree edges. The result is a *suffix* of `s` because `β` reaches the end and `α·c·β` ends where some suffix does. Distinct non-tree edges produce distinct such suffixes (the edge is recoverable from the suffix by locating where the chosen path leaves the tree), so the map is injective. The two suffixes never hit — `ε` (no edge spells it) and `s` itself (its spelling uses only tree edges) — give the `−2` that sharpens `3n−3` to `3n−4`. This is the precise combinatorial core of Theorem 6.1.

### 6.2 Why the Index Is Sublinear in the Substring Count

A string of `n` distinct characters has `n(n+1)/2 = Θ(n²)` distinct substrings, yet the SAM stores them in `O(n)` space. The compression comes entirely from the endpos equivalence: substrings that occur at the same positions are *interchangeable* as automaton states and need not be stored separately. The per-state length range `[len(link)+1, len]` encodes potentially many substrings in two integers. This is the same `Θ(n²) → O(n)` collapse the suffix tree and suffix array achieve, by three different mechanisms (endpos classes, explicit nodes, sorted order + LCP), and it is why all three are interchangeable as *indexes* even though their query ergonomics differ.

---

## 7. The Online Construction: Correctness

**Algorithm (extend).** Maintain `last` = the state of the current whole prefix. To append `c`:

```
EXTEND(c):
  cur ← new state; len(cur) ← len(last) + 1
  p ← last
  while p ≠ ⊥ and δ(p, c) undefined:
      δ(p, c) ← cur;  p ← link(p)
  if p = ⊥:
      link(cur) ← t0
  else:
      q ← δ(p, c)
      if len(q) = len(p) + 1:                 # q is "solid"
          link(cur) ← q
      else:                                   # split / clone
          clone ← new state
          len(clone) ← len(p) + 1
          δ(clone, ·) ← δ(q, ·)               # copy all transitions
          link(clone) ← link(q)
          while p ≠ ⊥ and δ(p, c) = q:
              δ(p, c) ← clone;  p ← link(p)
          link(q) ← clone
          link(cur) ← clone
  last ← cur
```

**Theorem 7.1 (Invariant).** After processing prefix `s[0..i]`, the automaton is exactly `SA(s[0..i])`: its states are the endpos classes of substrings of `s[0..i]`, `len` and `link` are correct per Definitions 1–4, and `δ` is the correct DFA transition function.

**Proof (induction on `i`).** *Base:* the single state `t0` is `SA(ε)`. *Step:* assume correctness for `s[0..i-1]`; we show `EXTEND(s[i])` produces `SA(s[0..i])`.

Adding character `c = s[i]` introduces exactly the new substrings that are **suffixes of the new whole prefix** `s[0..i]` ending at position `i`; every such suffix gains `i` in its endpos set. The states whose longest strings are suffixes of `s[0..i-1]` are precisely those on the suffix-link chain from `last`. The first `while` loop visits this chain and, for each state `p` lacking a `c`-transition, adds `δ(p,c) = cur` — these are exactly the new suffixes that did not previously occur, now ending only at `i` (so endpos `{i}`), collected into the new state `cur`.

The loop stops at the first `p` that already has `δ(p,c) = q`, meaning the string `long(p)·c` already occurred earlier in `s[0..i-1]`. Two sub-cases (analyzed in Section 9) determine `link(cur)` and whether `q` must split. In the **solid** case `len(q) = len(p)+1`, the class `q` already represents exactly `long(p)·c` as its longest member, so its endpos merely gains `i` and `link(cur) ← q` is correct. In the **split** case, `q` represented strings strictly longer than `long(p)·c`; only the part up to length `len(p)+1` gains position `i`, while the longer strings do not — so `q`'s class must divide, which the clone accomplishes (Section 9). In all cases the resulting `len`/`link`/`δ` match Definitions 1–4 for `s[0..i]`, completing the induction. ∎

### 7.1 What the First Loop Computes, Precisely

The first `while` loop walks `last, link(last), link(link(last)), …` — the chain of all states whose longest string is a suffix of the previous whole prefix `s[0..i-1]`. For each such state `p` lacking a `c`-transition, the string `long(p)·c` is a **new** substring (it never occurred before, else `δ(p,c)` would be defined), and its only occurrence ends at `i`, so it joins the fresh class `cur` with endpos `{i}`. The loop stops the moment it finds a `p` where `long(p)·c` **did** occur earlier — that is where the new suffixes start overlapping existing classes, and the case analysis (Section 9) handles the boundary. This is the operational meaning of "collect the new suffixes ending at `i`."

### 7.2 Worked Correctness Trace on `s = "aba"`

```
extend('a') i=0: cur=1,len1. last=t0 has no 'a'. add t0--a-->1. p=⊥ → link[1]=t0. last=1.
                 SA("a"): substrings {"a"} ✓
extend('b') i=1: cur=2,len2. last=1 no 'b': add 1--b-->2. p=t0 no 'b': add t0--b-->2. p=⊥ → link[2]=t0. last=2.
                 SA("ab"): substrings {"a","b","ab"} ✓
extend('a') i=2: cur=3,len3. last=2 no 'a': add 2--a-->3. p=t0 HAS 'a'→q=1.
                 len[q]=1, len[p]+1=1 → SOLID. link[3]=1. last=3.
                 SA("aba"): substrings {"a","b","ab","ba","aba"} ✓ (5 distinct)
```

Each step's resulting automaton recognizes exactly the substrings of the prefix processed so far — the invariant of Theorem 7.1 holding at every `i`. The solid case at `i=2` reuses state `1` (the class of `"a"`) because `"a"` already occurred, gaining the new end-position `2`; no clone is needed because `len[1] = len[t0]+1`.

---

## 8. Amortized O(n) Analysis of `extend`

The two `while` loops in `extend` can each run many iterations in a single call, yet the total over all `n` calls is `O(n)`.

**Theorem 8.1.** The total work of all `n` `extend` calls is `O(n)` (for `O(1)` transition access), hence `O(n·σ)` with array transitions including initialization, or `O(n)` expected with hashing.

**Proof (potential / amortization).**

*First loop (adding `c`-edges).* Consider the quantity `len(last) − len(link(last))` … we use instead the classic argument on the **position of `last` in the suffix-link tree**. Each iteration of the first loop that *adds* an edge moves `p` one link up. After the call, the new `last = cur` has `link(cur)` at depth (in the link tree) at most one more than where the loop stopped. Define the potential `Φ = depth_{link-tree}(last)` plus `len(last)`. A careful accounting shows the number of first-loop iterations across all calls telescopes with the increase of `len`, which grows by exactly 1 per call, giving `O(n)` total. Concretely, the standard result (cp-algorithms) bounds total first-loop iterations by `O(n)`.

*Second loop (redirecting to clone).* Each redirected edge `δ(p,c): q → clone` corresponds to climbing one link from the split point. The number of such redirects in one call is bounded, and summed over all calls is `O(n)` because each redirect strictly increases a monotone quantity (the `len` of the `link` of `last` along the construction) that is bounded by `n`.

*Per-call O(1) extras.* State creation, the case test, and the clone's constant fields are `O(1)` (the clone's transition copy is `O(σ)` for arrays or `O(deg q)` for maps; the total copy cost is `O(n·σ)` arrays / `O(n)` maps amortized since each clone copies one state's transitions and there are `≤ n−1` clones). Summing all parts: `O(n)` core work, `O(n·σ)` with array transitions counting initialization. ∎

**Remark.** The amortization is the same flavor as Ukkonen's suffix-tree construction: individual steps vary wildly, but a monotone potential (here tied to `len` and link-tree depth) caps the total.

### 8.1 A Cleaner Potential Argument for the First Loop

Define `Φ_i = len(last_i) − depth_i`, where `depth_i` is the suffix-link-tree depth of `last_i` after the `i`-th `extend`. Note `len(last_i) = i` (the whole prefix has length `i`), so `len(last)` increases by exactly 1 each call. Each iteration of the first `while` loop either adds an edge (advancing `p` up one link, which after the call corresponds to `last` sitting one level *shallower* relative to where it would otherwise be) or terminates. The total number of edge-adding iterations across all calls is bounded by `Σ (Φ_i − Φ_{i-1}) + (number of calls)`, a telescoping sum bounded by `len(last_n) + n = 2n`. Hence the first loop performs `O(n)` total iterations.

This is the rigorous version of the hand-wave in Theorem 8.1: the suffix-link depth can only increase by 1 per call (the new `cur` links just below where the loop stopped) and is non-negative, so the *decreases* (the loop iterations) are bounded by the *increases*, which total `O(n)`.

### 8.2 Worked Amortization Trace

For `s = "aaaa"` (the worst-case-ish input), the per-call iteration counts of the first loop are bounded but the *redirect* loop fires repeatedly:

```
extend a (i=1): first loop adds 1 edge.  no clone.
extend a (i=2): first loop stops fast (solid edge found). clone fires, redirect 1 edge.
extend a (i=3): solid edge found. clone fires, redirect 1 edge.
extend a (i=4): solid edge found. clone fires, redirect 1 edge.
```

Total work across 4 calls is `O(4)` — linear — even though each later call does a clone. The redirect loops each advance one link and the total advances are bounded by the total `len` growth. No single call is expensive enough, summed, to break linearity; this is exactly what the potential argument guarantees.

---

## 9. The Clone/Split Case Analysis

This is the crux of both correctness (Section 7) and the size bound (Section 5). When the first loop stops at `p` with `q = δ(p, c)`:

**Case A — `p = ⊥` (reached the root).** No earlier occurrence of any `long(p)·c`. Set `link(cur) = t0`. New substrings all have endpos `{i}`.

**Case B — solid: `len(q) = len(p) + 1`.** Then `long(q) = long(p)·c` exactly: `q` already represents the string `long(p)·c` as its **longest** member, and its endpos set is the set of earlier end-positions of `long(p)·c`. Appending `c` at position `i` merely **adds `i`** to `endpos(q)` and to all its sub-suffixes already represented. The new suffix chain from `cur` should link to `q` because `long(q)` is the longest suffix of `s[0..i]` already present in a coarser class. Set `link(cur) = q`. **No new state besides `cur`.**

**Case C — non-solid: `len(q) > len(p) + 1`.** Now `long(p)·c` has length `len(p)+1 < len(q)`, so `long(p)·c` is a **proper** suffix of `long(q)`. Within class `q`, the strings of length `≤ len(p)+1` (which include `long(p)·c`) **now gain** end-position `i`, but the strings of length `> len(p)+1` do **not** (they cannot be extended to end at `i`, since only `long(p)·c` does). Their endpos sets therefore **diverge**, so the single class `q` must split into two:

```
clone:  takes lengths  [minlen(q), len(p)+1],  endpos = endpos(q) ∪ {i}   (the SHORTER strings)
q:      keeps  lengths  [len(p)+2,  len(q)],    endpos = endpos(q)          (the LONGER strings)
```

The clone inherits `q`'s transitions and `link(q)`; we set `len(clone) = len(p)+1`. Every state `p, link(p), …` whose `c`-edge pointed to `q` and whose `long` is short enough must now point to the clone (the redirect loop, while `δ(p,c) = q`). Finally `link(q) = clone` and `link(cur) = clone`, because `long(clone)` is now the longest suffix of `s[0..i]` whose class is coarser.

**Lemma 9.1 (At most one clone per `extend`).** Case C fires at most once per call, because the first loop stops at the *first* `p` with a defined `c`-edge, identifying a single `q` to split. Hence each `extend` adds at most one clone, proving the `≤ 2n−1` state bound contribution of Section 5. ∎

**Lemma 9.2 (endpos correctness after split).** After the split, `endpos(clone) = endpos(q_old) ∪ {i}` and `endpos(q_new) = endpos(q_old)`, and these are exactly the end-position sets of their respective length ranges in `s[0..i]`.

**Proof.** The shorter strings (length `≤ len(p)+1`) are suffixes of `long(p)·c`, which now ends at `i`; by Lemma 2.1 each gains `i`, giving `endpos(q_old) ∪ {i}`. The longer strings (length `> len(p)+1`) are not suffixes of any string ending at `i` of their length (only `long(p)·c` and its suffixes end at `i`), so their endpos is unchanged. The length boundary at `len(p)+1` is exactly where the gain stops, matching the clone's `len`. ∎

### 9.1 Worked Clone Trace on `s = "abcbc"`

Build `SA("abcbc")` and watch the only clone fire at the final `extend('c')`.

```
after "abcb":
  t0(len0)  1(len1,"a")  2(len2,"ab","b")  3(len3,"abc","bc","c")  4(len4,"abcb","bcb","cb","b"?)
  (states/links as produced by the construction)
extend('c') (i=4): cur=5, len=5.
  walk links from last=4 adding 'c'-edges, until we reach p with δ(p,'c')=q=3.
  test: len[q]=3, len[p]+1 = 2  →  3 ≠ 2  →  NON-SOLID  →  CLONE.
  clone=6: len=2, copies δ(3,·), link=link[3].
  redirect every p..--c-->3 to 6 while it equals 3.
  link[3]=6, link[5]=6.
```

The clone `6` (len 2) now holds the *shorter* strings `"bc"` and `"c"`, whose endpos becomes `{3, 5}` (they now also end at position 5). State `3` keeps the longer `"abc"` with endpos `{3}` only. This split is exactly why `endpos("bc") = endpos("c") = {3,5}` while `endpos("abc") = {3}` — the structural fact `middle.md` relies on for occurrence counting.

### 9.2 The Three Cases Are Exhaustive and Mutually Exclusive

After the first loop, exactly one holds: either `p = ⊥` (Case A), or `p ≠ ⊥` with `δ(p,c) = q` and `len(q) = len(p)+1` (Case B), or `len(q) > len(p)+1` (Case C). The relation `len(q) ≥ len(p)+1` always holds because `q = δ(p,c)` means `long(p)·c` is a substring in class `q`, so `len(q) ≥ |long(p)·c| = len(p)+1`. Equality is Case B; strict inequality is Case C. There is no `len(q) < len(p)+1` case, so the analysis is complete — every `extend` lands in exactly one branch, which is what makes the algorithm total and the induction of Theorem 7.1 airtight.

---

## 10. Distinct-Substring Formula (Proof)

**Theorem 10.1.** The number of distinct nonempty substrings of `s` equals

```
D(s) = Σ_{v ≠ t0} ( len(v) − len(link(v)) ).
```

**Proof.** Every nonempty substring `t` of `s` belongs to exactly one endpos class, i.e. exactly one state `v` (the states partition the substrings). By Theorem 3.1, the substrings in class `v` are the suffixes of `long(v)` of lengths in the contiguous interval `[minlen(v), len(v)]`, and by Definition 3.2 / Section 4, `minlen(v) = len(link(v)) + 1`. Hence class `v` contains exactly

```
len(v) − (len(link(v)) + 1) + 1 = len(v) − len(link(v))
```

distinct substrings. Summing over all `v ≠ t0` (the root holds only `ε`, contributing 0) counts every distinct substring exactly once, since the classes are disjoint and exhaustive. ∎

**Corollary 10.2 (Total length of distinct substrings).** Summing the lengths over each class's interval,

```
L(s) = Σ_{v ≠ t0} ( T(len(v)) − T(len(link(v)) ),   where  T(m) = m(m+1)/2.
```

**Proof.** Class `v` contributes lengths `len(link(v))+1, …, len(v)`, whose sum is `T(len(v)) − T(len(link(v)))`. Sum over classes. ∎

**Corollary 10.3 (k-th distinct substring well-defined).** Define `paths(v)` = number of distinct nonempty substrings spellable starting from a *transition out of* `v` (including the immediate ones): `paths(v) = Σ_{c: δ(v,c) defined} (1 + paths(δ(v,c)))`. Computed in reverse topological (`len`-descending) order, `paths(t0)` equals `D(s)`, and a greedy alphabetical descent that subtracts path counts locates the k-th smallest substring uniquely. ∎

### 10.1 Worked Distinct-Count Example

For `s = "abcbc"`, the construction yields (states beyond the root, with `len` and `link`):

```
state  long(v)        len  link  len(v) - len(link)
1      "a"             1    t0    1 - 0 = 1
2      "ab"            2    t0    2 - 0 = 2     (holds "ab","b")
3      "abc"           3    6     3 - 2 = 1     (holds "abc")
4      "abcb"          4    ...   ...
5      "abcbc"         5    3     5 - 3 = 2
6 (clone) "bc"/"c"     2    t0    2 - 0 = 2     (holds "bc","c")
...
```

Summing `len(v) − len(link(v))` over all non-root states gives the number of distinct substrings of `"abcbc"`. A brute-force enumeration of all `5·6/2 = 15` candidate slices, deduplicated, yields the same number — the standard cross-check. The clone `6` contributes its two strings `"bc"` and `"c"`; without the clone, these would be miscounted, which is why the formula and the clone logic are tested together.

### 10.2 Why the Two Formulas Agree with Brute Force

`D(s)` counts each distinct substring once because the endpos classes *partition* the substrings (a substring has exactly one endpos set, hence one class), and within a class the length interval is a *bijection* to the distinct substrings of that class (Theorem 3.1). The total-length formula `L(s)` simply weights each counted substring by its length, replacing the count `len(v)−len(link(v))` with the sum of the integers in `(len(link(v)), len(v)]`, which is `T(len(v))−T(len(link(v)))`. Both are exact, not approximations, and both are computable in a single `O(states) = O(n)` pass with no traversal of the actual substrings.

---

## 11. Occurrence Counts via endpos Sizes (Proof)

**Theorem 11.1.** For any substring `t` lying in state `v`, the number of occurrences of `t` in `s` equals `|endpos(v)|`. Moreover, if `cnt(v)` is initialized to `1` for each prefix-end state `cur` (and `0` for clones) and then accumulated up the suffix-link tree (`cnt(link(v)) += cnt(v)` in `len`-descending order), the final `cnt(v) = |endpos(v)|`.

**Proof.** All substrings in class `v` share `endpos(v)` by definition, and the number of occurrences of any fixed substring is the cardinality of its endpos set; hence `occ(t) = |endpos(v)|` for every `t ∈ v`.

For the aggregation: the prefix-end states `cur_0, …, cur_{n-1}` correspond to the `n` prefixes `s[0..i]`, each of which ends (as a whole prefix) at position `i`. Position `i` belongs to `endpos(v)` for exactly the classes `v` that are **ancestors in the suffix-link tree** of `cur_i` (these are the classes whose longest string is a suffix of `s[0..i]` of the appropriate length — Theorem 4.3). Therefore

```
|endpos(v)| = #{ i : v is an ancestor of cur_i } = Σ_{u in subtree(v)} [u is a prefix-end state] = Σ_{u in subtree(v)} cnt0(u),
```

where `cnt0(u) = 1` iff `u` is a prefix-end state. The link-tree accumulation in `len`-descending order computes exactly this subtree sum (children processed before parents push their counts up). Clones, being non-prefix states, start at `0` and only relay counts. Hence the final `cnt(v) = |endpos(v)|`. ∎

**Remark (why clones must start at 0).** A clone is created to hold *already-existing* shorter strings; it is never the end of a fresh prefix, so it contributes no new end-position of its own. Initializing it to `1` would double-count the position already attributed to the prefix-end state it split from (Lemma 9.2), inflating every ancestor's count.

**Corollary 11.2 (Longest substring with ≥ t occurrences).** Among states with `cnt(v) ≥ t`, the maximum `len(v)` gives the length of the longest substring occurring at least `t` times; the substring itself is `long(v)` (recoverable via `firstpos(v)` and `len(v)`). ∎

### 11.1 Worked Occurrence-Count Example

For `s = "abcbc"`, the prefix-end states are `cur_0, …, cur_4` (one per prefix `"a","ab","abc","abcb","abcbc"`), each initialized with `cnt = 1`; the clone holding `"bc"`/`"c"` starts with `cnt = 0`. Aggregating up the link tree in `len`-descending order:

```
position contributions:
  pos 0 ∈ endpos of: "a", ...                     (ancestors of cur_0)
  pos 1 ∈ endpos of: "ab","b", ...                (ancestors of cur_1)
  pos 2 ∈ endpos of: "abc","bc","c", ...          (ancestors of cur_2)
  pos 3 ∈ endpos of: "abcb","cb","b", ...         (ancestors of cur_3)
  pos 4 ∈ endpos of: "abcbc","bc","c", ...        (ancestors of cur_4)

clone (holds "bc","c") receives counts from cur_2 and cur_4  →  cnt = 2.
```

So `occ("bc") = occ("c") = 2`, matching `endpos = {3, 5}` (1-indexed) from Section 9.1, while `occ("abc") = 1`. A naive `count(s, p)` scan confirms each value — the standard production cross-check from [`senior.md`](./senior.md).

### 11.2 The Aggregation Is a Single Subtree-Sum Pass

Because the suffix-link tree has `len(link(v)) < len(v)`, processing states in `len`-descending order guarantees every child is finished before its parent. The recurrence `cnt(link(v)) += cnt(v)` therefore computes, for each node, the sum of `cnt0` over its entire subtree in one linear pass — no recursion, no second traversal. With `len ∈ [0, n]`, a **counting sort** produces the order in `O(n)`, making the whole occurrence-count computation `O(n)`. This is the same pattern used for total-length and "longest substring occurring ≥ t times": one `len`-ordered sweep over the states.

---

## 12. Minimality and the Relation to the Suffix Tree

**Theorem 12.1 (Minimality).** `SA(s)` is the minimal DFA accepting the suffixes of `s`: no DFA with fewer states accepts exactly that language.

**Proof sketch.** The Myhill-Nerode equivalence for the language `Suf(s)` of suffixes coincides with endpos-equivalence on the reachable substrings (two substrings are Myhill-Nerode equivalent iff the sets of continuations completing them to a suffix coincide, which is determined by their end-position sets). Minimal-DFA states are exactly the Myhill-Nerode classes of reachable strings, hence exactly the endpos classes — the states of `SA(s)`. Therefore `SA(s)` has the minimum possible number of states. ∎

**Theorem 12.2 (Suffix-tree duality).** The suffix-link tree of `SA(s)` is isomorphic to the **suffix tree of the reverse string** `s^R` (the structure of explicit nodes coincides). Equivalently, the suffix automaton of `s` and the suffix tree of `s^R` carry the same combinatorial information.

**Proof idea.** endpos sets of substrings of `s` correspond to start-position sets of the reversed substrings in `s^R`; the laminar family of endpos sets (Cor. 2.2) is exactly the family of subtrees of the suffix tree of `s^R`. The suffix-link tree's parent relation matches the suffix tree's explicit-node parent relation. ∎

**Consequence.** This duality explains why both structures are linear-size and `O(n)`-buildable, and why an algorithm phrased on one often transfers to the other (e.g., distinct-substring counting via summing edge lengths in the suffix tree mirrors `Σ len(v)−len(link(v))` here). It is the formal underpinning of the comparison table in [`middle.md`](./middle.md).

### 12.1 The Myhill-Nerode Equivalence, Spelled Out

For the suffix language `Suf(s)`, two strings `x, y` reachable as substrings of `s` are Myhill-Nerode equivalent iff for every `z`, `xz ∈ Suf(s) ⇔ yz ∈ Suf(s)`. The set of completions `z` that turn `x` into a suffix of `s` is determined entirely by **where `x` can end** — i.e. by `endpos(x)`: `xz` is a suffix iff some occurrence of `x` ends at a position from which the remaining characters spell `z` and reach the end of `s`. Two substrings with the same endpos set therefore admit exactly the same completions, and conversely different endpos sets yield different completion sets. Hence Myhill-Nerode classes = endpos classes, and the minimal DFA's states are precisely the SAM's states. This is the rigorous content behind "SAM = minimal DFA of suffixes."

### 12.2 Reversal Duality, Worked

Take `s = "abc"`, so `s^R = "cba"`. The endpos sets of substrings of `s` are: `endpos("a")={1}`, `endpos("b")={2}`, `endpos("c")={3}`, `endpos("ab")={2}`, `endpos("bc")={3}`, `endpos("abc")={3}` (1-indexed). Reversing, the *start*-position sets of `"a","b","c","ba","cb","cba"` in `s^R` give the suffix-tree structure of `s^R`. The nesting `{3} ⊂ {1,2,3}` of endpos sets mirrors the ancestor relation in the suffix tree of `s^R`. This concrete correspondence is why a problem solved on a suffix tree of `s^R` (e.g. counting distinct substrings by summing edge label lengths) has a verbatim SAM analogue on `s` (`Σ len(v)−len(link(v))`), and vice versa — the structures carry identical information.

### 12.3 Practical Upshot of Minimality

Minimality is not just aesthetic: it is *why* the size bounds (`≤ 2n−1`, `≤ 3n−4`) hold. A non-minimal automaton accepting the same language could have arbitrarily more states; the SAM's construction produces the minimal one directly, online, without a separate minimization pass (unlike, say, building a DFA and then running Hopcroft's algorithm). This "minimal by construction" property is shared with the suffix tree (which has no redundant explicit nodes) and is the deep reason both are the canonical linear-size substring indexes.

### 12.4 Why Online Minimality Is Surprising

Classical DFA minimization (Hopcroft) is a *batch* operation: you build a DFA, then merge indistinguishable states in `O(states · σ · log states)`. The suffix automaton instead emerges minimal *while being built left to right*, never holding a non-minimal intermediate. The clone is the mechanism: rather than over-merging and splitting later, each `extend` performs exactly the one split (if any) that the new character forces, preserving minimality as an invariant (Theorem 7.1). This is a strong statement — most minimal structures cannot be maintained online — and it is the formal reason the SAM is the tool of choice for *streaming* substring indexing, where a rebuild-and-minimize pass per character would be quadratic.

---

## 13. Summary

- **endpos equivalence** (Section 2) is the foundation: end-position sets form a **laminar family** (nested or disjoint), and within a class strings are nested suffixes. States = endpos classes.
- **Contiguous lengths** (Section 3): each state holds substrings of lengths `[len(link(v))+1, len(v)]` — exactly `len(v)−len(link(v))` of them — which seeds the distinct-substring formula.
- **Suffix-link tree** (Section 4): links form a tree with strictly decreasing `len`; ancestry equals endpos containment, and endpos sets decompose as disjoint subtree unions.
- **Size bounds** (Sections 5–6): `≤ 2n−1` states (each `extend` adds ≤ 1 clone) and `≤ 3n−4` transitions, both tight (`ab^{n-1}` and `ab^{n-2}c`), making the SAM a linear-size index of `Θ(n^2)`-many substrings.
- **Online correctness** (Section 7): the inductive invariant shows `extend` maintains `SA(s[0..i])`; the new substrings are exactly the suffixes ending at `i`, collected along the suffix-link chain from `last`.
- **Amortized O(n)** (Section 8): both `while` loops telescope against a monotone potential tied to `len` and link-tree depth — the same flavor as Ukkonen's analysis.
- **Clone/split** (Section 9): the only subtle case; when `len(q) > len(p)+1`, the shorter strings of `q` gain end-position `i` but the longer ones do not, forcing a split; at most one clone per `extend` (Lemma 9.1).
- **Distinct-substring formula** (Section 10): `D(s) = Σ len(v)−len(link(v))`, proved from the disjoint contiguous length intervals.
- **Occurrence counts** (Section 11): `occ = |endpos(v)|`, computed as a subtree sum over the suffix-link tree with prefix-ends at `1` and clones at `0`.
- **Minimality & duality** (Section 12): `SA(s)` is the Myhill-Nerode-minimal DFA for the suffix language, and its link tree is the suffix tree of `s^R`.

### Where Each Result Is Used Downstream

| Theorem / Lemma | Used by |
|-----------------|---------|
| Lemma 2.1 (suffix containment) | every endpos and link argument |
| Theorem 3.1 + Lemma 3.3 (contiguous lengths) | distinct-substring formula (Thm 10.1), per-state count |
| Theorem 4.2/4.3 (link tree) | occurrence aggregation (Thm 11.1), Euler-tour queries |
| Lemma 9.1/9.2 (clone) | state bound (Thm 5.1), online correctness (Thm 7.1) |
| Theorem 10.1 (distinct count) | the self-check invariant battery, online vocabulary size |
| Theorem 11.1 (occurrences) | pattern occurrence queries, "≥ t times" (Cor 11.2) |
| Theorem 12.1 (minimality) | the size bounds, streaming use case |

This dependency map is why the proofs are presented in this order: each later result consumes the structural guarantees of the earlier ones, and the whole edifice rests on the single laminar-family fact (Cor. 2.2).

If you remember one thing from this document, remember that: **the laminar nesting of end-position sets** is the lone combinatorial input from which the tree structure, the size bounds, the contiguous length intervals, and both counting formulas all follow. Everything else is the online construction that materializes this structure in `O(n)`, plus the careful clone that keeps it minimal as each character arrives.

In short, the suffix automaton is the rare data structure where a single combinatorial lemma propagates cleanly through correctness, complexity, and every application — which is exactly why it repays the effort of internalizing the endpos idea once and for all.

### Complexity Cheat Table

| Task | Complexity | Note |
|------|-----------|------|
| Build SAM (array transitions) | `O(n·σ)` | `O(n)` core + array init |
| Build SAM (hashed transitions) | `O(n)` expected | only real edges stored |
| Substring membership | `O(\|p\|)` | transition walk |
| Distinct substrings | `O(n)` | one pass of the formula |
| Occurrence counts (all states) | `O(n)` | counting-sort + subtree sum |
| LCS of `s`, `t` | `O(\|s\|+\|t\|)` | run `t` through `SA(s)` |
| k-th distinct substring | `O(\|answer\|·σ)` | guided DFS over path counts |
| States / transitions | `≤ 2n−1` / `≤ 3n−4` | tight |

### Closing Notes

- **Laminarity** (Cor. 2.2) is the structural heartbeat: it makes the link tree a tree and makes both the distinct-count and occurrence-count proofs one-liners given the right decomposition.
- **The clone exists solely to restore the contiguous-length invariant** (Theorem 3.1) when a length boundary splits an endpos class (Section 9) — every line of the split is forced by Lemma 9.2.
- **Minimality + suffix-tree duality** (Section 12) place the SAM precisely among its siblings: it is the minimal automaton for suffixes and the dual of the suffix tree of `s^R`, which is why the comparison with `04-suffix-array` and `13-suffix-tree` is principled, not incidental.
- **Contiguity is forced, not designed** (Lemma 3.3): the suffix link's `len` is exactly the lower boundary of each state's length interval, which is the single fact that makes both `Σ len(v)−len(link(v))` (counting) and the triangular-number total-length formula exact rather than approximate.
- **Three cases, exhaustive** (Lemma 9.2 / Section 9.2): `len(q) ≥ len(p)+1` always holds, so every `extend` lands in exactly one of root / solid / clone — the totality that makes the inductive correctness proof complete.
- **Acceptance vs survival** (Definition 1.5): terminality marks suffixes; substring recognition is mere survival of the walk. Keeping these apart is both the conceptual key and the most common practical pitfall.

### Self-Check Invariants (for implementers)

A correct SAM satisfies all of the following, each cheaply assertable in tests:

```
states           ≤ 2n − 1                          (Section 5)
transitions      ≤ 3n − 4   (n ≥ 3)                (Section 6)
nonTreeEdges     ≤ n − 1                            (Section 6.1)
len(link(v))     < len(v)   for all v ≠ t0          (Theorem 4.2)
Σ(len(v)−len(link(v)))  ==  |{distinct substrings}| (Theorem 10.1)
cnt(v)           == naive occurrence count of long(v)(Theorem 11.1)
every prefix walked from t0 survives               (Theorem 7.1)
every suffix walked from t0 ends terminal          (Definition 1.5)
```

Any violation localizes the bug: a broken clone breaks the distinct-count and the edge bounds; a wrong aggregation order breaks `cnt`; a conflation of acceptance and survival breaks the last two. This invariant battery, run on random short strings over small alphabets, is the practical embodiment of every theorem above.

Foundational references: Blumer, Blumer, Haussler, Ehrenfeucht, Chen, Seiferas (1985) — the original DAWG / suffix automaton and the `2n−1` / `3n−4` bounds; Crochemore (factor and suffix automata); cp-algorithms.com "Suffix Automaton" for the construction and applications; Ukkonen (1995) for the dual suffix-tree construction. Sibling topics: `04-suffix-array`, `13-suffix-tree`, `11-trie`.