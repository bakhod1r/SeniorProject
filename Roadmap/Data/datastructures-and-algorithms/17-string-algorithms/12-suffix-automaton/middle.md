# Suffix Automaton (SAM) — Middle Level

> **Focus:** What the **endpos** equivalence really is, how the **clone/split** in `extend` keeps the automaton minimal, how the **suffix-link tree** powers occurrence counting, and the standard applications — distinct-substring count, occurrence counts, longest common substring — compared head-to-head with suffix arrays and suffix trees.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Clone/Split in `extend`, Traced](#the-clonesplit-in-extend-traced)
4. [The Suffix-Link Tree](#the-suffix-link-tree)
5. [Counting Applications](#counting-applications)
6. [Longest Common Substring of Two Strings](#longest-common-substring-of-two-strings)
7. [Comparison with Suffix Array and Suffix Tree](#comparison-with-suffix-array-and-suffix-tree)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: *states are endpos classes, build online with `extend`, query in `O(|p|)`*. At middle level we make every one of those phrases precise and operational:

- **What exactly is an endpos class**, and why do its substrings form a contiguous length range `[len[link]+1, len]`?
- **Why does `extend` sometimes need to clone a state**, and what invariant would break if we did not?
- **How does the suffix-link tree turn occurrence counting into a single tree-aggregation pass?**
- **How does LCS of two strings reduce to running one string through the other's SAM?**
- **When should you reach for a suffix array or suffix tree instead?**

These are the questions that separate "I copied a SAM template" from "I can derive and debug one, and pick it over its siblings on purpose."

---

## Deeper Concepts

### endpos: the equivalence that defines states

For a substring `t` of `s`, `endpos(t)` is the set of right-endpoints of its occurrences:

```
endpos(t) = { r : s[r - |t| + 1 .. r] == t }     (1-indexed positions of the last character)
```

Two substrings are in the same **state** iff their endpos sets are identical. Three structural facts drive everything:

1. **Nesting.** For any two substrings `u`, `w` with `|u| ≤ |w|`, either `endpos(w) ⊆ endpos(u)` (when `u` is a suffix of `w`) or `endpos(w) ∩ endpos(u) = ∅`. The endpos sets form a **laminar family** (a tree of nested sets). This is exactly why the suffix links form a tree.
2. **Contiguous lengths.** All substrings sharing one endpos set are **suffixes of each other**, and their lengths fill a contiguous interval `[len[link[v]]+1, len[v]]`. So a state is fully described by `len[v]` plus its link.
3. **Few classes.** The number of distinct endpos classes — hence states — is `≤ 2n-1`. Each `extend` adds at most two states (the new prefix state and at most one clone), giving the bound directly.

### `len` and the per-state substring count

State `v` holds exactly `len[v] - len[link[v]]` distinct substrings: the suffixes of its longest string whose length lies in `(len[link[v]], len[v]]`. Below `len[link[v]]+1` the endpos set changes (gets larger), which is precisely where the suffix link points. This per-state count is the atom of the distinct-substring formula.

### Why the suffix link points where it does

`link[v]` is the state of the **longest proper suffix** of `v`'s longest string `w` that has a *strictly larger* endpos set than `w`. Dropping characters off the front of `w` keeps endpos the same until, at some length, a new occurrence appears (endpos grows) — that boundary is `len[link[v]]`. So `link[v]` is "the next coarser endpos class as you shorten from the front."

---

## The Clone/Split in `extend`, Traced

The clone is the heart of the algorithm. Let us trace it on `s = "abab"`, focusing on the final `extend('b')`.

After building `"aba"` we have (from junior's walkthrough):

```
t0(len0)  1(len1,link t0,"a")  2(len2,link t0,"b","ab")  3(len3,link 1,"ba","aba")
trans: t0--a-->1, t0--b-->2, 1--b-->2, 2--a-->3
```

**extend('b'), cur = 4, len[4] = 4.** Walk links from `last = 3`:

- `p = 3`: no `'b'`. Add `3 --b--> 4`. Go to `link[3] = 1`.
- `p = 1`: `1` **has** `'b'` → `q = 2`. Stop the first loop.

Now the case test: `len[p] + 1 == len[q]`? `len[1] + 1 = 2`, `len[2] = 2`. They are **equal**, so `q = 2` is solid and `link[4] = 2`. **No clone this time** — `"abab"`'s relevant suffix boundary lined up.

To actually *see* a clone, use `s = "aabb"` or the classic `s = "abcbc"`. Trace `s = "abcbc"` at the final `extend('c')`:

After `"abcb"` the state holding `"b"`/`"cb"`/... has `len` larger than `len[p]+1` at the point we reach a `'c'`-edge, so:

- We find `p` with `next[p]['c'] = q` and `len[q] != len[p]+1`.
- We **clone** `q` into `clone`: `len[clone] = len[p]+1`, `next[clone] = copy(next[q])`, `link[clone] = link[q]`.
- We **redirect** every edge `p --c--> q` to `clone`, walking up suffix links while `next[p]['c'] == q`.
- We set `link[q] = clone` and `link[cur] = clone`.

**Why the clone is necessary.** Before this character, the strings in `q` all shared one endpos set. Adding the new character creates a *new* occurrence for the *shorter* members of `q` (those of length `≤ len[p]+1`) but **not** for the longer ones. Their endpos sets diverge, so they can no longer share a state. The clone holds the shorter strings (now with the enlarged endpos), and the original `q` keeps the longer strings (with the old endpos plus possibly the new prefix). Without the clone, the automaton would either accept too much or stop being minimal.

```
clone gets: len = len[p]+1, the SHORT strings, the enlarged endpos
q keeps:    its old len, the LONG strings, the original endpos
both cur and q link to clone (the new coarser class)
```

Each `extend` creates **at most one** clone, which is why the state count stays `≤ 2n-1`.

---

## The Suffix-Link Tree

The suffix links `link[v]` form a tree rooted at the initial state `t0`. Properties you exploit constantly:

- **`len` strictly decreases toward the root.** `len[link[v]] < len[v]`. So sorting states by `len` descending is a topological order (children before parents).
- **endpos nesting = tree ancestry.** `u` is an ancestor of `v` in the link tree iff `u`'s longest string is a suffix of `v`'s, and `endpos(v) ⊆ endpos(u)`.
- **Leaves correspond to prefixes.** Every prefix of `s` ends at some state created as a `cur` (not a clone). Their endpos sets are singletons-or-larger that propagate upward.
- **Terminal states.** Walking links from `last` (the final state) marks every state whose class contains a **suffix** of `s`. These are the accepting states of the DFA.

### Occurrence counting via the tree

The number of occurrences of any substring in state `v` equals `|endpos(v)|`. To compute it:

1. Set `cnt[v] = 1` for each state created as a prefix-end `cur` during the build (clones get `cnt = 0`).
2. Process states in **`len` descending** order; for each `v`, do `cnt[link[v]] += cnt[v]`.

After this, `cnt[v] = |endpos(v)|` for every state. Intuitively, each prefix contributes one ending position, and that position bubbles up to every coarser class containing the same suffix.

---

## Counting Applications

### Distinct substrings

```
distinct(s) = Σ over states v != root of ( len[v] - len[link[v]] )
```

Because each distinct substring lives in exactly one state and each state contributes its length range, the sum is exact and computed in one pass.

### Total length of all distinct substrings

Each state `v` contributes substrings of lengths `len[link[v]]+1 .. len[v]`. The sum of those lengths is the arithmetic series:

```
totalLen(s) = Σ_v  ( len[v]*(len[v]+1)/2 - len[link[v]]*(len[link[v]]+1)/2 )
```

### Occurrences of a specific pattern `p`

Walk `p` through the SAM to land on state `v` (or fail). If you reach `v`, the answer is `cnt[v]` (the precomputed endpos size). This is `O(|p|)` after the `O(n)` preprocessing.

### k-th smallest distinct substring

Precompute, for each state, the number of distinct substrings reachable from it (sum over outgoing transitions of `1 + paths(child)`), processed in reverse topological order. Then DFS from the root choosing transitions in alphabetical order, subtracting counts until you pinpoint the k-th. Each step is `O(σ)`; the walk length is the answer's length.

---

## Longest Common Substring of Two Strings

To find the longest common substring (LCS) of `s` and `t`:

1. Build the SAM of `s`.
2. Walk `t` through the SAM, character by character, maintaining the current state `v` and the current matched length `l`.
3. On character `c`: if `next[v][c]` exists, move there and `l += 1`. Otherwise, follow suffix links (`v = link[v]`) until a state with a `c`-transition is found (or the root), set `l = len[v] + 1` and move; if none exists, reset `v = root, l = 0`.
4. Track the maximum `l` seen. That maximum is the LCS length.

This runs in `O(|s| + |t|)` total because the matched length `l` increases by at most 1 per character and the suffix-link descents are amortized. The same idea extends to the LCS of *multiple* strings using a generalized SAM (see [`senior.md`](./senior.md)).

### Worked LCS trace

Take `s = "abcde"` (build `SA(s)`) and run `t = "zcdef"`:

```
'z': no transition from root, v stays 0, l = 0.
'c': from root walk 'c' → state for "c", v = that, l = 1.
'd': transition 'd' exists → v advances, l = 2  (matched "cd").
'e': transition 'e' exists → v advances, l = 3  (matched "cde").  best = 3
'f': no 'f' transition; follow links resetting l; no match in s, v = 0, l = 0.
```

The maximum `l` is `3`, the length of `"cde"` — the longest common substring of `"abcde"` and `"zcdef"`. The key mechanic: when `'f'` fails, we do **not** discard the whole match; we follow suffix links and shorten `l` to the longest suffix of the current match that still has the needed transition, which is what keeps the algorithm linear.

### Why the matched length is reset to `len[v]`, not 0

On a failed transition we set `v = link[v]` and `l = len[v]` (not `l -= 1`). This is because after jumping to `link[v]`, the longest string still matched is `long(link[v])`, whose length is exactly `len[link[v]]`. Setting `l = len[v]` after the jump (using the *new* `v`) reflects that we have dropped to the longest suffix that the coarser class represents. Getting this reset wrong (e.g. `l -= 1`) is the most common LCS bug and silently undercounts.

---

## Comparison with Suffix Array and Suffix Tree

| Aspect | Suffix Automaton (this topic) | Suffix Array (`04`) | Suffix Tree (`13`) |
|--------|-------------------------------|---------------------|--------------------|
| What it is | Minimal DFA of all suffixes | Sorted order of suffixes + LCP | Compressed trie of all suffixes |
| Size | ≤ `2n-1` states, ≤ `3n-4` edges | `n` ints (+`n` LCP) | `≤ 2n` nodes, `O(n)` with edge labels |
| Build time | `O(n)` online | `O(n)` (SA-IS) or `O(n log n)` | `O(n)` (Ukkonen) |
| Online (add chars)? | **Yes**, natural | No (rebuild) | Yes (Ukkonen, but trickier) |
| Substring check | `O(|p|)` walk | `O(|p| log n)` binary search | `O(|p|)` walk |
| Distinct substrings | `Σ len[v]-len[link[v]]` | `Σ (n - SA[i] - LCP[i])` | sum of edge lengths |
| Occurrence count | endpos size via link tree | range on SA | subtree leaf count |
| LCS of two strings | run `t` through SAM(`s`) | combined SA + LCP | combined tree |
| k-th substring, sorted | needs DFS over edges | natural via SA/LCP | DFS over tree |
| Memory constant | small (states are light) | smallest (flat arrays) | larger (nodes + edges) |

**Rules of thumb.** The SAM and the suffix tree are near-duals: the SAM's suffix-link tree is essentially the suffix tree of the **reversed** string. Prefer the **SAM** for online construction, distinct-substring counting, occurrence counting, and LCS of two strings — its `extend` and link-tree aggregations are clean. Prefer the **suffix array** when you need sorted suffix order, LCP-based queries, or the smallest memory footprint. Prefer the **suffix tree** when you want explicit substring paths or are already reasoning in tree terms. All three are `O(n)`-buildable; the choice is about which queries are *natural*.

---

## Code Examples

### Occurrence counting and pattern queries

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type SAM struct {
	next   []map[byte]int
	link   []int
	length []int
	cnt    []int64
	last   int
}

func NewSAM() *SAM {
	s := &SAM{}
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, 0)
	s.cnt = append(s.cnt, 0)
	s.last = 0
	return s
}

func (s *SAM) Extend(c byte) {
	cur := len(s.next)
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, s.length[s.last]+1)
	s.cnt = append(s.cnt, 1) // prefix-end state: one occurrence
	p := s.last
	for p != -1 {
		if _, ok := s.next[p][c]; ok {
			break
		}
		s.next[p][c] = cur
		p = s.link[p]
	}
	if p == -1 {
		s.link[cur] = 0
	} else {
		q := s.next[p][c]
		if s.length[p]+1 == s.length[q] {
			s.link[cur] = q
		} else {
			clone := len(s.next)
			cn := map[byte]int{}
			for k, v := range s.next[q] {
				cn[k] = v
			}
			s.next = append(s.next, cn)
			s.link = append(s.link, s.link[q])
			s.length = append(s.length, s.length[p]+1)
			s.cnt = append(s.cnt, 0) // clones start at 0
			for p != -1 && s.next[p][c] == q {
				s.next[p][c] = clone
				p = s.link[p]
			}
			s.link[q] = clone
			s.link[cur] = clone
		}
	}
	s.last = cur
}

func (s *SAM) ComputeCounts() {
	order := make([]int, len(s.next))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool {
		return s.length[order[a]] > s.length[order[b]]
	})
	for _, v := range order {
		if s.link[v] > 0 || s.link[v] == 0 {
			if s.link[v] != -1 {
				s.cnt[s.link[v]] += s.cnt[v]
			}
		}
	}
}

func (s *SAM) Occurrences(p string) int64 {
	v := 0
	for i := 0; i < len(p); i++ {
		nv, ok := s.next[v][p[i]]
		if !ok {
			return 0
		}
		v = nv
	}
	return s.cnt[v]
}

func main() {
	sam := NewSAM()
	for i := 0; i < len("abcbc"); i++ {
		sam.Extend("abcbc"[i])
	}
	sam.ComputeCounts()
	fmt.Println("occurrences of bc =", sam.Occurrences("bc")) // 2
	fmt.Println("occurrences of c  =", sam.Occurrences("c"))  // 2
}
```

#### Java

```java
import java.util.*;

public class SamCounts {
    List<Map<Character, Integer>> next = new ArrayList<>();
    List<Integer> link = new ArrayList<>();
    List<Integer> length = new ArrayList<>();
    List<Long> cnt = new ArrayList<>();
    int last;

    SamCounts() {
        next.add(new HashMap<>());
        link.add(-1);
        length.add(0);
        cnt.add(0L);
        last = 0;
    }

    void extend(char c) {
        int cur = next.size();
        next.add(new HashMap<>());
        link.add(-1);
        length.add(length.get(last) + 1);
        cnt.add(1L);
        int p = last;
        while (p != -1 && !next.get(p).containsKey(c)) {
            next.get(p).put(c, cur);
            p = link.get(p);
        }
        if (p == -1) {
            link.set(cur, 0);
        } else {
            int q = next.get(p).get(c);
            if (length.get(p) + 1 == length.get(q)) {
                link.set(cur, q);
            } else {
                int clone = next.size();
                next.add(new HashMap<>(next.get(q)));
                link.add(link.get(q));
                length.add(length.get(p) + 1);
                cnt.add(0L);
                while (p != -1 && Objects.equals(next.get(p).get(c), q)) {
                    next.get(p).put(c, clone);
                    p = link.get(p);
                }
                link.set(q, clone);
                link.set(cur, clone);
            }
        }
        last = cur;
    }

    void computeCounts() {
        Integer[] order = new Integer[next.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> length.get(b) - length.get(a));
        for (int v : order) {
            int lk = link.get(v);
            if (lk != -1) cnt.set(lk, cnt.get(lk) + cnt.get(v));
        }
    }

    long occurrences(String p) {
        int v = 0;
        for (char c : p.toCharArray()) {
            Integer nv = next.get(v).get(c);
            if (nv == null) return 0;
            v = nv;
        }
        return cnt.get(v);
    }

    public static void main(String[] args) {
        SamCounts sam = new SamCounts();
        for (char c : "abcbc".toCharArray()) sam.extend(c);
        sam.computeCounts();
        System.out.println("occurrences of bc = " + sam.occurrences("bc")); // 2
        System.out.println("occurrences of c  = " + sam.occurrences("c"));  // 2
    }
}
```

#### Python

```python
class SamCounts:
    def __init__(self):
        self.nxt = [{}]
        self.link = [-1]
        self.length = [0]
        self.cnt = [0]
        self.last = 0

    def extend(self, c):
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1)
        self.length.append(self.length[self.last] + 1)
        self.cnt.append(1)            # prefix-end: one occurrence
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur
            p = self.link[p]
        if p == -1:
            self.link[cur] = 0
        else:
            q = self.nxt[p][c]
            if self.length[p] + 1 == self.length[q]:
                self.link[cur] = q
            else:
                clone = len(self.nxt)
                self.nxt.append(dict(self.nxt[q]))
                self.link.append(self.link[q])
                self.length.append(self.length[p] + 1)
                self.cnt.append(0)    # clones start at 0
                while p != -1 and self.nxt[p].get(c) == q:
                    self.nxt[p][c] = clone
                    p = self.link[p]
                self.link[q] = clone
                self.link[cur] = clone
        self.last = cur

    def compute_counts(self):
        order = sorted(range(len(self.nxt)), key=lambda v: self.length[v], reverse=True)
        for v in order:
            if self.link[v] != -1:
                self.cnt[self.link[v]] += self.cnt[v]

    def occurrences(self, p):
        v = 0
        for ch in p:
            if ch not in self.nxt[v]:
                return 0
            v = self.nxt[v][ch]
        return self.cnt[v]


if __name__ == "__main__":
    sam = SamCounts()
    for ch in "abcbc":
        sam.extend(ch)
    sam.compute_counts()
    print("occurrences of bc =", sam.occurrences("bc"))  # 2
    print("occurrences of c  =", sam.occurrences("c"))   # 2
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Clones counted as occurrences | `cnt[clone] = 1` inflates counts. | Clones start at `cnt = 0`; only prefix-end states get 1. |
| Counts not aggregated | `cnt[v]` stays 1, queries return 1. | Sum `cnt[link[v]] += cnt[v]` in `len`-descending order. |
| LCS keeps wrong `l` after link descent | Set `l = len[v]+1` only after finding a `c`-edge. | On descent, `l = len[matchedState] + 1`; on full miss, reset to 0. |
| Distinct count off by the root | Included root or used `len[-1]`. | Iterate states `1..`; root contributes nothing. |
| Wrong topological order | Sorted ascending by `len`. | Aggregate **descending** so children precede parents. |
| Generalized SAM merges wrong | Reused `last` across strings without resetting. | Reset `last = root` before each new string (see senior). |

---

## Performance Analysis

| `n` (string length) | states (≤ 2n-1) | transitions (≤ 3n-4) | build (array σ) |
|---------------------|------------------|-----------------------|------------------|
| 10 | ≤ 19 | ≤ 26 | instant |
| 10³ | ≤ 1999 | ≤ 2996 | instant |
| 10⁶ | ≤ 2·10⁶ | ≤ 3·10⁶ | well under a second |
| 10⁷ | ≤ 2·10⁷ | ≤ 3·10⁷ | a few seconds; use array transitions |

The build is amortized `O(n)`: the first `while` loop (adding `c`-edges) and the redirect loop each advance suffix links, and the total link-advances across all `extend` calls is `O(n)`. With a **fixed-size array** of transitions per state, lookups are `O(1)` but memory is `O(n·σ)`; with a **hash map**, memory is `O(n)` (only real edges stored) but with a constant-factor lookup overhead. For competitive constraints (`n ≤ 10^6`, lowercase), arrays win; for huge alphabets, maps win.

```python
# Validating the size bound is a cheap sanity check:
def assert_bounds(sam, n):
    assert len(sam.nxt) <= 2 * n - 1, "too many states"
    edges = sum(len(d) for d in sam.nxt)
    assert edges <= 3 * n - 4 or n < 3, "too many transitions"
```

---

## Best Practices

- **Keep `extend` canonical.** It is the part everyone breaks; verify it against a brute-force distinct-substring counter on random strings of length ≤ 12.
- **Separate phases.** Build fully, then call `computeCounts`, then answer queries. Do not interleave.
- **Use counting sort for `len` ordering.** Values are in `[0, n]`; a counting sort gives the topological order in `O(n)`.
- **Mark terminal states** when "is a suffix" matters; walk links from `last`.
- **Pick the right sibling.** Need sorted suffixes or LCP? Use a suffix array. Need online + occurrence counts? SAM is ideal.
- **Test the clone path** explicitly with repetitive strings (`"aaaa"`, `"abcbc"`); they are where bugs hide.

### A quick correctness recipe

Before trusting a SAM on large input, run this on random short strings:

1. Build the SAM and assert `states ≤ 2n-1`, `edges ≤ 3n-4`, and `len[link[v]] < len[v]` for all `v`.
2. Compare `Σ len[v]-len[link[v]]` against `len(set of all substrings))`.
3. For a few random substrings `p`, compare `occ(p)` against a naive `s.count`-style scan.
4. For a random second string `t`, compare the SAM LCS against the `O(|s||t|)` brute force.

If all four pass on a few hundred random instances across alphabets of size 1–3 (small alphabets force clones), the implementation is almost certainly correct. The unary string `"aaaa"` is the single best stress input for the clone path.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Each `extend` creating a new state with its `len`, and the suffix-link walk adding transitions.
> - The **clone/split** event drawn explicitly: one state dividing, transitions redirecting, links rewired.
> - The suffix-link tree growing alongside, so you can watch endpos classes refine.

---

## Summary

A suffix automaton's states are **endpos equivalence classes**: substrings grouped by where they end. The endpos sets nest into a laminar family, which is exactly the **suffix-link tree**, and each state holds a contiguous length range `[len[link]+1, len]`. The online `extend` keeps the automaton minimal; its only subtlety is the **clone/split**, which fires when a found `c`-transition leads to a non-solid state (`len[q] != len[p]+1`) — the shorter strings gain a new occurrence and must split into a coarser class. From this structure, **distinct substrings** are `Σ (len[v]-len[link[v]])`, **occurrence counts** are endpos sizes aggregated up the link tree, and the **longest common substring** of two strings is found by running one through the other's SAM in linear time. Against its siblings: SAM excels at online build, distinct/occurrence counting, and two-string LCS; suffix arrays win on sorted order and memory; suffix trees give explicit substring paths. Master the clone and the link tree, and the whole counting family is linear.