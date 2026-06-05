# Suffix Automaton (SAM) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the SAM logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle (enumerate substrings into a set, or scan for occurrences) on small inputs before trusting the SAM result.**

---

## Beginner Tasks (5)

### Task 1 — Implement `extend` and build a SAM

**Problem.** Implement the online `extend(c)` step and build the suffix automaton of a string `s` character by character. Print the number of states created.

**Input / Output spec.**
- Read `s`.
- Print the number of states (including the initial state).

**Constraints.**
- `1 ≤ |s| ≤ 10^5`, lowercase letters.
- Must use the standard clone/split logic.

**Hint.** Maintain `next`, `link`, `length` arrays and `last`. Follow the reference `extend` exactly; the two `while` loops differ.

**Starter — Go.**
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
	// TODO: create cur, walk links adding c-edges, handle root/solid/clone cases
}

func main() {
	var s string
	fmt.Scan(&s)
	sam := NewSAM()
	for i := 0; i < len(s); i++ {
		sam.Extend(s[i])
	}
	fmt.Println(len(sam.next))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static List<Map<Character, Integer>> next = new ArrayList<>();
    static List<Integer> link = new ArrayList<>();
    static List<Integer> length = new ArrayList<>();
    static int last = 0;

    static void extend(char c) {
        // TODO
    }

    public static void main(String[] args) {
        next.add(new HashMap<>()); link.add(-1); length.add(0);
        Scanner sc = new Scanner(System.in);
        String s = sc.next();
        for (char c : s.toCharArray()) extend(c);
        System.out.println(next.size());
    }
}
```

**Starter — Python.**
```python
import sys


class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.last = 0

    def extend(self, c):
        # TODO
        pass


def main():
    s = sys.stdin.readline().strip()
    sam = SAM()
    for ch in s:
        sam.extend(ch)
    print(len(sam.nxt))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- State count is in `[|s|+1, 2|s|-1]`.
- Clone/split implemented correctly (test with `"aaaa"`).
- Builds in `O(|s|)` amortized.

---

### Task 2 — Substring membership

**Problem.** After building `SA(s)`, answer `q` queries: for each pattern `p`, print `YES` if `p` is a substring of `s`, else `NO`.

**Input / Output spec.**
- Read `s`, then `q`, then `q` patterns.
- Print `YES`/`NO` per pattern.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ q ≤ 10^5`, total pattern length `≤ 10^6`.

**Hint.** Walk transitions from the initial state; survive all `|p|` steps ⇒ `YES`.

**Reference oracle (Python).**
```python
def brute_contains(s, p):
    return p in s
```

**Evaluation criteria.**
- Matches `brute_contains` on all queries.
- Each query is `O(|p|)`, independent of `|s|`.
- Empty pattern returns `YES`.

---

### Task 3 — Count distinct substrings

**Problem.** Given `s`, print the number of distinct nonempty substrings, using `Σ (len[v] − len[link[v]])`.

**Input / Output spec.**
- Read `s`. Print the count.

**Constraints.** `1 ≤ |s| ≤ 10^6`. Answer may exceed 32-bit ⇒ use 64-bit.

**Hint.** Sum over states `1..`; the root contributes nothing.

**Worked check.** `"aba" → 5`, `"aaaa" → 4`, `"abc" → 6`.

**Reference oracle (Python).**
```python
def brute_distinct(s):
    return len({s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1)})
```

**Evaluation criteria.**
- Matches `brute_distinct` for `|s| ≤ 200`.
- Uses 64-bit accumulation.
- `O(|s|)` after the build.

---

### Task 4 — Total length of all distinct substrings

**Problem.** Given `s`, print the sum of lengths of all distinct substrings, using `Σ (T(len[v]) − T(len[link[v]]))` with `T(m) = m(m+1)/2`.

**Input / Output spec.**
- Read `s`. Print the sum.

**Constraints.** `1 ≤ |s| ≤ 10^6`. Use 64-bit.

**Hint.** Each state contributes lengths `len[link[v]]+1 .. len[v]`; the sum of an integer interval is a difference of triangular numbers.

**Reference oracle (Python).**
```python
def brute_total_len(s):
    subs = {s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1)}
    return sum(len(x) for x in subs)
