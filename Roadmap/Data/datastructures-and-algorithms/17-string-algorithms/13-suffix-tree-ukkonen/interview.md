# Suffix Tree & Ukkonen's Algorithm — Interview Preparation

The suffix tree is a classic "separates the strong candidates" interview topic: it rewards a crisp one-liner — *"a compressed trie of all suffixes of `S$`, `O(n)` nodes, built online in `O(n)` by Ukkonen"* — and then probes whether you can explain the **three tricks** (global end, suffix links, active point), the **three rules**, why the build is amortized `O(n)`, and how to turn the tree into answers (substring check, longest repeated, longest common, distinct count). This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | How | Complexity |
|------|-----|------------|
| Build suffix tree | Ukkonen (global end + suffix links + active point) | `O(n)` |
| Substring check "is `P` in `S`?" | Walk down from root following `P` | `O(m)` |
| Count occurrences of `P` | Leaves in subtree below `P`'s endpoint | `O(m + occ)` |
| Longest repeated substring | Deepest internal node by string-depth | `O(n)` |
| Longest common substring (k strings) | Generalized tree, deepest full-color node | `O(total)` |
| Number of distinct substrings | Sum of edge-label lengths | `O(n)` |
| Naive build (oracle) | Insert each suffix into a trie | `O(n²)` |

The three tricks:

```text
1. Global end pointer  → set leafEnd = i once; all leaves grow (Rule 1 is free)
2. Suffix links        → O(1) hop from node "xα" to node "α" (no re-descent)
3. Active point        → (active_node, active_edge, active_length) + skip/count
```

The three extension rules:

```text
Rule 1: active point at a leaf edge      → extend leaf (automatic via global end)
Rule 2: c not present at active point    → split edge / add leaf + internal node
Rule 3: c already present at active point → active_length++, STOP the phase (implicit)
```

Key facts:
- Build on `S$` with a **unique sentinel** so every suffix is an explicit leaf.
- `n+1` leaves, `≤ n` internal nodes, `≤ 2n+1` nodes total → `O(n)` space.
- Edges store `[start, end]` index pairs, never copied substrings.
- An internal node ⇔ a substring that occurs **at least twice**.

---

## Junior Questions (12 Q&A)

### J1. What is a suffix tree?
A compressed trie containing every suffix of `S$`. Edges are labeled by substrings stored as `[start, end]` index pairs. Every internal node (except the root) has ≥ 2 children, every suffix ends at its own leaf, and the whole structure has `O(n)` nodes.

### J2. Why append a sentinel `$`?
Without `$`, a suffix that is a prefix of a longer suffix (e.g. `"a"` inside `"ana"` in `"banana"`) ends mid-edge with no leaf, making the tree *implicit*. A unique `$` ensures no suffix is a prefix of another, so every suffix gets a distinct leaf and the tree is *explicit*.

### J3. Why does the tree have only `O(n)` nodes?
There are `n+1` leaves (one per suffix). Every internal node has ≥ 2 children, so a tree with `L` leaves has ≤ `L-1` internal nodes. Total ≤ `2n+1` nodes and ≤ `2n` edges.

### J4. Why store edges as `[start, end]` instead of the substring?
The suffixes together contain `Θ(n²)` characters, so copying labels gives `O(n²)` space. Index pairs are `O(1)` per edge, keeping the whole tree `O(n)`.

### J5. How do you check if `P` is a substring of `S`?
Walk down from the root following `P`'s characters along edge labels. If you consume all of `P`, it occurs; if a character cannot be matched, it does not. Cost `O(|P|)`.

### J6. What does an internal node represent?
A substring that occurs at least twice (two suffixes diverge there). The branch exists precisely because the substring has two different continuations in `S`.

### J7. What is the longest repeated substring in terms of the tree?
The path-label of the deepest internal node, measured by string-depth (total characters from the root). One DFS finds it in `O(n)`.

### J8. How many leaves does the tree have?
Exactly `n+1` with the sentinel — one per suffix of `S$`.

### J9. What is the naive construction and its cost?
Insert each suffix into a trie one at a time, splitting edges on divergence. Each insertion is `O(n)`, so the build is `O(n²)` (or `O(n³)` if you copy labels).

### J10. What are the three tricks of Ukkonen's algorithm?
The global end pointer (extends all leaves for free), suffix links (`O(1)` hops between related nodes), and the active point with skip/count (remembers where to resume so we never re-walk).

### J11. How do you count how many times `P` occurs?
Walk to `P`'s endpoint, then count the **leaves** in the subtree below it. Each leaf is one occurrence. Precompute leaf counts with one DFS.

### J12 (analysis). Why is Ukkonen `O(n)` and not `O(n²)`?
Leaf extension is free (global end), suffix links avoid re-descending from the root, skip/count descends long edges by arithmetic, and the total number of structural (Rule-2) operations is bounded by `n` because each makes one suffix explicit exactly once.

---

## Middle Questions (12 Q&A)

