# Palindromic Tree (eertree) — Practice Tasks

> Fifteen graded tasks plus a benchmark, each implemented in Go, Java, and Python.
>
> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the eertree logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(n²)` set/count oracle on small inputs before trusting the eertree result.**
> The two roots (imaginary `len -1`, empty `len 0`), the length-1 link to the empty root, and the append-then-`getLink` index convention are the three details that must be exactly right before any task will pass.

---

Tasks are grouped Beginner / Intermediate / Advanced, with a final benchmark. Each states the problem, an I/O spec, constraints, hints, and (where useful) a brute-force oracle to validate against. Work them in order — later tasks reuse the `add`/`getLink` core from the earlier ones.

## Beginner Tasks (5)

### Task 1 — Build the eertree and report node count

**Problem.** Implement the online eertree construction (two roots, suffix links, `getLink` walk, `add`). After processing the string, print the total number of nodes (including the two roots).

**Input / Output spec.**
- Read a lowercase string `s`.
- Print `numberOfNodes` (which is `distinct palindromes + 2`).

**Constraints.**
- `0 ≤ |s| ≤ 10^5`, lowercase English letters.
- Use array or map children; document your choice.

**Hint.** Initialize `len = [-1, 0]`, `link = [0, 0]`, `last = 1`. The imaginary root (`len = -1`) terminates every `getLink` walk.

**Starter — Go.**
```go
package main

import "fmt"

type Eertree struct {
	s    []byte
	len  []int
	link []int
	next []map[byte]int
	last int
}

func New() *Eertree {
	// TODO: two roots: imaginary (len -1), empty (len 0); last = 1
	return nil
}

func (e *Eertree) Add(c byte) {
	// TODO: getLink walk, reuse or create one node, set suffix link
}

