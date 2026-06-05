# Palindromic Tree (eertree) — Interview Preparation

The eertree is a favourite interview topic because it rewards a single crisp insight — *"appending one character creates at most one new distinct palindrome, so all distinct palindromes fit in `≤ n + 2` nodes"* — and then tests whether you can (a) explain the two roots and the suffix link, (b) describe the online `O(n)` construction (the suffix-link walk to find the extensible palindromic suffix), (c) turn the tree into answers — distinct counts, total occurrences, per-position counts — and (d) contrast it with Manacher (which counts but does not store the distinct set). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Distinct palindromic substrings | `numberOfNodes - 2` | `O(n·|Σ|)` build, `O(1)` read |
| Total palindromic substrings (multiplicity) | occurrence propagation up suffix links | `O(n)` |
| Palindromes ending at each position | `endCount[last]` per character | `O(1)` per position |
| Longest palindromic suffix of each prefix | `len[last]` per character | `O(1)` per position |
| Longest palindromic substring | `max len over nodes` (or Manacher) | `O(n)` |
| Palindromic richness | every `add()` returns true? | `O(n)` |
| Minimum palindromic factorization | eertree + series links | `O(n log n)` |
| **Count *distinct* palindromes with Manacher** | **not directly — Manacher stores radii, not the set** | — |

Core construction (counting "did a new palindrome appear?"):

```text
add(c) at position i:
    cur = getLink(last, i)                 # walk suffix links from last
    if next[cur][c] exists:
        last = next[cur][c]; return false  # palindrome already seen
    create node now, len[now] = len[cur] + 2
    if len[now] == 1: link[now] = emptyRoot
    else:             link[now] = next[getLink(link[cur], i)][c]
    next[cur][c] = now; last = now; return true   # new palindrome

getLink(x, i):  while i - len[x] - 1 < 0 or s[i - len[x] - 1] != s[i]: x = link[x]; return x
```

Key facts:
- **Two roots:** imaginary `len = -1` (parent of odd palindromes), empty `len = 0` (parent of even palindromes).
- **Suffix link** of `P` = longest proper palindromic suffix of `P`.
- **`last`** = longest palindromic suffix of the prefix read so far.
- Each character adds **at most one** new distinct palindrome → `≤ n + 2` nodes, `O(n)` build.
- Length-1 palindromes link to the **empty** root, not the imaginary one.

---

## Junior Questions (12 Q&A)

### J1. What does the eertree store?
Every **distinct palindromic substring** of the string, one per node. The palindrome `a` may occur many times but gets a single node. The tree uses at most `n + 2` nodes for a length-`n` string.

### J2. Why "at most `n + 2` nodes"?
Because appending one character creates at most **one** new distinct palindrome (the new longest palindromic suffix). Over `n` characters that is at most `n` distinct palindromes, plus the two roots — `n + 2` total.

### J3. What are the two roots?
The **imaginary root** with `len = -1` (the parent of all odd-length palindromes; wrapping its "length -1 string" in `c` gives the single character `c`) and the **empty root** with `len = 0` (representing `ε`, the parent of all even-length palindromes; wrapping `ε` in `c` gives `cc`).

### J4. Why is the imaginary root's length `-1`?
So the rule `len(cPc) = len(P) + 2` works uniformly. A length-1 palindrome `c` is `c` wrapped around an inner "string" of length `1 - 2 = -1`. The imaginary root makes odd and even palindromes share one growth rule.

### J5. What is a suffix link?
A pointer from a palindrome `P` to its **longest proper palindromic suffix** (a shorter palindrome that ends `P`). For `aba` it points to `a`; for `a` it points to the empty root.

### J6. What is the `last` pointer?
The node of the **longest palindromic suffix of the prefix processed so far**. After reading `abab`, `last` points to `bab`. It is the entry point for appending the next character.

### J7. How do you count distinct palindromes?
`numberOfNodes - 2` (subtract the two roots). Each non-root node is exactly one distinct palindrome.

### J8. What does appending a character do?
Walk suffix links from `last` to find the longest palindromic suffix `X` such that `cXc` ends at the new position. If the edge `X --c-->` exists, the palindrome was already seen (no new node); otherwise create one new node for `cXc` and set its suffix link.