### M1. Explain the three extension rules.
Rule 1: the active point is on a leaf edge → extend it (automatic via the global end). Rule 2: the next char is not present at the active point → split the edge / add a leaf and an internal node. Rule 3: the next char is already present → increment `active_length` and stop the phase, leaving shorter suffixes implicit.

### M2. What is the active point?
The triple `(active_node, active_edge, active_length)` marking where the next insertion happens. `active_length = 0` means we are at `active_node`; otherwise we are `active_length` characters into the edge identified by `active_edge`.

### M3. Why is Rule 3 a "show-stopper"?
If the next character is already present after suffix `β`, it is also present after every shorter suffix (each is a suffix of `βc`, hence already a substring). So all remaining extensions in the phase are also Rule 3 and can be skipped — the phase ends.

### M4. What is a suffix link and why is it needed?
A pointer from an internal node with path-label `xα` to the node with path-label `α`. After inserting suffix `T[j..i]`, the next extension concerns `T[j+1..i]` — the same string minus the first character — and the suffix link jumps there in `O(1)` instead of re-descending from the root (which would make the build `O(n²)`).

### M5. What is the global end pointer trick?
All leaf edges share a single `leafEnd` variable as their end index. Setting `leafEnd = i` at the start of phase `i` extends every leaf by one character at once — performing all Rule-1 extensions in `O(1)`.

### M6. What is skip/count?
When re-descending by `active_length` characters after a suffix-link hop, compare `active_length` against each edge's length and jump whole edges by arithmetic (no per-character matching, since the substring already exists). This keeps total descent work `O(n)` amortized.

### M7. What is the difference between the implicit and explicit suffix tree?
During construction (no sentinel), some suffixes end mid-edge with no leaf — that is the *implicit* tree. Appending the unique `$` and running one more phase makes every suffix an explicit leaf — the *explicit* tree.

### M8. How do you count distinct substrings?
Sum the edge-label lengths over all edges: `Σ (end - start + 1)`. Each distinct substring is a unique position along some edge. One DFS, `O(n)`.

### M9. How do you find the longest common substring of two strings?
Build a generalized suffix tree of `A#B$` with **distinct** separators. Tag leaves by source. The deepest internal node whose subtree contains leaves from both strings spells the LCS.

### M10. How does the suffix tree relate to the suffix array?
A lexicographic DFS over the tree visits leaves in suffix-array order, and the string-depth of the LCA of adjacent leaves gives the LCP value. The tree and (suffix array + LCP) carry the same information and are inter-convertible in `O(n)`.

### M11. Why might you choose a suffix array over a suffix tree?
A suffix array uses ~8 bytes/char vs the tree's 20–40, is cache-friendly, and is much simpler to implement, while answering the same queries (with an `O(log n)` factor for binary search). Memory and simplicity usually favor the array.

### M12 (analysis). What bounds the total number of Rule-2 operations across all phases?
The `remaining` counter: each phase increments it by 1 (total `n`), and each Rule-2 extension decrements it by 1. Since `remaining ≥ 0`, total Rule-2 extensions ≤ `n`, each `O(1)`.

---

## Senior Questions (10 Q&A)

### S1. The suffix tree is too memory-heavy for your input. What do you do?
Switch to a **suffix array + LCP** (sibling `04`) — same query power at ~4× less memory and far simpler code — or, at genomic scale, an **FM-index / compressed suffix tree**. If you must keep a tree, use a flat int-indexed arena and sorted-array children instead of pointers and hash maps.

### S2. How do you set suffix links correctly during the build?
Track `last_new` — the internal node created in the current phase that still needs its link. When you create the next internal node (or hit Rule 3 / fall to the active node), set `last_new.link` to it. Every internal node gets its link within one extension of creation.

### S3. How does the active point update after a Rule-2 split?
If `active_node` is the root and `active_length > 0`: decrement `active_length` and set `active_edge = i - remaining + 1`. If `active_node` is not the root: follow the suffix link, `active_node = active_node.link` (or root if none). Then re-apply skip/count.

### S4. How do you build a generalized suffix tree for k strings?
Concatenate with **distinct** separators (`S_1 #_1 S_2 #_2 …`) or run Ukkonen sequentially, tagging each leaf with its source id. Compute per-node color sets via a post-order DFS (bitsets for small k, small-to-large for large k) for common-substring and document-frequency queries.

### S5. How do you prove Ukkonen runs in `O(n)`?
Global end makes Rule 1 free; `remaining` caps total Rule-2 operations at `n`; suffix links make each hop `O(1)`; and a node-depth potential argument caps total skip/count descents at `O(n)`. Summing gives `O(n)`. (Full proof in `professional.md`.)

### S6. What are the most common implementation bugs?
Missing/non-unique sentinel (implicit tree), storing leaf `end` by value (leaves stop growing), omitting suffix links (`O(n²)` build), inclusive/half-open interval confusion (off-by-one walks), and shared separators in a generalized tree (cross-string matches).