func main() {
	var s string
	fmt.Scan(&s)
	e := New()
	for i := 0; i < len(s); i++ {
		e.Add(s[i] - 'a')
	}
	fmt.Println(len(e.len)) // node count
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.hasNext() ? sc.next() : "";
        char[] str = s.toCharArray();
        List<Integer> len = new ArrayList<>(List.of(-1, 0));
        List<Integer> link = new ArrayList<>(List.of(0, 0));
        List<Map<Character, Integer>> next = new ArrayList<>(List.of(new HashMap<>(), new HashMap<>()));
        int last = 1;
        for (int i = 0; i < str.length; i++) {
            // TODO: getLink walk, reuse or create one node
        }
        System.out.println(len.size());
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    s = sys.stdin.readline().strip()
    length, link, to, last, buf = [-1, 0], [0, 0], [dict(), dict()], 1, []
    # TODO: implement get_link and add; process s
    print(len(length))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `node count == distinct palindromes + 2`, verified against a brute-force set on small inputs.
- Empty string → 2 nodes.
- `"aaaa"` → 6 nodes (4 distinct + 2 roots).

**Getting the roots right.** This task exists to nail the bootstrap. Common mistakes: using node 0 as both "no child" sentinel and the imaginary root; linking length-1 palindromes to node 0 instead of node 1; indexing `s[i - len - 1]` without the `< 0` guard. Print the `(len, link)` of every node and check by hand that node 0 is `(-1, 0)`, node 1 is `(0, 0)`, and every length-1 node links to node 1. Once Task 1 is solid, Tasks 2–10 are short extensions.

---

### Task 2 — Count distinct palindromic substrings

**Problem.** Given `s`, output the number of **distinct** palindromic substrings, i.e. `numberOfNodes - 2`.

**Input / Output spec.**
- Read `s`. Print the distinct count.

**Constraints.** `1 ≤ |s| ≤ 10^6`, lowercase.

**Hint.** Build the eertree once; answer is `numberOfNodes - 2`. No second pass needed.

**Reference oracle (Python) — use this to validate.**
```python
def distinct_oracle(s):
    return len({s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1) if s[i:j] == s[i:j][::-1]})
```

**Evaluation criteria.**
- `"ababa"` → 5, `"aaaa"` → 4, `"abc"` → 3.
- Matches `distinct_oracle` for `|s| ≤ 14`.
- `O(n)` build.

**Worked check.** `"aaaa"`: the distinct palindromes are `a, aa, aaa, aaaa` — exactly 4. The eertree has 4 non-root nodes (plus the 2 roots = 6 total), forming a single suffix-link chain `aaaa → aaa → aa → a → ε`. `"abc"`: only single characters are palindromic, so 3 distinct, three sibling nodes under the imaginary root. These two extremes (all-same vs all-different) are the best first tests — they exercise the longest chain and the widest fan-out respectively.

---

### Task 3 — Total palindromic substrings (with multiplicity)

**Problem.** Given `s`, output the **total** number of palindromic substrings (each occurrence counted), using occurrence propagation up suffix links.

**Input / Output spec.**
- Read `s`. Print the total (use 64-bit; the value can be `Θ(n²)`).

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Increment `occ[v]` each time `v` becomes `last`; then `for v from last node down to 2: occ[link[v]] += occ[v]`; sum `occ[2:]`.

**Worked check.** `"aaa"` → `a×3 + aa×2 + aaa×1 = 6`. `"ababa"` → 9. Cross-check: `Σ endCount[last_i]` must equal this sum.

**Reference oracle (Python).**
```python
def total_oracle(s):
    return sum(1 for i in range(len(s)) for j in range(i + 1, len(s) + 1) if s[i:j] == s[i:j][::-1])
```

**Evaluation criteria.**
- `"aaa"` → 6, `"ababa"` → 9.
- Propagation in reverse creation order (length-descending).
- Matches `total_oracle` for small inputs; 64-bit accumulator.

**Common bug.** Propagating in the *wrong* order (parent before child) loses counts — for `"ababa"` you would get a total below 9. The fix is to iterate `for v from (numberOfNodes - 1) down to 2`, which is length-descending because nodes are created in non-decreasing length order. Test specifically on `a^n` where the chain is longest and order errors are most visible.

---

### Task 4 — Palindromes ending at each position

**Problem.** Given `s`, output an array `e` where `e[i]` = number of palindromic substrings ending at index `i`. Use `endCount[v] = endCount[link[v]] + 1`.

**Input / Output spec.**
- Read `s`. Print `e[0] … e[n-1]` space-separated.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Track `endCount` at node creation; after appending `s[i]`, `e[i] = endCount[last]`. The sum of `e` equals the total palindrome count (Task 3).

**Evaluation criteria.**
- `"ababa"` → `[1, 1, 2, 2, 3]`; sum = 9.
- `Σ e[i]` equals the Task 3 total.
- `O(n)` overall (no per-position chain walk).

**Why no chain walk.** A naive solution walks the suffix-link chain from `last` per position to count palindromic suffixes — `O(n²)` on `a^n`. The `endCount[v] = endCount[link[v]] + 1` recurrence precomputes the chain depth at node creation, so reading `endCount[last]` is `O(1)`. This is the single most important optimization in this task; an `O(n²)` solution will time out on long uniform strings.

---

### Task 5 — Longest palindromic suffix per prefix

**Problem.** Given `s`, output `L[i]` = length of the longest palindromic suffix of the prefix `s[0..i]`. This is simply `len[last]` after appending `s[i]`.

**Input / Output spec.**
- Read `s`. Print `L[0] … L[n-1]`.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** After each `add`, record `len[last]`. Handle `n = 0` (empty output).

**Evaluation criteria.**
- `"ababa"` → `[1, 1, 3, 3, 5]`.
- `L[i] ≥ 1` for every non-empty prefix.
- Matches a brute-force "longest palindromic suffix" check for small inputs.

**Use in factorization.** This array is the foundation of palindromic partitioning: a greedy or DP partition repeatedly peels off the longest palindromic suffix. Note `L[i]` can jump by more than 1 between consecutive positions (e.g. `ab` → `aba` goes from `1` to `3`), reflecting that appending a character can extend the longest palindromic suffix by up to 2 — never more, a direct consequence of the wrap-in-`c` rule.

---

## Intermediate Tasks (5)

### Task 6 — Per-palindrome occurrence counts

**Problem.** Given `s`, for each distinct palindrome output its (string, occurrenceCount) pair, sorted by length then lexicographically. Use occurrence propagation.

**Constraints.** `1 ≤ |s| ≤ 10^5` (so reconstructing strings is feasible).

**Hint.** After propagation, `occ[v]` is the count of palindrome `v`. Reconstruct each palindrome's string by following parent edges (store the first occurrence's end position per node and slice `s`, or rebuild from the tree). Verify counts sum to the Task 3 total.

