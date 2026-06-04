# Aho-Corasick Multi-Pattern String Matching — Interview Preparation

Aho-Corasick is a favourite interview topic because it rewards a single crisp insight — *"build one trie of all patterns, add KMP-style failure links by BFS, scan the text once in `O(n + z)`"* — and then tests whether you can (a) build the failure links correctly in BFS order, (b) report **overlapping** matches via output links, (c) recognize the automaton/goto view that gives `O(1)` per character, and (d) relate it cleanly to KMP (sibling `01-kmp`) and tries (sibling `07-tries`). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Find all patterns in a text | full Aho-Corasick scan | `O(n + z)` after `O(m)` build |
| Build failure links | BFS, `fail(u)=goto(fail(parent),c)` | `O(m·σ)` |
| Report overlapping matches | output / dictionary suffix links | `O(z)` total |
| `O(1)` per character | precompute goto transition table | `O(m·σ)` build |
| Count total occurrences of each pattern | fail-tree subtree sums | `O(n + m)` |
| Single pattern only | KMP (sibling `01-kmp`) | `O(n + ℓ)` |
| Censor / replace keywords | scan + resolve overlaps into non-overlapping spans | `O(n + z)` |

Definitions to recite:
- **m** = sum of all pattern lengths; **n** = text length; **σ** = alphabet size; **z** = number of matches.
- **Failure link** `fail(u)` = longest proper suffix of `S(u)` that is a trie prefix (the multi-pattern KMP prefix function).
- **Output link** = nearest terminal node up the failure chain; reports every pattern ending here.

Core build (BFS):

```text
build():
    for c in alphabet:
        if root has child c: fail(child)=root; enqueue(child)
        else: goto(root,c)=root
    while queue:
        u = dequeue()
        output[u] += output[fail[u]]        # merge dictionary suffix outputs
        for c in alphabet:
            v = child(u,c)
            if v: fail(v)=goto(fail(u),c); enqueue(v)
            else: goto(u,c)=goto(fail(u),c)   # complete the transition
# build: O(m·σ); scan: O(n + z)
```

Key facts:
- **Build once, scan many** — the build cost amortizes across all texts.
- **Failure links need BFS order** (a fail link always points to a shallower node).
- **Output links catch overlaps** (`he` inside `she`); never skip them.
- **It counts walks of the automaton, i.e. exact substring occurrences** — overlapping by default.

---

## Junior Questions (12 Q&A)

### J1. What problem does Aho-Corasick solve?
Finding all occurrences of **many** patterns in a text in one pass. Build cost is `O(m)` (total pattern length); search is `O(n + z)` where `z` is the number of matches — independent of how many patterns there are.

### J2. What is the trie used for?
All patterns are inserted into one trie (prefix tree), so common prefixes are shared. Each trie node is a *state* of the automaton; nodes where a pattern ends are *terminal*.

### J3. What is a failure link?
From node `u` spelling string `S(u)`, the failure link points to the node spelling the **longest proper suffix of `S(u)` that is also a prefix in the trie**. It tells the automaton where to continue when the current character does not extend the path.

### J4. How are failure links related to KMP?
They are KMP's prefix function generalized from a single string to a whole trie. For one pattern, the trie is a straight line and the failure links *are* the KMP failure array. See sibling `01-kmp`.

### J5. Why are failure links built with BFS?
Because a failure link always points to a node closer to the root (a shorter string). BFS processes nodes by increasing depth, so when we compute `fail(u)`, the shallower node it points to is already finalized.

### J6. What is an output link (dictionary suffix link)?
It points to the nearest node up the failure chain that is the end of a pattern. It lets you report **every** pattern ending at the current position — including shorter patterns that are suffixes of a longer one.

### J7. Why do we need output links separate from failure links?
Failure links keep the scan state correct; output links report matches. A single position can end several patterns (`she`, `he` both end together). Output links enumerate them in time proportional to the matches.

### J8. What is the goto function?
`goto(u, c)` is the state to move to from `u` on character `c`. After completing the table, even missing edges redirect through the failure link, so each character costs `O(1)`.

### J9. What is the time complexity of the scan?
`O(n + z)`: `O(n)` to read the text (one transition per character) plus `O(z)` to emit all matches. This is optimal — you must read the text and emit each match.

### J10. Does Aho-Corasick find overlapping matches?
Yes. It reports `he` inside `she` and both occurrences of `aa` in `aaa`. Overlaps are handled naturally via output links.

### J11. How does the root behave?
The root's failure link is the root itself, and the root's missing transitions loop back to the root. Getting this wrong is the most common build bug.

### J12 (analysis). Why is searching independent of the number of patterns?
Because all patterns live in one automaton, and the scan advances one state per text character regardless of how many patterns exist. Only the *total* pattern length `m` (build cost) and the number of matches `z` depend on the dictionary.

---

## Middle Questions (12 Q&A)

### M1. State and justify the failure-link recurrence.
For node `u` reached from parent `p` via `c`: `fail(u) = goto(fail(p), c)`. The longest suffix-prefix of `S(p)c` is obtained by taking the longest suffix-prefix of `S(p)` (`fail(p)`) and extending by `c`, where `goto` already follows fail links until `c` is possible.