### S7. How do you test a suffix-tree implementation?
Build the naive `O(n²)` tree and Ukkonen's tree on thousands of random and adversarial strings (`aaaa…`, Fibonacci words, DNA), and compare: substring sets, distinct-substring counts, LRS/LCS answers, leaf count (`n+1`), and node bound (`≤ 2n+1`).

### S8. When is a suffix tree the wrong tool?
For a single pattern in a single text (use KMP/Z), when memory is tight (use a suffix array), for the minimal substring automaton or incremental distinct counts (use a suffix automaton), or at genome scale (use an FM-index).

### S9. Can you delete characters or prepend to a suffix tree?
Ukkonen supports only **appending** trailing characters cheaply. Prepending, deleting, or mid-string edits have no efficient general operation; you typically rebuild or use a different structure for sliding windows.

### S10 (analysis). Why does an internal node mean "occurs at least twice," not "exactly twice"?
An internal node is a branch point: the substring has ≥ 2 distinct continuations, i.e. occurs ≥ 2 times. The exact occurrence count is the number of **leaves** in its subtree, which can be far more than two.

---

## Professional Questions (8 Q&A)

### P1. Design a substring-search service over a large fixed corpus.
If the corpus fits in memory and you need true `O(m)` walking with online appends, build a flat int-indexed suffix tree once and serve `contains`/`count` queries. If memory is tight or queries are batchable, build a suffix array + LCP (or an FM-index at scale) instead. Cache leaf-count and string-depth aggregates from one DFS for occurrence and repeated-substring queries.

### P2. Prove the distinct-substring formula.
Distinct substrings are in bijection with distinct loci (positions) in the tree. Each edge contributes exactly `len(edge)` new loci (the positions 1..len into it), all distinct across edges. So `#distinct substrings = Σ_edges len(edge)`. Subtract `$`-bearing substrings if counting over `S` rather than `S$`.

### P3. How do generalized suffix trees solve document retrieval?
Tag each leaf with its document id. For a query pattern `P`, walk to its endpoint and report the **set** of document colors in the subtree — that is exactly the documents containing `P`. Color sets are precomputed via a post-order DFS; document frequency is the popcount.

### P4. How do you debug "my suffix tree gives wrong answers"?
Diff against the naive `O(n²)` builder on the exact failing input. Check the usual suspects: missing sentinel (leaf count ≠ `n+1`), by-value leaf ends (truncated leaf labels), omitted suffix links (quadratic time), and interval off-by-ones (`len = end - start + 1`). Assert every internal non-root node has ≥ 2 children.

### P5. Explain the equivalence between a suffix tree and a suffix array + LCP.
An ordered (lexicographic) DFS over the tree visits leaves in suffix-array order; the string-depth of the LCA of adjacent leaves is their LCP. Conversely, a left-to-right stack sweep over `(SA, LCP)` reconstructs the tree's internal nodes (LCP-interval tree). Both are `O(n)` and mutually inverse.

### P6. How would you compute matching statistics (for two strings) with a suffix tree?
Build the suffix tree of `T`. Scan `P` while walking the tree, using suffix links to recover from mismatches in amortized `O(1)`, recording at each position the length of the longest substring of `P` starting there that is also a substring of `T`. This `O(|P|)` procedure underlies approximate matching and the Lempel–Ziv factorization.

### P7. What is the relationship to the suffix automaton?
The suffix automaton's suffix-link tree is isomorphic to the suffix tree of the **reversed** string. Distinct-substring counting has dual formulas: `Σ_edges len(edge)` (tree) and `Σ_states (len(v) − len(link(v)))` (automaton). The automaton is usually lighter and online; the tree exposes explicit edge-compressed branching.

### P8 (analysis). Why can't you efficiently count distinct *subsequences* with a suffix tree?
A suffix tree indexes contiguous **substrings**, not subsequences. Subsequences require a different DP (over the string with last-occurrence bookkeeping), and there are up to `2^n` of them. The suffix tree's `O(n)` structure is fundamentally about contiguous substrings; subsequences have no analogous linear-size index.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you chose a simpler data structure over a "better" one.
Look for a story where a suffix tree was theoretically ideal but a suffix array (or FM-index) was chosen for memory, cache behavior, or maintainability, with a measured justification (heap profile, latency) and an honest tradeoff discussion.

### B2. A teammate's suffix tree OOMs in production. How do you help?
Profile the heap to confirm children-container overhead dominates, propose a flat int-indexed layout or a switch to a suffix array / FM-index, and add a pre-build memory budget guard that fails fast with a clear "use a lighter index" message. Frame it as a structural fit problem, not a coding mistake.

### B3. Design autocomplete / substring search over user documents.
Discuss a generalized suffix structure tagged by document, with `O(m)` substring walks and document-color sets for retrieval; weigh a suffix tree vs an FM-index by corpus size and update frequency; mention that appends are cheap (Ukkonen online) but edits force rebuilds.

