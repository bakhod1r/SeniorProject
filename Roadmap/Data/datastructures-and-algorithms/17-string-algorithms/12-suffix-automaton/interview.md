# Suffix Automaton (SAM) — Interview Preparation

The suffix automaton is a high-signal interview topic: it rewards one crisp insight — *"states are endpos equivalence classes; the automaton recognizes every substring"* — and then tests whether you can (a) build it online in `O(n)` with the clone/split, (b) count **distinct substrings** with the `Σ len[v]-len[link[v]]` formula, (c) count **occurrences** via endpos sizes aggregated up the suffix-link tree, and (d) find the **longest common substring** of two strings by running one through the other's SAM. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is `p` a substring of `s`? | walk transitions from `t0` | `O(\|p\|)` |
| Number of distinct substrings | `Σ (len[v] − len[link[v]])` | `O(n)` |
| Total length of distinct substrings | `Σ T(len[v]) − T(len[link[v]])`, `T(m)=m(m+1)/2` | `O(n)` |
| Occurrences of a substring | endpos size `cnt[v]` via link-tree sum | `O(n)` prep, `O(\|p\|)` query |
| Longest common substring of `s`, `t` | run `t` through `SA(s)` | `O(\|s\|+\|t\|)` |
| k-th smallest distinct substring | guided DFS over path counts | `O(\|ans\|·σ)` |
| #states / #transitions | bounds | `≤ 2n−1` / `≤ 3n−4` |

Core `extend` skeleton:

```text
extend(c):
    cur = new state, len[cur] = len[last]+1
    p = last
    while p != -1 and no c-edge at p:  next[p][c] = cur; p = link[p]
    if p == -1: link[cur] = root
    else:
        q = next[p][c]
        if len[q] == len[p]+1: link[cur] = q
        else: clone q (len=len[p]+1, copy next/link), redirect p..->q to clone,
              link[q] = link[cur] = clone
    last = cur
```

Key facts:
- A **state** = an **endpos equivalence class** (substrings ending in the same positions), holding lengths `[len[link]+1, len]`.
- **Suffix links** form a tree with strictly decreasing `len`.
- Distinct substrings: `Σ len[v]−len[link[v]]`. Occurrences: endpos sizes (clones start at 0, prefix-ends at 1).
- Build is **online**, amortized `O(n)`; the only subtlety is the clone/split.

---

## Junior Questions (12 Q&A)

### J1. What is a suffix automaton?
The minimal DFA that accepts exactly the suffixes of a string `s`. Because every substring of `s` is a prefix of some suffix, walking the automaton from the start also recognizes every substring of `s`.

### J2. What does a single state represent?
An **endpos equivalence class**: a group of substrings that all occur ending at exactly the same set of positions. Many substrings collapse into one state, which is why the automaton is small.

### J3. What are `len[v]` and `link[v]`?
`len[v]` is the length of the longest substring in state `v`'s class. `link[v]` is the suffix link: the state of the longest proper suffix of `v`'s longest string that lies in a different (coarser) endpos class. Links form a tree.

### J4. How do you check whether `p` is a substring?
Walk transitions from the initial state, one per character of `p`. If you ever lack a transition, `p` is not a substring; if you consume all of `p`, it is. This is `O(|p|)`.

### J5. How big is a suffix automaton?
At most `2n−1` states and `3n−4` transitions for a string of length `n` (`n ≥ 2`/`n ≥ 3`). It is linear-size despite indexing up to `Θ(n²)` distinct substrings.

### J6. How long does it take to build?
`O(n)` amortized (online, one character at a time) for a fixed alphabet — `O(n·σ)` with array transitions counting initialization, `O(n)` expected with hashing.

### J7. What is the formula for the number of distinct substrings?
`Σ over states v ≠ root of (len[v] − len[link[v]])`. Each state contributes its contiguous range of substring lengths.

### J8. Why does each state hold a *range* of lengths?
All substrings in one endpos class are suffixes of each other, and their lengths form a contiguous interval `[len[link[v]]+1, len[v]]`. So the state stores only `len[v]`; the lower end comes from the link.

### J9. What is the initial state?
The start state `t0` with `len = 0` and `link = -1`. It represents the empty substring and is the root of the suffix-link tree.

### J10. What is a clone?
A copied state created during `extend` when an endpos class must split. It copies the original's transitions and link, takes `len = len[p]+1`, and represents the shorter strings that gained a new occurrence.