### J9. Why is the build `O(n)`?
The suffix-link walk is **amortized** `O(1)` per character: `len[last]` rises by at most 2 per character and each walk step decreases it, so the total walk work is `O(n)` (the same potential argument as KMP).

### J10. How does the eertree differ from Manacher?
Manacher (sibling `11`) finds the maximal palindrome radius at each center in `O(n)` — great for the longest palindrome or a total count — but it does **not store the distinct set**. The eertree gives an explicit, annotatable node per distinct palindrome and is online.

### J11. What suffix link do single characters get?
The **empty** root (length 0), not the imaginary root. This is the most common beginner bug.

### J12 (analysis). Is the eertree online?
Yes. It processes the string left to right, one character at a time, never needing the whole string up front for the structure. Each `add` is amortized `O(1)`.

---

## Middle Questions (12 Q&A)

### M1. Walk me through the online construction.
Maintain `last` = longest palindromic suffix so far. To add `c` at position `i`: `getLink(last, i)` walks suffix links to find the longest `X` with `s[i - len[X] - 1] == c` (so `cXc` is a palindrome ending at `i`). If `next[X][c]` exists, reuse it; else create a node with `len = len[X] + 2`, set its suffix link (length-1 → empty root, else `next[getLink(link[X], i)][c]`), and update `last`.

### M2. Prove appending a character adds at most one new palindrome.
Any new palindrome must end at the last position, so it is a palindromic suffix. If two new palindromic suffixes `u ⊃ w` existed, `w` (being a suffix of the palindrome `u`) is also a prefix of `u`, so `w` occurs earlier inside the old string — contradicting that `w` is new. Hence at most one new palindrome, the longest palindromic suffix.

### M3. How do you count total palindromic occurrences?
Give each node `occ`, incremented each time it becomes `last`. Then propagate up suffix links in **reverse creation order**: `occ[link[v]] += occ[v]`. After this, `occ[v]` is the occurrence count of palindrome `v`, and `Σ occ` is the total number of palindromic substrings with multiplicity.

### M4. Why reverse creation order for propagation?
Nodes are created with non-decreasing length, so reverse creation order is length-descending. A node's full count is accumulated (from its longer descendants in the suffix-link tree) before it is pushed to its shorter suffix-link parent — guaranteeing correctness without an explicit sort.

### M5. How do you count palindromes ending at each position?
Maintain `endCount[v] = endCount[link[v]] + 1` at node creation (the depth in the suffix-link tree). After appending `s[i]`, the number of palindromes ending at `i` is `endCount[last]`, read in `O(1)`.

### M6. What is the longest palindromic suffix per prefix, and why care?
`len[last]` after processing `s[i]` is the length of the longest palindromic suffix of `s[0..i]`. It feeds palindromic-factorization / partitioning problems that decompose a string into palindromic pieces.

### M7. What are series links (quick links)?
The palindromic suffixes of any prefix form `O(log n)` arithmetic series of lengths. `diff[v] = len[v] - len[link[v]]`; `slink[v]` jumps to the top of the current series (`slink[v] = diff[v]==diff[link[v]] ? slink[link[v]] : link[v]`). Walking `slink` visits `O(log n)` nodes per position instead of the full chain.

### M8. What do series links unlock?
Palindromic-factorization DPs in `O(n log n)` (minimum number of palindromes a string splits into; counting palindromic partitions) — anything that aggregates over all palindromic suffixes of every prefix.

### M9. Array children vs map children?
Array `int[|Σ|]` per node is `O(1)` and cache-friendly but `O(n·|Σ|)` memory. Map children are `O(n)` memory at a constant-factor time cost. Use arrays for small fixed alphabets (DNA, lowercase), maps for large/Unicode alphabets.

### M10. How do you test palindromic richness?
`s` is rich (maximum `n` distinct palindromes) iff every character adds a new palindrome — i.e. `add()` returns `true` at every position. The eertree decides richness in `O(n)` with one boolean per character.

### M11. Why does the suffix-link walk always terminate?
The imaginary root has `len = -1`, so `i - len - 1 = i` and `s[i] == s[i]` is trivially true: the imaginary root catches every character as a length-1 palindrome. It is the universal terminator of every suffix-link chain.