**Evaluation criteria.**
- For `"ababa"`: `a:3, b:2, aba:2, bab:1, ababa:1`.
- `Σ occ[v]` equals the total palindrome count.
- Matches a brute-force per-palindrome count for small inputs.

**Reconstructing palindrome strings.** Store `firstEnd[v] = i` (the position at which `v` was created) at node creation; then the palindrome is `s[firstEnd[v] - len[v] + 1 .. firstEnd[v]]`. This is `O(len)` per palindrome to materialize. Sorting by `(len, lexicographic)` is then straightforward. Avoid re-deriving strings by walking child edges character-by-character — slicing `s` directly is simpler and faster.

---

### Task 7 — Palindromic richness test

**Problem.** Given `s`, decide whether `s` is **rich** (has exactly `n` distinct nonempty palindromic substrings, the maximum). Output `RICH` or `NOT RICH`.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** `s` is rich iff `add()` returns `true` (creates a new node) at **every** character. Equivalently, `distinct == n`.

**Reference oracle (Python).**
```python
def is_rich_oracle(s):
    distinct = len({s[i:j] for i in range(len(s)) for j in range(i + 1, len(s) + 1) if s[i:j] == s[i:j][::-1]})
    return distinct == len(s)
```

**Evaluation criteria.**
- `"abacaba"` → RICH; a genuine non-rich example (some character adds no new palindrome) → NOT RICH.
- `a^n` is always RICH.
- Matches `is_rich_oracle` for small inputs; `O(n)`.

**Why this is `O(n)` and elegant.** Richness normally sounds like it needs counting all distinct palindromes and comparing to `n`. But the eertree gives it for free: `s` is rich iff `add()` creates a node at *every* character. So you can return `NOT RICH` the instant `add()` returns `false` — often before reading the whole string. This early-exit is a nice property to demonstrate: on a long non-rich string, you may decide after a constant prefix.

---

### Task 8 — Longest palindromic substring via eertree

**Problem.** Given `s`, output the length of the **longest** palindromic substring using the eertree (the maximum `len` over all nodes).

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Track `max(len[v])` during construction. (Note: Manacher, sibling `11`, is the simpler tool for *just* this — but the eertree solves it too as a side effect.)

**Reference oracle (Python).**
```python
def longest_pal_oracle(s):
    best = 0
    for i in range(len(s)):
        for j in range(i + 1, len(s) + 1):
            if s[i:j] == s[i:j][::-1]:
                best = max(best, j - i)
    return best
```

**Evaluation criteria.**
- `"babad"` → 3 (`bab` or `aba`); `"cbbd"` → 2 (`bb`).
- Matches `longest_pal_oracle` for small inputs.
- `O(n)`; document that Manacher is the lighter alternative for this single query.

**Online bonus.** Tracking `max(len[v])` during the build gives the longest palindrome of *every prefix* online — a capability Manacher lacks (it needs the whole string). If the task only ever asks for the longest palindrome of the *complete* string, Manacher is simpler; if it asks per-prefix or for streaming input, the eertree wins. State this trade-off explicitly in your solution's comments.