### M2. When is running KMP per pattern acceptable?
When there is one pattern (then it *is* KMP), or when the pattern set changes every query so Aho-Corasick's `O(m)` build cannot be amortized. KMP-per-pattern is `O(P·n + m)`; the `P` factor kills it for many patterns.

### M3. How do you make each character `O(1)`?
Precompute the full goto table: for every state and character, store the transition (real edge or `goto(fail(u), c)`). The scan then does one array lookup per character with no failure walking.

### M4. How do you count occurrences of every pattern in `O(n + m)`?
Scan once, incrementing a counter on each landed state. Then push counts up the failure tree in reverse BFS order (`cnt[fail[u]] += cnt[u]`). Each terminal node's accumulated count is its occurrence total — no per-match enumeration.

### M5. What is the memory cost of the goto table?
`O(m·σ)` for dense array children. For large alphabets (bytes, Unicode) this explodes; use map-based children or alphabet reduction (map used bytes to a small dense range).

### M6. How do output links report all patterns at a position?
At state `u`, every pattern ending here is a suffix of `S(u)`, and those lie on the failure chain. Walking `u → out(u) → …` (or merging `output[fail[u]]` at build time) reports them all, once each.

### M7. Why must failure links be computed before they are used for deeper nodes?
`fail(u)` depends on `fail(parent)` and the parent's completed transitions, which are at shallower depth. BFS guarantees all shallower nodes are finalized first.

### M8. How would you handle a byte alphabet efficiently?
Alphabet reduction: scan the patterns to find which byte values appear, map them to `[0, σ')`, and build transition rows of width `σ'` instead of 256. One extra lookup per char translates the byte; memory drops 5–10×.

### M9. Lazy vs eager transitions — trade-off?
Lazy (NFA): store only real edges, follow `fail` at scan time. Memory `O(m)`, scan amortized `O(n)` with worse constant. Eager (DFA): precompute every transition. Memory `O(m·σ)`, scan `O(n)` with the best constant. Choose by memory vs throughput.

### M10. How do you do case-insensitive matching?
Normalize patterns and text through the same function (lowercase, Unicode NFC) before indexing. Never branch on case in the hot loop.

### M11. How do overlapping vs non-overlapping requirements differ?
Aho-Corasick reports all overlapping matches. For non-overlapping needs (e.g. censoring), do a second pass that resolves the reported matches into disjoint spans (e.g. earliest-start / longest-match).

### M12 (analysis). Prove the scan is linear.
Use a potential `Φ = depth(state)`. Each character advances depth by at most 1 (`n` total increase) or fails, decreasing depth by ≥ 1. Since `Φ ≥ 0`, total failure steps ≤ total increase ≤ `n`. So transitions are `O(n)`, plus `O(z)` to emit — `O(n + z)`.

---

## Senior Questions (10 Q&A)

### S1. How do you scan a multi-gigabyte stream?
Aho-Corasick is online: the entire state is one integer. Thread that state across chunks, so a pattern straddling a chunk boundary is handled with no buffering. Report matches at absolute offsets via a running counter.

### S2. The dictionary changes daily. How do you update the automaton?
The classic automaton is static, so batch changes and rebuild periodically, publishing the new automaton via an atomic pointer swap. Serialize the compact automaton and `mmap` it for fast startup and cross-process sharing.

### S3. How do you fit a million byte-signatures in memory?
Avoid dense `[256]int` per node. Use alphabet reduction, map-based children for sparse deep nodes, or a double-array trie that packs transitions into two integer arrays with `O(1)` lookup near `O(nodes)` memory.

### S4. How does Aho-Corasick relate to tries and to KMP?
It is a trie (sibling `07-tries`) augmented with failure and output links to become a DFA. On a single pattern, the trie degenerates to a path and the failure links are exactly KMP's prefix function (sibling `01-kmp`).

### S5. How do you make the matcher thread-safe?
The automaton is read-only after build, so it is freely shareable. Keep the only mutable per-scan state (the current node) local to each thread; never put `cur` on a shared object. For counting, give each worker a private counter and merge.

### S6. When would you count instead of report?
When matches vastly outnumber distinct patterns (huge `z`), or you only need totals. Fail-tree aggregation is `O(n + m)`, independent of `z`, versus `O(n + z)` for reporting positions.

### S7. How do you defend against algorithmic-complexity attacks?
Adversarial input can end many patterns at every position, exploding `z` and the emit path. Cap per-input match emission, switch to counting, or rate-limit. Treat `z` as attacker-controlled and monitor match rate.

### S8. Why does completing the goto table not blow up the state count?
Generic NFA→DFA can be exponential, but Aho-Corasick's failure links form paths (suffix links), not branching sets. Determinizing the goto+fail NFA keeps the DFA at `≤ m+1` states.

### S9. How do you verify correctness when you cannot eyeball the automaton?
Diff against a naive multi-search oracle (`str.find` per pattern) on small random inputs; cross-check reported-position counts against the fail-tree count totals; for `P = 1`, check against KMP; fuzz with random alphabets to catch normalization bugs.

### S10 (analysis). Why is `O(n + z)` optimal for reporting?
You must read every text character (an unread char could hide a match) — `Ω(n)` — and emit each of `z` matches — `Ω(z)`. The sum is a lower bound, which Aho-Corasick achieves.

---

## Professional Questions (8 Q&A)