### J11. Substring vs suffix recognition — what is the difference?
Substring membership is "did the transition walk survive". Suffix membership is "did the walk end in a **terminal** state" (a class containing a suffix of `s`), which you mark by walking links from the last state.

### J12 (analysis). Why is the build `O(n)` and not `O(n²)`?
The `while` loops in `extend` advance suffix links, and a monotone potential (tied to `len` and link-tree depth) caps the total advances across all `n` calls at `O(n)`. Individual `extend` calls vary, but they amortize to linear.

---

## Middle Questions (12 Q&A)

### M1. Define `endpos(t)` and explain why it defines states.
`endpos(t)` is the set of end-positions of all occurrences of `t` in `s`. Two substrings with identical endpos sets are interchangeable in the automaton, so they share a state. The endpos classes are exactly the states.

### M2. Why do endpos sets form a laminar family?
For substrings `u, w` with `|u| ≤ |w|`: if `u` is a suffix of `w` then `endpos(w) ⊆ endpos(u)`; otherwise the sets are disjoint. So any two endpos sets are nested or disjoint — a laminar family — which is exactly the suffix-link tree.

### M3. When does `extend` create a clone?
When the first `while` loop stops at a state `p` whose `c`-transition leads to `q` with `len[q] != len[p]+1` (non-solid). The shorter strings of `q` gain the new end-position but the longer ones do not, so `q` must split.

### M4. What does the clone inherit, and what changes?
The clone copies `q`'s transitions and `q`'s suffix link, and sets `len[clone] = len[p]+1`. Then edges `p..--c-->q` are redirected to the clone (while they equal `q`), and `link[q]` and `link[cur]` are set to the clone.

### M5. How do you count occurrences of every substring?
Set `cnt = 1` on prefix-end states (`0` on clones), sort states by `len` descending, and accumulate `cnt[link[v]] += cnt[v]`. Then `cnt[v] = |endpos(v)|` = occurrence count for every substring in `v`.

### M6. Why must clones start with `cnt = 0`?
A clone is never the end of a fresh prefix; it only holds already-existing shorter strings. Giving it `cnt = 1` would double-count the position already credited to the prefix-end state it split from.

### M7. How do you find the longest common substring of two strings?
Build `SA(s)`, then walk `t` through it maintaining current state `v` and matched length `l`. On a missing transition, follow suffix links (resetting `l = len[v]+1`) until a transition exists or you reach the root. Track the maximum `l`. Runs in `O(|s|+|t|)`.

### M8. What is the suffix-link tree and why does `len` decrease toward the root?
The tree formed by `link[v]` pointers, rooted at `t0`. Each link goes to a strictly shorter string in a coarser class, so `len[link[v]] < len[v]`; sorting by `len` descending is a topological order.

### M9. How is the SAM related to the suffix array and suffix tree?
All three index every substring in `O(n)` space/build. SAM excels at online build, distinct/occurrence counting, and two-string LCS; suffix arrays give sorted suffix order and LCP with the smallest memory; suffix trees give explicit substring paths. The SAM's link tree is the suffix tree of the reversed string.

### M10. How do you compute the total length of all distinct substrings?
Sum each state's length-interval contribution: `Σ (T(len[v]) − T(len[link[v]]))` where `T(m)=m(m+1)/2`. Each state contributes lengths `len[link[v]]+1 .. len[v]`.

### M11. How do you find the k-th smallest distinct substring?
Precompute `paths[v]` = number of distinct substrings reachable from `v` (in reverse topological order). Then DFS from the root, trying characters in alphabetical order and subtracting path counts until you isolate the k-th. The walk length equals the answer's length.

### M12 (analysis). What forces the `≤ 2n−1` state bound?
Each `extend` creates exactly one prefix-end state and at most one clone (the first loop stops at a single `q`). Over `n` characters that is at most `1 + n + (n−1) = 2n`, tightened to `2n−1`, achieved by `s = ab^{n-1}`.

---

## Senior Questions (10 Q&A)

### S1. How do you store transitions, and what is the trade-off?
Fixed-size array per state: `O(1)` lookup but `O(states·σ)` memory — good for small alphabets. Hash map or global table: `O(edges)` memory but a larger constant — good for large/sparse alphabets. Remap the alphabet to a dense range when it is large but sparse.