### B4. How would you explain Ukkonen to a junior engineer?
Lead with the analogy: leaves are dangling threads that a single ruler (global end) lengthens at once; suffix links are teleport tunnels between related rooms; the active point is a bookmark so you never re-read from page one. Then introduce the three rules, flagging the sentinel requirement first.

### B5. Your build time spiked on a new dataset. How do you investigate?
Check whether suffix links are actually being followed (a missing link silently degrades to `O(n²)`); log build metrics (splits, peak `remaining`, duration); test the pathological input (`aaaa…`) against the naive oracle; and verify the children container's lookup cost did not balloon on a larger alphabet.

---

## Coding Challenges

### Challenge 1: Build a Suffix Tree and Answer Substring Queries

**Problem.** Given a string `S`, build its suffix tree (on `S$`) and answer "is `P` a substring of `S`?" in `O(|P|)`.

**Example.**
```text
S = "banana", P = "ana" -> true
S = "banana", P = "xyz" -> false
```

**Constraints.** `1 ≤ |S| ≤ 10^5`, many queries.

**Optimal.** Ukkonen build `O(n)`, each query `O(|P|)`.

**Go.**
```go
package main

import "fmt"

type Node struct {
	start    int
	end      *int
	children map[byte]*Node
	link     *Node
}

type ST struct {
	text                                string
	root, an                            *Node
	ae, al, rem, leafEnd                int
}

func nn(s int, e *int) *Node { return &Node{start: s, end: e, children: map[byte]*Node{}} }
func (t *ST) elen(n *Node) int { return *n.end - n.start + 1 }

func (t *ST) walk(n *Node) bool {
	if l := t.elen(n); t.al >= l {
		t.ae += l; t.al -= l; t.an = n
		return true
	}
	return false
}

func (t *ST) extend(i int) {
	t.leafEnd = i
	t.rem++
	var last *Node
	for t.rem > 0 {
		if t.al == 0 { t.ae = i }
		c := t.text[t.ae]
		nx, ok := t.an.children[c]
		if !ok {
			t.an.children[c] = nn(i, &t.leafEnd)
			if last != nil { last.link = t.an; last = nil }
		} else {
			if t.walk(nx) { continue }
			if t.text[nx.start+t.al] == t.text[i] {
				if last != nil && t.an != t.root { last.link = t.an }
				t.al++
				break
			}
			se := nx.start + t.al - 1
			sp := nn(nx.start, &se)
			t.an.children[c] = sp
			sp.children[t.text[i]] = nn(i, &t.leafEnd)
			nx.start += t.al
			sp.children[t.text[nx.start]] = nx
			if last != nil { last.link = sp }
			last = sp
		}
		t.rem--
		if t.an == t.root && t.al > 0 {
			t.al--; t.ae = i - t.rem + 1
		} else if t.an != t.root {
			if t.an.link != nil {
				t.an = t.an.link
			} else {
				t.an = t.root
			}
		}
	}
}

func Build(s string) *ST {
	end := -1
	t := &ST{text: s, leafEnd: -1, ae: -1}
	t.root = nn(-1, &end)
	t.root.link = t.root
	t.an = t.root
	for i := 0; i < len(s); i++ { t.extend(i) }
	return t
}

func (t *ST) contains(p string) bool {
	node, i := t.root, 0
	for i < len(p) {
		ch, ok := node.children[p[i]]
		if !ok { return false }
		j := ch.start
		for j <= *ch.end && i < len(p) {
			if t.text[j] != p[i] { return false }
			i++; j++
		}
		node = ch
	}
	return true
}

func main() {
	t := Build("banana$")
	fmt.Println(t.contains("ana")) // true
	fmt.Println(t.contains("xyz")) // false
}
```

**Java.**
```java
import java.util.*;

public class SuffixTreeQuery {
    String text; Node root, an; int ae=-1, al=0, rem=0; int[] leafEnd={-1};
    class Node { int start; int[] end; Map<Character,Node> ch=new HashMap<>(); Node link;
        Node(int s,int[] e){start=s;end=e;} int len(){return end[0]-start+1;} }

    boolean walk(Node n){ int l=n.len(); if(al>=l){ae+=l;al-=l;an=n;return true;} return false; }

    void extend(int i){
        leafEnd[0]=i; rem++; Node last=null;
        while(rem>0){
            if(al==0) ae=i;
            char c=text.charAt(ae);
            Node nx=an.ch.get(c);
            if(nx==null){ an.ch.put(c,new Node(i,leafEnd)); if(last!=null){last.link=an;last=null;} }
            else{
                if(walk(nx)) continue;
                if(text.charAt(nx.start+al)==text.charAt(i)){
                    if(last!=null&&an!=root) last.link=an; al++; break;
                }
                int[] se={nx.start+al-1};
                Node sp=new Node(nx.start,se);
                an.ch.put(c,sp);
                sp.ch.put(text.charAt(i),new Node(i,leafEnd));
                nx.start+=al;
                sp.ch.put(text.charAt(nx.start),nx);
                if(last!=null) last.link=sp; last=sp;
            }
            rem--;
            if(an==root&&al>0){al--;ae=i-rem+1;}
            else if(an!=root) an=(an.link!=null)?an.link:root;
        }
    }

    SuffixTreeQuery(String s){ text=s; root=new Node(-1,new int[]{-1}); root.link=root; an=root;
        for(int i=0;i<s.length();i++) extend(i); }

    boolean contains(String p){
        Node node=root; int i=0;
        while(i<p.length()){
            Node ch=node.ch.get(p.charAt(i)); if(ch==null) return false;
            int j=ch.start;
            while(j<=ch.end[0]&&i<p.length()){ if(text.charAt(j)!=p.charAt(i)) return false; i++; j++; }
            node=ch;
        }
        return true;
    }

    public static void main(String[] a){
        SuffixTreeQuery t=new SuffixTreeQuery("banana$");
        System.out.println(t.contains("ana")); // true
        System.out.println(t.contains("xyz")); // false
    }
}
```