### M12 (analysis). Distinct vs total — give an example.
For `ababa`: distinct palindromes are `a, b, aba, bab, ababa` → **5 distinct**. Total occurrences: `a`×3, `b`×2, `aba`×2, `bab`×1, `ababa`×1 → **9 total**. The eertree gives both: `nodes - 2 = 5` and `Σ occ = 9`.

---

## Senior Questions (10 Q&A)

### S1. How would you build a generalized eertree over many strings?
Process each string but **reset `last` to the empty root** between strings (no palindrome spans two strings), keeping nodes/links/children shared so common palindromes share a node. Use a per-string offset in the `getLink` bounds check. Annotate nodes with per-string bitsets/counts to know which documents each palindrome appears in.

### S2. How do you support append + undo (rollback)?
`add` mutates a bounded set: one new node (always the last), one child edge, `last` (and `occ`/`endCount`). Record an undo log per `add`; to roll back, restore `last`, truncate the parallel arrays by one (removing the created node), and clear the child edge — `O(1)` amortized. This powers the "eertree on a trie" DFS.

### S3. Explain the amortized `O(n)` build rigorously.
Potential `Φ = len[last]`. It rises by at most 2 per character (`len[last] = len[cur] + 2`) and each suffix-link walk step decreases it by ≥ 1. Summing, total walk steps `≤ 2n`. So the build is `O(n)` total, `O(1)` amortized per character — identical to the KMP / suffix-automaton amortization.

### S4. When is Manacher the better choice?
For the **longest** palindromic substring or a quick **total** count, Manacher is simpler (one pass, tiny constant, no tree). The eertree wins when you need the **distinct set**, per-palindrome annotations (counts, positions), online updates, richness, or factorization.

### S5. How do you avoid the `O(n·|Σ|)` memory trap?
Map children (drop to `O(n)`), alphabet compression (only characters that appear), or open-addressed inline hash tables per node (near-array speed, near-map memory). Store the tree as parallel arrays, not node objects, to cut per-node overhead.

### S6. How do you verify correctness when `n` is large?
Brute-force oracle for small `n`: a set of palindromic substrings (distinct) and a count with multiplicity (total), diffed against the eertree. Property tests: `nodes ≤ n + 2`, total walk steps `≤ 2n`, `Σ occ == Σ endCount`, `len[link[v]] < len[v]`, length-1 nodes link to the empty root.

### S7. What is the occurrence-count propagation's analogue elsewhere?
It is the palindromic version of the **suffix automaton's `endpos`-size propagation**: in both, occurrence counts are pushed up suffix links in length-descending order. The eertree's suffix-link tree plays the role the suffix automaton's suffix links play.

### S8. How do you compute minimum palindromic factorization efficiently?
Naive DP over all palindromic suffixes is `O(n²)`. With **series links**, maintain one aggregate per series and update all `O(log n)` series in `O(1)` per position, giving `O(n log n)` — the Kosolobov–Rubinchik–Shur result.

### S9. What breaks if you forget to reset `last` in a generalized eertree?
The suffix-link walk finds a palindrome ending in the *previous* string and fabricates a cross-string palindrome that does not actually exist, corrupting the distinct set. Always reset `last = emptyRoot` and re-base the index per string.

### S10 (analysis). Why are total occurrences potentially `O(n²)`?
A string like `a^n` has palindrome `a` occurring `n` times, `aa` occurring `n-1` times, etc., so the total occurrence count is `n + (n-1) + … + 1 = Θ(n²)`. Use 64-bit accumulators; the *structure* is still `O(n)` nodes, only the *count* is quadratic.

---

## Professional Questions (8 Q&A)

### P1. Design a service that reports distinct/total palindrome counts over streamed text.
The eertree is online: append each character as it arrives, surfacing `add()`'s boolean (distinct count delta) and `endCount[last]` (palindromes ending here) per character. Distinct = `nodes - 2` live. For total occurrences, run the reverse-order propagation when a query lands (or maintain it incrementally). Bound memory by capping max palindrome length for unbounded streams; use map children for large alphabets.

### P2. How do you build the generalized eertree of a dictionary of related strings cheaply?
Arrange the strings as a **trie** and DFS: on descending an edge labeled `c`, `add(c)`; on ascending, **roll back**. This shares the eertree work across common prefixes, building the generalized eertree in `O(trieSize · |Σ|)` instead of `O(Σ stringLengths)` — a big win for dictionaries with shared prefixes.