### P1. Design an intrusion-detection pre-filter over thousands of byte signatures.
Build a byte-alphabet automaton with alphabet reduction, in DFA (eager) form for line-rate throughput, serialized and `mmap`-ed read-only and shared across worker threads/processes. Aho-Corasick identifies candidate signatures; a slower per-rule engine confirms. Cap per-packet emission to resist complexity attacks; version the automaton against the signature-database release.

### P2. How do you censor/replace keywords with overlaps present?
Scan to get all `(pattern, start, end)` matches, then resolve overlaps into disjoint spans (policy: longest match, or earliest start, or merge overlapping spans into one). Replace each resolved span in a single left-to-right rebuild of the output. This is the "censor" coding challenge below.

### P3. Your automaton uses 30 GB for a byte dictionary. What do you do?
Dense `[256]int` per node is the culprit. Apply alphabet reduction first (often 5–10× cut), switch deep sparse nodes to maps, or move to a double-array trie / default-transition (failure) compression. Serialize the compact form and mmap so multiple processes share one copy.

### P4. How do you debug "a known keyword was missed"?
Run the naive oracle on the same input and diff. Check the three usual suspects: forgot to merge `output[fail[u]]` (overlap miss), root handling (fail/missing-edge), and normalization mismatch (patterns lowercased but text not). Assert positions (end = current index; start = end − len + 1).

### P5. When is Aho-Corasick the wrong tool?
For a single pattern (use KMP). For approximate/fuzzy or regex matching (Aho-Corasick is exact substring only; combine with other engines). For a pattern set that changes every query with no reuse (rebuild dominates). For one fixed text queried by many changing pattern sets, a suffix automaton/array of the text may be better.

### P6. How do you parallelize matching a huge corpus?
The automaton is read-only; shard the corpus across workers, each carrying its own state. For a single huge stream, partition into chunks with overlap of `maxlen − 1` so boundary-straddling matches are caught, or thread the state sequentially. Merge per-worker results/counts at the end.

### P7. How do bioinformatics motif searches use it?
DNA (`σ=4`) or protein (`σ=20`) gives a tiny alphabet, so the dense array automaton is both fast and memory-cheap — the byte-alphabet memory trap does not apply. Aho-Corasick locates many short motifs in a long sequence in one pass, a standard read-mapping/motif-scan primitive.

### P8 (analysis). Why does counting avoid the `Ω(z)` bound?
Counting never materializes individual occurrences; it computes, per pattern, a subtree sum of landing frequencies over the failure tree. That is `O(n + m)` regardless of how large `z` is — the failure tree is the suffix-link tree, and occurrences of `S(w)` are the positions whose state lies in `w`'s fail-subtree.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(P·n)` per-pattern search with a single pass.
Look for a concrete story: a filtering or scanning task with many keywords, a profile showing repeated text scans dominating, the insight to merge all patterns into one automaton, and a measured speedup. Strong answers mention the correctness check against the old per-pattern path and how overlaps were handled.

### B2. A teammate's profanity filter misses `he` inside `she`. How do you help?
Explain the output-link / dictionary-suffix-link concept: shorter patterns that are suffixes of a longer match must be reported via the failure chain (or by merging `output[fail[u]]` at build). Show the `ushers` trace as a tiny counterexample. Frame it as a teaching moment about the two distinct link types.

### B3. Design a real-time chat keyword flagging feature.
Aho-Corasick over the banned-phrase dictionary, built once and shared read-only. Discuss normalization/evasion (users insert spaces/zero-width chars), overlap policy, streaming per-message state reset, and capping emission for abusive inputs. Mention atomic rebuild when the banned list updates.

### B4. How would you explain failure links to a junior engineer?
Use the "fall back to the last useful landmark" analogy: when the next character breaks your current match, you do not start over — you jump to the longest tail you have already matched that could still lead somewhere. Note it is exactly KMP's idea, but over a trie of many words instead of one.

### B5. Your matcher's memory ballooned in production. How do you investigate?
Check the children representation: dense `[256]int` per node on a byte alphabet is the usual cause. Verify alphabet reduction is applied, that deep sparse nodes use maps, and that the automaton is shared (mmap), not duplicated per request. Profile allocations; confirm you build once, not per query.

---

## Coding Challenges

### Challenge 1: Multi-Pattern Search (report all occurrences)

**Problem.** Given a list of patterns and a text, return all `(pattern_index, start_index)` occurrences, including overlapping ones, sorted.

**Example.**
```text
patterns = ["he","she","his","hers"], text = "ushers"
-> (1,1) "she" at 1, (0,2) "he" at 2, (3,2) "hers" at 2
   (start indices: she@1, he@2, hers@2)
```

**Optimal.** Aho-Corasick, `O(m + n + z)`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

const SIGMA = 26

type Aho struct {
	next   [][SIGMA]int
	fail   []int
	out    [][]int
	plen   []int // pattern length by id
}

func (a *Aho) node() int {
	var row [SIGMA]int
	for i := range row {
		row[i] = -1
	}
	a.next = append(a.next, row)
	a.fail = append(a.fail, 0)
	a.out = append(a.out, nil)
	return len(a.next) - 1
}

func (a *Aho) add(p string, id int) {
	cur := 0
	for i := 0; i < len(p); i++ {
		c := int(p[i] - 'a')
		if a.next[cur][c] == -1 {
			a.next[cur][c] = a.node()
		}
		cur = a.next[cur][c]
	}
	a.out[cur] = append(a.out[cur], id)
}