**Python.**
```python
class Node:
    __slots__ = ("start", "end", "ch", "link")
    def __init__(self, s, e):
        self.start = s; self.end = e; self.ch = {}; self.link = None


class SuffixTree:
    def __init__(self, text):
        self.t = text
        self.leaf_end = [-1]
        self.root = Node(-1, [-1]); self.root.link = self.root
        self.an = self.root; self.ae = -1; self.al = 0; self.rem = 0
        for i in range(len(text)):
            self._ext(i)

    def _elen(self, n):
        return n.end[0] - n.start + 1

    def _walk(self, n):
        l = self._elen(n)
        if self.al >= l:
            self.ae += l; self.al -= l; self.an = n
            return True
        return False

    def _ext(self, i):
        self.leaf_end[0] = i; self.rem += 1; last = None
        while self.rem > 0:
            if self.al == 0:
                self.ae = i
            c = self.t[self.ae]
            nx = self.an.ch.get(c)
            if nx is None:
                self.an.ch[c] = Node(i, self.leaf_end)
                if last:
                    last.link = self.an; last = None
            else:
                if self._walk(nx):
                    continue
                if self.t[nx.start + self.al] == self.t[i]:
                    if last and self.an is not self.root:
                        last.link = self.an
                    self.al += 1
                    break
                se = [nx.start + self.al - 1]
                sp = Node(nx.start, se)
                self.an.ch[c] = sp
                sp.ch[self.t[i]] = Node(i, self.leaf_end)
                nx.start += self.al
                sp.ch[self.t[nx.start]] = nx
                if last:
                    last.link = sp
                last = sp
            self.rem -= 1
            if self.an is self.root and self.al > 0:
                self.al -= 1; self.ae = i - self.rem + 1
            elif self.an is not self.root:
                self.an = self.an.link or self.root

    def contains(self, p):
        node, i = self.root, 0
        while i < len(p):
            ch = node.ch.get(p[i])
            if ch is None:
                return False
            j = ch.start
            while j <= ch.end[0] and i < len(p):
                if self.t[j] != p[i]:
                    return False
                i += 1; j += 1
            node = ch
        return True


if __name__ == "__main__":
    t = SuffixTree("banana$")
    print(t.contains("ana"))  # True
    print(t.contains("xyz"))  # False
```

---

### Challenge 2: Longest Repeated Substring

**Problem.** Given `S`, return the longest substring that appears at least twice. It is the path-label of the deepest internal node.

**Example.** `S = "banana" -> "ana"`.

**Approach.** Build the suffix tree of `S$`, DFS computing string-depths, return the deepest internal node's path-label. The solutions below use a self-contained naive `O(n²)` tree for clarity (the same logic applies to a Ukkonen tree).

**Python.**
```python
class N:
    __slots__ = ("s", "e", "ch")
    def __init__(self, s, e): self.s = s; self.e = e; self.ch = {}


def build(text):
    root = N(-1, -1)
    for i in range(len(text)):
        node, j = root, i
        while j < len(text):
            c = text[j]
            ch = node.ch.get(c)
            if ch is None:
                node.ch[c] = N(j, len(text) - 1); break
            k = ch.s
            while k <= ch.e and j < len(text) and text[j] == text[k]:
                j += 1; k += 1
            if k > ch.e:
                node = ch; continue
            mid = N(ch.s, k - 1)
            node.ch[c] = mid; ch.s = k
            mid.ch[text[k]] = ch
            mid.ch[text[j]] = N(j, len(text) - 1)
            break
    return root


def longest_repeated(text):
    text = text + "$"
    root = build(text)
    best = (0, "")
    def dfs(node, depth, label):
        nonlocal best
        if len(node.ch) >= 2 and node is not root and depth > best[0]:
            best = (depth, label)
        for ch in node.ch.values():
            seg = text[ch.s:ch.e + 1]
            dfs(ch, depth + len(seg), label + seg)
    dfs(root, 0, "")
    return best[1].rstrip("$")


if __name__ == "__main__":
    print(longest_repeated("banana"))  # ana
```

