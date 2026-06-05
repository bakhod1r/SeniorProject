# Tries (Prefix Trees) for String Processing — Professional / Theoretical Level

> **One-line summary:** A trie is a **deterministic finite automaton (DFA)** for a finite language. This view yields the core theorems: `O(L)` operations *independent of the number of keys*, exact space bounds (sum of key lengths minus shared prefixes), the `O(n)` node bound for radix tries, the DAWG = minimal-DFA connection, and the correctness of trie-based string sorting (pre-order traversal = lexicographic order).

---

## Table of Contents

1. [Introduction](#introduction)
2. [A Trie Is a Deterministic Automaton](#a-trie-is-a-deterministic-automaton)
3. [Theorem: O(L) Operations Independent of n](#theorem-ol-operations-independent-of-n)
4. [Space Bounds](#space-bounds)
5. [The Radix-Trie Node-Count Bound](#the-radix-trie-node-count-bound)
6. [DAWG = Minimal DFA (Myhill–Nerode)](#dawg--minimal-dfa-myhillnerode)
7. [Sorting Correctness: Pre-order = Lexicographic](#sorting-correctness-pre-order--lexicographic)
8. [Information-Theoretic and Comparison Bounds](#information-theoretic-and-comparison-bounds)
9. [Worked Proof Examples](#worked-proof-examples)
10. [Code: Verifiable Implementations](#code-verifiable-implementations)
11. [Coding Patterns](#coding-patterns)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Cheat Sheet](#cheat-sheet)
15. [Visual Animation](#visual-animation)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

The practical files treat a trie as a tree of character edges. The theoretical view is sharper and more powerful: **a trie is a deterministic finite automaton whose accepted language is exactly the finite set of stored keys.** Every node is a state, every labeled edge is a transition `δ(state, character) → state`, the root is the start state, and the `isEnd` flag marks accepting states. Searching a key is *running the automaton* on the input string; the key is in the set iff the run ends in an accepting state.

This reframing is not decoration — it directly produces the topic's headline results. The `O(L)` cost of every operation, *independent of how many keys are stored*, is just the statement that a DFA processes a length-`L` input in `L` transitions regardless of how many states it has. The space of a trie is the number of distinct prefixes, which equals the sum of key lengths minus the savings from shared prefixes. A **radix trie** has `O(n)` nodes because every internal node branches, making it a tree with `n` leaves and bounded internal degree. A **DAWG** is precisely the **minimal DFA** for the language, the unique smallest automaton guaranteed by the Myhill–Nerode theorem. And trie-based sorting is correct because a pre-order traversal with edges visited in alphabetical order enumerates strings in exactly lexicographic order.

We prove each of these. Throughout, let `Σ` be the alphabet, `n` the number of distinct keys, `L` the length of a query, and `m = Σ |key_i|` the total number of characters across all keys.

---

## A Trie Is a Deterministic Automaton

**Definition.** Given a finite set of strings `K ⊆ Σ*`, the trie `T(K)` is the rooted tree whose nodes are in bijection with the set of **prefixes** of `K`:

```
Prefixes(K) = { p : p is a prefix of some k ∈ K }   (includes the empty string ε)
```

The root is `ε`. There is an edge labeled `c` from prefix `p` to prefix `pc` whenever both are in `Prefixes(K)`. A node `p` is **accepting** (`isEnd`) iff `p ∈ K`.

**As a DFA.** Define the automaton `M = (Q, Σ, δ, q₀, F)` where:

- `Q = Prefixes(K)` (the trie nodes),
- `q₀ = ε` (the root),
- `δ(p, c) = pc` if `pc ∈ Prefixes(K)`, else undefined (a dead transition),
- `F = K` (accepting nodes are the stored keys).

`δ` is a **partial function** that is **deterministic**: from any state, each character leads to at most one next state (a tree has at most one `c`-child per node). Running `M` on input `w` follows `δ` character by character; it accepts iff the run reaches a state in `F`, i.e. iff `w ∈ K`. This is exactly trie `search`. The language recognized is `L(M) = K`, a **finite** language — and every finite language has such a DFA. Everything below follows from this identification.

---

## Theorem: O(L) Operations Independent of n

**Theorem 1.** `search`, `startsWith`, `insert`, and prefix-count on a trie each run in `O(L · cost_of_child_step)` time, where `L` is the length of the query string, **independent of `n` (the number of stored keys).**

**Proof.** A DFA processes input by reading one symbol and taking one transition per symbol. Processing a length-`L` input therefore takes exactly `L` transitions, each of which is a single lookup `δ(state, c)`:

- with **array children**, the lookup is one indexed array access, `O(1)`;
- with **map children**, the lookup is one hash probe, `O(1)` expected;
- with a **balanced-tree / TST** node, the lookup is `O(log Σ)`.

The total is `L` lookups. `search` adds one final `O(1)` accepting-state check; `startsWith` omits it; `insert` may create a node per step (`O(1)` each); prefix-count reads one integer field. None of these touches any state off the input path, so **no part of the cost scales with `n`**. ∎

The crucial structural reason `n` never appears: the automaton's run length is bounded by the *input length*, not the *number of states*. A DFA with a million states still answers a 3-character query in 3 transitions. This is the precise sense in which a trie beats balanced-BST string maps (`O(L log n)` because of `log n` node comparisons) and matches a hash set's `O(L)` while additionally supporting prefix queries.

---

## Space Bounds

**Theorem 2 (node count of a character trie).** The number of nodes in `T(K)` equals `|Prefixes(K)|`, the number of distinct prefixes (including `ε`). Equivalently,

```
nodes(T(K)) = 1 + Σ_{k ∈ K} |k|  −  (number of shared prefix-characters)
            = 1 + |distinct nonempty prefixes|.
```

**Upper bound.** `nodes ≤ 1 + m` where `m = Σ |k|`, achieved when no two keys share any prefix (every key contributes a fresh chain). **Lower bound / savings.** Each character that two keys share collapses two would-be nodes into one, so the more prefix overlap, the fewer nodes. For a set of `n` keys all sharing a length-`q` prefix, the prefix contributes `q` shared nodes instead of `nq`.

**Proof.** By construction each node corresponds to a unique prefix and vice versa (the bijection in the definition). The number of distinct prefixes is at most the total character count plus one for `ε`, with equality iff no prefix is shared. ∎

**Edge-pointer space.** With array children, every node also stores `Σ` child slots, giving `O(Σ · nodes)` words — this is the term that makes naive tries memory-hungry for large `Σ`. With map children, total child slots equal the number of edges, which is `nodes − 1` (a tree), giving `O(m)` words. This is the formal justification for the array-vs-map trade-off in the middle/senior files.

---

## The Radix-Trie Node-Count Bound

**Theorem 3 (radix/compressed trie size).** A radix trie storing `n` keys has at most `2n − 1` nodes, i.e. `O(n)` — independent of key lengths.

**Proof.** A radix trie merges every maximal chain of single-child nodes into one edge labeled with a substring. After this compression, **every internal node has degree ≥ 2** (a node with one child would have been merged into its parent's edge). Consider the tree of internal branching nodes plus leaves:

- Each stored key corresponds to a node marked `isEnd`; there are `n` of these. In the worst case all are leaves, giving `n` leaves.
- A rooted tree in which every internal node has ≥ 2 children has at most `(leaves − 1)` internal nodes.

Therefore total nodes ≤ `n + (n − 1) = 2n − 1 = O(n)`. ∎

This is the formal reason a radix trie is dramatically smaller than a character trie for long sparse keys: the character trie's node count is bounded by `m` (total characters), while the radix trie's is bounded by `n` (number of keys) — and `m` can be arbitrarily larger than `n` (e.g. a single 10⁶-character key gives `m ≈ 10⁶` character-trie nodes but only `O(1)` radix nodes).

---

## DAWG = Minimal DFA (Myhill–Nerode)

A trie shares prefixes; a **DAWG (directed acyclic word graph) / MA-FSA** additionally shares suffixes. The theoretical statement:

**Theorem 4.** The DAWG of a key set `K` is the **unique minimal DFA** recognizing the finite language `K`.

**Proof sketch (Myhill–Nerode).** Define the equivalence on strings `x ≡_K y` iff for all `z`, `xz ∈ K ⟺ yz ∈ K` (they have the same set of "continuations to a key"). The **Myhill–Nerode theorem** states that the minimal DFA for any regular language has exactly one state per equivalence class of `≡_K`, and this minimal DFA is unique up to isomorphism. Because `K` is finite, `≡_K` has finitely many classes (so a DFA exists). Two trie subtrees are merge-equivalent in DAWG construction precisely when their nodes are `≡_K`-equivalent — they accept the same set of suffixes and have identical onward transitions. Minimizing the trie's DFA by merging equivalent states therefore yields exactly the Myhill–Nerode minimal automaton, which is the DAWG. ∎

**Consequences.** (1) The DAWG is the smallest possible automaton for membership in `K` — no representation sharing only prefixes can be smaller. (2) Because states are merged by equivalence, distinct keys may share a state; per-key data cannot be stored by state identity (hence FSTs/ordinal indexing in the senior file). (3) DFA minimization is the classic Hopcroft `O(|Q| log |Q|)` algorithm, and Daciuk's incremental method builds the minimal acyclic DFA directly from sorted input in linear time.

---

## Sorting Correctness: Pre-order = Lexicographic

**Theorem 5.** Let the trie's children at every node be visited in increasing order of edge label. Then a pre-order DFS that emits a key each time it reaches an `isEnd` node outputs the keys in **lexicographic (dictionary) order**.

**Proof.** Recall lexicographic order on strings: `x < y` iff either `x` is a proper prefix of `y`, or at the first index `i` where they differ, `x[i] < y[i]`. Consider any two distinct emitted keys `x` and `y` with longest common prefix `p = x[0..i−1] = y[0..i−1]`. Both emissions occur within the subtree rooted at node `p`.

- **Case A: `p = x` (x is a proper prefix of y).** The node `p` is `isEnd` (it is `x`) and `y` continues into a child of `p`. Pre-order emits node `p` *before* descending into any child, so `x` is emitted before `y`. And indeed `x < y` lexicographically. ✓
- **Case B: x and y diverge at index `i`.** Then `x[i] ≠ y[i]`, and `x`, `y` lie in *different* children subtrees of node `p`, namely the `x[i]`-child and the `y[i]`-child. Pre-order visits children in increasing label order, so the subtree of `min(x[i], y[i])` is fully traversed before the other. Hence the key with the smaller character at index `i` is emitted first — which is exactly the lexicographically smaller key. ✓

In both cases emission order matches lexicographic order for every pair, so the whole output is sorted. ∎

This makes a trie a **most-significant-character radix sort**: building costs `O(m)` and the traversal costs `O(m)`, giving `O(m)` total string sorting (with `O(Σ)` per-node ordering for array children, or `O(deg · log deg)` to sort map edges). It also deduplicates, since each distinct key is one `isEnd` node emitted once.

---

## Information-Theoretic and Comparison Bounds

- **Comparison lower bound.** Sorting `n` strings by comparisons is `Ω(n log n)` *comparisons*, but each comparison can cost up to `O(L)` character checks, so comparison sorts are `Ω(n L log n)` character operations in the worst case. The trie sort is `O(m) = O(n L̄)` (with `L̄` the average length) — it beats comparison sorting because it never re-compares shared prefixes.
- **Membership lower bound.** Any structure answering membership for a length-`L` key must read enough of the key to distinguish it; `O(L)` is optimal for the query, and the trie achieves it.
- **Space lower bound.** To store `n` arbitrary keys you must store their distinguishing information; the DAWG attains the minimal-automaton bound, which is the information-theoretic floor for an automaton-based membership structure over `K`.

---

## Worked Proof Examples

**Example 1 — node count.** `K = {to, tea, ted, ten, in, inn}`. Distinct prefixes: `ε, t, to, te, tea, ted, ten, i, in, inn` → 10 prefixes → 10 nodes. Sum of lengths `m = 2+3+3+3+2+3 = 16`; nodes `= 10 < 1 + 16 = 17`, the difference being shared prefixes (`t`, `te`, `in`). Matches Theorem 2.

**Example 2 — radix bound.** Same `K` as a radix trie: shared `te` collapses, the chain to `inn` partially collapses. With `n = 6` keys, Theorem 3 guarantees ≤ `2·6 − 1 = 11` nodes — and the radix trie indeed has far fewer than the character trie's 10 once chains merge (the bound is `O(n)`, here loose because keys are short).

**Example 3 — sorting.** Pre-order of the trie for `{ten, tea, to, in}` with sorted edges visits root → `i`(→`in`) → `t`(→`te`→`tea`, `te`→`ten`, then `t`→`to`), emitting `in, tea, ten, to` — exactly lexicographic. Confirms Theorem 5, including Case B at the `e` vs `o` divergence under `t`.

---

## Code: Verifiable Implementations

### Example: trie sort + node count, checked against the proofs

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type Node struct {
	ch    map[byte]*Node
	isEnd bool
}

func newNode() *Node { return &Node{ch: make(map[byte]*Node)} }

type Trie struct {
	root  *Node
	nodes int
}

func New() *Trie { return &Trie{root: newNode(), nodes: 1} } // count root

func (t *Trie) Insert(w string) {
	cur := t.root
	for i := 0; i < len(w); i++ {
		if cur.ch[w[i]] == nil {
			cur.ch[w[i]] = newNode()
			t.nodes++ // counts distinct prefixes (Theorem 2)
		}
		cur = cur.ch[w[i]]
	}
	cur.isEnd = true
}

// Sorted enumeration: pre-order with sorted edges == lexicographic (Theorem 5).
func (t *Trie) Sorted() []string {
	var out []string
	var dfs func(n *Node, path string)
	dfs = func(n *Node, path string) {
		if n.isEnd {
			out = append(out, path)
		}
		keys := make([]int, 0, len(n.ch))
		for c := range n.ch {
			keys = append(keys, int(c))
		}
		sort.Ints(keys)
		for _, c := range keys {
			dfs(n.ch[byte(c)], path+string(byte(c)))
		}
	}
	dfs(t.root, "")
	return out
}

func main() {
	t := New()
	for _, w := range []string{"to", "tea", "ted", "ten", "in", "inn"} {
		t.Insert(w)
	}
	fmt.Println("nodes:", t.nodes) // 10  (matches Example 1)
	fmt.Println(t.Sorted())        // [in inn tea ted ten to]
}
```

#### Java

```java
import java.util.*;

public class TrieProof {
    static class Node {
        TreeMap<Character, Node> ch = new TreeMap<>(); // ordered edges
        boolean isEnd;
    }
    private final Node root = new Node();
    private int nodes = 1;

    public void insert(String w) {
        Node cur = root;
        for (char c : w.toCharArray()) {
            if (!cur.ch.containsKey(c)) { cur.ch.put(c, new Node()); nodes++; }
            cur = cur.ch.get(c);
        }
        cur.isEnd = true;
    }

    public List<String> sorted() {
        List<String> out = new ArrayList<>();
        dfs(root, new StringBuilder(), out);
        return out;
    }

    private void dfs(Node n, StringBuilder p, List<String> out) {
        if (n.isEnd) out.add(p.toString());
        for (Map.Entry<Character, Node> e : n.ch.entrySet()) { // ascending keys
            p.append(e.getKey());
            dfs(e.getValue(), p, out);
            p.deleteCharAt(p.length() - 1);
        }
    }

    public int nodeCount() { return nodes; }

    public static void main(String[] args) {
        TrieProof t = new TrieProof();
        for (String w : new String[]{"to","tea","ted","ten","in","inn"}) t.insert(w);
        System.out.println("nodes: " + t.nodeCount()); // 10
        System.out.println(t.sorted());                // [in, inn, tea, ted, ten, to]
    }
}
```

#### Python

```python
class Node:
    __slots__ = ("ch", "is_end")

    def __init__(self):
        self.ch = {}
        self.is_end = False


class Trie:
    def __init__(self):
        self.root = Node()
        self.nodes = 1  # root

    def insert(self, w):
        cur = self.root
        for c in w:
            if c not in cur.ch:
                cur.ch[c] = Node()
                self.nodes += 1     # distinct prefixes (Theorem 2)
            cur = cur.ch[c]
        cur.is_end = True

    def sorted_keys(self):
        out = []

        def dfs(n, path):
            if n.is_end:
                out.append(path)
            for c in sorted(n.ch):  # ascending edge labels (Theorem 5)
                dfs(n.ch[c], path + c)

        dfs(self.root, "")
        return out


if __name__ == "__main__":
    t = Trie()
    for w in ["to", "tea", "ted", "ten", "in", "inn"]:
        t.insert(w)
    print("nodes:", t.nodes)      # 10
    print(t.sorted_keys())        # ['in', 'inn', 'tea', 'ted', 'ten', 'to']
```

**Run:** `go run main.go` | `javac TrieProof.java && java TrieProof` | `python proof.py`

---

## Amortized and Average-Case Analysis

The worst-case bounds above (`O(L)` per op, `O(m)` build) are the headline, but the *average* behavior over realistic key distributions is sharper and explains why tries perform so well in practice.

**Expected depth under random keys.** Suppose `n` keys are drawn from an alphabet of size `Σ` with each character independent and uniform. The expected depth at which two random keys first diverge — the expected length of their longest common prefix — is `O(log_Σ n)`. Intuitively, after `d` characters there are `Σ^d` possible prefixes, and once `Σ^d ≫ n` the keys almost surely occupy distinct prefixes, so they separate by depth `d ≈ log_Σ n`. Therefore:

```
Expected internal (branching) path length ≈ log_Σ n
Expected number of nodes for n random keys ≈ O(n · log_Σ n) for the shared upper part,
plus the per-key suffix tails.
```

This is the same `log_Σ n` that governs the expected height of a random trie (a classic result of Knuth and of Régnier/Jacquet via the "Poissonization" technique and Mellin-transform analysis of digital trees). The practical takeaway: although a single key of length `L` gives a worst-case path of length `L`, the *branching* portion of a trie over `n` random keys is only logarithmically deep; the long tails are unshared suffixes that a radix trie compresses away to single edges.

**Build cost is `O(m)`, not `O(m log n)`.** Unlike a balanced-BST string map (which pays `O(L log n)` per insert because each of the `log n` node comparisons may scan up to `L` characters), the trie pays `O(L)` per insert with no `log n` factor. Summed over all keys this is `O(m)` total — strictly better than comparison-based string maps whenever `n` is large. This is the precise quantitative advantage of "digital" search (decide by the next character) over "comparison" search (decide by comparing whole keys).

**Successful vs unsuccessful search.** A successful `search` of key `k` always costs exactly `|k|` transitions. An *unsuccessful* search costs only the length of the longest stored prefix of the query before the path breaks — on random data, `O(log_Σ n)` expected, because most queries diverge from every stored key within the first few characters. Tries reject non-members fast, a property hash sets do not share (a hash set must compute the full hash of the whole query first).

---

## Connection to Suffix Trees and Aho-Corasick

The trie is the base structure for two of the most important string algorithms, and the automaton view makes the relationship precise.

**Aho-Corasick = trie + failure function = full DFA over `Σ*`.** The plain trie's transition function `δ` is *partial*: from a state, only the characters that continue some key are defined. Aho-Corasick *completes* the automaton by adding a **failure link** from each state `p` to the longest proper suffix of `p` that is also a trie state, then deriving total transitions `δ̂(p, c)` for **every** character. The result is a DFA over the full alphabet `Σ*` that, while scanning a text once, reports every occurrence of every dictionary key. Formally, the failure links turn the prefix-tree DFA (which only recognizes the keys exactly) into the minimal automaton recognizing `Σ* · K` — "any text ending in a key." The trie supplies the **goto** function; the failure links supply the rest. This is why the dictionary in Aho-Corasick (sibling `05`) is literally a trie: the trie *is* the goto automaton.

**Suffix tree = compressed trie of all suffixes.** A suffix tree of a string `S` is a *radix trie* (Theorem 3 applies) built over the set of all suffixes of `S`. Because there are `|S|` suffixes, the radix bound gives `O(|S|)` nodes — the reason suffix trees are linear-size despite representing quadratically many substrings. Every substring of `S` is a prefix of some suffix, hence a path from the root, so substring queries become prefix walks. The path-compression that makes a radix trie `O(n)` nodes is exactly what makes a suffix tree `O(|S|)` rather than `O(|S|²)`.

Both results are corollaries of the trie theory in this file: Aho-Corasick from the DFA view (Section 2), suffix trees from the radix node-count bound (Theorem 3). The trie is not merely a data structure; it is the common algebraic skeleton — a deterministic automaton for a set of strings — underneath the whole string-algorithms section.

---

## Proof: startsWith and Prefix Count Are Exact

It is worth proving rigorously what the practical files assert, because the proofs pin down the exact semantics that bugs violate.

**Claim (startsWith).** `startsWith(p)` returns true iff there exists a stored key `k ∈ K` with `p` a prefix of `k`.

**Proof.** `startsWith(p)` walks `p` and returns true iff the run `δ*(ε, p)` is defined, i.e. iff `p ∈ Prefixes(K)`. By the definition of `Prefixes(K)`, `p ∈ Prefixes(K)` iff `p` is a prefix of some `k ∈ K`. The two conditions are literally the same set, so the procedure is exactly correct — and note it must **not** consult `isEnd`, since `p` itself need not be a stored key (it need only be *some key's* prefix). ∎

**Claim (prefix count).** With `passCount(node)` defined as the number of stored keys (with multiplicity) whose path passes through `node`, `countPrefix(p) = passCount(δ*(ε, p))`, and this equals `|{ k ∈ K : p is a prefix of k }|` counted with multiplicity.

**Proof.** A key `k` passes through the node for prefix `p` iff `p` is a prefix of `k` (the path of `k` includes every prefix of `k` as a node, and no others). Insert increments `passCount` at exactly the nodes on `k`'s path, i.e. at exactly `k`'s prefixes. Therefore after all inserts, `passCount(node_p)` equals the number of keys having `p` as a prefix, with multiplicity. Reading it is `O(L)` (one walk), establishing both correctness and complexity. ∎

**Corollary (consistency under deletion).** If `delete(k)` decrements `passCount` along `k`'s path and clears/decrements the end marker, then `passCount` remains the invariant above. Pruning a node is safe iff its `passCount` reaches 0 (no key passes through it) — equivalently, it has no children and is not an end-of-word. This is the formal justification for the deletion algorithm in `middle.md`: the prune condition is exactly `passCount == 0`.

---

## Lower Bounds and Optimality Discussion

How good *is* a trie, in an absolute sense? We frame three optimality statements.

**1. Query optimality.** Any algorithm that decides membership of a length-`L` key in an arbitrary set must, in the worst case, examine all `L` characters (otherwise two keys differing only in an unexamined position are indistinguishable). The trie's `O(L)` query is therefore worst-case optimal up to the per-character lookup constant. No structure can do asymptotically better on the query length.

**2. Sorting optimality.** Comparison-based sorting of `n` strings needs `Ω(n log n)` comparisons, and each comparison may scan `Θ(L)` characters, giving `Ω(n L log n)` character operations in the adversarial case. The trie sort runs in `Θ(m) = Θ(n L̄)` character operations (Theorem 5), with **no** `log n` factor, because it never re-examines a shared prefix and never compares two keys directly. So for string sorting the trie (MSD radix) provably beats every comparison sort on the character-operation measure — the comparison lower bound simply does not apply to digital methods.

**3. Space optimality (DAWG).** Among automata recognizing exactly the language `K`, the DAWG is the minimum-state one (Theorem 4, Myhill–Nerode). No prefix-only structure (plain or radix trie) can be smaller than the DAWG, because the DAWG additionally collapses suffix-equivalent states. The DAWG thus attains the information-theoretic floor *for the automaton model*; structures outside that model (e.g. succinct tries with rank/select bit-vectors, or minimal perfect hashing) can approach the raw entropy `log₂ C(|Σ*|≤ℓ, n)` bits, which is a different and even tighter benchmark covered in succinct-data-structure literature.

These bounds explain the engineering choices in `senior.md`: pick the radix trie when you want `O(n)` nodes with prefix queries, the DAWG when you want the minimal automaton for pure membership, and a succinct/FST representation when you need both minimal size and payloads.

---

## Algebraic View: Tries as Free Monoid Quotients

For readers comfortable with a little algebra, there is a clean structural statement that unifies everything above.

Strings over `Σ` form the **free monoid** `Σ*` under concatenation, with the empty string `ε` as identity. A trie over a key set `K` is the **prefix-closed sub-poset** of `Σ*` generated by `K` under the prefix order `⊑` (where `x ⊑ y` iff `x` is a prefix of `y`):

```
Nodes(T(K)) = ↓K = { x ∈ Σ* : x ⊑ k for some k ∈ K }   (the down-set of K)
```

- The **prefix order** `⊑` is a partial order; the trie is its Hasse diagram restricted to `↓K`, drawn as a tree because each non-root element has a unique immediate predecessor (drop the last character).
- Each **edge** `x → xc` is the covering relation in `⊑`: `xc` covers `x` because nothing sits strictly between them.
- `isEnd` is the **indicator of `K`** as a subset of the node set `↓K`.

| Algebraic object | Trie counterpart |
|------------------|------------------|
| Free monoid `Σ*` | all possible strings (the universe) |
| Identity `ε` | the root |
| Concatenation `x · c` | following edge `c` from node `x` |
| Prefix order `⊑` | ancestor relation in the tree |
| Down-set `↓K` | the set of trie nodes |
| Indicator `1_K` | the `isEnd` flags |

This view makes several facts immediate. **Closure under prefixes** (`↓K` is down-closed) is *why* a trie is well-defined: every prefix of a stored key is itself a node. **Lexicographic order** is the linear extension of `⊑` induced by ordering each node's covers by their edge label — directly giving Theorem 5. And **DAWG minimization** is a quotient: it identifies nodes with the same *future* (the set of suffixes leading to `K`), i.e. the Myhill–Nerode quotient of the automaton, which is the right-congruence on `Σ*` defining the minimal DFA. The radix trie is the same poset with the *vertices of degree ≤ 2 along chains suppressed* — a topological contraction that preserves the order but compresses representation. Seen this way, every theorem in this file is a statement about one object — the down-set `↓K` in the free monoid — viewed either as a tree (trie), a contracted tree (radix trie), or a minimized automaton (DAWG).

---

## Generalizing the Semiring: Weighted Tries and Transducers

The plain trie answers a Boolean question — *is `w ∈ K`?* Generalizing the accepting value from a Boolean to a value in a **semiring** turns the same structure into a weighted automaton, which is the theoretical basis for FSTs and many string-processing tasks.

Recall a semiring `(S, ⊕, ⊗, 0̄, 1̄)` has an "add" `⊕` and a "multiply" `⊗`. Attach to each edge a weight in `S` and to each accepting node a final value; the value of a string is the `⊗`-product of edge weights along its path, `⊗`-ed with the final value, and the value of a *set* of paths is their `⊕`-sum. Different semirings recover different tasks:

| Semiring | `⊕` | `⊗` | A weighted trie computes |
|----------|-----|-----|--------------------------|
| Boolean | OR | AND | membership (the plain trie) |
| Counting `(ℕ, +, ×)` | + | × | number of keys with a given prefix (`passCount`) |
| Tropical / min-plus | min | + | cheapest key matching a pattern (spell-cost) |
| Probability `([0,1], +, ×)` | + | × | total probability mass under a prefix (language models) |
| String / output | concat-merge | concat | **transducer**: emit an output string per input (FST) |

The **counting semiring** is exactly the `passCount` field formalized: edge weight `1̄ = 1`, sum at a node = number of keys through it. The **tropical semiring** underlies approximate matching and weighted spell-correction, where each edit has a cost and you want the minimum-cost dictionary word — the same `(min, +)` algebra used for shortest paths (cross-reference `11-graphs/06-floyd-warshall` and `32-paths-fixed-length`, which switch the matrix semiring for the identical reason). The **output semiring** gives the **finite-state transducer**: each accepting path emits an output (e.g. a posting-list offset in Lucene, or a normalized form in a morphological analyzer), which is precisely the "DAWG with payloads" the senior file needs.

The unifying theorem: **a trie is the Boolean instance of a weighted automaton over the free monoid, and every practical extension (prefix counting, weighted/approximate matching, transduction) is the same automaton over a richer semiring.** The structure does not change — only the algebra on the edges and accepting states does. This is the deepest reason the trie reappears everywhere in string algorithms: it is the canonical deterministic automaton for a finite set of strings, and the semiring you choose decides what question it answers.

---

## Complexity Summary Table (with derivations)

A consolidated reference, each row justified by the theorems above. Let `L` = query length, `n` = number of keys, `m` = total characters, `Σ` = alphabet size.

| Operation | Time | Why (theorem) |
|-----------|------|---------------|
| `insert(w)` | `O(L)` | one transition per character; node creation `O(1)` each (Thm 1) |
| `search(w)` | `O(L)` | DFA run length = input length, + one `isEnd` check (Thm 1) |
| `startsWith(p)` | `O(L)` | run is defined iff `p ∈ Prefixes(K)`; no final check (Thm 1, startsWith proof) |
| `countPrefix(p)` | `O(L)` | walk + read `passCount` (prefix-count proof) |
| `autocomplete(p)` | `O(L + |subtree|)` | walk + DFS over matching subtree |
| build all keys | `O(m)` | each character inserted once (Thm 2) |
| sorted iteration | `O(m)` | pre-order visits each node once (Thm 5) |
| char-trie space (array) | `O(Σ · |Prefixes(K)|)` | `Σ` child slots per node (Thm 2) |
| char-trie space (map) | `O(m)` | edges = nodes − 1 (tree) (Thm 2) |
| radix-trie space | `O(n)` | ≤ `2n − 1` nodes (Thm 3) |
| DAWG space | minimal DFA states | Myhill–Nerode minimal (Thm 4) |
| string sort | `O(m)`, no `log n` | digital, not comparison (Thm 5, optimality) |

The single structural invariant behind the entire table: **operation cost tracks the input length and the touched subtree, never the population `n`.** Every other claim in the practical files — autocomplete latency, prefix-count speed, sorting performance — is a corollary of that invariant plus the space bounds, and every space bound is a corollary of the prefix-bijection (Theorem 2) and its radix/DAWG refinements (Theorems 3–4).

---

## Coding Patterns

### Pattern 1: Treat the trie as a DFA run

**Intent:** Model `search` as "run automaton `M` on input `w`; accept iff final state ∈ F." This framing generalizes cleanly to Aho-Corasick (add failure links to make the trie a full DFA over `Σ*`) and to regex/automaton matching (sibling `05`).

### Pattern 2: Count distinct prefixes during build

**Intent:** Maintain a node counter incremented on each new node; it equals `|Prefixes(K)|` (Theorem 2), giving you exact memory accounting and a cross-check for serialization round-trips.

### Pattern 3: Minimize to a DAWG via state equivalence

**Intent:** After building, merge nodes with identical `(isEnd, sorted child signatures)` — DFA minimization — to obtain the Myhill–Nerode minimal automaton (Theorem 4). Hash each subtree's canonical signature to find duplicates in linear time.

---

## Edge Cases & Pitfalls

- **Empty string / empty set** — `ε` is always a node (the root); the empty *language* is a lone non-accepting root.
- **Partial `δ`** — a missing transition means "reject"; do not confuse an undefined transition with a defined transition to a dead state.
- **Accepting vs non-accepting prefixes** — a node can be a state on the path to other keys without being accepting; `isEnd` distinguishes `F` from `Q \ F`.
- **DAWG node identity** — minimization merges states, so node identity no longer equals key identity; per-key data needs ordinals/FST.
- **Sorting with unordered children** — Theorem 5 *requires* edges visited in label order; a hash-map trie must sort edges or the output is not lexicographic.
- **Radix bound applies to compressed tries only** — the `2n−1` bound assumes every internal node branches; an uncompressed character trie does not satisfy it.

---

## Common Mistakes

1. **Claiming `O(L)` "because the trie is balanced"** — it is `O(L)` because a DFA run length equals the *input* length, not for any balance reason; `n` is irrelevant.
2. **Confusing the character-trie node bound (`O(m)`) with the radix-trie bound (`O(n)`)** — different structures, different proofs.
3. **Believing a DAWG can store per-word values by node** — shared states forbid it (Theorem 4 consequence).
4. **Asserting sorted output without ordered edge traversal** — Theorem 5 has a hypothesis; drop it and the output is arbitrary.
5. **Treating `startsWith` as an accepting-state query** — `startsWith` checks state *existence* (`δ*` defined), not membership in `F`.
6. **Forgetting `ε`** — the empty prefix is a real node/state; off-by-one node counts come from omitting it.

---

## Cheat Sheet

| Result | Statement |
|--------|-----------|
| Automaton view | Trie = DFA with `Q=Prefixes(K)`, `q₀=ε`, `F=K`, `δ(p,c)=pc` |
| Operation time | `O(L)` per op, independent of `n` (DFA run length = input length) |
| Char-trie nodes | `|Prefixes(K)| ≤ 1 + m`; equality iff no shared prefix |
| Edge space | `O(Σ·nodes)` array vs `O(m)` map |
| Radix-trie nodes | `≤ 2n − 1 = O(n)` (every internal node branches) |
| DAWG | unique minimal DFA for `K` (Myhill–Nerode) |
| Sort | pre-order + ordered edges = lexicographic; `O(m)` total |
| Membership optimality | `O(L)` query is optimal (must read the key) |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> Read the animation through the automaton lens: each node is a DFA state, each highlighted walk is a *run* of the automaton on the input, the green "match" highlight marks reaching an accepting state (`isEnd`), and the alphabetical child ordering is exactly the hypothesis of the sorting theorem.

---

## Summary

Seeing a trie as a deterministic finite automaton for a finite language explains everything. Operations are `O(L)` independent of `n` because a DFA's run length equals its input length, not its state count (Theorem 1). A character trie has `|Prefixes(K)| ≤ 1 + m` nodes, with shared prefixes shrinking the count (Theorem 2), while a radix trie has `O(n)` nodes because every internal node branches (Theorem 3). The DAWG is the unique minimal DFA recognizing the key set, guaranteed by Myhill–Nerode (Theorem 4) — the smallest possible automaton, at the cost of node-identity payloads. And trie sorting is correct because pre-order traversal with alphabetically ordered edges enumerates keys in lexicographic order (Theorem 5), giving an `O(m)` most-significant-character radix sort. These five results are the mathematical backbone under every practical trie technique in the other files.

---

## Further Reading

- Hopcroft, Motwani & Ullman — *Introduction to Automata Theory* — DFAs, Myhill–Nerode, minimization.
- Knuth, *TAOCP* Vol. 3 — digital search trees and trie analysis.
- de la Briandais (1959) and Fredkin (1960) — the original trie papers.
- Daciuk, Mihov, Watson & Watson — incremental construction of minimal acyclic FSAs (DAWG).
- Sibling topic `21-advanced-structures/24-25` — radix/Patricia tries and TSTs.
- Sibling topic `17-string-algorithms/05` — Aho-Corasick: the trie completed into a full automaton with failure links.