---

### Task 9 — Distinct palindromes containing a given character

**Problem.** Given `s` and a character `x`, count the distinct palindromic substrings that contain at least one occurrence of `x`.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Build the eertree; for each node reconstruct (or annotate during creation) whether its palindrome contains `x`. A palindrome `cPc` contains `x` iff `c == x` or `P` contains `x` — propagate this boolean from parent to child at creation in `O(1)`.

**Evaluation criteria.**
- For `"ababa"`, `x = 'b'`: palindromes containing `b` are `b, aba, bab, ababa` → 4.
- Matches a brute-force distinct-set filter for small inputs.
- `O(n)` with the parent-propagated boolean.

**Edge cases.** If `x` does not appear in `s` at all, the answer is 0. If every character is `x` (e.g. `s = "aaaa"`, `x = 'a'`), every palindrome contains `x`, so the answer equals the distinct count `nodes - 2`. These two extremes are quick sanity checks before running the full oracle.

**Implementation note.** Store `hasX[v]` at node creation: `hasX[v] = (edgeChar[v] == x) || hasX[parent[v]]`, where `parent` is the child-edge source (the palindrome you wrapped to get `v`). Because `cPc` contains `x` iff `c == x` or `P` already contains `x`, this is correct and `O(1)` per node. Count nodes with `hasX == true`. Do **not** reconstruct each palindrome string and scan it — that is `O(n · len)` and unnecessary.

---

### Task 10 — Generalized eertree over two strings

**Problem.** Given two strings `s` and `t`, count the number of distinct palindromic substrings that appear in **both** `s` and `t`.

**Constraints.** `1 ≤ |s|, |t| ≤ 10^5`.

**Hint.** Build one generalized eertree: process `s` (mark nodes touched by `s`), **reset `last` to the empty root**, then process `t` (mark nodes touched by `t`). Count nodes touched by both. Reset `last` between strings is critical.

**Reference oracle (Python).**
```python
def common_oracle(s, t):
    def pals(x):
        return {x[i:j] for i in range(len(x)) for j in range(i + 1, len(x) + 1) if x[i:j] == x[i:j][::-1]}
    return len(pals(s) & pals(t))
```

**Evaluation criteria.**
- `s = "aba"`, `t = "aca"`: common palindromes are `a` → 1.
- Forgetting to reset `last` between strings produces a wrong (inflated) count — guard against it.
- Matches `common_oracle` for small inputs.

**Why reset matters.** Without `last = emptyRoot` before processing `t`, the suffix-link walk at the start of `t` can find a palindrome ending in `s` and fabricate a cross-string palindrome that does not exist in either string alone. The position-index bound check must also be re-based to `t`'s start (or use a separate buffer per string), or `getLink` reads `s`'s characters when extending early positions of `t`. Both resets are mandatory; test by asserting the common count never exceeds `min(distinct(s), distinct(t))`.

---

## Advanced Tasks (5)

### Task 11 — Minimum palindromic factorization (series links)

**Problem.** Given `s`, compute the minimum number of palindromes that `s` can be split into (palindromic factorization). Use the eertree with **series links** for `O(n log n)`.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Maintain `diff[v] = len[v] - len[link[v]]` and `slink[v]`. The DP `f(i)` = min palindromes for prefix of length `i`; use per-series stored values `seriesAns` updated in `O(1)` as you process each character, iterating only the `O(log n)` series via `slink`.

**Reference oracle (Python, `O(n²)`).**
```python
def min_fact_oracle(s):
    n = len(s)
    INF = float("inf")
    f = [INF] * (n + 1)
    f[0] = 0
    for i in range(1, n + 1):
        for j in range(i):
            if s[j:i] == s[j:i][::-1]:
                f[i] = min(f[i], f[j] + 1)
    return f[n]
```