### S2. How do you build a generalized SAM over many strings?
Either reset `last = root` before each string and use a **guarded** extend that reuses an existing solid transition (and splits a non-solid one) instead of creating a duplicate state, or insert all strings into a trie and run the SAM construction in BFS order over the trie. The guard is essential to avoid spurious states.

### S3. How do you count in how many *documents* a substring appears?
Attach document ids to prefix-end states and aggregate **distinct** ids up the suffix-link tree. For few documents use a bitmask per state; for many, use small-to-large set merging or an Euler-tour offline distinct-color count to stay `O(n log n)`.

### S4. How do you report all positions of a pattern, not just the count?
Store `firstpos[v]` (the end position of the first occurrence) at creation, clones inheriting from the split state. The occurrences of a matched substring are the `firstpos` of prefix-end states in the subtree of the matched state in the suffix-link tree — enumerated in `O(occurrences)`.

### S5. What numeric types do you need, and why?
64-bit for occurrence counts, distinct-substring counts (up to `~5·10^{11}` for `n = 10^6`), and total-length sums — they overflow 32-bit. Cap path counts at `k` for the k-th-substring query to avoid overflow.

### S6. How do you verify correctness when the text is huge?
Keep a brute-force distinct-substring oracle (`set` of all substrings) for small `n` and compare to `Σ len[v]−len[link[v]]`. Assert the size bounds (`≤ 2n−1`, `≤ 3n−4`) and `len[link[v]] < len[v]`. Cross-check occurrence counts against a naive scan on samples.

### S7. Why is the SAM's link tree the suffix tree of the reversed string?
endpos sets of substrings of `s` correspond to start-position sets of reversed substrings in `s^R`, and the laminar family of endpos sets is exactly the subtree family of the suffix tree of `s^R`. The parent relations coincide, so the structures are isomorphic.

### S8. How do you find the longest substring occurring at least `t` times?
After computing `cnt[v] = |endpos(v)|`, take the maximum `len[v]` among states with `cnt[v] ≥ t`; the substring is `long(v)`, recoverable via `firstpos[v]` and `len[v]`.

### S9. What is the most common bug in a generalized SAM, and how do you prevent it?
Creating duplicate states by skipping the "transition already exists" guard on reset-`last` insertion. Prevent it with the guarded extend or the trie-driven build, and assert `states ≤ 2·totalLen`.

### S10 (analysis). Prove the `extend` is amortized `O(n)`.
Both `while` loops advance suffix links. A monotone potential tied to `len[last]` (which increases by exactly 1 per call) and the link-tree depth bounds the total iterations across all `n` calls by `O(n)`. Per-call extras are `O(1)` (plus `O(σ)` clone copies, `≤ n−1` clones total).

---

## Professional Questions (8 Q&A)

### P1. Design a substring-search service over a large fixed corpus with many queries.
Build the SAM of the corpus once (online, streaming the text), precompute `cnt` over the suffix-link tree, and serialize as flattened CSR transition arrays. Each query walks `p` in `O(|p|)` and returns `cnt[v]`. Store `firstpos` + Euler-tour ranges if position listing is needed. Validate size bounds on load.

### P2. How do you answer "longest common substring of all `m` documents"?
Build a generalized SAM; for each state compute the number of *distinct* documents whose occurrences pass through it (subtree distinct-color count). The answer is the maximum `len[v]` among states reached by all `m` documents. This is `O(total length · log m)` with the distinct-color technique.

### P3. Your SAM uses too much memory at `σ = 65536`. What do you do?
Array transitions cost `O(states·σ)` — prohibitive. Remap the alphabet to the dense set actually used; if still large, switch to per-state hash maps or a global open-addressing table keyed by `(state, char)`, storing only the `≤ 3n−4` real edges. Estimate `states·σ·4 bytes` before choosing.

### P4. How do you debug "occurrence counts are wrong" in production?
Check the three usual suspects: clones initialized to `cnt = 1` (must be 0), aggregation done in `len`-ascending instead of descending order, and a broken clone (missing copied transitions). Re-run a naive `count(s, p)` on sampled patterns and diff against `cnt[v]`.

### P5. When is the suffix array the better choice over the SAM?
When you need suffixes in **sorted order**, LCP-array queries, or the smallest memory footprint (flat `n`-int arrays). The SAM does not give sorted suffix ranks naturally; the suffix array (`04`) does, and is more cache-friendly for those tasks.