**Go.**
```go
package main

import (
	"fmt"
	"strings"
)

type N struct {
	s, e int
	ch   map[byte]*N
}

func build(t string) *N {
	root := &N{-1, -1, map[byte]*N{}}
	for i := 0; i < len(t); i++ {
		node, j := root, i
		for j < len(t) {
			c := t[j]
			ch, ok := node.ch[c]
			if !ok {
				node.ch[c] = &N{j, len(t) - 1, map[byte]*N{}}
				break
			}
			k := ch.s
			for k <= ch.e && j < len(t) && t[j] == t[k] {
				j++; k++
			}
			if k > ch.e { node = ch; continue }
			mid := &N{ch.s, k - 1, map[byte]*N{}}
			node.ch[c] = mid; ch.s = k
			mid.ch[t[k]] = ch
			mid.ch[t[j]] = &N{j, len(t) - 1, map[byte]*N{}}
			break
		}
	}
	return root
}

func longestRepeated(s string) string {
	t := s + "$"
	root := build(t)
	bestLen, bestLabel := 0, ""
	var dfs func(n *N, depth int, label string)
	dfs = func(n *N, depth int, label string) {
		if len(n.ch) >= 2 && n != root && depth > bestLen {
			bestLen, bestLabel = depth, label
		}
		for _, ch := range n.ch {
			seg := t[ch.s : ch.e+1]
			dfs(ch, depth+len(seg), label+seg)
		}
	}
	dfs(root, 0, "")
	return strings.TrimRight(bestLabel, "$")
}

func main() {
	fmt.Println(longestRepeated("banana")) // ana
}
```

**Java.**
```java
import java.util.*;

public class LongestRepeated {
    static class N { int s,e; Map<Character,N> ch=new HashMap<>(); N(int s,int e){this.s=s;this.e=e;} }
    static String t; static int bestLen; static String bestLabel;

    static N build(String text){
        N root=new N(-1,-1);
        for(int i=0;i<text.length();i++){
            N node=root; int j=i;
            while(j<text.length()){
                char c=text.charAt(j); N ch=node.ch.get(c);
                if(ch==null){ node.ch.put(c,new N(j,text.length()-1)); break; }
                int k=ch.s;
                while(k<=ch.e&&j<text.length()&&text.charAt(j)==text.charAt(k)){j++;k++;}
                if(k>ch.e){ node=ch; continue; }
                N mid=new N(ch.s,k-1);
                node.ch.put(c,mid); ch.s=k;
                mid.ch.put(text.charAt(k),ch);
                mid.ch.put(text.charAt(j),new N(j,text.length()-1));
                break;
            }
        }
        return root;
    }

    static void dfs(N node,int depth,String label,N root){
        if(node.ch.size()>=2&&node!=root&&depth>bestLen){ bestLen=depth; bestLabel=label; }
        for(N ch:node.ch.values()){
            String seg=t.substring(ch.s,ch.e+1);
            dfs(ch,depth+seg.length(),label+seg,root);
        }
    }

    static String longestRepeated(String s){
        t=s+"$"; N root=build(t); bestLen=0; bestLabel="";
        dfs(root,0,"",root);
        return bestLabel.replaceAll("\\$$","");
    }

    public static void main(String[] a){
        System.out.println(longestRepeated("banana")); // ana
    }
}
```

---

### Challenge 3: Longest Common Substring of Two Strings

**Problem.** Given `A` and `B`, find their longest common substring via a generalized suffix tree.

**Example.** `A = "xabxac", B = "abcabxabcd" -> "abxa"` (length 4).

**Approach.** Build the tree of `A + "#" + B + "$"`; a node is "common" if its subtree contains a leaf from `A` (suffix start < |A|+1) and from `B`. Return the deepest common node's label.