**Evaluation criteria.**
- `"aab"` → 2 (`aa` + `b`); `"abacaba"` → 1 (already a palindrome).
- Matches `min_fact_oracle` for small inputs.
- `O(n log n)` via series links (a chain walk via plain `link` is `O(n²)` and not acceptable here).

**The subtle part.** The "series ancestor" handoff between consecutive positions is where most implementations break. A series at position `i` corresponds to a series at position `i - diff` shifted by the period; the stored `seriesAns` must be carried across correctly. Test on `a^k b a^k` and `(ab)^k` — long periodic strings with many series — not just short inputs, because the handoff bug only manifests when a series spans several positions.

---

### Task 12 — Count palindromic factorizations mod p

**Problem.** Given `s`, count the number of ways to split `s` into a sequence of palindromes, modulo `10^9 + 7`. Use the eertree series-link DP.

**Constraints.** `1 ≤ |s| ≤ 10^6`.

**Hint.** Same series-link machinery as Task 11, but the DP `g(i)` = number of palindromic factorizations of the prefix; aggregate sums over series with per-series running sums, reduced mod `p`.

**Reference oracle (Python, `O(n²)`).**
```python
def count_fact_oracle(s, mod=10**9 + 7):
    n = len(s)
    g = [0] * (n + 1)
    g[0] = 1
    for i in range(1, n + 1):
        for j in range(i):
            if s[j:i] == s[j:i][::-1]:
                g[i] = (g[i] + g[j]) % mod
    return g[n]
```

**Evaluation criteria.**
- `"aaa"` → 4 factorizations: `a|a|a`, `a|aa`, `aa|a`, `aaa`.
- Matches `count_fact_oracle` for small inputs.
- `O(n log n)`; mod reduction at every accumulation.

**Relation to Task 11.** This is the *counting* twin of minimum factorization: the same series-link iteration, but the DP aggregates *sums* (number of ways) instead of *minimums* (fewest pieces). The series machinery is identical; only the combine operation changes from `min`/`+1` to `+`/sum. Implement Task 11 first, then adapt it — sharing the series-link plumbing reduces the chance of a handoff bug.

---

### Task 13 — Rollback eertree (append + undo)

**Problem.** Process a sequence of operations: `+c` (append character `c`) and `-` (undo the last append). After each operation, output the current number of **distinct** palindromes. Use a rollback eertree.

**Constraints.** `1 ≤ numberOfOps ≤ 10^6`, at any time the active string length `≥ 0`.

**Hint.** `add` mutates a bounded set: at most one new node (always the last index), one child edge, and `last`. Record an undo record per `add`; to undo, restore `last`, truncate the parallel arrays by one if a node was created, and clear the child edge. `O(1)` amortized per op.

**Evaluation criteria.**
- `+a +b +a` then `-` reproduces the distinct counts `1, 2, 3, 2`.
- A round-trip (append then undo) restores byte-identical state (assert via a snapshot on small inputs).
- Matches rebuilding the eertree from scratch after each op for small inputs.

**Undo record contents.** Per `add`, store: the previous `last`; whether a node was created (and if so, its index — always the current last index); and the edited child edge `(parent, char)` (always an insertion, since a new palindrome means a new edge). To undo: restore `last`; if a node was created, truncate the parallel arrays by one and delete the edge; if an existing node's `occ` was bumped, decrement it. Never roll back after running occurrence propagation — `Finalize()` is a terminal, non-undoable step.

---

### Task 14 — eertree on a trie (build generalized eertree via DFS)

**Problem.** Given a trie of strings (each root-to-node path is a string), build the generalized eertree of **all** strings represented, by DFS: append on descending an edge, roll back on ascending. Output the total number of distinct palindromes across all trie strings.

**Constraints.** `1 ≤ trieSize ≤ 10^6`, alphabet ≤ 26.