func (a *Aho) build() {
	q := []int{}
	for c := 0; c < SIGMA; c++ {
		if a.next[0][c] == -1 {
			a.next[0][c] = 0
		} else {
			q = append(q, a.next[0][c])
		}
	}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		a.out[u] = append(a.out[u], a.out[a.fail[u]]...)
		for c := 0; c < SIGMA; c++ {
			v := a.next[u][c]
			if v == -1 {
				a.next[u][c] = a.next[a.fail[u]][c]
			} else {
				a.fail[v] = a.next[a.fail[u]][c]
				q = append(q, v)
			}
		}
	}
}

func (a *Aho) search(text string) [][2]int {
	res := [][2]int{}
	cur := 0
	for i := 0; i < len(text); i++ {
		cur = a.next[cur][int(text[i]-'a')]
		for _, id := range a.out[cur] {
			start := i - a.plen[id] + 1
			res = append(res, [2]int{id, start})
		}
	}
	sort.Slice(res, func(x, y int) bool {
		if res[x][1] != res[y][1] {
			return res[x][1] < res[y][1]
		}
		return res[x][0] < res[y][0]
	})
	return res
}

func main() {
	a := &Aho{}
	a.node()
	pats := []string{"he", "she", "his", "hers"}
	for id, p := range pats {
		a.plen = append(a.plen, len(p))
		a.add(p, id)
	}
	a.build()
	fmt.Println(a.search("ushers"))
}
```

**Java.**
```java
import java.util.*;

public class MultiSearch {
    static final int SIGMA = 26;
    int[][] next = new int[1][SIGMA];
    int[] fail = new int[1];
    List<List<Integer>> out = new ArrayList<>();
    List<Integer> plen = new ArrayList<>();
    int size = 1;

    MultiSearch() { Arrays.fill(next[0], -1); out.add(new ArrayList<>()); }

    int node() {
        if (size == next.length) { next = Arrays.copyOf(next, size*2); fail = Arrays.copyOf(fail, size*2); }
        next[size] = new int[SIGMA]; Arrays.fill(next[size], -1);
        out.add(new ArrayList<>());
        return size++;
    }

    void add(String p, int id) {
        int cur = 0;
        for (char ch : p.toCharArray()) {
            int c = ch - 'a';
            if (next[cur][c] == -1) next[cur][c] = node();
            cur = next[cur][c];
        }
        out.get(cur).add(id);
    }

    void build() {
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < SIGMA; c++) {
            if (next[0][c] == -1) next[0][c] = 0; else q.add(next[0][c]);
        }
        while (!q.isEmpty()) {
            int u = q.poll();
            out.get(u).addAll(out.get(fail[u]));
            for (int c = 0; c < SIGMA; c++) {
                int v = next[u][c];
                if (v == -1) next[u][c] = next[fail[u]][c];
                else { fail[v] = next[fail[u]][c]; q.add(v); }
            }
        }
    }

    List<int[]> search(String text) {
        List<int[]> res = new ArrayList<>();
        int cur = 0;
        for (int i = 0; i < text.length(); i++) {
            cur = next[cur][text.charAt(i) - 'a'];
            for (int id : out.get(cur)) res.add(new int[]{id, i - plen.get(id) + 1});
        }
        res.sort((a,b) -> a[1] != b[1] ? a[1]-b[1] : a[0]-b[0]);
        return res;
    }

    public static void main(String[] args) {
        MultiSearch a = new MultiSearch();
        String[] pats = {"he","she","his","hers"};
        for (int id = 0; id < pats.length; id++) { a.plen.add(pats[id].length()); a.add(pats[id], id); }
        a.build();
        for (int[] r : a.search("ushers")) System.out.println(r[0] + " @ " + r[1]);
    }
}
```

**Python.**
```python
from collections import deque

SIGMA = 26


class Aho:
    def __init__(self):
        self.next = [[-1] * SIGMA]
        self.fail = [0]
        self.out = [[]]
        self.plen = []

    def _node(self):
        self.next.append([-1] * SIGMA)
        self.fail.append(0)
        self.out.append([])
        return len(self.next) - 1

    def add(self, p, pid):
        cur = 0
        for ch in p:
            c = ord(ch) - 97
            if self.next[cur][c] == -1:
                self.next[cur][c] = self._node()
            cur = self.next[cur][c]
        self.out[cur].append(pid)

    def build(self):
        q = deque()
        for c in range(SIGMA):
            if self.next[0][c] == -1:
                self.next[0][c] = 0
            else:
                q.append(self.next[0][c])
        while q:
            u = q.popleft()
            self.out[u] += self.out[self.fail[u]]
            for c in range(SIGMA):
                v = self.next[u][c]
                if v == -1:
                    self.next[u][c] = self.next[self.fail[u]][c]
                else:
                    self.fail[v] = self.next[self.fail[u]][c]
                    q.append(v)

    def search(self, text):
        res = []
        cur = 0
        for i, ch in enumerate(text):
            cur = self.next[cur][ord(ch) - 97]
            for pid in self.out[cur]:
                res.append((pid, i - self.plen[pid] + 1))
        return sorted(res, key=lambda r: (r[1], r[0]))