### P3. Your eertree OOMs on a 100 MB string. What do you do?
The culprit is array children at `O(n·|Σ|)`. Switch to map (or compressed/open-addressed) children for `O(n)` memory; compress the alphabet to characters that actually appear; store parallel primitive arrays rather than objects. Verify node count stays `≤ n + 2` (a violation means a `getLink` bug creating duplicates).

### P4. How do you debug "the distinct count is wrong"?
Run the brute-force oracle on the same small input and diff. Check the usual suspects: length-1 nodes linking to the imaginary root instead of the empty root; subtracting one root instead of two; a missing bounds guard in `getLink` creating wrong nodes; not resetting `last` in the generalized case. Assert `len[link[v]] < len[v]` for all real nodes.

### P5. When is the eertree the wrong tool?
When you only need the **longest** palindrome or a **total** count (Manacher is simpler), or a single "is this string a palindrome?" check (two pointers). Also when the alphabet is so large and the string so short that the constant overhead dominates a direct hashing approach.

### P6. How do you count palindromic factorizations modulo a prime efficiently?
Use the eertree's **series links**: a DP `g(i)` = number of palindromic factorizations of the prefix, aggregated over series with per-series running sums updated in `O(1)`, total `O(n log n)`. Reduce mod the prime at every accumulation.

### P7. How does occurrence propagation relate to the suffix-link tree structure?
A palindrome `w` occurs ending at position `i` iff `w` is a palindromic suffix of `s[0..i]`, iff `w` is on the suffix-link chain from `last_i`. So `occ(w)` = sum of "times a descendant became `last`" over `w`'s subtree in the suffix-link tree — exactly what length-descending propagation computes.

### P8 (analysis). Why can't Manacher report the distinct palindrome count directly?
Manacher stores, per center, the maximal radius — a *count* of palindromes around centers, not the *set*. Two different centers can produce the same palindrome string, and Manacher has no mechanism to deduplicate them. Reporting `|PAL(s)|` from Manacher needs extra `Θ(n)` machinery (hashing palindromes around centers) and is not online; the eertree dedups for free by reusing nodes.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` set-based approach with a linear structure.
Look for a concrete story: a palindrome-enumeration or repeat-detection task where the `O(n²)` "collect all substrings into a set" approach blew up on large inputs, the insight that distinct palindromes are bounded by `n` (eertree), and the measured speedup. Strong answers mention validating the new structure against the old slow one on small inputs.

### B2. A teammate used Manacher and then tried to dedup palindromes by hashing every radius, and it is slow and buggy. How do you respond?
Explain calmly that the eertree is the purpose-built tool for the **distinct set** — it dedups for free by reusing nodes and is online. Offer to swap in the eertree, keeping Manacher only where the *longest* palindrome or a *total* count is needed. Frame it as choosing the right tool, not criticizing.

### B3. Design a feature that flags repeated palindromic patterns across many documents.
A **generalized eertree** over the corpus: shared palindromes share a node; per-node bitsets record which documents contain each palindrome. Discuss resetting `last` per document, memory for the bitsets (use hashing/sampling for thousands of docs), and surfacing palindromes appearing in many documents.

### B4. How would you explain the eertree to a junior engineer?
Start with the library-catalog analogy: one card per distinct title regardless of copies — the eertree keeps one node per distinct palindrome regardless of occurrences. Then the magic fact: each new letter crowns at most one new symmetric phrase ending there, so everything fits in `n + 2` nodes. Lead with the two gotchas: length-1 links to the *empty* root, and subtract *two* roots for the distinct count.

### B5. Your palindrome-analytics job is using too much memory at scale. How do you investigate?
Each node with array children costs `|Σ|` ints; check whether `|Σ|` ballooned (Unicode) — switch to map/compressed children. Confirm node count is `≤ n + 2` (else a duplicate-node bug). Verify you store parallel primitive arrays, not per-node objects. Profile allocations; the fix is usually map children plus alphabet compression.

---

## Coding Challenges

### Challenge 1: Count Distinct Palindromic Substrings

**Problem.** Given a string `s`, return the number of **distinct** palindromic substrings of `s`.

**Example.**
```text
s = "ababa"  ->  5   (a, b, aba, bab, ababa)
s = "aaaa"   ->  4   (a, aa, aaa, aaaa)
```

**Constraints.** `1 ≤ |s| ≤ 10^6`, lowercase letters.

**Brute force.** Collect all `O(n²)` substrings into a set, `O(n³)` or `O(n²)` with hashing — infeasible for large `n`.

**Optimal.** Build the eertree; answer is `numberOfNodes - 2`, `O(n)`.

**Go.**
```go
package main