### P6. How do you make distinct-substring counting reproducible across languages?
State numbering is non-canonical (depends on clone timing), but the *semantic* outputs are canonical. Compare distinct counts, occurrence counts, and LCS lengths — not raw state ids — and iterate transitions in character-sorted order where output order matters.

### P7. How does the SAM connect to automata theory and minimality?
The SAM is the Myhill-Nerode-minimal DFA for the language of suffixes: minimal-DFA states equal Myhill-Nerode classes of reachable strings, which coincide with endpos classes. So no DFA with fewer states accepts exactly the suffixes of `s`.

### P8 (analysis). Why is the clone the *only* way to keep the automaton minimal during `extend`?
Adding a character splits an endpos class precisely when the shorter strings gain the new end-position but the longer ones do not (`len[q] > len[p]+1`). The class must divide at the length boundary `len[p]+1`; the clone realizes that split while preserving all transitions and links, restoring the contiguous-length invariant that minimality requires.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n·q)` scan with an index.
Look for a concrete story: many substring/occurrence queries against a fixed text, a profile showing repeated scans dominating, the insight to build a SAM once and answer each query in `O(|p|)`, and the measured speedup. Strong answers mention the brute-force oracle used to validate the index.

### B2. A teammate's distinct-substring count is off by a lot. How do you help?
Calmly walk the formula `Σ len[v]−len[link[v]]` and the two classic bugs: summing over the root, and a broken clone (missing copied transitions). Show a tiny case (`"aaaa"` → 4 distinct substrings) and the brute-force `set` oracle. Frame it as a debugging recipe, not blame.

### B3. Design a feature: "documents containing this phrase, and how many times."
A generalized SAM over the documents. Walk the phrase to a state, return `cnt[v]` for total occurrences and the subtree distinct-document count for document coverage. Discuss memory (transition storage at the corpus's alphabet), incremental ingestion via the online build, and serialization.

### B4. Explain a suffix automaton to a junior engineer.
Start with the mailing-list analogy: substrings that always appear at the same positions get grouped into one "state". Then: walk characters to test membership, and the automaton is tiny (`≤ 2n` states). Lead with the two gotchas — a state is a *group* of substrings, and "substring" means "the walk survived", not "ended accepting".

### B5. Your SAM build is slow on a 100 MB text. How do you investigate?
Profile transition lookups — array vs map matters at scale. Check the alphabet: a large σ with array transitions wastes memory and cache. Confirm you preallocate `2n` states (no reallocation churn) and use counting sort (not comparison sort) for the `len` order. The fix is usually transition-layout choice plus alphabet remapping.

---

## Coding Challenges

### Challenge 1: Build a SAM and Count Distinct Substrings

**Problem.** Given a string `s`, return the number of distinct nonempty substrings of `s`.

**Example.**
```text
s = "aba"   -> 5   ("a","b","ab","ba","aba")
s = "aaaa"  -> 4   ("a","aa","aaa","aaaa")
```

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Brute force.** Enumerate all `O(n²)` substrings into a set — infeasible for large `n`.

**Optimal.** Build the SAM and sum `len[v] − len[link[v]]`, `O(n)`.

**Go.**
```go
package main

import "fmt"

type SAM struct {
	next   []map[byte]int
	link   []int
	length []int
	last   int
}

func NewSAM() *SAM {
	s := &SAM{next: []map[byte]int{{}}, link: []int{-1}, length: []int{0}, last: 0}
	return s
}

func (s *SAM) Extend(c byte) {
	cur := len(s.next)
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, s.length[s.last]+1)
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

func (s *SAM) Distinct() int64 {
	var total int64
	for v := 1; v < len(s.next); v++ {
		total += int64(s.length[v] - s.length[s.link[v]])
	}
	return total
}

func main() {
	sam := NewSAM()
	for i := 0; i < len("aba"); i++ {
		sam.Extend("aba"[i])
	}
	fmt.Println(sam.Distinct()) // 5
}
```

**Java.**
```java
import java.util.*;

public class DistinctSubstrings {
    List<Map<Character, Integer>> next = new ArrayList<>();
    int[] link, length;
    int sz = 0, last = 0, cap;

    DistinctSubstrings(int n) {
        cap = 2 * n + 5;
        link = new int[cap];
        length = new int[cap];
        next.add(new HashMap<>());
        link[0] = -1;
        sz = 1;
    }