if __name__ == "__main__":
    a = Aho()
    for pid, p in enumerate(["he", "she", "his", "hers"]):
        a.plen.append(len(p))
        a.add(p, pid)
    a.build()
    print(a.search("ushers"))   # [(1, 1), (0, 2), (3, 2)]
```

---

### Challenge 2: Count Total Matches

**Problem.** Given patterns and a text, return the **total** number of pattern occurrences (overlaps counted) without listing them, in `O(n + m)`.

**Example.**
```text
patterns = ["a","aa"], text = "aaaa" -> 7   (a:4 + aa:3)
```

**Optimal.** Scan recording landing counts, then push counts up the failure tree.

**Go.**
```go
package main

import "fmt"

const SIGMA = 26

func countMatches(pats []string, text string) int {
	next := [][SIGMA]int{}
	fail := []int{}
	endHere := []int{} // number of patterns ending exactly at node
	cnt := []int{}
	order := []int{}
	node := func() int {
		var row [SIGMA]int
		for i := range row {
			row[i] = -1
		}
		next = append(next, row)
		fail = append(fail, 0)
		endHere = append(endHere, 0)
		cnt = append(cnt, 0)
		return len(next) - 1
	}
	node() // root
	for _, p := range pats {
		cur := 0
		for i := 0; i < len(p); i++ {
			c := int(p[i] - 'a')
			if next[cur][c] == -1 {
				next[cur][c] = node()
			}
			cur = next[cur][c]
		}
		endHere[cur]++
	}
	q := []int{}
	for c := 0; c < SIGMA; c++ {
		if next[0][c] == -1 {
			next[0][c] = 0
		} else {
			q = append(q, next[0][c])
		}
	}
	for i := 0; i < len(q); i++ {
		u := q[i]
		order = append(order, u)
		for c := 0; c < SIGMA; c++ {
			v := next[u][c]
			if v == -1 {
				next[u][c] = next[fail[u]][c]
			} else {
				fail[v] = next[fail[u]][c]
				q = append(q, v)
			}
		}
	}
	cur := 0
	for i := 0; i < len(text); i++ {
		cur = next[cur][int(text[i]-'a')]
		cnt[cur]++
	}
	total := 0
	for i := len(order) - 1; i >= 0; i-- {
		u := order[i]
		cnt[fail[u]] += cnt[u]
	}
	for u := 0; u < len(next); u++ {
		total += endHere[u] * cnt[u]
	}
	return total
}

func main() {
	fmt.Println(countMatches([]string{"a", "aa"}, "aaaa")) // 7
}
```

**Java.**
```java
import java.util.*;

public class CountMatches {
    static final int SIGMA = 26;

    static long count(String[] pats, String text) {
        List<int[]> next = new ArrayList<>();
        List<Integer> fail = new ArrayList<>();
        List<Integer> endHere = new ArrayList<>();
        List<Long> cnt = new ArrayList<>();
        Runnable ignored = null;
        java.util.function.Supplier<Integer> node = () -> {
            int[] row = new int[SIGMA]; Arrays.fill(row, -1);
            next.add(row); fail.add(0); endHere.add(0); cnt.add(0L);
            return next.size() - 1;
        };
        node.get(); // root
        for (String p : pats) {
            int cur = 0;
            for (char ch : p.toCharArray()) {
                int c = ch - 'a';
                if (next.get(cur)[c] == -1) next.get(cur)[c] = node.get();
                cur = next.get(cur)[c];
            }
            endHere.set(cur, endHere.get(cur) + 1);
        }
        List<Integer> order = new ArrayList<>();
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < SIGMA; c++) {
            if (next.get(0)[c] == -1) next.get(0)[c] = 0; else q.add(next.get(0)[c]);
        }
        while (!q.isEmpty()) {
            int u = q.poll(); order.add(u);
            for (int c = 0; c < SIGMA; c++) {
                int v = next.get(u)[c];
                if (v == -1) next.get(u)[c] = next.get(fail.get(u))[c];
                else { fail.set(v, next.get(fail.get(u))[c]); q.add(v); }
            }
        }
        int cur = 0;
        for (int i = 0; i < text.length(); i++) {
            cur = next.get(cur)[text.charAt(i) - 'a'];
            cnt.set(cur, cnt.get(cur) + 1);
        }
        for (int i = order.size() - 1; i >= 0; i--) {
            int u = order.get(i);
            cnt.set(fail.get(u), cnt.get(fail.get(u)) + cnt.get(u));
        }
        long total = 0;
        for (int u = 0; u < next.size(); u++) total += (long) endHere.get(u) * cnt.get(u);
        return total;
    }

    public static void main(String[] args) {
        System.out.println(count(new String[]{"a", "aa"}, "aaaa")); // 7
    }
}
```

**Python.**
```python
from collections import deque

SIGMA = 26


def count_matches(pats, text):
    nxt = [[-1] * SIGMA]
    fail = [0]
    end_here = [0]
    cnt = [0]

    def node():
        nxt.append([-1] * SIGMA)
        fail.append(0)
        end_here.append(0)
        cnt.append(0)
        return len(nxt) - 1

    for p in pats:
        cur = 0
        for ch in p:
            c = ord(ch) - 97
            if nxt[cur][c] == -1:
                nxt[cur][c] = node()
            cur = nxt[cur][c]
        end_here[cur] += 1

    order, q = [], deque()
    for c in range(SIGMA):
        if nxt[0][c] == -1:
            nxt[0][c] = 0
        else:
            q.append(nxt[0][c])
    while q:
        u = q.popleft()
        order.append(u)
        for c in range(SIGMA):
            v = nxt[u][c]
            if v == -1:
                nxt[u][c] = nxt[fail[u]][c]
            else:
                fail[v] = nxt[fail[u]][c]
                q.append(v)

    cur = 0
    for ch in text:
        cur = nxt[cur][ord(ch) - 97]
        cnt[cur] += 1
    for u in reversed(order):
        cnt[fail[u]] += cnt[u]
    return sum(end_here[u] * cnt[u] for u in range(len(nxt)))