```

**Evaluation criteria.**
- Matches `brute_total_len` for `|s| ≤ 150`.
- 64-bit arithmetic.
- `O(|s|)` after the build.

---

### Task 5 — Mark terminal states

**Problem.** Given `s`, build `SA(s)` and report which states are **terminal** (their class contains a suffix of `s`). Print the number of terminal states.

**Input / Output spec.**
- Read `s`. Print the count of terminal states.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Start at `last` (the final whole-prefix state) and walk suffix links to the root, marking each visited state terminal.

**Evaluation criteria.**
- Every suffix of `s` is recognized by ending in a terminal state.
- The number of terminal states equals the number of distinct endpos classes containing a suffix.
- Matches a brute check that walks each suffix to a marked state.

---

## Intermediate Tasks (5)

### Task 6 — Occurrence count of each substring

**Problem.** Build `SA(s)`, compute `cnt[v] = |endpos(v)|` for every state (prefix-ends start at 1, clones at 0, aggregate up the link tree), then answer `q` queries: for each pattern `p`, print the number of occurrences in `s`.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `1 ≤ q ≤ 10^5`, total pattern length `≤ 10^6`.

**Hint.** Counting-sort states by `len` (values in `[0, |s|]`), aggregate `cnt[link[v]] += cnt[v]` in descending order, then walk `p` and read `cnt[v]`.

**Reference oracle (Python).**
```python
def brute_occ(s, p):
    if not p:
        return len(s) + 1
    count, start = 0, 0
    while True:
        idx = s.find(p, start)
        if idx == -1:
            break
        count += 1
        start = idx + 1
    return count
```

**Evaluation criteria.**
- Clones start at `cnt = 0`; prefix-ends at `1`.
- Aggregation is in `len`-descending order.
- Matches `brute_occ` for small `s`.

---

### Task 7 — Longest common substring of two strings

**Problem.** Given `s` and `t`, print the length of the longest common substring. Use `SA(s)` and run `t` through it.

**Constraints.** `1 ≤ |s|, |t| ≤ 10^6`.

**Hint.** Maintain current state `v` and matched length `l`. On a missing transition, follow `v = link[v]` and set `l = len[v]` until a transition exists or you hit the root (reset `l = 0`). Track `max l`.

**Reference oracle (Python).**
```python
def brute_lcs(s, t):
    best = 0
    for i in range(len(s)):
        for j in range(len(t)):
            l = 0
            while i + l < len(s) and j + l < len(t) and s[i + l] == t[j + l]:
                l += 1
            best = max(best, l)
    return best
```

**Evaluation criteria.**
- Matches `brute_lcs` for `|s|, |t| ≤ 100`.
- Correctly resets `l` on suffix-link descent.
- `O(|s| + |t|)`.

---

### Task 8 — Longest substring occurring at least k times

**Problem.** Given `s` and `k`, find the length of the longest substring that occurs at least `k` times in `s`. Print `0` if none.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `1 ≤ k ≤ |s|`.

**Hint.** Compute `cnt[v]` (Task 6), then take `max len[v]` over states with `cnt[v] ≥ k`. (`k = 1` always gives `|s|`.)

**Reference oracle (Python).**
```python
def brute_longest_k(s, k):
    from collections import Counter
    best = 0
    for length in range(1, len(s) + 1):
        c = Counter(s[i:i + length] for i in range(len(s) - length + 1))
        if max(c.values(), default=0) >= k:
            best = length
    return best
```

**Evaluation criteria.**
- Matches `brute_longest_k` for `|s| ≤ 100`.
- Uses the precomputed endpos sizes, not re-scanning.
- `O(|s|)` after counts are built.

---

### Task 9 — k-th smallest distinct substring

**Problem.** Given `s` and `k`, output the k-th lexicographically smallest distinct substring of `s`, or `-1` if fewer than `k` distinct substrings exist.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ k ≤ 10^{18}` (use 64-bit; cap path counts at `k`).

**Hint.** Precompute `paths[v]` = distinct substrings reachable from `v` (reverse topological order). DFS from the root in alphabetical order, subtracting `paths` until you isolate the k-th. Cap counts to avoid overflow.

**Reference oracle (Python).**
```python
def brute_kth(s, k):
    subs = sorted({s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1)})
    return subs[k - 1] if k <= len(subs) else "-1"
```

**Evaluation criteria.**
- Matches `brute_kth` for `|s| ≤ 50`.
- Returns `-1` when `k` exceeds the distinct count.
- Path counts capped/safe from overflow.

---

### Task 10 — Number of distinct substrings after each prefix