    void extend(char c) {
        int cur = sz++;
        next.add(new HashMap<>());
        length[cur] = length[last] + 1;
        link[cur] = -1;
        int p = last;
        while (p != -1 && !next.get(p).containsKey(c)) {
            next.get(p).put(c, cur);
            p = link[p];
        }
        if (p == -1) link[cur] = 0;
        else {
            int q = next.get(p).get(c);
            if (length[p] + 1 == length[q]) link[cur] = q;
            else {
                int clone = sz++;
                next.add(new HashMap<>(next.get(q)));
                length[clone] = length[p] + 1;
                link[clone] = link[q];
                while (p != -1 && Objects.equals(next.get(p).get(c), q)) {
                    next.get(p).put(c, clone);
                    p = link[p];
                }
                link[q] = clone;
                link[cur] = clone;
            }
        }
        last = cur;
    }

    long distinct() {
        long total = 0;
        for (int v = 1; v < sz; v++) total += length[v] - length[link[v]];
        return total;
    }

    public static void main(String[] args) {
        String s = "aba";
        DistinctSubstrings sam = new DistinctSubstrings(s.length());
        for (char c : s.toCharArray()) sam.extend(c);
        System.out.println(sam.distinct()); // 5
    }
}
```

**Python.**
```python
class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.last = 0

    def extend(self, c):
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1)
        self.length.append(self.length[self.last] + 1)
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur; p = self.link[p]
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
                while p != -1 and self.nxt[p].get(c) == q:
                    self.nxt[p][c] = clone; p = self.link[p]
                self.link[q] = clone
                self.link[cur] = clone
        self.last = cur

    def distinct(self):
        return sum(self.length[v] - self.length[self.link[v]] for v in range(1, len(self.nxt)))


if __name__ == "__main__":
    sam = SAM()
    for ch in "aba":
        sam.extend(ch)
    print(sam.distinct())  # 5
```

---

### Challenge 2: Number of Occurrences of a Pattern

**Problem.** Given `s` and a pattern `p`, return how many times `p` occurs in `s` (as a substring).

**Example.**
```text
s = "abcbc", p = "bc"  -> 2
s = "abcbc", p = "xy"  -> 0
```

**Approach.** Build `SA(s)`, set `cnt=1` on prefix-ends (`0` on clones), aggregate up the link tree, then walk `p` and read `cnt[v]`. `O(n)` prep, `O(|p|)` query.

**Python.**
```python
class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.cnt = [0]; self.last = 0

    def extend(self, c):
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1)
        self.length.append(self.length[self.last] + 1); self.cnt.append(1)
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur; p = self.link[p]
        if p == -1:
            self.link[cur] = 0
        else:
            q = self.nxt[p][c]
            if self.length[p] + 1 == self.length[q]:
                self.link[cur] = q
            else:
                clone = len(self.nxt)
                self.nxt.append(dict(self.nxt[q])); self.link.append(self.link[q])
                self.length.append(self.length[p] + 1); self.cnt.append(0)
                while p != -1 and self.nxt[p].get(c) == q:
                    self.nxt[p][c] = clone; p = self.link[p]
                self.link[q] = clone; self.link[cur] = clone
        self.last = cur

    def finalize(self):
        for v in sorted(range(len(self.nxt)), key=lambda x: self.length[x], reverse=True):
            if self.link[v] != -1:
                self.cnt[self.link[v]] += self.cnt[v]

    def occ(self, p):
        v = 0
        for ch in p:
            if ch not in self.nxt[v]:
                return 0
            v = self.nxt[v][ch]
        return self.cnt[v]


if __name__ == "__main__":
    sam = SAM()
    for ch in "abcbc":
        sam.extend(ch)
    sam.finalize()
    print(sam.occ("bc"))  # 2
    print(sam.occ("xy"))  # 0
```

**Go.**
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
	return &SAM{next: []map[byte]int{{}}, link: []int{-1}, length: []int{0}, cnt: []int64{0}, last: 0}
}

func (s *SAM) Extend(c byte) {
	cur := len(s.next)
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, s.length[s.last]+1)
	s.cnt = append(s.cnt, 1)
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
			s.cnt = append(s.cnt, 0)
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

func (s *SAM) Finalize() {
	order := make([]int, len(s.next))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return s.length[order[a]] > s.length[order[b]] })
	for _, v := range order {
		if s.link[v] != -1 {
			s.cnt[s.link[v]] += s.cnt[v]
		}
	}
}

func (s *SAM) Occ(p string) int64 {
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
	sam.Finalize()
	fmt.Println(sam.Occ("bc")) // 2
}
```