**Hint.** DFS the trie; at each edge `c`, call `add(c)` using the parent node's eertree state (its `last`); after recursing, `Rollback()`. This shares eertree work across common prefixes — `O(trieSize · |Σ|)` instead of summing string lengths.

**Evaluation criteria.**
- Produces the same distinct-palindrome set as building a generalized eertree over the explicit list of all trie strings (with `last` reset per string).
- Rollback restores state correctly on backtrack (no leaked nodes).
- Shares prefix work (assert node count `≤ trieSize + 2`).

**The payoff.** If two trie strings share a length-`p` prefix, the naive approach re-processes those `p` characters for each; the DFS processes them once. For a dictionary where strings share long common prefixes (e.g. URLs, file paths), this is a large constant-factor win. The correctness rests entirely on rollback being a perfect inverse of `add` — so test the round-trip invariant (append then undo restores byte-identical state) exhaustively before trusting the DFS on a large trie.

---

### Task 15 — Decide eertree vs Manacher

**Problem.** Given a problem description with fields `(needsDistinctSet, needsLongestOnly, needsPerPalindromeData, isOnline, needsTotalCount)`, implement `classify(problem)` returning `EERTREE`, `MANACHER`, or `EITHER`, with justification.

**Cases to handle.**
- Needs the distinct **set** or per-palindrome data → `EERTREE`.
- Needs only the **longest** palindrome → `MANACHER` (simpler).
- Needs only a **total count**, no set → `EITHER` (Manacher: sum radii; eertree: sum occ).
- Online / streaming input → `EERTREE` (Manacher needs the whole string).
- Richness / factorization → `EERTREE`.

**Hint.** Encode the decision rules from `middle.md` and `professional.md`. The trap: people reach for Manacher then bolt on hashing to dedup the distinct set — the eertree does that natively.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `EERTREE`-for-distinct branch cites that Manacher stores radii, not the set.
- Justification references the right complexity (`O(n)` build, `O(n log n)` factorization).

**The decision tree in words.** Ask first: do you need the *set* of distinct palindromes or per-palindrome data? → `EERTREE`. Next: is the input online/streaming or do you need per-prefix answers? → `EERTREE` (Manacher needs the whole string). Next: only the longest palindrome? → `MANACHER` (simpler). Next: only a total count, no set? → `EITHER`. The trap case is "count distinct palindromes": people reach for Manacher and bolt on hashing — the eertree does it natively in one pass, so this case is `EERTREE`.

---

## Benchmark Task

### Task B — eertree vs brute-force set crossover

**Problem.** Empirically compare distinct-palindrome counting via (a) the brute-force `O(n²)`-hashing set and (b) the eertree, across growing `n`, and identify the crossover where the eertree clearly wins. Use a fixed-seed random string over a small alphabet (which maximizes palindrome density).