if __name__ == "__main__":
    print(count_matches(["a", "aa"], "aaaa"))   # 7
```

---

### Challenge 3: Censor Keywords (replace with `*`)

**Problem.** Given banned words and a text, replace every character covered by any banned word with `*`. Overlapping matches all contribute; the union of covered ranges is masked.

**Example.**
```text
banned = ["ab","bc"], text = "xabcy" -> "x***y"   (ab covers 1-2, bc covers 2-3 → union 1-3)
```

**Approach.** Aho-Corasick to find all `(start, end)` matches, mark a boolean cover array, then rebuild masking covered positions.

**Go.**
```go
package main

import "fmt"

const SIGMA = 26

func censor(banned []string, text string) string {
	next := [][SIGMA]int{}
	fail := []int{}
	out := [][]int{}
	plen := []int{}
	node := func() int {
		var row [SIGMA]int
		for i := range row {
			row[i] = -1
		}
		next = append(next, row)
		fail = append(fail, 0)
		out = append(out, nil)
		return len(next) - 1
	}
	node()
	for id, p := range banned {
		plen = append(plen, len(p))
		cur := 0
		for i := 0; i < len(p); i++ {
			c := int(p[i] - 'a')
			if next[cur][c] == -1 {
				next[cur][c] = node()
			}
			cur = next[cur][c]
		}
		out[cur] = append(out[cur], id)
	}
	q := []int{}
	for c := 0; c < SIGMA; c++ {
		if next[0][c] == -1 {
			next[0][c] = 0
		} else {
			q = append(q, next[0][c])
		}
	}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		out[u] = append(out[u], out[fail[u]]...)
		for c := 0; c < SIGMA; c++ {
			v := next[u][c]
			if v == -1 {
				next[u][c] = next[fail[u]][c]
			} else {
				fail[v] = next[fail[u]][c]
				q = append(q, v)
			}
		}
	}
	cover := make([]bool, len(text))
	cur := 0
	for i := 0; i < len(text); i++ {
		cur = next[cur][int(text[i]-'a')]
		for _, id := range out[cur] {
			for j := i - plen[id] + 1; j <= i; j++ {
				cover[j] = true
			}
		}
	}
	b := []byte(text)
	for i := range b {
		if cover[i] {
			b[i] = '*'
		}
	}
	return string(b)
}

func main() {
	fmt.Println(censor([]string{"ab", "bc"}, "xabcy")) // x***y
}
```

**Java.**
```java
import java.util.*;

public class Censor {
    static final int SIGMA = 26;
    int[][] next = new int[1][SIGMA];
    int[] fail = new int[1];
    List<List<Integer>> out = new ArrayList<>();
    List<Integer> plen = new ArrayList<>();
    int size = 1;

    Censor() { Arrays.fill(next[0], -1); out.add(new ArrayList<>()); }

    int node() {
        if (size == next.length) { next = Arrays.copyOf(next, size*2); fail = Arrays.copyOf(fail, size*2); }
        next[size] = new int[SIGMA]; Arrays.fill(next[size], -1); out.add(new ArrayList<>());
        return size++;
    }

    void add(String p, int id) {
        plen.add(p.length());
        int cur = 0;
        for (char ch : p.toCharArray()) {
            int c = ch - 'a';
            if (next[cur][c] == -1) next[cur][c] = node();
            cur = next[cur][c];
        }
        out.get(cur).add(id);
    }

    void build() {
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < SIGMA; c++) { if (next[0][c] == -1) next[0][c] = 0; else q.add(next[0][c]); }
        while (!q.isEmpty()) {
            int u = q.poll();
            out.get(u).addAll(out.get(fail[u]));
            for (int c = 0; c < SIGMA; c++) {
                int v = next[u][c];
                if (v == -1) next[u][c] = next[fail[u]][c];
                else { fail[v] = next[fail[u]][c]; q.add(v); }
            }
        }
    }

    String censor(String text) {
        boolean[] cover = new boolean[text.length()];
        int cur = 0;
        for (int i = 0; i < text.length(); i++) {
            cur = next[cur][text.charAt(i) - 'a'];
            for (int id : out.get(cur))
                for (int j = i - plen.get(id) + 1; j <= i; j++) cover[j] = true;
        }
        char[] b = text.toCharArray();
        for (int i = 0; i < b.length; i++) if (cover[i]) b[i] = '*';
        return new String(b);
    }

    public static void main(String[] args) {
        Censor c = new Censor();
        c.add("ab", 0); c.add("bc", 1); c.build();
        System.out.println(c.censor("xabcy")); // x***y
    }
}
```

**Python.**
```python
from collections import deque

SIGMA = 26