**Java.**
```java
import java.util.*;

public class Occurrences {
    List<Map<Character, Integer>> next = new ArrayList<>();
    int[] link, length; long[] cnt; int sz = 0, last = 0;

    Occurrences(int n) {
        int cap = 2 * n + 5;
        link = new int[cap]; length = new int[cap]; cnt = new long[cap];
        next.add(new HashMap<>()); link[0] = -1; sz = 1;
    }

    void extend(char c) {
        int cur = sz++;
        next.add(new HashMap<>()); length[cur] = length[last] + 1; cnt[cur] = 1; link[cur] = -1;
        int p = last;
        while (p != -1 && !next.get(p).containsKey(c)) { next.get(p).put(c, cur); p = link[p]; }
        if (p == -1) link[cur] = 0;
        else {
            int q = next.get(p).get(c);
            if (length[p] + 1 == length[q]) link[cur] = q;
            else {
                int clone = sz++;
                next.add(new HashMap<>(next.get(q)));
                length[clone] = length[p] + 1; link[clone] = link[q]; cnt[clone] = 0;
                while (p != -1 && Objects.equals(next.get(p).get(c), q)) { next.get(p).put(c, clone); p = link[p]; }
                link[q] = clone; link[cur] = clone;
            }
        }
        last = cur;
    }

    void finalizeCounts() {
        Integer[] order = new Integer[sz];
        for (int i = 0; i < sz; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> length[b] - length[a]);
        for (int v : order) if (link[v] != -1) cnt[link[v]] += cnt[v];
    }

    long occ(String p) {
        int v = 0;
        for (char c : p.toCharArray()) {
            Integer nv = next.get(v).get(c);
            if (nv == null) return 0;
            v = nv;
        }
        return cnt[v];
    }

    public static void main(String[] args) {
        String s = "abcbc";
        Occurrences sam = new Occurrences(s.length());
        for (char c : s.toCharArray()) sam.extend(c);
        sam.finalizeCounts();
        System.out.println(sam.occ("bc")); // 2
    }
}
```

---

### Challenge 3: Longest Common Substring of Two Strings

**Problem.** Given strings `s` and `t`, return the length of their longest common substring.

**Example.**
```text
s = "abcde", t = "cdef"  -> 3   ("cde")
```

**Approach.** Build `SA(s)`, run `t` through it tracking current state and matched length; on a miss, follow suffix links and reset the length. `O(|s|+|t|)`.

**Python.**
```python
class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.last = 0

    def extend(self, c):
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1); self.length.append(self.length[self.last] + 1)
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur; p = self.link[p]
        if p == -1:
            self.link[cur] = 0
        else:
            q = self.nxt[p][c]
            if self.length[p] + 1 == self.length[q]:
                self.link[cur] = q
            else:
                clone = len(self.nxt)
                self.nxt.append(dict(self.nxt[q])); self.link.append(self.link[q])
                self.length.append(self.length[p] + 1)
                while p != -1 and self.nxt[p].get(c) == q:
                    self.nxt[p][c] = clone; p = self.link[p]
                self.link[q] = clone; self.link[cur] = clone
        self.last = cur


def lcs(s, t):
    sam = SAM()
    for ch in s:
        sam.extend(ch)
    v, l, best = 0, 0, 0
    for ch in t:
        while v != 0 and ch not in sam.nxt[v]:
            v = sam.link[v]
            l = sam.length[v]
        if ch in sam.nxt[v]:
            v = sam.nxt[v][ch]
            l += 1
        else:
            v, l = 0, 0
        best = max(best, l)
    return best


if __name__ == "__main__":
    print(lcs("abcde", "cdef"))  # 3
```

**Go.**
```go
package main

import "fmt"

type SAM struct {
	next   []map[byte]int
	link   []int
	length []int
	last   int
}

func NewSAM() *SAM {
	return &SAM{next: []map[byte]int{{}}, link: []int{-1}, length: []int{0}, last: 0}
}

func (s *SAM) Extend(c byte) {
	cur := len(s.next)
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, s.length[s.last]+1)
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

func lcs(s, t string) int {
	sam := NewSAM()
	for i := 0; i < len(s); i++ {
		sam.Extend(s[i])
	}
	v, l, best := 0, 0, 0
	for i := 0; i < len(t); i++ {
		c := t[i]
		for v != 0 {
			if _, ok := sam.next[v][c]; ok {
				break
			}
			v = sam.link[v]
			l = sam.length[v]
		}
		if nv, ok := sam.next[v][c]; ok {
			v = nv
			l++
		} else {
			v, l = 0, 0
		}
		if l > best {
			best = l
		}
	}
	return best
}

func main() {
	fmt.Println(lcs("abcde", "cdef")) // 3
}
```