**Starter — Python.**
```python
import random
import time


def gen_string(n, seed, alphabet="ab"):
    r = random.Random(seed)
    return "".join(r.choice(alphabet) for _ in range(n))


def brute_distinct(s):
    # TODO: O(n^2) hashing into a set; return distinct count
    return 0


def eertree_distinct(s):
    # TODO: online eertree; return numberOfNodes - 2
    return 0


def bench(fn, s):
    start = time.perf_counter()
    fn(s)
    return time.perf_counter() - start


def main():
    print("n         brute_ms       eertree_ms")
    for n in [100, 1000, 5000, 20000, 100000]:
        s = gen_string(n, 42)
        rb = [bench(eertree_distinct, s) for _ in range(3)]
        if n <= 20000:
            ra = [bench(brute_distinct, s) for _ in range(3)]
            print(f"{n:<9d} {sum(ra)/3*1000:<14.2f} {sum(rb)/3*1000:<14.2f}")
        else:
            print(f"{n:<9d} {'(skipped)':<14} {sum(rb)/3*1000:<14.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string across Go, Java, and Python.
- Brute force (a) becomes infeasible for `n ≥ ~20 000`; the eertree (b) stays fast (linear).
- Both agree on the distinct count for all `n` where brute force runs.
- Report includes the mean across at least 3 runs and excludes string generation from timing.
- Writeup: a short note on the measured crossover and how the eertree's `O(n)` beats the brute-force `O(n²)`.

**Expected shape.** The brute-force time grows quadratically (doubling `n` roughly quadruples it), while the eertree time grows linearly. On a small-alphabet random string (densest palindromes), the eertree should pull decisively ahead by `n ≈ a few thousand`, and brute force becomes impractical well before `n = 10^5`. The exact crossover depends on language and constant factors, but the *shapes* (linear vs quadratic) are the point to demonstrate — plot them if you can.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every counting task above ships with (or references) a slow `O(n²)` set/count oracle. Run it on small `n`, diff, and only then trust the eertree on large `n`.
- **Initialize the two roots explicitly.** `len = [-1, 0]`, `link = [0, 0]`, `last = 1`. The imaginary root (`len = -1`) terminates every `getLink` walk.
- **Length-1 palindromes link to the empty root**, not the imaginary one — the single most common bug.
- **Subtract two roots** for the distinct count: `distinct = numberOfNodes - 2`.
- **Propagate occurrence counts in reverse creation order** (length-descending); use 64-bit accumulators (totals are `Θ(n²)`).
- **Reset `last` between strings** in generalized eertrees; carrying it over fabricates cross-string palindromes.
- **Verify two ways when you can.** Total occurrences computed via `occ` propagation must equal `Σ endCount[last_i]`; distinct via `nodes - 2` must equal the brute-force set size. Cross-checks catch order and indexing bugs that single computations hide.
- **Use series links only for factorization-style tasks** (Tasks 11–12); plain suffix links suffice for distinct/total/per-position counts.
- **Array children for small alphabets, map children for large** — keep the rest of the code identical.
- **Pin the position index convention.** Append the character to the buffer first, then call `getLink(last, i)` with `i = oldLength`; the wrap-test reads `buf[i - len[x] - 1]`. An off-by-one here builds a wrong tree that still passes tiny smoke tests — only the dense-palindrome oracle catches it.
- **Annotate at creation, not in a second pass.** `endCount`, `diff`, `slink`, `hasX`, and `firstEnd` are all `O(1)` to set when a node is born; computing them later by walking chains reintroduces the `O(n²)` you were avoiding.

### Recommended solving order

1. Start with **Task 1** (build + node count) and get the two-roots / length-1-link / index convention exactly right against the oracle. Everything else builds on this.
2. **Tasks 2–5** are one-line reads off the built tree (`nodes - 2`, `occ` propagation, `endCount[last]`, `len[last]`); do them together.
3. **Tasks 6–10** add annotations (per-palindrome data, richness, containment, generalized) — still plain suffix links.
4. **Tasks 11–14** need the advanced machinery (series links, rollback, trie-DFS); do them last and test each against its `O(n²)` oracle.
5. **Task 15** and **Task B** are analysis/benchmark — they cement when the eertree is and is not the right tool.

### Difficulty progression

- **Beginner (1–5):** master the build and the four one-line reads (node count, distinct, total, per-position, longest-suffix). These cement the two roots, the length-1 link, and the index convention.
- **Intermediate (6–10):** add annotations and the generalized eertree — still plain suffix links, but now you maintain extra per-node data and handle multiple strings.
- **Advanced (11–15):** the hard machinery — series links for factorization, rollback for undo/trie-DFS, and the classification meta-task that tests whether you know *when* the eertree applies.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs. The discipline of triple implementation surfaces language-specific traps (boxing in Java/Python maps, integer overflow without 64-bit in Go/Java, recursion limits in Python for trie DFS) that a single-language solution would hide.