import "fmt"

const SIGMA = 26

type Eertree struct {
	s    []byte
	len  []int
	link []int
	next []map[byte]int
	last int
}

func New() *Eertree {
	return &Eertree{len: []int{-1, 0}, link: []int{0, 0}, next: []map[byte]int{{}, {}}, last: 1}
}

func (e *Eertree) getLink(x, i int) int {
	for i-e.len[x]-1 < 0 || e.s[i-e.len[x]-1] != e.s[i] {
		x = e.link[x]
	}
	return x
}

func (e *Eertree) Add(c byte) {
	i := len(e.s)
	e.s = append(e.s, c)
	cur := e.getLink(e.last, i)
	if v, ok := e.next[cur][c]; ok {
		e.last = v
		return
	}
	now := len(e.len)
	e.len = append(e.len, e.len[cur]+2)
	e.next = append(e.next, map[byte]int{})
	if e.len[now] == 1 {
		e.link = append(e.link, 1)
	} else {
		e.link = append(e.link, e.next[e.getLink(e.link[cur], i)][c])
	}
	e.next[cur][c] = now
	e.last = now
}

func countDistinct(s string) int {
	e := New()
	for i := 0; i < len(s); i++ {
		e.Add(s[i] - 'a')
	}
	return len(e.len) - 2
}

func main() {
	fmt.Println(countDistinct("ababa")) // 5
	fmt.Println(countDistinct("aaaa"))  // 4
}
```

**Java.**
```java
import java.util.*;

public class CountDistinct {
    static int countDistinct(String s) {
        char[] str = s.toCharArray();
        List<Integer> len = new ArrayList<>(List.of(-1, 0));
        List<Integer> link = new ArrayList<>(List.of(0, 0));
        List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
        int last = 1;
        for (int i = 0; i < str.length; i++) {
            char c = str[i];
            int cur = last;
            while (i - len.get(cur) - 1 < 0 || str[i - len.get(cur) - 1] != c) cur = link.get(cur);
            if (next.get(cur).containsKey(c)) { last = next.get(cur).get(c); continue; }
            int now = len.size();
            len.add(len.get(cur) + 2);
            next.add(new HashMap<>());
            int lnk;
            if (len.get(now) == 1) lnk = 1;
            else {
                int x = link.get(cur);
                while (i - len.get(x) - 1 < 0 || str[i - len.get(x) - 1] != c) x = link.get(x);
                lnk = next.get(x).get(c);
            }
            link.add(lnk);
            next.get(cur).put(c, now);
            last = now;
        }
        return len.size() - 2;
    }

    public static void main(String[] args) {
        System.out.println(countDistinct("ababa")); // 5
        System.out.println(countDistinct("aaaa"));  // 4
    }
}
```

**Python.**
```python
def count_distinct(s):
    length, link, to, last, buf = [-1, 0], [0, 0], [dict(), dict()], 1, []

    def get_link(x, i):
        while i - length[x] - 1 < 0 or buf[i - length[x] - 1] != buf[i]:
            x = link[x]
        return x

    for ch in s:
        i = len(buf)
        buf.append(ch)
        cur = get_link(last, i)
        if ch in to[cur]:
            last = to[cur][ch]
            continue
        now = len(length)
        length.append(length[cur] + 2)
        to.append(dict())
        link.append(1 if length[now] == 1 else to[get_link(link[cur], i)][ch])
        to[cur][ch] = now
        last = now
    return len(length) - 2


if __name__ == "__main__":
    print(count_distinct("ababa"))  # 5
    print(count_distinct("aaaa"))   # 4
```

---

### Challenge 2: Total Number of Palindromic Substrings

**Problem.** Given `s`, return the **total** number of palindromic substrings (each occurrence counted), modulo `10^9 + 7` if large.

**Example.**
```text
s = "aaa"    ->  6   (a×3, aa×2, aaa×1)
s = "ababa"  ->  9
```

**Constraints.** `1 ≤ |s| ≤ 10^6`. Total can be `Θ(n²)` → use 64-bit.

**Optimal.** Build the eertree, propagate `occ` up suffix links, sum. Equivalently, sum `endCount[last]` per position.

**Go.**
```go
package main

