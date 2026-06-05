# Suffix Tree & Ukkonen's Algorithm — Mathematical Foundations

> **Focus:** Rigorous definitions and proofs — the suffix-tree definition and the `O(n)` node bound, the correctness of Ukkonen's three extension rules (they preserve the implicit-suffix-tree invariant), the existence of suffix links, the amortized `O(n)` analysis via the active-point/skip-count potential argument, correctness of the distinct-substring and longest-repeated formulas, and the formal equivalence to the suffix array plus LCP array.

---

## Table of Contents

1. [Formal Definitions](#1-formal-definitions)
2. [The O(n) Node Bound](#2-the-on-node-bound)
3. [Implicit Suffix Trees and the Invariant](#3-implicit-suffix-trees-and-the-invariant)
4. [The Three Extension Rules Preserve the Invariant](#4-the-three-extension-rules-preserve-the-invariant)
5. [Existence of Suffix Links](#5-existence-of-suffix-links)
6. [Amortized O(n): The Skip/Count Potential Argument](#6-amortized-on-the-skipcount-potential-argument)
7. [Distinct-Substring Correctness](#7-distinct-substring-correctness)
8. [Longest Repeated and Common Substring Correctness](#8-longest-repeated-and-common-substring-correctness)
9. [Equivalence to Suffix Array + LCP](#9-equivalence-to-suffix-array--lcp)
10. [Relationship to the Suffix Automaton](#10-relationship-to-the-suffix-automaton)
11. [Worked Construction Trace](#11-worked-construction-trace)
12. [Complexity Cheat Table](#12-complexity-cheat-table)
13. [Summary](#13-summary)

---

## 1. Formal Definitions

Let `S` be a string of length `n` over an alphabet `Σ`, and let `$ ∉ Σ` be a sentinel. Write `T = S$`, of length `n+1`. Index positions `0..n`.

**Definition (suffix).** For `0 ≤ i ≤ n`, the `i`-th suffix is `T[i..n]`. There are `n+1` suffixes, all distinct (the `$` guarantees no suffix is a prefix of another).

**Definition (suffix trie).** The suffix trie of `T` is the trie containing all `n+1` suffixes: a rooted tree whose edges carry single characters, where the root-to-node path spells a string, and a node is *marked* if its path-label is a suffix.

**Definition (suffix tree).** The suffix tree `ST(T)` is the **path-compressed** suffix trie: every maximal chain of non-branching, non-marked internal nodes is merged into a single edge whose label is the concatenation of the chain's characters, stored as an index pair `[start, end]` denoting `T[start..end]`. Formally:

- Each **edge** is labeled by a non-empty substring `T[start..end]`.
- The **path-label** of a node `v`, written `L(v)`, is the concatenation of edge labels from the root to `v`. Its length `|L(v)|` is the **string-depth** of `v`.
- No two edges out of the same node start with the same character.
- Every **internal node** other than the root has **≥ 2 children** (it is a branching point).
- The **leaves** are in bijection with the suffixes: leaf `ℓ_i` has `L(ℓ_i) = T[i..n]`.

**Definition (locus / implicit node).** A position in the tree is either a **node** (explicit) or a point **inside an edge** (implicit). The locus of a string `α` is the unique position whose path-label equals `α`, if `α` is a substring of `T`.

**Lemma (substring ↔ locus).** `α` is a substring of `T` **iff** `α` has a locus in `ST(T)`. *Proof.* Every substring is a prefix of some suffix `T[i..n]`; that prefix is the path from the root along the leaf `ℓ_i`'s path, stopping after `|α|` characters, which is a (possibly implicit) position. Conversely any path-prefix spells a substring. ∎

This lemma is the foundation of the `O(m)` substring query: walk the locus of `P`; it exists iff `P` occurs.

**Notation summary.** Throughout this file we use:

| Symbol | Meaning |
|--------|---------|
| `n` | length of `S` (so `T = S$` has length `n+1`) |
| `T[i..j]` | substring from index `i` to `j` inclusive |
| `L(v)` | path-label of node `v` (string from root to `v`) |
| `string-depth(v)` | `|L(v)|`, character count from root |
| `node-depth(v)` | number of edges from root to `v` |
| `slink(v)` | suffix link of internal node `v` |
| `IST_i` | implicit suffix tree of `T[0..i]` |
| `remaining` | count of suffixes not yet made explicit in the current phase |
| `leafEnd` | the shared global end index for all leaf edges |
| `occ(α)` | number of occurrences of `α` in `T` |

**Three standard facts we rely on repeatedly:**

1. **Suffix-closure.** If `α` is a substring of `T` and `β` is a suffix of `α`, then `β` is a substring of `T`. (Trivially true since `β` appears wherever `α` does, shifted.)
2. **Prefix-of-suffix.** Every substring of `T` is a prefix of some suffix of `T`. (Take any occurrence; the suffix starting there has the substring as a prefix.)
3. **Distinctness under `$`.** With a unique sentinel, no suffix of `T` is a prefix of another, so all `n+1` suffixes end at distinct leaves.

These three facts underpin nearly every proof below; we cite them by name rather than re-deriving them.

---

## 2. The O(n) Node Bound

**Theorem.** `ST(S$)` has exactly `n+1` leaves and at most `n` internal nodes (including the root counts toward at most `n`), hence at most `2n+1` nodes and at most `2n` edges.

**Proof.** Leaves: each suffix `T[i..n]` ends at a distinct leaf because all suffixes are distinct (sentinel), and every leaf is some suffix; so exactly `n+1` leaves. Internal nodes: every internal node other than the root has degree (number of children) `≥ 2`. Consider the tree with `L = n+1` leaves where every internal node is at least binary. By a standard counting argument on trees: if `I` is the number of internal nodes and every internal node has ≥ 2 children, then the number of edges is `≥ 2I` counting downward, but also the tree with `L` leaves and `I` internal nodes has `L + I - 1` edges total (a tree on `L+I` nodes). Combining, a full-ish branching tree with `L` leaves has at most `L - 1` internal nodes. Thus `I ≤ n`, total nodes `≤ (n+1) + n = 2n+1`, and edges `= (#nodes) - 1 ≤ 2n`. ∎

**Corollary (space).** Because each edge stores only the pair `(start, end)` — `O(1)` — and there are `O(n)` edges, the total space is `O(n)` *regardless of the total length of the substrings the edges represent* (which could be `Θ(n²)`). The index-pair representation is exactly what converts the `Θ(n²)` trie into an `O(n)` tree.

**Tightness of the bound.** The bound `≤ 2n+1` nodes is achieved (up to constants) by strings with maximal branching. For example, the string `S = a^k b^k` (k copies of `a` then k of `b`) plus a sentinel produces close to `2n` nodes, because many suffixes share short prefixes and then diverge. Conversely, a string of a single repeated character `a^n$` produces a nearly *path-like* tree with few internal nodes — yet still `n+1` leaves. Both extremes respect the bound, which is why the `O(n)` claim is robust across all inputs.

**Why "at least two children" is essential.** If we did *not* compress unary chains, an internal node could have exactly one child, and a single suffix could spawn `Θ(n)` such nodes, recreating the `Θ(n²)` blowup. Path compression — merging unary chains into one index-pair edge — is precisely the operation that enforces the "≥ 2 children" property on internal nodes and thereby the `O(n)` bound. The suffix tree is, by definition, the *minimal* such compressed structure.

---

## 3. Implicit Suffix Trees and the Invariant

Ukkonen builds incrementally. Define the **implicit suffix tree** `IST_i` as the tree obtained from `ST(T[0..i])` (the suffix tree of the length-`(i+1)` prefix, **without** a sentinel) by:

1. removing every edge label character equal to the (absent) terminator, and
2. removing any node that then has fewer than two children, splicing it out.

Concretely, `IST_i` is the path-compressed trie of all suffixes of `T[0..i]`, where suffixes that are prefixes of longer suffixes end at **implicit** positions (no leaf).

**Construction invariant.** *After phase `i`, the tree maintained by Ukkonen equals `IST_i`.* The whole correctness proof is showing that the three extension rules transform `IST_{i-1}` into `IST_i` when character `c = T[i]` is appended.

**Key structural fact.** Going from `IST_{i-1}` to `IST_i` requires, for each suffix `T[j..i-1]` (j = 0..i), ensuring that `T[j..i]` (its one-character extension) has a locus in the tree. There are `i+1` such suffixes to consider; the rules dispatch each in `O(1)` amortized.

---

## 4. The Three Extension Rules Preserve the Invariant

Fix phase `i`, appending `c = T[i]`. For each `j` from `0` upward, let `β = T[j..i-1]` be the current suffix and consider extending it with `c`. Exactly one rule applies, based on the locus of `β`:

**Rule 1 (β ends at a leaf).** The locus of `β` is a leaf edge. Appending `c` simply lengthens that leaf's edge label by one. *Invariant preservation:* the leaf's path-label becomes `βc = T[j..i]`, exactly the required suffix. With the global-end implementation, the leaf's `end` field already references `leafEnd`, which was set to `i` at the start of the phase, so this is automatic and correct.

**Rule 2 (β ends where c does not continue).** The locus of `β` is a position from which no edge/branch starts with `c`.
- If `β`'s locus is at an explicit node, add a new leaf edge labeled `T[i..]` (a leaf for suffix `T[j..i]`).
- If `β`'s locus is inside an edge, **split** the edge at that locus, creating a new internal node `w` with `L(w) = β`, then attach a new leaf edge for `c`.
*Invariant preservation:* after the operation, `βc` has a locus (the new leaf), and the new internal node `w` (if created) correctly represents the now-branching substring `β`, which had two distinct continuations (the old one and `c`). All other path-labels are unchanged. So the tree still equals the path-compressed trie of the suffixes of `T[0..i]` restricted to those processed so far.

**Rule 3 (β's continuation with c already exists).** The locus of `β` already has `c` as its next character (either the edge continues with `c`, or a child edge starts with `c`). Then `βc` *already* has a locus — nothing to insert. *Invariant preservation:* crucially, if `βc` already exists, then for **every** shorter suffix `β' = T[j'..i-1]` with `j' > j`, `β'c` also already exists (because `β'c` is a suffix of `βc`, and the tree is suffix-closed by construction). Therefore **all remaining extensions in this phase are also Rule 3** and can be skipped — the phase stops. The pending suffixes remain implicit, which is exactly what `IST_i` permits.

**Lemma (Rule-3 show-stopper validity).** *If extension `j` is Rule 3 in phase `i`, then extensions `j+1, …, i` are all Rule 3.* *Proof.* `βc` has a locus means `βc` is a substring of `T[0..i]`. For `j' > j`, `T[j'..i] = β'c` is a **suffix** of `βc`, hence also a substring of `T[0..i]`, hence has a locus. So those extensions are also Rule 3. ∎

This lemma is why each phase performs only the "new" Rule-2 work plus a single Rule-3 detection — the source of the `O(n)` total bound.

**Worked invariant check (`T = "abab$"`).** Trace the implicit trees:

```
IST_0 (read "a"):   root —a→ ·                         (1 implicit suffix: "a")
IST_1 (read "ab"):  root —ab→ leaf, root —b→ leaf       (suffixes "ab","b")
IST_2 (read "aba"): "a"/"b" prefixes shared; "a" now ends mid-edge (implicit)
IST_3 (read "abab"): "ab" repeats → an internal node for "ab" appears (Rule 2 split)
IST_4 (read "abab$"): the $ phase forces every implicit suffix to a leaf → explicit
```

At `IST_2`, the suffix `"a"` ends in the middle of the `"ab…"` edge — it is *implicit*, exactly as Rule 3 leaves it. When `"abab"` introduces the second occurrence of `"ab"`, a Rule-2 split materializes the internal node for `"ab"`. Finally the `$` phase, since `$` matches nothing, fires Rule 2 for every pending suffix, making the tree explicit. This concrete trace mirrors the general invariant: between phases the tree may hold implicit suffixes, and the sentinel phase resolves them all.

**Subtlety: the order of rule application within a phase.** Within a single phase, extensions proceed from the *longest* pending suffix to the *shortest*. The first few extensions of a phase are typically Rule 1 (handled en masse by the global end), the middle ones are Rule 2 (real work), and the phase terminates at the first Rule 3. This monotone structure — leaf, then split, then stop — is not an accident: it follows from the fact that longer suffixes contain shorter ones, so once a continuation exists (Rule 3), it exists for all shorter suffixes too.

---

### 4.1 The Extension Algorithm in Precise Pseudocode

For reference, the canonical phase procedure whose correctness Section 4 establishes:

```
procedure EXTEND(i):                       # phase i, adding c = T[i]
    leafEnd ← i                            # Trick 1: Rule 1 for all leaves
    remaining ← remaining + 1
    lastNew ← null
    while remaining > 0:
        if activeLength = 0:
            activeEdge ← i
        ac ← T[activeEdge]
        if activeNode has no child on ac:
            # Rule 2 (leaf): new leaf for c
            create leaf [i, leafEnd] under activeNode on ac
            if lastNew ≠ null: slink(lastNew) ← activeNode; lastNew ← null
        else:
            nxt ← child(activeNode, ac)
            if activeLength ≥ edgeLen(nxt):       # skip/count
                activeEdge ← activeEdge + edgeLen(nxt)
                activeLength ← activeLength − edgeLen(nxt)
                activeNode ← nxt
                continue
            if T[nxt.start + activeLength] = c:
                # Rule 3 (show-stopper)
                if lastNew ≠ null and activeNode ≠ root:
                    slink(lastNew) ← activeNode
                activeLength ← activeLength + 1
                break
            # Rule 2 (split): create internal node
            split ← new internal node [nxt.start, nxt.start + activeLength − 1]
            replace child(activeNode, ac) with split
            add leaf [i, leafEnd] under split on c
            nxt.start ← nxt.start + activeLength
            add nxt under split on T[nxt.start]
            if lastNew ≠ null: slink(lastNew) ← split
            lastNew ← split
        remaining ← remaining − 1
        if activeNode = root and activeLength > 0:
            activeLength ← activeLength − 1
            activeEdge ← i − remaining + 1
        else if activeNode ≠ root:
            activeNode ← slink(activeNode)      # null → root
```

Every line of this procedure is justified by a claim in Section 4 (rule cases), Section 5 (suffix-link target existence and timing), and Section 6 (the `O(1)` amortized cost of `skip/count` and the link hop). The break on Rule 3 is the show-stopper lemma; the `remaining` decrement is what bounds total Rule-2 work; the `activeEdge ← i − remaining + 1` reset re-targets the active point at the start index of the next suffix to process.

### 4.2 Invariant After Each Phase (Formal Statement)

**Theorem (phase invariant).** *Let `Tree_i` be the data structure after `EXTEND(0..i)` completes. Then `Tree_i = IST_i`, the implicit suffix tree of `T[0..i]`.*

*Proof (induction on `i`).* Base `i = 0`: a single leaf for `T[0]`, which is `IST_0`. Inductive step: assume `Tree_{i-1} = IST_{i-1}`. By Section 4, each extension in phase `i` applies the correct rule for one pending suffix, transforming the locus structure exactly as `IST_i` requires; Rule 3 stops once all remaining suffixes are already present (show-stopper lemma), leaving them implicit precisely as `IST_i` does. Hence `Tree_i = IST_i`. ∎

A corollary worth stating: after the sentinel phase (`c = $`), `IST_{n} = ST(T)` is explicit, because `$` is unique so no suffix is a prefix of another (distinctness fact 3), forcing every pending suffix to a leaf.

---

## 5. Existence of Suffix Links

**Definition (suffix link).** For an internal node `v` with `L(v) = xα` (a character `x` followed by a possibly empty string `α`), the suffix link `slink(v)` points to the node `u` with `L(u) = α`. The root is its own suffix link target for the empty/`α=ε` case.

**Theorem (existence).** *In an implicit (or explicit) suffix tree, if an internal node `v` has path-label `xα`, then there exists an internal node `u` with path-label `α`. Hence `slink(v)` is well-defined.*

**Proof.** Because `v` is internal with `L(v) = xα`, it is a branching node: there exist at least two characters `a ≠ b` such that both `xαa` and `xαb` are substrings of `T` (they are path-labels reachable through `v`). Each of these is a substring, so by suffix-closure, dropping the leading `x` gives substrings `αa` and `αb` of `T` as well. Thus `α` has at least two distinct right-extensions `αa`, `αb` in `T`, so the locus of `α` is a **branching** position, i.e. an explicit internal node `u` with `L(u) = α`. Therefore `u` exists and `slink(v) = u` is well-defined. ∎

**Corollary (link target timing).** When Ukkonen creates a new internal node `v` by a Rule-2 split during phase `i`, the node `u = slink(v)` either already exists or will be created in the **very next** extension of the same phase. Ukkonen records `v` as `last_new` and, on creating the next internal node `v'` (or upon Rule 3 / falling to the active node), sets `slink(last_new) = v'` (or the active node). This guarantees every internal node has its suffix link set within one extension of its creation, so links are complete by the end of the phase.

**Why suffix links matter for complexity.** After processing the extension for suffix `T[j..i]`, the next extension concerns `T[j+1..i]`, whose relevant prefix is the current path-label with the first character dropped. The suffix link from the current internal node jumps directly to the node for that dropped-prefix in `O(1)`, avoiding an `O(depth)` re-descent from the root. Without suffix links, re-descent makes the build `O(n²)`.

**Suffix links form a tree.** Consider the directed graph whose vertices are the internal nodes (plus the root) and whose edges are the suffix links. Because `slink(v)` has a strictly shorter path-label than `v` (by exactly one character at the root level, but the *node* it lands on has strictly smaller string-depth), the suffix-link graph is acyclic and every non-root internal node has exactly one outgoing link to a node of smaller string-depth. Hence the suffix links form a **tree rooted at the root** — the *suffix-link tree*. This tree is precisely the structure isomorphic to the suffix tree of the reversed string (Section 10), and it is the object the suffix automaton exposes directly. Recognizing that suffix links are not arbitrary pointers but a second tree over the same nodes is the key to several advanced algorithms (matching statistics, Weiner's algorithm, and the SAM equivalence).

**Why the link target has string-depth exactly `|α|`.** When `v` has path-label `xα`, the node `u = slink(v)` has path-label `α`, so `string-depth(u) = |α| = string-depth(v) − 1` *only* when measured in characters — but in *node-depth* (edge count) it can drop by more than one if the path to `v` had longer edges than the path to `u`. This distinction matters for the amortized analysis: the potential argument in Section 6 is stated in **node-depth**, and the bound "node-depth drops by at most a bounded amount per hop" is what we must (and do) justify there.

---

### 5.1 Link-Setting Timing, Formally

The corollary above asserts links are set within one extension. We make the bookkeeping precise. Within a phase, let `v_1, v_2, …, v_t` be the internal nodes created (in order) by Rule-2 splits. The algorithm maintains `lastNew`:

```
when v_j is created:   if lastNew ≠ null: slink(lastNew) ← v_j;   lastNew ← v_j
on Rule 3 (non-root):  if lastNew ≠ null: slink(lastNew) ← activeNode
on Rule 2 leaf:        if lastNew ≠ null: slink(lastNew) ← activeNode;  lastNew ← null
```

**Claim.** *Every `v_j` receives a correct suffix link by the end of its phase.* For `j < t`, `slink(v_j) = v_{j+1}` is set when `v_{j+1}` is created. For `v_t` (the last one), the link is set when the phase terminates — either by Rule 3 (link to the active node) or by a Rule-2 leaf (link to the active node). The target is correct because, by the active-point update conventions, after creating `v_j` the active point moves to exactly the locus of `L(v_j)` with its first character dropped — i.e. the locus of `slink(v_j)`. ∎

This is why a missing or misordered `lastNew` assignment is the single most common source of a subtly *wrong* tree (as opposed to a merely *slow* one): the structure can look plausible while a suffix link points to the wrong node, corrupting future skip/count descents.

## 6. Amortized O(n): The Skip/Count Potential Argument

We bound the total work of all phases. Per-phase work splits into: (a) the `O(1)` global-end update (all Rule-1 extensions), (b) the Rule-2 extensions actually performed, (c) the suffix-link hops, and (d) the skip/count descent steps.

**Counting Rule-2 extensions.** Maintain `remaining`, the number of suffixes not yet made explicit. Each phase increments `remaining` by 1 (the new character creates one new pending suffix). Each Rule-2 extension makes exactly one pending suffix explicit and decrements `remaining`. Since `remaining ≥ 0` always and total increments over all phases is `n`, the **total number of Rule-2 extensions across all phases is at most `n`**. Each Rule-2 extension does `O(1)` structural work (one split, one leaf, one link). Hence total Rule-2 work is `O(n)`. Suffix-link hops are at most one per Rule-2 extension, so also `O(n)`.

**Bounding skip/count.** The subtle cost is the descent (`walk_down`) when re-positioning the active point after a suffix-link hop. Define a potential `Φ` = the **node-depth** of `active_node` (number of edges from the root to `active_node`), an integer in `[0, n]`.

- Following a suffix link decreases the node-depth of the active node by **at most 1** (the link target's path-label is one character shorter at the root's first-character level; its node-depth drops by at most 1). So each suffix-link hop increases the "descent budget" by at most a constant.
- Each `walk_down` skip step moves the active node **down by one edge**, increasing node-depth by 1, and is charged to the potential.
- Node-depth is bounded by the tree height `≤ n` and can only be reset/decreased by suffix-link hops (`O(n)` of them, each by ≤ 1).

By the potential method, the total number of skip steps is bounded by `(total node-depth increase) ≤ (initial depth) + (#suffix-link hops) ≤ O(n)`. The character comparison inside `walk_down` is `O(1)` per skip because skip/count uses **edge-length arithmetic** (compare `active_length` to `edge_len`) rather than per-character matching — the characters are known to match since the substring already exists. Therefore **total skip/count work is `O(n)`**.

**Conclusion.** Summing (a)+(b)+(c)+(d): each is `O(n)`, so Ukkonen runs in `O(n)` time and `O(n)` space (for constant alphabet; for alphabet `Σ`, child lookup adds an `O(log|Σ|)` or `O(1)`-expected factor depending on the children container). ∎

**Detailed potential accounting.** Let us make the potential argument explicit. Define `Φ = depth(active_node)`, where `depth` is the number of edges from the root to the active node. Over the entire run:

- **Increases to `Φ`** come only from `walk_down` skip steps, each of which moves the active node one edge deeper (`+1`). Let `D` be the total number of skip steps.
- **Decreases to `Φ`** come from two sources: following a suffix link (decreases node-depth by at most a constant `Δ`, and there are `O(n)` such hops) and the root-convention reset (`active_node` stays root, `Φ` unchanged or 0).

Since `Φ` starts at 0, ends at some value `≥ 0`, and is bounded in `[0, n]`, the total increase equals the total decrease plus the final value, all `O(n)`. Therefore `D = O(n)`: the total skip work across the entire algorithm is linear. The crucial enabler is that each skip is `O(1)` — it compares `active_length` against an edge length (arithmetic), never matching characters one by one, because the substring being descended is *already in the tree* and therefore *known* to match. This "count, don't compare" property is what the name **skip/count** denotes.

**Why naive (no links, no skip/count) is `Θ(n²)`.** Without suffix links, each extension re-descends from the root, costing `O(depth)`; across `Θ(n)` extensions in the worst case this is `Θ(n²)`. Without skip/count, re-descending after a link hop matches characters one at a time, again `Θ(n)` per re-descent. Each trick independently removes a factor of `n` from a different part of the cost; together with the free global-end Rule 1, they collapse the build to `Θ(n)`. The string `a^n$` is the canonical witness: naive insertion does `Θ(n²)` character comparisons, while Ukkonen does `Θ(n)`.

---

## 7. Distinct-Substring Correctness

**Theorem.** *The number of distinct non-empty substrings of `T` equals the sum over all edges of the edge-label length:*

```
#distinct substrings of T = Σ_{edges e} len(e),   where len(e) = end_e - start_e + 1.
```

**Proof.** By the substring↔locus lemma (Section 1), distinct substrings of `T` are in bijection with **distinct loci** in `ST(T)` (positions, explicit or implicit, reachable from the root, excluding the empty string at the root). Each edge `e` from parent `p` to child `c` contributes exactly `len(e)` new loci: the positions obtained by walking `1, 2, …, len(e)` characters into `e` from `p`. These positions are pairwise distinct across all edges because two positions with the same path-label would have to lie on the same root path, hence on the same edge. The root contributes the empty string (excluded). Therefore the total number of distinct non-empty substrings equals the total number of edge positions, `Σ_e len(e)`. ∎

**Practical note.** To count distinct substrings of `S` (not `S$`), subtract the substrings that contain `$`. Since `$` is unique and appears only at the end, exactly `n+1` distinct substrings of `S$` contain `$` (the suffixes of `S$` that are the `$`-terminated tails), so subtract `n+1` — or equivalently build on `S$` and ignore the `$` character's contributions. The DFS computing `Σ_e len(e)` is `O(n)`.

**Worked distinct-substring example (`S = "aba"`).** Build the tree of `"aba$"`. Its distinct substrings of `S` are: `a, b, ab, ba, aba` — five. Let us confirm via the edge-length sum. The suffixes of `"aba$"` are `aba$, ba$, a$, $`. The tree has edges whose labels (and lengths) are, schematically: an `"a"` internal node (edge `"a"`, len 1) splitting into `"ba$"` (len 3) and `"$"` (len 1); a `"ba$"` leaf off the root (len 3); and a `"$"` leaf off the root (len 1). Summing edge lengths: `1 + 3 + 1 + 3 + 1 = 9`. Subtract the `n+1 = 4` substrings containing `$` to get `9 − 4 = 5`. The formula and the hand count agree.

**Alternative incremental formula.** During an online build, the number of *new* distinct substrings introduced by appending character `S[i]` equals the number of Rule-2 extensions performed in phase `i` plus the new positions created — equivalently, it is the increase in `Σ_e len(e)`. This gives a streaming distinct-substring counter without re-traversing the tree, at the cost of careful bookkeeping. The suffix automaton (Section 10) makes this incremental count especially clean via `len(v) − len(link(v))`.

---

## 8. Longest Repeated and Common Substring Correctness

**Theorem (LRS).** *The longest repeated substring of `T` equals the path-label of the deepest (max string-depth) internal node of `ST(T)`.*

**Proof.** A substring `α` repeats (occurs ≥ 2 times) **iff** `α` has at least two distinct right-extensions in `T` or occurs as both an internal occurrence and a suffix — equivalently, **iff** the locus of `α` is a branching position, i.e. an explicit internal node. (If `α` occurred ≥ 2 times, the characters following each occurrence either differ, forcing a branch, or one occurrence is a suffix ending in `$`, again forcing a branch with the `$` edge.) Among all internal nodes, the one of greatest string-depth has the longest such `α`. Hence the deepest internal node's path-label is the longest repeated substring. ∎

**Theorem (LCS of two strings).** *Build the generalized suffix tree of `A #_1 B #_2` with distinct separators. Tag each leaf by its source string. The longest common substring of `A` and `B` equals the path-label of the deepest internal node whose subtree contains leaves from **both** `A` and `B`.*

**Proof.** A string `α` is a common substring **iff** it occurs in `A` and in `B`, **iff** the subtree below `α`'s locus contains a leaf from `A` and a leaf from `B` (each leaf is a suffix start of one source). The deepest internal node satisfying this maximizes `|α|`. Distinct separators are required so that no path-label spans the `A`–`B` boundary (otherwise a "common" substring could be an artifact of the concatenation). ∎

Both are computed with a single post-order DFS: string-depths and per-node color (source) sets, in `O(n)` (with bitsets / small-to-large for the color sets).

**Occurrence count is the leaf count.** A finer statement than LRS: for any substring `α` with locus at node or edge-position `p`, the number of occurrences of `α` in `T` equals the number of **leaves** in the subtree rooted at the first explicit node at or below `p`. *Proof.* Each leaf `ℓ_i` corresponds to suffix `T[i..n]`; `α` occurs starting at position `i` **iff** `α` is a prefix of `T[i..n]` **iff** `ℓ_i` is in the subtree below `α`'s locus. So the leaf count *is* the occurrence count. ∎ This is why occurrence queries are `O(m + occ)`: walk to the locus (`O(m)`), then enumerate the `occ` leaves below it.

**Generalization to k strings.** For `k` strings, tag each leaf with a color in `{0,…,k-1}` and store per-node a `k`-bit color set. The longest substring common to *all* `k` is the deepest node with a full color set; the longest common to *at least* `t` of them is the deepest node whose color popcount `≥ t`. The color-set DFS is `O(nk/w)` with word-parallel bitsets (`w` = word size) or `O(n log k)` with small-to-large merging — both linear up to the `k`/log factor, preserving the suffix tree's advantage.

---

## 9. Equivalence to Suffix Array + LCP

The suffix tree and the (suffix array, LCP array) pair carry the **same information**; each is recoverable from the other in `O(n)`.

**From tree to array.** Order each node's children by the first character of their edge labels (lexicographic). Perform a DFS visiting children in this order. The leaves are then visited in **increasing lexicographic order of their suffixes**, so the sequence of leaf suffix-start indices is exactly the **suffix array** `SA`. Moreover, for consecutive leaves `ℓ_{SA[r]}` and `ℓ_{SA[r+1]}`, the string-depth of their **lowest common ancestor** equals `LCP[r+1]` — the longest common prefix of the two adjacent suffixes. Formally:

```
SA[r]      = suffix-start index of the r-th leaf in lexicographic DFS order
LCP[r]     = string-depth of LCA(leaf_{r-1}, leaf_r)
```

**From array to tree.** Given `SA` and `LCP`, build the suffix tree by a left-to-right sweep using a stack of "current rightmost path" nodes keyed by string-depth: for each new suffix, pop nodes deeper than `LCP[r]`, create an internal node at depth `LCP[r]` if needed, and attach the new leaf. This is the standard `O(n)` "LCP-interval tree" construction. The LCP-interval tree is isomorphic to the suffix tree's internal-node structure.

**Worked equivalence example (`S = "banana"`).** The suffix array of `"banana$"` and its LCP array:

```
rank  SA   suffix         LCP
 0     6   $               -
 1     5   a$              0
 2     3   ana$            1
 3     1   anana$          3
 4     0   banana$         0
 5     4   na$             0
 6     2   nana$           2
```

The maximum LCP value is `3` (between `ana$` and `anana$`), and the corresponding shared prefix `"ana"` is the **longest repeated substring** — exactly the deepest internal node of the suffix tree. The internal nodes of the tree correspond to the *distinct* LCP-interval boundaries: an internal node of string-depth `d` exists wherever `d` is the minimum LCP over some maximal range of ranks. So `"a"` (depth 1, ranks 1–3), `"ana"` (depth 3, ranks 2–3), and `"na"` (depth 2, ranks 5–6) are the internal nodes — matching the hand-built tree from `junior.md`. This is the equivalence made concrete: the array's LCP minima *are* the tree's branching nodes.

**Distinct substrings from the array.** The same data gives distinct-substring counts directly:

```
#distinct substrings of S = Σ_r (n − SA[r]) − Σ_r LCP[r]
```

For `"banana"` (`n = 6`, ignoring the `$` row appropriately) this yields the same count the tree's `Σ_e len(e)` formula gives. The two formulas are algebraically equal because each suffix contributes its length minus its overlap with the previous suffix — precisely what an edge's incremental length encodes in the tree.

The stack-sweep construction in precise pseudocode:

```
procedure SA_LCP_TO_TREE(SA, LCP, n):
    root ← new node (depth 0)
    stack ← [root]
    for r in 0 .. n-1:
        # pop nodes deeper than the new LCP boundary
        last ← null
        while depth(top(stack)) > LCP[r]:
            last ← pop(stack)
        if depth(top(stack)) < LCP[r]:
            # split: insert a new internal node at depth LCP[r]
            mid ← new internal node (depth LCP[r])
            attach last under mid
            push(stack, mid)
        else if last ≠ null:
            attach last under top(stack)
        leaf ← new leaf for suffix SA[r] (depth n − SA[r])
        attach leaf under top(stack)
        push(stack, leaf)
    return root
```

Each suffix is pushed once and each node popped once, so the sweep is `O(n)`. The resulting internal nodes are exactly the LCP-interval boundaries, confirming the isomorphism with `ST(T)`'s internal structure.

**Theorem (equivalence).** *`ST(T)` and `(SA, LCP)` are inter-convertible in `O(n)` time, and any query answerable by one is answerable by the other within the same asymptotic budget (up to an `O(log n)` factor for array binary search vs `O(m)` tree walking).*

**Proof sketch.** The two `O(n)` constructions above are mutually inverse: tree→(SA,LCP) by ordered DFS, (SA,LCP)→tree by the stack sweep. The internal nodes correspond exactly to the distinct LCP-interval boundaries (RMQ minima), and the leaves to `SA` entries. Both encode the set of all suffixes and their branching structure. ∎

This equivalence is *the* reason engineers substitute a suffix array for a suffix tree: identical expressive power, `~4×` less memory, far simpler `O(n)`-`O(n log n)` construction (SA-IS, DC3, or `O(n log² n)` doubling), and Kasai's `O(n)` LCP. The suffix array is the suffix tree "flattened."

---

## 10. Relationship to the Suffix Automaton

The **suffix automaton (SAM)** of `S` (sibling `12`) is the minimal deterministic finite automaton recognizing all substrings of `S`. There is a precise duality:

**Fact.** *The suffix automaton of `S` is closely related to the suffix tree of the **reverse** `S^R`.* The states of `SAM(S)` correspond to **endpos-equivalence classes** of substrings, and the **suffix-link tree** of the suffix automaton is isomorphic to the suffix tree of `S^R` (the so-called "suffix link tree = suffix tree of reverse"). Concretely, the SAM's suffix links form a tree whose structure mirrors `ST(S^R)`.

**Consequence.** Distinct-substring counting has two dual formulas:
- Suffix tree: `Σ_e len(e)` (Section 7).
- Suffix automaton: `Σ_{states v ≠ init} (len(v) − len(link(v)))`, the per-state contribution of new substrings.

Both yield the same total. The automaton is typically lighter (linear in states, single-character transitions) and online, making it the preferred structure when distinct-substring counts or substring membership over a streaming string are the goal — while the suffix tree's advantage is the explicit edge-compressed branching that makes operations like matching statistics and LZ factorization natural.

**Comparison of the three "all-substring" structures:**

| Property | Suffix tree | Suffix array + LCP | Suffix automaton |
|----------|-------------|--------------------|------------------|
| Object indexed | suffixes (compressed trie) | sorted suffix order | substring DFA (minimal) |
| Nodes/states | `≤ 2n+1` | `n` array entries | `≤ 2n−1` states |
| Edge labels | substrings `[start,end]` | — | single characters |
| Build | `O(n)` (Ukkonen) | `O(n)` (SA-IS) | `O(n)` (online) |
| Substring query | `O(m)` walk | `O(m log n)` / `O(m+log n)` | `O(m)` transitions |
| Distinct substrings | `Σ_e len(e)` | `Σ (n − SA[i]) − LCP[i]` | `Σ (len−len∘link)` |
| Memory weight | heavy | light | medium |
| Online (append) | yes | no | yes |

The three are inter-translatable, and a senior engineer chooses among them by the *cost model* of the deployment (memory budget, query mix, update pattern), not by theoretical elegance. The proofs in this file establish *why* they carry the same information; the engineering files (`senior.md`) establish *which* to ship.

**Weiner's and McCreight's algorithms (historical context).** Ukkonen (1995) was not the first linear-time suffix-tree construction. Weiner (1973) built the tree by inserting suffixes from *shortest to longest* using "indicator vectors" — the original linear algorithm, but memory-hungry. McCreight (1976) inserted suffixes from *longest to shortest* with suffix links, halving the space. Ukkonen's contribution was the **online, left-to-right** construction with the clean active-point formulation, which is both implementable and pedagogically transparent. All three are `O(n)`; Ukkonen's is the one taught and shipped today precisely because of the active-point abstraction this topic emphasizes.

---

### 10.1 Matching Statistics Correctness

**Definition (matching statistics).** For a text `T` (indexed by a suffix tree) and a query `P`, the matching-statistics array `ms[0..|P|-1]` has `ms[k] = ` the length of the longest prefix of `P[k..]` that is a substring of `T`.

**Theorem.** *Matching statistics can be computed in `O(|P|)` time using the suffix tree of `T` and its suffix links.*

**Proof / algorithm.** Maintain a current locus (node + offset) in `ST(T)` and a current matched length `ℓ`. Scan `P` left to right:

1. While the next character `P[k+ℓ]` continues the current locus, descend and increment `ℓ`; record progress.
2. On a mismatch, set `ms[k] = ℓ`, then advance to `k+1` by following the **suffix link** of the nearest ancestor node and re-descending the leftover via skip/count.

The suffix link drops exactly one character from the front of the current match, so re-establishing the locus for `P[k+1..]` costs amortized `O(1)` — the same potential argument as Section 6 (the matched depth can fall by at most 1 per link hop and rises monotonically with the scan). Total time `O(|P|)`. ∎

Matching statistics generalize substring search to *every* starting position at once and are the engine behind approximate matching, the Lempel–Ziv factorization, and longest-common-extension queries.

### 10.2 The Walks-vs-Simple-Paths Analogue: Substrings vs Subsequences

The suffix tree indexes contiguous **substrings**. A natural-seeming but fundamentally harder relative is counting distinct **subsequences**, and the gap is instructive:

| Problem | Structure | Complexity |
|---------|-----------|------------|
| #distinct substrings | suffix tree / array / automaton | `O(n)` |
| #distinct subsequences | last-occurrence DP | `O(n·|Σ|)` count, but `2^n` objects |
| Longest repeated substring | deepest internal node | `O(n)` |
| Longest repeated subsequence | DP (variant of LCS) | `O(n²)` |

The reason substrings are easy is **suffix-closure plus contiguity**: a suffix tree compactly represents all `Θ(n²)` substrings in `O(n)` space because they nest into `O(n)` equivalence classes (the edge positions). Subsequences have no analogous linear-size index — there can be exponentially many distinct ones and they do not nest into a compressed trie of linear size. This is the conceptual boundary of what suffix trees buy you: contiguity is everything.

---

## 11. Worked Construction Trace

We trace Ukkonen on `T = "xabxa$"` to see the active point, the global end, and the rules in concert. Index: `x=0 a=1 b=2 x=3 a=4 $=5`.

**Phase 0 (`x`).** `leafEnd = 0`, `remaining = 1`. Active point at root. Rule 2: add leaf `[0,#]` for `x`. `remaining = 0`. Tree: `root —x…→ leaf0`.

**Phase 1 (`a`).** `leafEnd = 1`, `remaining = 1`. Root has no `a` child. Rule 2: add leaf `[1,#]`. `remaining = 0`. Tree has two leaves (`x…`, `a…`).

**Phase 2 (`b`).** `leafEnd = 2`, `remaining = 1`. Root has no `b` child. Rule 2: add leaf `[2,#]`. `remaining = 0`.

**Phase 3 (`x`).** `leafEnd = 3`, `remaining = 1`. Now active point: `active_edge = x`, `active_length` becomes 1. The `x…` edge already continues — but its next char after `x` is `a` (position 1), and we are adding `x` at position 3... The active point sits at root, `x` exists, and `T[start_of_x_edge + 0] = x = T[3]` → **Rule 3**: `active_length = 1`, stop. `remaining` stays 1 (carried forward — `"x"` is now implicit).

**Phase 4 (`a`).** `leafEnd = 4`, `remaining = 2`. We are 1 char into the `x…` edge; the next char on it is `a` (position 1) and we add `a` (position 4) → match → **Rule 3**: `active_length = 2`, stop. `remaining = 2` (now `"xa"` and `"a"` are implicit).

**Phase 5 (`$`).** `leafEnd = 5`, `remaining = 3`. `$` matches nothing. We are 2 chars into the `x…` edge (`"xa"`); `$ ≠ b` → **Rule 2 split**: create internal node for `"xa"`, attach the old tail and a new `$` leaf. Follow active-point update; the active point moves (via the root convention, since `active_node` is root) to handle suffix `"a"`: another **Rule 2 split** creating the `"a"` internal node, with a **suffix link** from the `"xa"` node to the `"a"` node. Then suffix `"$"` itself: **Rule 2** new leaf. `remaining = 0`. The tree is now explicit, with internal nodes `"xa"` and `"a"` and a suffix link `"xa" → "a"`.

This trace shows all three rules, the carry-over of `remaining` across phases (the heart of the implicit tree), and the creation of the suffix link during the sentinel phase.

**Per-phase summary table for `"xabxa$"`:**

| Phase | char | leafEnd | rules fired | remaining after | new nodes |
|-------|------|---------|-------------|-----------------|-----------|
| 0 | x | 0 | R2 leaf | 0 | leaf(x) |
| 1 | a | 1 | R2 leaf | 0 | leaf(a) |
| 2 | b | 2 | R2 leaf | 0 | leaf(b) |
| 3 | x | 3 | R3 | 1 | — (implicit "x") |
| 4 | a | 4 | R3 | 2 | — (implicit "xa","a") |
| 5 | $ | 5 | R2 split ×2, R2 leaf | 0 | int("xa"), int("a"), leaf($) + slink |

Notice phases 3 and 4 do *no* structural work (pure Rule 3, `O(1)` each) but grow `remaining`; phase 5 then does three extensions, "paying off" the accumulated backlog. The total structural work across all six phases is the number of Rule-2 extensions = 6 = `O(n)`, exactly matching the `remaining`-counting bound. This is the amortization made visible: cheap phases bank work that an expensive phase later discharges, with the *total* staying linear.

**Reading the final tree.** After phase 5, the suffix tree of `"xabxa$"` has 6 leaves (one per suffix), internal nodes for the repeated substrings `"xa"` and `"a"`, and a suffix link `"xa" → "a"`. The deepest internal node is `"xa"` (string-depth 2), so the longest repeated substring of `"xabxa"` is `"xa"` — which indeed occurs twice (positions 0 and 3). The tree *is* the answer, with no extra computation beyond a depth-tracking DFS.

---

## 11b. Edge Cases the Proofs Must Handle

Rigorous correctness requires that the construction and the query proofs hold at the boundaries. We enumerate them:

1. **Empty string `S = ""`.** `T = "$"`. One phase, one leaf for `$`. The tree is the root plus a single `$`-leaf. The node bound `2n+1 = 1` (with `n=0`, counting `T` of length 1 gives 1 leaf) holds. Substring queries on the empty pattern trivially succeed at the root.
2. **Single character `S = "a"`.** `T = "a$"`. Two leaves (`a$`, `$`), no internal nodes beyond the root. `Σ_e len(e) = 2 + 1 = 3`; minus `n+1 = 2` `$`-substrings gives `1` distinct substring (`"a"`), correct.
3. **All identical `S = a^n`.** `T = a^n$`. The implicit tree before the `$` phase is a single path; the `$` phase fires `n+1` Rule-2 extensions, the maximum for one phase. This is the worst case for `remaining` (it grows to `n+1`) and the canonical test that the amortized bound holds even when one phase does `Θ(n)` work — earlier phases did `O(1)`, so the *amortized* per-phase cost is still `O(1)`.
4. **No repeats `S` = all distinct characters.** No internal nodes except the root; every suffix is a direct leaf off the root. The longest-repeated-substring query correctly returns empty (no internal node of depth ≥ 1).
5. **Sentinel collision.** If `$` were not unique, distinctness fact 3 fails, some suffix becomes a prefix of another, and the explicit-tree theorem (Section 4.2 corollary) breaks. The proofs *require* a unique sentinel; this is a hypothesis, not an implementation detail.

Each boundary is a place where an off-by-one in the implementation or a missing hypothesis in the proof would surface. A complete correctness argument checks all five.

## 11c. Lower Bounds and Optimality

**Theorem (construction optimality).** *Any comparison-based algorithm that builds a structure supporting `O(m)` substring queries over `S` must read all of `S`, so `Ω(n)` is a lower bound; Ukkonen's `O(n)` is therefore asymptotically optimal for constant alphabets.*

For general (large) alphabets, the lower bound becomes `Ω(n log |Σ|)` in the comparison model, matching the cost of sorting the alphabet at branch points — which is why balanced-tree children incur a `log |Σ|` factor and why integer-alphabet suffix *arrays* (via SA-IS) can sometimes shave it with radix techniques. The suffix tree's per-node children container is exactly where this alphabet factor lives:

| Children container | Build factor | Query factor |
|--------------------|--------------|--------------|
| Array `[|Σ|]` | `O(1)`, `O(|Σ|)` space/node | `O(1)` |
| Hash map | `O(1)` expected | `O(1)` expected |
| Balanced BST / sorted | `O(log|Σ|)` | `O(log|Σ|)` |

The asymptotic `O(n)` headline assumes constant alphabet (array children); state this assumption explicitly in any formal complexity claim.

## 12. Complexity Cheat Table

| Quantity | Bound | Justification |
|----------|-------|---------------|
| Build time (Ukkonen) | `O(n)` | global end + bounded Rule-2 + skip/count potential |
| Build space | `O(n)` | `≤ 2n+1` nodes, `O(1)` per edge |
| Leaves | `n+1` | one per suffix of `S$` |
| Internal nodes | `≤ n` | every internal node is ≥ binary |
| Total Rule-2 ops | `≤ n` | `remaining` decremented `≤ n` times |
| Skip/count steps | `O(n)` | node-depth potential argument |
| Substring query "P in S?" | `O(m)` | walk down following `P` |
| Count occurrences | `O(m + occ)` | walk + leaf enumeration |
| Distinct substrings | `O(n)` | sum of edge lengths via one DFS |
| Longest repeated substring | `O(n)` | deepest internal node |
| Longest common substring (k strings) | `O(total)` | generalized tree + color sets |
| Tree ↔ (SA, LCP) conversion | `O(n)` | ordered DFS ↔ stack sweep |

For an alphabet of size `|Σ|`, multiply child-lookup-dependent steps by `O(1)` (array children) or `O(log|Σ|)` (sorted/balanced children); hash-map children give `O(1)` expected with a larger constant.

### Invariants Worth Memorizing

A compact list of the load-bearing facts, each proved above:

1. **Substring ↔ locus**: `α` is a substring of `T` iff it has a position in the tree.
2. **Node bound**: `n+1` leaves, `≤ n` internal nodes, `≤ 2n+1` total.
3. **Phase invariant**: after phase `i`, the tree equals `IST_i`.
4. **Show-stopper**: the first Rule 3 in a phase ends the phase.
5. **Suffix-link existence**: a branching `xα` forces a branching `α`.
6. **Rule-2 bound**: total Rule-2 extensions `≤ n` via `remaining`.
7. **Skip/count bound**: total descent steps `O(n)` via node-depth potential.
8. **Occurrence = leaf count** below the locus.
9. **LRS = deepest internal node** by string-depth.
10. **Distinct = `Σ_e len(e)`** (minus `$`-bearing substrings).
11. **Tree ≡ (SA, LCP)** under ordered DFS / stack sweep.
12. **SAM suffix-link tree ≡ `ST(S^R)`** (reverse-string duality).

If you can state these twelve and sketch the proof of each, you understand the suffix tree at the level this file targets.

### Closing Notes

The mathematics of the suffix tree rests on a single structural insight — **every substring is a prefix of a suffix** — and a single representational insight — **store edge labels as index pairs**. Together they compress the `Θ(n²)`-character suffix trie into an `O(n)`-node tree. Ukkonen's algorithm then exploits three further insights to *build* that tree online in linear time, each removing one factor of `n` from the naive cost:

- the **global end** removes the per-leaf extension cost (Rule 1 becomes free),
- **suffix links** remove the re-descent-from-root cost (each hop is `O(1)`),
- **skip/count** removes the per-character re-descent cost (count, don't compare).

The correctness rests on the **implicit-suffix-tree invariant** preserved by the three rules, and the linearity rests on two counting arguments: `remaining` bounds Rule-2 work, and a node-depth potential bounds skip/count work. The applications — substring search, longest repeated, longest common, distinct counts, matching statistics — all reduce to reading the tree's structure (leaves, internal nodes, edge lengths) in `O(n)` or `O(m)`.

Finally, the proofs in Sections 9 and 10 establish that the suffix tree is *one of three equivalent windows* onto the same combinatorial object — the suffixes of `S` and their shared prefixes. The suffix array flattens it; the suffix automaton minimizes its reverse. Knowing the equivalences is what lets a practitioner pick the lightest representation that meets the query contract, which is the recurring senior-level recommendation: reach for the suffix tree only when its explicit `O(m)` walking or online growth is genuinely needed, and otherwise prefer the array.

---

## 13. Summary

The suffix tree `ST(S$)` is the path-compressed trie of all suffixes of `S$`, with edges stored as index pairs, giving exactly `n+1` leaves, at most `n` internal nodes, and `O(n)` total space (the index-pair representation collapses a `Θ(n²)` trie). Ukkonen's online construction maintains the **implicit-suffix-tree invariant** `IST_i` after each phase; the **three extension rules** preserve it — Rule 1 extends leaves (free via the global end), Rule 2 splits/creates internal nodes (the only structural work), and Rule 3 detects an existing continuation and stops the phase, leaving shorter suffixes implicit (justified by the show-stopper lemma). **Suffix links exist** because a branching node `xα` forces `α` to branch as well, and they are set within one extension of a node's creation. The **amortized `O(n)`** bound follows from `remaining` capping total Rule-2 extensions at `n` and a node-depth potential capping total skip/count descents at `O(n)`. The **distinct-substring count** equals the sum of edge-label lengths, the **longest repeated substring** is the deepest internal node, and the **longest common substring** is the deepest two-colored node in a generalized tree. Finally, the suffix tree is `O(n)`-equivalent to the **suffix array + LCP array** (ordered DFS ↔ stack sweep) and dual to the **suffix automaton** of the reversed string — which is precisely why the lighter array and automaton so often stand in for the tree in practice.