def censor(banned, text):
    nxt = [[-1] * SIGMA]
    fail = [0]
    out = [[]]
    plen = []

    def node():
        nxt.append([-1] * SIGMA)
        fail.append(0)
        out.append([])
        return len(nxt) - 1

    for pid, p in enumerate(banned):
        plen.append(len(p))
        cur = 0
        for ch in p:
            c = ord(ch) - 97
            if nxt[cur][c] == -1:
                nxt[cur][c] = node()
            cur = nxt[cur][c]
        out[cur].append(pid)

    q = deque()
    for c in range(SIGMA):
        if nxt[0][c] == -1:
            nxt[0][c] = 0
        else:
            q.append(nxt[0][c])
    while q:
        u = q.popleft()
        out[u] += out[fail[u]]
        for c in range(SIGMA):
            v = nxt[u][c]
            if v == -1:
                nxt[u][c] = nxt[fail[u]][c]
            else:
                fail[v] = nxt[fail[u]][c]
                q.append(v)

    cover = [False] * len(text)
    cur = 0
    for i, ch in enumerate(text):
        cur = nxt[cur][ord(ch) - 97]
        for pid in out[cur]:
            for j in range(i - plen[pid] + 1, i + 1):
                cover[j] = True
    return "".join("*" if cover[i] else ch for i, ch in enumerate(text))


if __name__ == "__main__":
    print(censor(["ab", "bc"], "xabcy"))   # x***y
```

---

### Challenge 4: Shortest Substring Containing All Patterns

**Problem.** Given a set of patterns (all over the same alphabet) and a text, find the shortest substring of the text that contains **every** pattern at least once (as a substring). Return its length, or `-1` if impossible.

**Approach.** Run Aho-Corasick to get, for each pattern, all its occurrence intervals `[start, end]` in the text. Then it is a sliding-window / two-pointer problem over occurrence end-events: as the right pointer sweeps occurrence ends, track how many distinct patterns have an occurrence whose start is `≥ left`, and shrink. A clean approach: collect all occurrences as `(end, start, patternId)`, sort by end, and slide a window over starts requiring all `P` patterns covered.

**Python.**
```python
from collections import deque, defaultdict

SIGMA = 26


def build_aho(pats):
    nxt = [[-1] * SIGMA]
    fail = [0]
    out = [[]]

    def node():
        nxt.append([-1] * SIGMA)
        fail.append(0)
        out.append([])
        return len(nxt) - 1

    for pid, p in enumerate(pats):
        cur = 0
        for ch in p:
            c = ord(ch) - 97
            if nxt[cur][c] == -1:
                nxt[cur][c] = node()
            cur = nxt[cur][c]
        out[cur].append(pid)
    q = deque()
    for c in range(SIGMA):
        if nxt[0][c] == -1:
            nxt[0][c] = 0
        else:
            q.append(nxt[0][c])
    while q:
        u = q.popleft()
        out[u] += out[fail[u]]
        for c in range(SIGMA):
            v = nxt[u][c]
            if v == -1:
                nxt[u][c] = nxt[fail[u]][c]
            else:
                fail[v] = nxt[fail[u]][c]
                q.append(v)
    return nxt, out


def shortest_window(pats, text):
    P = len(pats)
    plen = [len(p) for p in pats]
    nxt, out = build_aho(pats)
    # occurrences as (start, end) per pattern
    occ = []  # (end, start, pid)
    cur = 0
    for i, ch in enumerate(text):
        cur = nxt[cur][ord(ch) - 97]
        for pid in out[cur]:
            occ.append((i, i - plen[pid] + 1, pid))
    occ.sort()                       # by end ascending
    # sliding window over occurrences keyed by start; need all P pids covered
    best = float("inf")
    have = defaultdict(int)
    distinct = 0
    left = 0
    # window over the occ list: a window covers patterns; substring is [min start, max end]
    for right in range(len(occ)):
        endR, startR, pidR = occ[right]
        if have[pidR] == 0:
            distinct += 1
        have[pidR] += 1
        while distinct == P:
            endL, startL, pidL = occ[left]
            # substring spanning these occurrences:
            lo = min(o[1] for o in occ[left:right + 1])
            hi = endR
            best = min(best, hi - lo + 1)
            have[pidL] -= 1
            if have[pidL] == 0:
                distinct -= 1
            left += 1
    return -1 if best == float("inf") else best


if __name__ == "__main__":
    print(shortest_window(["ab", "bc"], "zzabxbcyy"))  # ab@2-3, bc@5-6 -> window 2..6 len 5
    print(shortest_window(["x", "y"], "xy"))           # 2
    print(shortest_window(["q"], "abc"))               # -1