**Python.**
```python
class N:
    __slots__ = ("s", "e", "ch")
    def __init__(self, s, e): self.s = s; self.e = e; self.ch = {}


def build(text):
    root = N(-1, -1)
    for i in range(len(text)):
        node, j = root, i
        while j < len(text):
            c = text[j]; ch = node.ch.get(c)
            if ch is None:
                node.ch[c] = N(j, len(text) - 1); break
            k = ch.s
            while k <= ch.e and j < len(text) and text[j] == text[k]:
                j += 1; k += 1
            if k > ch.e: node = ch; continue
            mid = N(ch.s, k - 1)
            node.ch[c] = mid; ch.s = k
            mid.ch[text[k]] = ch; mid.ch[text[j]] = N(j, len(text) - 1)
            break
    return root


def lcs(a, b):
    text = a + "#" + b + "$"
    boundary = len(a)              # leaves starting <= boundary belong to A
    root = build(text)
    best = (0, "")

    def dfs(node, depth, label, leaf_start):
        # returns set of colors {0 for A, 1 for B} present in subtree
        nonlocal best
        if not node.ch:
            return {0 if leaf_start <= boundary else 1}
        colors = set()
        for ch in node.ch.values():
            seg = text[ch.s:ch.e + 1]
            colors |= dfs(ch, depth + len(seg), label + seg, ch.s - depth - len(seg) + len(seg))
        # recompute leaf_start properly below; we instead pass suffix start
        return colors

    # cleaner: track suffix start = leaf's edge start adjusted
    def dfs2(node, depth, label):
        nonlocal best
        if not node.ch:
            start = node.s - depth + (node.e - node.s + 1)  # suffix start index
            suffix_start = node.s - depth
            return {0 if suffix_start <= boundary else 1}
        colors = set()
        for ch in node.ch.values():
            seg = text[ch.s:ch.e + 1]
            colors |= dfs2(ch, depth + len(seg), label + seg)
        if len(colors) == 2 and depth > best[0]:
            best = (depth, label)
        return colors

    dfs2(root, 0, "")
    return best[1]


if __name__ == "__main__":
    print(lcs("xabxac", "abcabxabcd"))  # abxa
```

**Go.**
```go
package main

import "fmt"

type N struct {
	s, e int
	ch   map[byte]*N
}

var text string
var boundary int
var bestLen int
var bestLabel string

func build(t string) *N {
	root := &N{-1, -1, map[byte]*N{}}
	for i := 0; i < len(t); i++ {
		node, j := root, i
		for j < len(t) {
			c := t[j]; ch, ok := node.ch[c]
			if !ok { node.ch[c] = &N{j, len(t) - 1, map[byte]*N{}}; break }
			k := ch.s
			for k <= ch.e && j < len(t) && t[j] == t[k] { j++; k++ }
			if k > ch.e { node = ch; continue }
			mid := &N{ch.s, k - 1, map[byte]*N{}}
			node.ch[c] = mid; ch.s = k
			mid.ch[t[k]] = ch; mid.ch[t[j]] = &N{j, len(t) - 1, map[byte]*N{}}
			break
		}
	}
	return root
}

func dfs(node *N, depth int, label string) map[int]bool {
	if len(node.ch) == 0 {
		suffixStart := node.s - depth
		col := 1
		if suffixStart <= boundary { col = 0 }
		return map[int]bool{col: true}
	}
	colors := map[int]bool{}
	for _, ch := range node.ch {
		seg := text[ch.s : ch.e+1]
		for k := range dfs(ch, depth+len(seg), label+seg) { colors[k] = true }
	}
	if len(colors) == 2 && depth > bestLen { bestLen = depth; bestLabel = label }
	return colors
}

func lcs(a, b string) string {
	text = a + "#" + b + "$"
	boundary = len(a)
	bestLen = 0; bestLabel = ""
	dfs(build(text), 0, "")
	return bestLabel
}

func main() {
	fmt.Println(lcs("xabxac", "abcabxabcd")) // abxa
}
```

**Java.**
```java
import java.util.*;

public class LongestCommon {
    static class N { int s,e; Map<Character,N> ch=new HashMap<>(); N(int s,int e){this.s=s;this.e=e;} }
    static String text; static int boundary, bestLen; static String bestLabel;

    static N build(String t){
        N root=new N(-1,-1);
        for(int i=0;i<t.length();i++){
            N node=root; int j=i;
            while(j<t.length()){
                char c=t.charAt(j); N ch=node.ch.get(c);
                if(ch==null){ node.ch.put(c,new N(j,t.length()-1)); break; }
                int k=ch.s;
                while(k<=ch.e&&j<t.length()&&t.charAt(j)==t.charAt(k)){j++;k++;}
                if(k>ch.e){ node=ch; continue; }
                N mid=new N(ch.s,k-1);
                node.ch.put(c,mid); ch.s=k;
                mid.ch.put(t.charAt(k),ch); mid.ch.put(t.charAt(j),new N(j,t.length()-1));
                break;
            }
        }
        return root;
    }

    static Set<Integer> dfs(N node,int depth,String label){
        if(node.ch.isEmpty()){
            int suffixStart=node.s-depth;
            Set<Integer> set=new HashSet<>(); set.add(suffixStart<=boundary?0:1); return set;
        }
        Set<Integer> colors=new HashSet<>();
        for(N ch:node.ch.values()){
            String seg=text.substring(ch.s,ch.e+1);
            colors.addAll(dfs(ch,depth+seg.length(),label+seg));
        }
        if(colors.size()==2&&depth>bestLen){ bestLen=depth; bestLabel=label; }
        return colors;
    }

    static String lcs(String a,String b){
        text=a+"#"+b+"$"; boundary=a.length(); bestLen=0; bestLabel="";
        dfs(build(text),0,""); return bestLabel;
    }

    public static void main(String[] x){
        System.out.println(lcs("xabxac","abcabxabcd")); // abxa
    }
}
```

