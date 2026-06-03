# Word Break (String Segmentation DP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the DP/Trie logic and validate against the evaluation criteria.
> **Always test against a brute-force naive-recursion oracle on small inputs before trusting the DP result.**

---

## Beginner Tasks (5)

### Task 1 — Build the hash-set dictionary and test membership

**Problem.** Implement `contains(wordDict, query)` that builds a hash set from `wordDict` once and reports whether `query` is in it. Then test it on a list of queries. This is the membership primitive every Word Break variant relies on.

**Input / Output spec.**
- Read the number of dictionary words `d`, then the `d` words.
- Read the number of queries `q`, then the `q` query strings.
- For each query print `true` or `false`.

**Constraints.**
- `1 ≤ d, q ≤ 10^5`, total characters `≤ 10^6`.
- Build the set once, not per query.

**Hint.** Use a `map[string]bool` (Go), `HashSet<String>` (Java), or `set` (Python). Membership is `O(1)` average per query.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	r := bufio.NewReader(os.Stdin)
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	var d int
	fmt.Fscan(r, &d)
	dict := make(map[string]bool, d)
	for i := 0; i < d; i++ {
		var s string
		fmt.Fscan(r, &s)
		dict[s] = true
	}
	var q int
	fmt.Fscan(r, &q)
	for i := 0; i < q; i++ {
		var s string
		fmt.Fscan(r, &s)
		// TODO: print whether s is in dict
		fmt.Fprintln(w, dict[s])
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int d = sc.nextInt();
        Set<String> dict = new HashSet<>();
        for (int i = 0; i < d; i++) dict.add(sc.next());
        int q = sc.nextInt();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            String query = sc.next();
            // TODO: append membership result
            sb.append(dict.contains(query)).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = iter(sys.stdin.read().split())
    d = int(next(data))
    dict_set = {next(data) for _ in range(d)}
    q = int(next(data))
    out = []
    for _ in range(q):
        query = next(data)
        # TODO: membership
        out.append("true" if query in dict_set else "false")
    print("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Set built exactly once.
- `O(1)` average membership per query.
- Correct boolean output for each query.

---

### Task 2 — Word Break I (decision)

**Problem.** Given a string `s` and dictionary `wordDict`, output `true` if `s` can be segmented into dictionary words, else `false`. Use bottom-up boolean DP.

**Input / Output spec.**
- Read `s`, then `d` and the `d` dictionary words.
- Print `true` or `false`.

**Constraints.** `0 ≤ len(s) ≤ 1000`, `1 ≤ d ≤ 1000`.

**Hint.** `dp[0]=true`; `dp[i]=OR_j(dp[j] && s[j..i)∈dict)`. Cap the look-back at `maxWordLen`. Remember the empty string returns `true`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_break(s, dict_set, start=0):
    if start == len(s):
        return True
    for end in range(start + 1, len(s) + 1):
        if s[start:end] in dict_set and brute_break(s, dict_set, end):
            return True
    return False
```

**Evaluation criteria.**
- `dp[0]=true` seeded; empty string returns `true`.
- Matches `brute_break` for small inputs.
- `O(n · maxWordLen)`.

---

### Task 3 — Count segmentations (mod p)

**Problem.** Given `s` and `wordDict`, output the number of distinct segmentations of `s`, modulo `10^9 + 7`. Use the counting DP.

**Input / Output spec.**
- Read `s`, then `d` and the dictionary words.
- Print the single number `count mod p`.

**Constraints.** `0 ≤ len(s) ≤ 1000`, `1 ≤ d ≤ 1000`.

**Hint.** `count[0]=1`; `count[i] = Σ_j (count[j] if s[j..i)∈dict)`. Reduce mod `p` after every addition — the count grows exponentially.

**Worked check.** For `s = "aaaa"` and `dict = {"a","aa"}`, the count is `5` (the Fibonacci number `F(5)`). For `s = "aaa"` it is `3`.

**Evaluation criteria.**
- `"aaaa"` with `{"a","aa"}` returns `5`.
- Empty string returns `1` (one empty segmentation).
- Matches the length of the brute-force enumeration for small inputs.

---

### Task 4 — Reconstruct ONE segmentation

**Problem.** Given `s` and `wordDict`, if `s` is segmentable, output one valid segmentation as a space-joined sentence; otherwise output `NONE`. Use boolean DP with parent pointers.

**Input / Output spec.**
- Read `s`, then `d` and the dictionary words.
- Print one valid sentence or `NONE`.

**Constraints.** `0 ≤ len(s) ≤ 1000`, `1 ≤ d ≤ 1000`.

**Hint.** When `dp[i]` becomes true via split point `j`, store `from[i]=j`. Walk back from `n` following `from` to recover the words, then reverse. `O(n)` reconstruction.

**Evaluation criteria.**
- Outputs a sentence whose words are all in the dictionary and whose concatenation equals `s`.
- Outputs `NONE` when not segmentable.
- No exponential blow-up (single sentence only).

---

### Task 5 — Word Break with single-character words

**Problem.** Given `s` and a dictionary that may contain single characters, decide segmentability. Verify the inner loop reaches `j = i-1` (single-character chunks). Output `true`/`false`.

**Input / Output spec.**
- Read `s`, then `d` and the dictionary words.
- Print `true` or `false`.

**Constraints.** `0 ≤ len(s) ≤ 1000`.

**Hint.** If every character of `s` is a dictionary word, the answer is always `true`. The bug to avoid: an off-by-one that never tests length-1 chunks.

**Evaluation criteria.**
- `s="abc"`, `dict={"a","b","c"}` returns `true`.
- `s="abc"`, `dict={"ab"}` returns `false`.
- Matches the naive oracle.

---

## Intermediate Tasks (5)

### Task 6 — Trie-accelerated Word Break I

**Problem.** Decide segmentability using a Trie for the dictionary so the inner check does no substring allocation. Output `true`/`false`.

**Constraints.** `0 ≤ len(s) ≤ 10^5`, total dictionary characters `≤ 10^6`.

**Hint.** Build a Trie; for each segmentable position `i`, walk `s[i..]` down the Trie and mark `dp[i+depth]=true` at every end-of-word node. Compare results and timing against the hash-set version.

**Evaluation criteria.**
- Matches the hash-set Word Break I result exactly.
- No substring construction in the inner loop (walks characters in place).
- Measurably less allocation than the hash-set version on long strings.

---

### Task 7 — Word Break II (all sentences) with pruning

**Problem.** Return all segmentations of `s` as space-joined sentences. Prune dead branches by first checking that the remaining suffix is segmentable. Output each sentence on its own line (sorted for deterministic comparison).

**Constraints.** `0 ≤ len(s) ≤ 30`, guaranteed segmentation count `≤ 10^4`.

**Hint.** Precompute `canReachEnd[i]` (Word Break I on suffixes). In `solve(start)`, only recurse into `end` when `canReachEnd[end]`. Memoize per `start`. Base: `solve(n)=[""]`.

**Reference oracle (Python).**
```python
def brute_all(s, dict_set, start=0):
    if start == len(s):
        return [""]
    res = []
    for end in range(start + 1, len(s) + 1):
        w = s[start:end]
        if w in dict_set:
            for tail in brute_all(s, dict_set, end):
                res.append(w if not tail else w + " " + tail)
    return res
```

**Evaluation criteria.**
- Matches `brute_all` as a set of sentences for small inputs.
- Pruning skips suffixes that cannot reach the end (verify on `"aaaa…ab"`).
- Returns `[]` when not segmentable.

---

### Task 8 — Fewest words to segment

**Problem.** Given `s` and `wordDict`, output the minimum number of dictionary words needed to segment `s`, or `-1` if impossible. Use a min-DP.

**Constraints.** `0 ≤ len(s) ≤ 1000`.

**Hint.** `fewest[0]=0`; `fewest[i]=min_j(fewest[j]+1)` over `j` with `s[j..i)∈dict` and `fewest[j] != INF`. Each dictionary word is a unit-cost edge — this is shortest path on the segmentation DAG.

**Reference oracle (Python).**
```python
def brute_fewest(s, dict_set, start=0, memo=None):
    if memo is None:
        memo = {}
    if start == len(s):
        return 0
    if start in memo:
        return memo[start]
    best = float("inf")
    for end in range(start + 1, len(s) + 1):
        if s[start:end] in dict_set:
            sub = brute_fewest(s, dict_set, end, memo)
            if sub != float("inf"):
                best = min(best, sub + 1)
    memo[start] = best
    return best
```

**Evaluation criteria.**
- `s="aaaa"`, `dict={"a","aa","aaaa"}` returns `1`.
- Returns `-1` when not segmentable.
- Matches `brute_fewest` for small inputs.

---

### Task 9 — Hashtag / sentence splitter with scoring

**Problem.** Given a lowercase string `s` (no spaces) and a dictionary where each word has a positive frequency score, output the segmentation that **maximizes the total score** (sum of word scores), as a space-joined sentence; output `NONE` if not segmentable. Use a max-DP (Viterbi-style).

**Input / Output spec.**
- Read `s`, then `d`, then `d` lines each with a word and its integer score.
- Print the best-scoring sentence or `NONE`.

**Constraints.** `0 ≤ len(s) ≤ 1000`, scores in `[1, 10^6]`.

**Hint.** `best[0]=0`; `best[i]=max_j(best[j]+score(s[j..i)))` over dictionary words. Store parent pointers to reconstruct the chosen segmentation. Ties may be broken arbitrarily.

**Evaluation criteria.**
- Returns the maximum-score segmentation, reconstructed correctly.
- Returns `NONE` when not segmentable.
- Matches a brute-force max over all segmentations for small inputs.

---

### Task 10 — Word Break with a wildcard character

**Problem.** The string `s` may contain the wildcard `'.'`, which matches any single character. Decide whether `s` can be segmented into dictionary words, where a chunk `s[j..i)` matches a dictionary word if they agree on every non-wildcard position. Output `true`/`false`.

**Constraints.** `0 ≤ len(s) ≤ 300`, `1 ≤ d ≤ 1000`.

**Hint.** You can no longer use a hash set directly. For each `i`, test each dictionary word of the right length against the chunk allowing `'.'` to match anything (or use a Trie walk that treats `'.'` as "follow all children"). The DP recurrence is unchanged.

**Evaluation criteria.**
- `s="c.t"`, `dict={"cat","cot"}` returns `true`.
- `s="c.t"`, `dict={"dog"}` returns `false`.
- Matches a brute-force wildcard-aware recursion for small inputs.

---

## Advanced Tasks (5)

### Task 11 — Aho-Corasick-driven Word Break

**Problem.** Build an Aho-Corasick automaton over the dictionary, scan `s` once to find every dictionary word ending at every position, then run the prefix DP using those matches. Decide segmentability. Output `true`/`false`.

**Constraints.** `0 ≤ len(s) ≤ 10^6`, total dictionary characters `≤ 10^6`.

**Hint.** For each match `(start, end)` reported, if `dp[start]` then set `dp[end]=true`. Process matches in order of `end`. The matching phase is `O(n + total matches)`; build the automaton once and reuse it across many input strings.

**Evaluation criteria.**
- Matches the Trie / hash-set Word Break I result.
- Single linear scan of `s` for matching (no `O(n²)` re-scan).
- Automaton built once, reusable across inputs.

---

### Task 12 — Exact count via big integers and CRT

**Problem.** Compute the **exact** number of segmentations of `s` (which may exceed 64 bits). Provide two implementations: (a) big-integer counting DP, and (b) modular counting under two coprime primes (`10^9+7`, `998244353`) reconstructed via CRT. Verify they agree when the value fits below the product of the two primes.

**Constraints.** `0 ≤ len(s) ≤ 5000`, dictionary may force exponential counts.

**Hint.** The big-integer version is the source of truth. The CRT version runs the modular DP twice and combines; it is faster per-modulus but limited to values below `p₁·p₂`.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t
```

**Evaluation criteria.**
- Big-integer and CRT results agree for counts below `p₁·p₂`.
- Counts match the known closed form for `s="aaa…a"`, `dict={"a","aa"}` (Fibonacci).
- Modular runs are independent (parallelizable).

---

### Task 13 — Streaming Word Break II (first K sentences)

**Problem.** Without materializing the full (possibly exponential) list, yield the first `K` segmentations of `s` lazily, then stop. Output up to `K` sentences.

**Constraints.** `0 ≤ len(s) ≤ 100`, `1 ≤ K ≤ 100`. The total segmentation count may be exponential.

**Hint.** Use a generator (Python `yield`), or a recursion that stops once `K` sentences are produced (Go/Java: pass a counter and a callback, abort when the limit is hit). Prune with reachability so dead branches are not explored.

**Evaluation criteria.**
- Returns at most `K` sentences without computing all of them.
- Terminates quickly even when the total count is astronomically large (e.g. `"aaaa…a"`).
- Each returned sentence is a valid segmentation.

---

### Task 14 — Maximum-probability word segmentation (Viterbi)

**Problem.** Given a string `s` (no spaces) and a dictionary mapping each word to a probability (a float in `(0,1]`), output the segmentation that maximizes the **product of word probabilities** (equivalently the sum of log-probabilities), as a space-joined sentence. Output `NONE` if not segmentable. Unknown chunks are not allowed.

**Constraints.** `0 ≤ len(s) ≤ 2000`.

**Hint.** Work in log-space to avoid floating-point underflow: `best[i] = max_j (best[j] + log(prob(s[j..i))))`. Store parent pointers. This is the production word-segmentation DP used for space-less languages.

**Evaluation criteria.**
- Returns the maximum-probability segmentation, reconstructed correctly.
- Uses log-space to avoid underflow on long strings.
- Matches a brute-force max-product over all segmentations for small inputs.

---

### Task 15 — Detect when Word Break is the wrong tool / classify the variant

**Problem.** Given a problem statement summarized as constraints `(len_s, dict_size, output_mode)`, implement `classify(...)` that returns one of: `DP_BOOLEAN` (decide), `DP_COUNT` (count, polynomial), `BACKTRACK_ALL` (enumerate, exponential — guard it), `TRIE_ACCEL` (huge dict, decide), or `VITERBI` (best-scoring tokenization). Justify each.

**Constraints / cases to handle.**
- Decide segmentability, modest dict → `DP_BOOLEAN`.
- Count segmentations → `DP_COUNT` (note: take mod `p`; polynomial despite exponential count).
- Return all sentences → `BACKTRACK_ALL` (note: output-sensitive, exponential; count first, prune, stream).
- Huge dictionary, decide → `TRIE_ACCEL` (or Aho-Corasick).
- Best-scoring/most-probable tokenization → `VITERBI`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap case is `BACKTRACK_ALL`: its output can be exponential, so it must be guarded with a polynomial count first.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `BACKTRACK_ALL` branch explicitly cites the exponential output and the count-first guard.
- Justification references the right complexity (`O(n·L)` for decide/count, output-sensitive for enumerate).

---

## Benchmark Task

### Task B — Hash-set vs Trie Word Break, and counting vs enumerating

**Problem.** Empirically compare (a) hash-set Word Break I, (b) Trie Word Break I, and (c) the counting DP, against (d) full Word Break II enumeration, on a controlled family of inputs. Show that (a)-(c) are polynomial and stable while (d) explodes.

Use the input family `s = "a" * n`, `wordDict = ["a", "aa"]` for `n ∈ {10, 20, 30, 35, 40}` (the worst case for enumeration: `F(n+1)` sentences). Measure wall-clock time and, for (c), report the count; for (d), report the count of sentences produced or "OOM/timeout".

**Starter — Python.**
```python
import time
from functools import lru_cache

MOD = 1_000_000_007


def word_break_hashset(s, dict_set, max_len):
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            if dp[j] and s[j:i] in dict_set:
                dp[i] = True
                break
    return dp[n]


def count_seg(s, dict_set, max_len):
    n = len(s)
    cnt = [0] * (n + 1)
    cnt[0] = 1
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            if cnt[j] and s[j:i] in dict_set:
                cnt[i] = (cnt[i] + cnt[j]) % MOD
    return cnt[n]


def word_break_ii(s, dict_set):
    n = len(s)

    @lru_cache(maxsize=None)
    def solve(start):
        if start == n:
            return [""]
        res = []
        for end in range(start + 1, n + 1):
            w = s[start:end]
            if w in dict_set:
                for tail in solve(end):
                    res.append(w if not tail else w + " " + tail)
        return res

    return solve(0)


def main():
    dict_set = {"a", "aa"}
    max_len = 2
    print("n     decide_ms   count_ms   count     enumerate")
    for n in [10, 20, 30, 35, 40]:
        s = "a" * n
        t0 = time.perf_counter()
        word_break_hashset(s, dict_set, max_len)
        t1 = time.perf_counter()
        c = count_seg(s, dict_set, max_len)
        t2 = time.perf_counter()
        # enumerate only for small n to avoid OOM
        enum = str(len(word_break_ii(s, dict_set))) if n <= 30 else "(skipped: too many)"
        print(f"{n:<5d} {(t1-t0)*1000:<11.3f} {(t2-t1)*1000:<10.3f} {c:<9d} {enum}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same input family produces the same counts across Go, Java, and Python.
- Decide (a) and count (c) stay fast and flat as `n` grows; enumerate (d) blows up.
- The count from (c) matches `F(n+1) mod p`; the enumeration size matches `F(n+1)` for small `n`.
- Report includes timings and a note that counting is polynomial while enumerating is exponential.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every decide/count/enumerate task above ships with (or references) a slow naive recursion. Run it on small `n`, diff, and only then trust the DP/Trie version.
- **Get `dp[0] = true` (and `count[0] = 1`) right.** The most common beginner bug is forgetting the empty-prefix base case, which makes every answer false / zero.
- **Use half-open ranges `[j, i)`.** Off-by-one in the substring range is the second most common bug. `s[j:i]` (Python/Go), `s.substring(j, i)` (Java).
- **Convert the dictionary to a hash set (or Trie) once.** Never scan a list inside the loops.
- **Cap the look-back at `maxWordLen`.** No longer chunk can be a word; this gives `O(n·L)`.
- **Take counts mod a prime.** Segmentation counts grow exponentially; use big integers / CRT only when the exact value is required.
- **Guard Word Break II.** Count first (polynomial), prune dead branches, and stream or refuse above a threshold — the output can be exponential.
- **Mind encoding.** For real text, match the character unit (bytes vs runes vs code points) between `s` and the dictionary.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.

---

## Suggested Order and Difficulty Map

| Task | Topic | Difficulty | Builds on |
|------|-------|-----------|-----------|
| 1 | Hash-set membership | Beginner | — |
| 2 | Word Break I | Beginner | 1 |
| 3 | Count segmentations | Beginner | 2 |
| 4 | Reconstruct one split | Beginner | 2 |
| 5 | Single-char words | Beginner | 2 |
| 6 | Trie-accelerated WB-I | Intermediate | 2 |
| 7 | Word Break II + pruning | Intermediate | 2, 4 |
| 8 | Fewest words | Intermediate | 2 |
| 9 | Scored splitter | Intermediate | 4, 8 |
| 10 | Wildcard Word Break | Intermediate | 2, 6 |
| 11 | Aho-Corasick WB | Advanced | 6 |
| 12 | Exact count + CRT | Advanced | 3 |
| 13 | Streaming first K | Advanced | 7 |
| 14 | Viterbi segmentation | Advanced | 9 |
| 15 | Classify the variant | Advanced | all |

Work top to bottom: each task reuses the `dp` skeleton or dictionary structure of an earlier one. By Task 15 you should be able to look at a problem statement and immediately name the right variant, the right dictionary structure, and the right complexity — the goal of the whole topic.