import "fmt"

func totalPalindromes(s string) int64 {
	length := []int{-1, 0}
	link := []int{0, 0}
	next := []map[byte]int{{}, {}}
	occ := []int64{0, 0}
	last := 1
	buf := []byte{}
	getLink := func(x, i int) int {
		for i-length[x]-1 < 0 || buf[i-length[x]-1] != buf[i] {
			x = link[x]
		}
		return x
	}
	for k := 0; k < len(s); k++ {
		c := s[k] - 'a'
		i := len(buf)
		buf = append(buf, c)
		cur := getLink(last, i)
		if v, ok := next[cur][c]; ok {
			last = v
			occ[v]++
			continue
		}
		now := len(length)
		length = append(length, length[cur]+2)
		next = append(next, map[byte]int{})
		occ = append(occ, 1)
		if length[now] == 1 {
			link = append(link, 1)
		} else {
			link = append(link, next[getLink(link[cur], i)][c])
		}
		next[cur][c] = now
		last = now
	}
	for v := len(length) - 1; v >= 2; v-- {
		occ[link[v]] += occ[v]
	}
	var total int64
	for v := 2; v < len(length); v++ {
		total += occ[v]
	}
	return total
}

func main() {
	fmt.Println(totalPalindromes("aaa"))   // 6
	fmt.Println(totalPalindromes("ababa")) // 9
}
```

**Java.**
```java
import java.util.*;

public class TotalPalindromes {
    static long total(String s) {
        char[] str = s.toCharArray();
        List<Integer> len = new ArrayList<>(List.of(-1, 0));
        List<Integer> link = new ArrayList<>(List.of(0, 0));
        List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
        List<Long> occ = new ArrayList<>(List.of(0L, 0L));
        int last = 1;
        for (int i = 0; i < str.length; i++) {
            char c = str[i];
            int cur = last;
            while (i - len.get(cur) - 1 < 0 || str[i - len.get(cur) - 1] != c) cur = link.get(cur);
            Integer ex = next.get(cur).get(c);
            if (ex != null) { last = ex; occ.set(ex, occ.get(ex) + 1); continue; }
            int now = len.size();
            len.add(len.get(cur) + 2);
            next.add(new HashMap<>());
            occ.add(1L);
            int lnk;
            if (len.get(now) == 1) lnk = 1;
            else {
                int x = link.get(cur);
                while (i - len.get(x) - 1 < 0 || str[i - len.get(x) - 1] != c) x = link.get(x);
                lnk = next.get(x).get(c);
            }
            link.add(lnk);
            next.get(cur).put(c, now);
            last = now;
        }
        for (int v = len.size() - 1; v >= 2; v--) occ.set(link.get(v), occ.get(link.get(v)) + occ.get(v));
        long t = 0;
        for (int v = 2; v < len.size(); v++) t += occ.get(v);
        return t;
    }

    public static void main(String[] args) {
        System.out.println(total("aaa"));   // 6
        System.out.println(total("ababa")); // 9
    }
}
```

**Python.**
```python
def total_palindromes(s):
    length, link, to, occ, last, buf = [-1, 0], [0, 0], [dict(), dict()], [0, 0], 1, []

    def get_link(x, i):
        while i - length[x] - 1 < 0 or buf[i - length[x] - 1] != buf[i]:
            x = link[x]
        return x

    for ch in s:
        i = len(buf)
        buf.append(ch)
        cur = get_link(last, i)
        if ch in to[cur]:
            last = to[cur][ch]
            occ[last] += 1
            continue
        now = len(length)
        length.append(length[cur] + 2)
        to.append(dict())
        occ.append(1)
        link.append(1 if length[now] == 1 else to[get_link(link[cur], i)][ch])
        to[cur][ch] = now
        last = now
    for v in range(len(length) - 1, 1, -1):
        occ[link[v]] += occ[v]
    return sum(occ[2:])


if __name__ == "__main__":
    print(total_palindromes("aaa"))    # 6
    print(total_palindromes("ababa"))  # 9