---

### Challenge 4: Count Distinct Substrings

**Problem.** Given `S`, count the number of distinct non-empty substrings of `S`. It equals the sum of edge-label lengths over the tree of `S$`, minus the `$`-bearing contributions.

**Example.** `S = "abab" -> 7` (`a, b, ab, ba, aba, bab, abab`).

**Approach.** Build the tree of `S$`, sum `(end - start + 1)` over all edges, and subtract the `n+1` substrings that end in `$`.

**Python.**
```python
class N:
    __slots__ = ("s", "e", "ch")
    def __init__(self, s, e): self.s = s; self.e = e; self.ch = {}


def build(text):
    root = N(-1, -1)
    for i in range(len(text)):
        node, j = root, i
        while j < len(text):
            c = text[j]; ch = node.ch.get(c)
            if ch is None:
                node.ch[c] = N(j, len(text) - 1); break
            k = ch.s
            while k <= ch.e and j < len(text) and text[j] == text[k]:
                j += 1; k += 1
            if k > ch.e: node = ch; continue
            mid = N(ch.s, k - 1)
            node.ch[c] = mid; ch.s = k
            mid.ch[text[k]] = ch; mid.ch[text[j]] = N(j, len(text) - 1)
            break
    return root


def count_distinct(s):
    text = s + "$"
    root = build(text)
    total = 0
    stack = list(root.ch.values())
    while stack:
        node = stack.pop()
        total += node.e - node.s + 1
        stack.extend(node.ch.values())
    return total - (len(s) + 1)   # remove substrings containing '$'


if __name__ == "__main__":
    print(count_distinct("abab"))  # 7
```

**Go.**
```go
package main

import "fmt"

type N struct {
	s, e int
	ch   map[byte]*N
}

func build(t string) *N {
	root := &N{-1, -1, map[byte]*N{}}
	for i := 0; i < len(t); i++ {
		node, j := root, i
		for j < len(t) {
			c := t[j]; ch, ok := node.ch[c]
			if !ok { node.ch[c] = &N{j, len(t) - 1, map[byte]*N{}}; break }
			k := ch.s
			for k <= ch.e && j < len(t) && t[j] == t[k] { j++; k++ }
			if k > ch.e { node = ch; continue }
			mid := &N{ch.s, k - 1, map[byte]*N{}}
			node.ch[c] = mid; ch.s = k
			mid.ch[t[k]] = ch; mid.ch[t[j]] = &N{j, len(t) - 1, map[byte]*N{}}
			break
		}
	}
	return root
}

func countDistinct(s string) int {
	t := s + "$"
	root := build(t)
	total := 0
	stack := []*N{}
	for _, c := range root.ch { stack = append(stack, c) }
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		total += node.e - node.s + 1
		for _, c := range node.ch { stack = append(stack, c) }
	}
	return total - (len(s) + 1)
}

func main() {
	fmt.Println(countDistinct("abab")) // 7
}
```

**Java.**
```java
import java.util.*;

public class CountDistinct {
    static class N { int s,e; Map<Character,N> ch=new HashMap<>(); N(int s,int e){this.s=s;this.e=e;} }

    static N build(String t){
        N root=new N(-1,-1);
        for(int i=0;i<t.length();i++){
            N node=root; int j=i;
            while(j<t.length()){
                char c=t.charAt(j); N ch=node.ch.get(c);
                if(ch==null){ node.ch.put(c,new N(j,t.length()-1)); break; }
                int k=ch.s;
                while(k<=ch.e&&j<t.length()&&t.charAt(j)==t.charAt(k)){j++;k++;}
                if(k>ch.e){ node=ch; continue; }
                N mid=new N(ch.s,k-1);
                node.ch.put(c,mid); ch.s=k;
                mid.ch.put(t.charAt(k),ch); mid.ch.put(t.charAt(j),new N(j,t.length()-1));
                break;
            }
        }
        return root;
    }

    static long countDistinct(String s){
        String t=s+"$"; N root=build(t);
        long total=0;
        Deque<N> stack=new ArrayDeque<>(root.ch.values());
        while(!stack.isEmpty()){
            N node=stack.pop();
            total += node.e - node.s + 1;
            stack.addAll(node.ch.values());
        }
        return total - (s.length() + 1);
    }

    public static void main(String[] a){
        System.out.println(countDistinct("abab")); // 7
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"a compressed trie of all suffixes of `S$`, `O(n)` nodes, built online in `O(n)` by Ukkonen using a global end, suffix links, and an active point."*
- Always mention the **sentinel** first — it is the most common bug and shows you have implemented this for real.
- Be ready to explain the **three rules** and why Rule 3 stops the phase (the show-stopper lemma).
- If memory comes up, pivot to the **suffix array + LCP** equivalence — interviewers love that you know when *not* to use a suffix tree.
- Offer to verify any implementation against a brute-force `O(n²)` builder on small random strings.