```

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

const SIGMA = 26

func shortestWindow(pats []string, text string) int {
	P := len(pats)
	plen := make([]int, P)
	next := [][SIGMA]int{}
	fail := []int{}
	out := [][]int{}
	node := func() int {
		var row [SIGMA]int
		for i := range row {
			row[i] = -1
		}
		next = append(next, row)
		fail = append(fail, 0)
		out = append(out, nil)
		return len(next) - 1
	}
	node()
	for id, p := range pats {
		plen[id] = len(p)
		cur := 0
		for i := 0; i < len(p); i++ {
			c := int(p[i] - 'a')
			if next[cur][c] == -1 {
				next[cur][c] = node()
			}
			cur = next[cur][c]
		}
		out[cur] = append(out[cur], id)
	}
	q := []int{}
	for c := 0; c < SIGMA; c++ {
		if next[0][c] == -1 {
			next[0][c] = 0
		} else {
			q = append(q, next[0][c])
		}
	}
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		out[u] = append(out[u], out[fail[u]]...)
		for c := 0; c < SIGMA; c++ {
			v := next[u][c]
			if v == -1 {
				next[u][c] = next[fail[u]][c]
			} else {
				fail[v] = next[fail[u]][c]
				q = append(q, v)
			}
		}
	}
	type occT struct{ end, start, pid int }
	occ := []occT{}
	cur := 0
	for i := 0; i < len(text); i++ {
		cur = next[cur][int(text[i]-'a')]
		for _, id := range out[cur] {
			occ = append(occ, occT{i, i - plen[id] + 1, id})
		}
	}
	sort.Slice(occ, func(a, b int) bool { return occ[a].end < occ[b].end })
	best := 1 << 30
	have := make([]int, P)
	distinct, left := 0, 0
	for right := 0; right < len(occ); right++ {
		if have[occ[right].pid] == 0 {
			distinct++
		}
		have[occ[right].pid]++
		for distinct == P {
			lo := occ[right].start
			for k := left; k <= right; k++ {
				if occ[k].start < lo {
					lo = occ[k].start
				}
			}
			if occ[right].end-lo+1 < best {
				best = occ[right].end - lo + 1
			}
			have[occ[left].pid]--
			if have[occ[left].pid] == 0 {
				distinct--
			}
			left++
		}
	}
	if best == 1<<30 {
		return -1
	}
	return best
}

func main() {
	fmt.Println(shortestWindow([]string{"ab", "bc"}, "zzabxbcyy")) // 5
	fmt.Println(shortestWindow([]string{"q"}, "abc"))              // -1
}
```

**Java.**
```java
import java.util.*;

public class ShortestWindow {
    static final int SIGMA = 26;

    static int solve(String[] pats, String text) {
        int P = pats.length;
        int[] plen = new int[P];
        List<int[]> next = new ArrayList<>();
        List<Integer> fail = new ArrayList<>();
        List<List<Integer>> out = new ArrayList<>();
        java.util.function.Supplier<Integer> node = () -> {
            int[] row = new int[SIGMA]; Arrays.fill(row, -1);
            next.add(row); fail.add(0); out.add(new ArrayList<>());
            return next.size() - 1;
        };
        node.get();
        for (int id = 0; id < P; id++) {
            plen[id] = pats[id].length();
            int cur = 0;
            for (char ch : pats[id].toCharArray()) {
                int c = ch - 'a';
                if (next.get(cur)[c] == -1) next.get(cur)[c] = node.get();
                cur = next.get(cur)[c];
            }
            out.get(cur).add(id);
        }
        Deque<Integer> q = new ArrayDeque<>();
        for (int c = 0; c < SIGMA; c++) { if (next.get(0)[c] == -1) next.get(0)[c] = 0; else q.add(next.get(0)[c]); }
        while (!q.isEmpty()) {
            int u = q.poll();
            out.get(u).addAll(out.get(fail.get(u)));
            for (int c = 0; c < SIGMA; c++) {
                int v = next.get(u)[c];
                if (v == -1) next.get(u)[c] = next.get(fail.get(u))[c];
                else { fail.set(v, next.get(fail.get(u))[c]); q.add(v); }
            }
        }
        List<int[]> occ = new ArrayList<>(); // {end, start, pid}
        int cur = 0;
        for (int i = 0; i < text.length(); i++) {
            cur = next.get(cur)[text.charAt(i) - 'a'];
            for (int id : out.get(cur)) occ.add(new int[]{i, i - plen[id] + 1, id});
        }
        occ.sort((a, b) -> a[0] - b[0]);
        int best = Integer.MAX_VALUE, distinct = 0, left = 0;
        int[] have = new int[P];
        for (int right = 0; right < occ.size(); right++) {
            if (have[occ.get(right)[2]]++ == 0) distinct++;
            while (distinct == P) {
                int lo = occ.get(right)[1];
                for (int k = left; k <= right; k++) lo = Math.min(lo, occ.get(k)[1]);
                best = Math.min(best, occ.get(right)[0] - lo + 1);
                if (--have[occ.get(left)[2]] == 0) distinct--;
                left++;
            }
        }
        return best == Integer.MAX_VALUE ? -1 : best;
    }

    public static void main(String[] args) {
        System.out.println(solve(new String[]{"ab", "bc"}, "zzabxbcyy")); // 5
        System.out.println(solve(new String[]{"q"}, "abc"));             // -1
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"One trie of all patterns, KMP-style failure links by BFS, single `O(n + z)` scan."*
- Immediately flag the two gotchas: handle the **root** (fails to itself, missing edges loop back) and follow/merge **output links** for overlapping matches.
- For `O(1)` per character, mention precomputing the **goto** transition table; for memory, mention **alphabet reduction** and **lazy/map children**.
- For counts, reach for **fail-tree subtree sums** (`O(n + m)`) instead of enumerating matches.
- Relate it to **KMP** (the single-pattern special case, sibling `01-kmp`) and **tries** (the base structure, sibling `07-tries`) to show you see the connections.
- Always offer to verify against a brute-force naive multi-search oracle on small inputs.