**Java.**
```java
import java.util.*;

public class LCS {
    List<Map<Character, Integer>> next = new ArrayList<>();
    int[] link, length; int sz = 0, last = 0;

    LCS(int n) {
        int cap = 2 * n + 5;
        link = new int[cap]; length = new int[cap];
        next.add(new HashMap<>()); link[0] = -1; sz = 1;
    }

    void extend(char c) {
        int cur = sz++;
        next.add(new HashMap<>()); length[cur] = length[last] + 1; link[cur] = -1;
        int p = last;
        while (p != -1 && !next.get(p).containsKey(c)) { next.get(p).put(c, cur); p = link[p]; }
        if (p == -1) link[cur] = 0;
        else {
            int q = next.get(p).get(c);
            if (length[p] + 1 == length[q]) link[cur] = q;
            else {
                int clone = sz++;
                next.add(new HashMap<>(next.get(q)));
                length[clone] = length[p] + 1; link[clone] = link[q];
                while (p != -1 && Objects.equals(next.get(p).get(c), q)) { next.get(p).put(c, clone); p = link[p]; }
                link[q] = clone; link[cur] = clone;
            }
        }
        last = cur;
    }

    static int lcs(String s, String t) {
        LCS sam = new LCS(s.length());
        for (char c : s.toCharArray()) sam.extend(c);
        int v = 0, l = 0, best = 0;
        for (char c : t.toCharArray()) {
            while (v != 0 && !sam.next.get(v).containsKey(c)) { v = sam.link[v]; l = sam.length[v]; }
            if (sam.next.get(v).containsKey(c)) { v = sam.next.get(v).get(c); l++; }
            else { v = 0; l = 0; }
            best = Math.max(best, l);
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(lcs("abcde", "cdef")); // 3
    }
}
```

---

### Challenge 4: k-th Smallest Distinct Substring

**Problem.** Given `s` and `k` (1-indexed), return the k-th lexicographically smallest distinct substring of `s`, or report it does not exist.

**Approach.** Build `SA(s)`. Precompute `paths[v]` = number of distinct substrings reachable from `v` (reverse topological order). DFS from the root in alphabetical order, subtracting counts until you isolate the k-th. `O(|answer|·σ)`.

**Python.**
```python
class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.last = 0

    def extend(self, c):
        cur = len(self.nxt)
        self.nxt.append({}); self.link.append(-1); self.length.append(self.length[self.last] + 1)
        p = self.last
        while p != -1 and c not in self.nxt[p]:
            self.nxt[p][c] = cur; p = self.link[p]
        if p == -1:
            self.link[cur] = 0
        else:
            q = self.nxt[p][c]
            if self.length[p] + 1 == self.length[q]:
                self.link[cur] = q
            else:
                clone = len(self.nxt)
                self.nxt.append(dict(self.nxt[q])); self.link.append(self.link[q])
                self.length.append(self.length[p] + 1)
                while p != -1 and self.nxt[p].get(c) == q:
                    self.nxt[p][c] = clone; p = self.link[p]
                self.link[q] = clone; self.link[cur] = clone
        self.last = cur


def kth_substring(s, k):
    sam = SAM()
    for ch in s:
        sam.extend(ch)
    n = len(sam.nxt)
    order = sorted(range(n), key=lambda v: sam.length[v])  # ascending; process longest last
    paths = [0] * n
    for v in reversed(order):                              # reverse topo = len descending
        paths[v] = 1
        for c in sam.nxt[v]:
            paths[v] += paths[sam.nxt[v][c]]
    # root contributes no substring of its own; subtract its self count
    if k > paths[0] - 1:
        return None
    res, v = [], 0
    while k > 0:
        for c in sorted(sam.nxt[v]):
            nv = sam.nxt[v][c]
            if k <= paths[nv]:
                res.append(c)
                k -= 1
                v = nv
                break
            else:
                k -= paths[nv]
    return "".join(res)


if __name__ == "__main__":
    print(kth_substring("aba", 1))  # "a"
    print(kth_substring("aba", 5))  # "ba"
```