```

---

### Challenge 3: Number of Palindromes Ending at Each Position

**Problem.** Given `s`, output an array `e` where `e[i]` = the number of palindromic substrings of `s` that **end** at index `i`.

**Example.**
```text
s = "ababa"  ->  [1, 1, 2, 2, 3]   (sum = 9 = total palindromic substrings)
```

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Optimal.** Maintain `endCount[v] = endCount[link[v]] + 1` at creation; after appending `s[i]`, `e[i] = endCount[last]`. `O(n)`.

**Go.**
```go
package main

import "fmt"

func palEndingAt(s string) []int {
	length := []int{-1, 0}
	link := []int{0, 0}
	next := []map[byte]int{{}, {}}
	endCount := []int{0, 0}
	last := 1
	buf := []byte{}
	res := make([]int, len(s))
	getLink := func(x, i int) int {
		for i-length[x]-1 < 0 || buf[i-length[x]-1] != buf[i] {
			x = link[x]
		}
		return x
	}
	for k := 0; k < len(s); k++ {
		c := s[k] - 'a'
		i := len(buf)
		buf = append(buf, c)
		cur := getLink(last, i)
		if v, ok := next[cur][c]; ok {
			last = v
		} else {
			now := len(length)
			length = append(length, length[cur]+2)
			next = append(next, map[byte]int{})
			var lnk int
			if length[now] == 1 {
				lnk = 1
			} else {
				lnk = next[getLink(link[cur], i)][c]
			}
			link = append(link, lnk)
			endCount = append(endCount, endCount[lnk]+1)
			next[cur][c] = now
			last = now
		}
		res[k] = endCount[last]
	}
	return res
}

func main() {
	fmt.Println(palEndingAt("ababa")) // [1 1 2 2 3]
}
```

**Java.**
```java
import java.util.*;

public class PalEndingAt {
    static int[] endingAt(String s) {
        char[] str = s.toCharArray();
        List<Integer> len = new ArrayList<>(List.of(-1, 0));
        List<Integer> link = new ArrayList<>(List.of(0, 0));
        List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
        List<Integer> endCount = new ArrayList<>(List.of(0, 0));
        int last = 1;
        int[] res = new int[str.length];
        for (int i = 0; i < str.length; i++) {
            char c = str[i];
            int cur = last;
            while (i - len.get(cur) - 1 < 0 || str[i - len.get(cur) - 1] != c) cur = link.get(cur);
            Integer ex = next.get(cur).get(c);
            if (ex != null) last = ex;
            else {
                int now = len.size();
                len.add(len.get(cur) + 2);
                next.add(new HashMap<>());
                int lnk;
                if (len.get(now) == 1) lnk = 1;
                else {
                    int x = link.get(cur);
                    while (i - len.get(x) - 1 < 0 || str[i - len.get(x) - 1] != c) x = link.get(x);
                    lnk = next.get(x).get(c);
                }
                link.add(lnk);
                endCount.add(endCount.get(lnk) + 1);
                next.get(cur).put(c, now);
                last = now;
            }
            res[i] = endCount.get(last);
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(endingAt("ababa"))); // [1, 1, 2, 2, 3]
    }
}
```

**Python.**
```python
def pal_ending_at(s):
    length, link, to, end_count, last, buf = [-1, 0], [0, 0], [dict(), dict()], [0, 0], 1, []
    res = []

    def get_link(x, i):
        while i - length[x] - 1 < 0 or buf[i - length[x] - 1] != buf[i]:
            x = link[x]
        return x

    for ch in s:
        i = len(buf)
        buf.append(ch)
        cur = get_link(last, i)
        if ch in to[cur]:
            last = to[cur][ch]
        else:
            now = len(length)
            length.append(length[cur] + 2)
            to.append(dict())
            lnk = 1 if length[now] == 1 else to[get_link(link[cur], i)][ch]
            link.append(lnk)
            end_count.append(end_count[lnk] + 1)
            to[cur][ch] = now
            last = now
        res.append(end_count[last])
    return res


if __name__ == "__main__":
    print(pal_ending_at("ababa"))  # [1, 1, 2, 2, 3]