**Problem.** Process `s` online; after reading each character, print the number of distinct substrings of the prefix so far. (This exploits the SAM's online nature.)

**Constraints.** `1 ≤ |s| ≤ 10^6`. Use 64-bit.

**Hint.** Maintain a running total. After each `extend`, the new distinct substrings added equal `len[cur] − len[link[cur]]` (clones add 0 net because a clone subtracts from `q` what it adds). Add that increment per character.

**Reference oracle (Python).**
```python
def brute_prefix_distinct(s):
    res = []
    for i in range(1, len(s) + 1):
        pref = s[:i]
        res.append(len({pref[a:b] for a in range(i) for b in range(a + 1, i + 1)}))
    return res
```

**Evaluation criteria.**
- Matches `brute_prefix_distinct` for `|s| ≤ 150`.
- Updates incrementally in `O(1)` amortized per character.
- 64-bit running total.

---

## Advanced Tasks (5)

### Task 11 — Generalized SAM over multiple strings

**Problem.** Build a generalized suffix automaton over `m` strings, then answer: number of *distinct* substrings across all strings, and for `q` patterns whether each occurs in at least one string.

**Constraints.** `1 ≤ m ≤ 10^4`, total length `≤ 10^6`.

**Hint.** Use the guarded reset-`last` extend (reuse an existing solid transition; split a non-solid one) or build over a trie in BFS order. Do **not** create duplicate states. The distinct-substring formula `Σ len[v]−len[link[v]]` still holds.

**Evaluation criteria.**
- No spurious states: `states ≤ 2·totalLength`.
- Distinct count matches a brute-force union of all substrings for small inputs.
- Membership queries correct across all strings.

---

### Task 12 — Number of documents containing each pattern

**Problem.** Given `m` documents and `q` patterns, for each pattern print how many *documents* contain it (not total occurrences).

**Constraints.** `1 ≤ m ≤ 64`, total length `≤ 10^6`, `1 ≤ q ≤ 10^5`.

**Hint.** Build a generalized SAM. Attach a document bitmask to each prefix-end state, then OR masks up the suffix-link tree. The answer for a pattern is the popcount of the mask of the state it walks to. (For `m > 64`, use distinct-color subtree counting instead.)

**Evaluation criteria.**
- Distinct-document counting (not occurrence counting) — a substring appearing twice in one document counts that document once.
- Masks aggregated up the link tree in `len`-descending order.
- Matches a brute-force per-document `in` check for small inputs.

---

### Task 13 — Report all occurrence positions of a pattern

**Problem.** Given `s` and `q` patterns, for each pattern list all end-positions where it occurs in `s` (sorted ascending).

**Constraints.** `1 ≤ |s| ≤ 10^5`, total output size manageable.

**Hint.** Store `firstpos[v]` at state creation (clones inherit from the split state). The end-positions of a matched substring are the `firstpos` of all prefix-end states in the subtree of the matched state in the suffix-link tree — collect them via an Euler tour or a DFS.

**Evaluation criteria.**
- Positions match a brute-force `find`-loop for small inputs.
- Clones do not contribute spurious positions.
- Enumeration is `O(occurrences)` per query after preprocessing.

---

### Task 14 — Lexicographically smallest cyclic shift via SAM

**Problem.** Given `s`, find the lexicographically smallest rotation of `s`. Build `SA(s + s)` (the doubled string) and greedily walk the smallest transition `|s|` times from the root, starting the walk at the right offset.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Concatenate `s + s`, build the SAM, then from the initial state greedily take the smallest available character `|s|` times — the path spells the minimal rotation. (Booth's algorithm is the standard alternative; this task is the SAM-based view.)

**Evaluation criteria.**
- Matches a brute-force minimum over all rotations for `|s| ≤ 2000`.
- Uses the doubled-string SAM.
- Greedy smallest-character walk of length `|s|`.

---

### Task 15 — Decide the right structure (SAM vs suffix array vs suffix tree)

**Problem.** Given a problem description and constraints `(n, query_type, online?)`, return one of `SUFFIX_AUTOMATON`, `SUFFIX_ARRAY`, `SUFFIX_TREE`, or `PLAIN_SCAN`, with justification.

**Constraints / cases to handle.**
- Many substring/occurrence queries, online text → `SUFFIX_AUTOMATON`.
- Need sorted suffix order / LCP queries / minimal memory → `SUFFIX_ARRAY`.
- Need explicit substring paths / already reasoning in tree terms → `SUFFIX_TREE`.
- Single substring check on a short text → `PLAIN_SCAN`.

**Hint.** Encode the comparison table from `middle.md`. The SAM wins on online build, distinct/occurrence counting, and two-string LCS; the suffix array wins on sorted order and memory.

**Evaluation criteria.**
- Correctly classifies all four canonical cases.
- Justification cites the right complexity (`O(n)` build, `O(|p|)` query for SAM; `O(|p| log n)` for SA search).
- Notes the SAM–suffix-tree-of-reverse duality where relevant.

---

### Task 16 — Longest common substring of `m` strings (generalized SAM)

**Problem.** Given `m` strings, print the length of the longest substring that appears in **every** one of them. Build a generalized SAM over all `m` strings and use per-state hit counters.

**Input / Output spec.**
- Read `m`, then `m` strings (one per line).
- Print the length of the longest common substring of all `m` strings (`0` if none).

**Constraints.** `2 ≤ m ≤ 10`, total length `≤ 10^6`.

**Hint.** Build the generalized SAM. For each string `i`, walk it through the automaton tracking current state and matched length; for every state visited, record the *maximum matched length reachable for string `i`* there — call it `best[i][v]`. After processing string `i`, propagate `best[i][v]` up the suffix-link tree (a state implies all its link-ancestors are also matched). A state is *common* iff it was hit by all `m` strings; among common states the answer is `min(min_i best[i][v], len[v])` maximized over `v`. Process states in `len`-descending order so propagation is one linear pass per string.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	var m int
	fmt.Fscan(reader, &m)
	strs := make([]string, m)
	for i := 0; i < m; i++ {
		fmt.Fscan(reader, &strs[i])
	}
	// TODO: build generalized SAM over strs.
	// TODO: for each string compute best[i][v], propagate up link tree.
	// TODO: answer = max over states hit by all m of min(min_i best[i][v], len[v]).
	fmt.Println(0)
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task16 {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int m = Integer.parseInt(br.readLine().trim());
        String[] strs = new String[m];
        for (int i = 0; i < m; i++) strs[i] = br.readLine().trim();
        // TODO: build generalized SAM over strs.
        // TODO: per-string best[i][v], propagate up link tree in len-desc order.
        // TODO: answer = max over states hit by all m of min(min_i best[i][v], len[v]).
        System.out.println(0);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split("\n")
    m = int(data[0])
    strs = [data[1 + i] for i in range(m)]
    # TODO: build generalized SAM over strs.
    # TODO: per-string best[v], propagate up link tree in len-desc order.
    # TODO: answer = max over states hit by all m of min(min_i best[i][v], len[v]).
    print(0)


if __name__ == "__main__":
    main()
```

**Reference oracle (Python).**
```python
def brute_lcs_multi(strs):
    base = strs[0]
    subs = {base[i:j] for i in range(len(base)) for j in range(i + 1, len(base) + 1)}
    best = 0
    for sub in subs:
        if all(sub in t for t in strs):
            best = max(best, len(sub))
    return best
```

**Evaluation criteria.**
- Matches `brute_lcs_multi` for `m ≤ 4`, each string `≤ 60`.
- A state counts as common only when reached by all `m` strings.
- `min(best[i][v], len[v])` is used so the reported length never exceeds the state's own longest substring.
- `O(total length)` after the build (one propagation pass per string).

---

### Task 17 — Endpos sizes and unique-occurrence substrings

**Problem.** Build `SA(s)`, compute `cnt[v] = |endpos(v)|` for every state via the link tree, then report two values: the number of distinct substrings that occur **exactly once**, and the number that occur **at least twice**.

**Input / Output spec.**
- Read `s`. Print two integers (unique-count, repeated-count) separated by a space.

**Constraints.** `1 ≤ |s| ≤ 10^6`. Answers may exceed 32-bit ⇒ use 64-bit.

**Hint.** Each state `v` represents exactly `len[v] − len[link[v]]` distinct substrings, and **all of them share the same occurrence count `cnt[v]`**. So accumulate `len[v] − len[link[v]]` into the unique bucket when `cnt[v] == 1`, otherwise into the repeated bucket. Compute `cnt[v]` by counting-sorting states by `len` and aggregating `cnt[link[v]] += cnt[v]` in descending `len` order (clones start at 0, prefix-ends at 1).

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var s string
	fmt.Scan(&s)
	// TODO: build SAM, set cnt[prefix-end]=1, cnt[clone]=0.
	// TODO: aggregate cnt up the link tree in len-desc order.
	// TODO: for v>=1, add (len[v]-len[link[v]]) to unique if cnt[v]==1 else repeated.
	var unique, repeated int64
	fmt.Println(unique, repeated)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task17 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.next();
        // TODO: build SAM, set cnt[prefix-end]=1, cnt[clone]=0.
        // TODO: aggregate cnt up the link tree in len-desc order.
        // TODO: for v>=1, add (len[v]-len[link[v]]) to unique if cnt[v]==1 else repeated.
        long unique = 0, repeated = 0;
        System.out.println(unique + " " + repeated);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    s = sys.stdin.readline().strip()
    # TODO: build SAM, set cnt[prefix-end]=1, cnt[clone]=0.
    # TODO: aggregate cnt up the link tree in len-desc order.
    # TODO: for v>=1, add (length[v]-length[link[v]]) to unique if cnt[v]==1 else repeated.
    unique = 0
    repeated = 0
    print(unique, repeated)


if __name__ == "__main__":
    main()


def brute_unique_repeated(s):
    from collections import Counter
    c = Counter(s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1))
    uniq = sum(1 for v in c.values() if v == 1)
    rep = sum(1 for v in c.values() if v >= 2)
    return uniq, rep
```

**Evaluation criteria.**
- `unique + repeated` equals the total distinct-substring count (Task 3).
- Matches `brute_unique_repeated` for `|s| ≤ 200`.
- Uses the fact that all substrings of a single state share one `cnt` value.
- 64-bit buckets; `O(|s|)` after the build.

---

## Benchmark Task

### Task B — SAM build and query throughput

**Problem.** Empirically measure SAM performance. On a random string of length `V` (fixed seed), measure:

- **(a) Build time:** time to construct `SA(s)` online.
- **(b) Distinct-substring time:** time to compute `Σ len[v]−len[link[v]]`.
- **(c) Query throughput:** average time to answer a substring membership query of length `L`.

Compare **array transitions** vs **map transitions** for a small alphabet (σ = 26) and report state/edge counts and memory.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_string(v: int, sigma: int, seed: int) -> str:
    r = random.Random(seed)
    return "".join(chr(ord("a") + r.randint(0, sigma - 1)) for _ in range(v))


class SAM:
    def __init__(self):
        self.nxt = [{}]; self.link = [-1]; self.length = [0]; self.last = 0

    def extend(self, c):
        # TODO: standard extend with clone/split
        pass

    def distinct(self):
        # TODO: sum len[v] - len[link[v]] over v >= 1
        return 0


def build(s: str) -> SAM:
    sam = SAM()
    for ch in s:
        sam.extend(ch)
    return sam


def bench_build(s: str) -> float:
    start = time.perf_counter()
    build(s)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    for V in [10_000, 100_000, 1_000_000]:
        s = gen_string(V, 26, 42)
        rb = [bench_build(s) for _ in range(3)]
        sam = build(s)
        states = len(sam.nxt)
        edges = sum(len(d) for d in sam.nxt)
        print(f"V={V:<9d} build_ms={mean_ms(rb):<10.2f} states={states} edges={edges}")
        assert states <= 2 * V - 1 or V < 2
        assert edges <= 3 * V - 4 or V < 3


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string across Go, Java, and Python.
- State count `≤ 2V−1` and edge count `≤ 3V−4` (asserted).
- Build completes for `V = 10^6` in well under a second (compiled) / a few seconds (CPython).
- Report compares array vs map transition memory and lookup speed.
- Report includes the mean across at least 3 runs and does not time string generation.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Enumerate substrings into a `set` (distinct counts) or scan for occurrences. Run on small `|s|`, diff, and only then trust the SAM on large inputs.
- **Keep `extend` canonical.** It is the part everyone breaks. The clone must copy `q`'s transitions and link and take `len = len[p]+1`; the redirect loop runs while `next[p][c] == q`.
- **Get the root and links right.** The root has `link = -1`; never include it (or use its `link`) in the distinct-substring sum.
- **Clones start at `cnt = 0`.** Only prefix-end states contribute an occurrence; aggregate up the link tree in `len`-descending order.
- **Use 64-bit.** Distinct-substring counts, total lengths, and occurrence sums overflow 32-bit for moderate `|s|`.
- **Choose transition storage by alphabet.** Array for small fixed σ (fast, `O(states·σ)` memory); map for large/sparse σ (`O(edges)` memory).
- **Substring ≠ suffix.** "Is a substring" is "the walk survived"; "is a suffix" is "ended in a terminal state".

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.