**Go.**
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
	last   int
}

func NewSAM() *SAM {
	return &SAM{next: []map[byte]int{{}}, link: []int{-1}, length: []int{0}, last: 0}
}

func (s *SAM) Extend(c byte) {
	cur := len(s.next)
	s.next = append(s.next, map[byte]int{})
	s.link = append(s.link, -1)
	s.length = append(s.length, s.length[s.last]+1)
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

func kth(s string, k int64) string {
	sam := NewSAM()
	for i := 0; i < len(s); i++ {
		sam.Extend(s[i])
	}
	n := len(sam.next)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool { return sam.length[order[a]] > sam.length[order[b]] })
	paths := make([]int64, n)
	for _, v := range order {
		paths[v] = 1
		for _, nv := range sam.next[v] {
			paths[v] += paths[nv]
		}
	}
	if k > paths[0]-1 {
		return "(none)"
	}
	res := []byte{}
	v := 0
	for k > 0 {
		keys := []byte{}
		for c := range sam.next[v] {
			keys = append(keys, c)
		}
		sort.Slice(keys, func(a, b int) bool { return keys[a] < keys[b] })
		for _, c := range keys {
			nv := sam.next[v][c]
			if k <= paths[nv] {
				res = append(res, c)
				k--
				v = nv
				break
			}
			k -= paths[nv]
		}
	}
	return string(res)
}

func main() {
	fmt.Println(kth("aba", 1)) // a
	fmt.Println(kth("aba", 5)) // ba
}
```

**Java.**
```java
import java.util.*;

public class KthSubstring {
    List<Map<Character, Integer>> next = new ArrayList<>();
    int[] link, length; int sz = 0, last = 0;

    KthSubstring(int n) {
        int cap = 2 * n + 5;
        link = new int[cap]; length = new int[cap];
        next.add(new HashMap<>()); link[0] = -1; sz = 1;
    }

    void extend(char c) {
        int cur = sz++;
        next.add(new HashMap<>()); length[cur] = length[last] + 1; link[cur] = -1;
        int p = last;
        while (p != -1 && !next.get(p).containsKey(c)) { next.get(p).put(c, cur); p = link[p]; }
        if (p == -1) link[cur] = 0;
        else {
            int q = next.get(p).get(c);
            if (length[p] + 1 == length[q]) link[cur] = q;
            else {
                int clone = sz++;
                next.add(new HashMap<>(next.get(q)));
                length[clone] = length[p] + 1; link[clone] = link[q];
                while (p != -1 && Objects.equals(next.get(p).get(c), q)) { next.get(p).put(c, clone); p = link[p]; }
                link[q] = clone; link[cur] = clone;
            }
        }
        last = cur;
    }

    String kth(String s, long k) {
        for (char c : s.toCharArray()) extend(c);
        Integer[] order = new Integer[sz];
        for (int i = 0; i < sz; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> length[b] - length[a]);
        long[] paths = new long[sz];
        for (int v : order) {
            paths[v] = 1;
            for (int nv : next.get(v).values()) paths[v] += paths[nv];
        }
        if (k > paths[0] - 1) return "(none)";
        StringBuilder res = new StringBuilder();
        int v = 0;
        while (k > 0) {
            for (char c : new TreeSet<>(next.get(v).keySet())) {
                int nv = next.get(v).get(c);
                if (k <= paths[nv]) { res.append(c); k--; v = nv; break; }
                k -= paths[nv];
            }
        }
        return res.toString();
    }

    public static void main(String[] args) {
        System.out.println(new KthSubstring(3).kth("aba", 1)); // a
        System.out.println(new KthSubstring(3).kth("aba", 5)); // ba
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"States are endpos equivalence classes; the automaton recognizes every substring, and it builds online in `O(n)`."*
- Immediately name the two key formulas: **distinct substrings** `Σ len[v]−len[link[v]]` and **occurrences** = endpos sizes aggregated up the suffix-link tree.
- For the **clone/split**, state the trigger crisply: it fires when `len[q] != len[p]+1` because the shorter strings gain a new end-position but the longer ones do not.
- For **LCS of two strings**, run `t` through `SA(s)`, following suffix links on a miss and resetting the matched length.
- Always offer to validate against a brute-force distinct-substring (`set`) oracle on small inputs — and to assert the `≤ 2n−1` / `≤ 3n−4` size bounds.