```

---

### Challenge 4: Longest Palindromic Suffix of Each Prefix

**Problem.** Given `s`, output an array `L` where `L[i]` = the length of the **longest palindromic suffix** of the prefix `s[0..i]`.

**Example.**
```text
s = "ababa"  ->  [1, 1, 3, 3, 5]   (a; b; aba; bab; ababa)
```

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Optimal.** After appending `s[i]`, `L[i] = len[last]`. `O(n)`.

**Python.**
```python
def longest_pal_suffix(s):
    length, link, to, last, buf = [-1, 0], [0, 0], [dict(), dict()], 1, []
    res = []

    def get_link(x, i):
        while i - length[x] - 1 < 0 or buf[i - length[x] - 1] != buf[i]:
            x = link[x]
        return x

    for ch in s:
        i = len(buf)
        buf.append(ch)
        cur = get_link(last, i)
        if ch in to[cur]:
            last = to[cur][ch]
        else:
            now = len(length)
            length.append(length[cur] + 2)
            to.append(dict())
            link.append(1 if length[now] == 1 else to[get_link(link[cur], i)][ch])
            to[cur][ch] = now
            last = now
        res.append(length[last])
    return res


if __name__ == "__main__":
    print(longest_pal_suffix("ababa"))  # [1, 1, 3, 3, 5]
```

**Go.**
```go
package main

import "fmt"

func longestPalSuffix(s string) []int {
	length := []int{-1, 0}
	link := []int{0, 0}
	next := []map[byte]int{{}, {}}
	last := 1
	buf := []byte{}
	res := make([]int, len(s))
	getLink := func(x, i int) int {
		for i-length[x]-1 < 0 || buf[i-length[x]-1] != buf[i] {
			x = link[x]
		}
		return x
	}
	for k := 0; k < len(s); k++ {
		c := s[k] - 'a'
		i := len(buf)
		buf = append(buf, c)
		cur := getLink(last, i)
		if v, ok := next[cur][c]; ok {
			last = v
		} else {
			now := len(length)
			length = append(length, length[cur]+2)
			next = append(next, map[byte]int{})
			if length[now] == 1 {
				link = append(link, 1)
			} else {
				link = append(link, next[getLink(link[cur], i)][c])
			}
			next[cur][c] = now
			last = now
		}
		res[k] = length[last]
	}
	return res
}

func main() {
	fmt.Println(longestPalSuffix("ababa")) // [1 1 3 3 5]
}
```

**Java.**
```java
import java.util.*;

public class LongestPalSuffix {
    static int[] solve(String s) {
        char[] str = s.toCharArray();
        List<Integer> len = new ArrayList<>(List.of(-1, 0));
        List<Integer> link = new ArrayList<>(List.of(0, 0));
        List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
        int last = 1;
        int[] res = new int[str.length];
        for (int i = 0; i < str.length; i++) {
            char c = str[i];
            int cur = last;
            while (i - len.get(cur) - 1 < 0 || str[i - len.get(cur) - 1] != c) cur = link.get(cur);
            Integer ex = next.get(cur).get(c);
            if (ex != null) last = ex;
            else {
                int now = len.size();
                len.add(len.get(cur) + 2);
                next.add(new HashMap<>());
                int lnk;
                if (len.get(now) == 1) lnk = 1;
                else {
                    int x = link.get(cur);
                    while (i - len.get(x) - 1 < 0 || str[i - len.get(x) - 1] != c) x = link.get(x);
                    lnk = next.get(x).get(c);
                }
                link.add(lnk);
                next.get(cur).put(c, now);
                last = now;
            }
            res[i] = len.get(last);
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(solve("ababa"))); // [1, 1, 3, 3, 5]
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"The eertree stores all distinct palindromic substrings in `≤ n + 2` nodes, built online in `O(n)`, because each character adds at most one new palindrome."*
- Immediately flag the structure: **two roots** (imaginary `-1`, empty `0`), **suffix links** (longest proper palindromic suffix), **`last`** (longest palindromic suffix so far).
- For distinct count say `nodes - 2`; for total occurrences say *propagate up suffix links in reverse creation order*.
- Contrast with **Manacher** (sibling `11`): it counts/locates palindromes but does **not** store the distinct set — the eertree's superpower.
- Mention **series links** for `O(n log n)` palindromic factorization, and **generalized/rollback** eertrees for multi-string and undo workloads.
- Always offer to verify against a brute-force `O(n²)` set/count oracle on small inputs.
