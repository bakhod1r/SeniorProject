# Word Break (String Segmentation DP) — Interview Preparation

Word Break is a favourite interview topic because it rewards a single crisp insight — *"`dp[i]` is true if some dictionary word ends at `i` and the prefix before it was already segmentable"* — and then tests whether you can (a) make it fast with the `O(n·L)` length cap and a hash set, (b) recognize the harder variants (return all sentences, count segmentations) and their complexity, (c) accelerate the membership check with a Trie, and (d) avoid the classic trap of materializing the exponential Word Break II output. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is `s` segmentable? (WB-I) | boolean DP `dp[i]=OR_j(dp[j] && s[j..i)∈dict)` | `O(n·L)` |
| Return all sentences (WB-II) | memoized backtracking | output-sensitive, `Θ(φⁿ)` worst |
| Count segmentations | sum DP (mod `p`) | `O(n·L)` |
| Fewest words to segment | min DP (each word cost 1) | `O(n·L)` |
| Accelerate the chunk check | Trie / Aho-Corasick | `O(n·L)`, no substring alloc |
| One segmentation only | DP + parent pointers | `O(n·L)` build, `O(n)` reconstruct |
| **Best-scoring tokenization** | Viterbi max DP | `O(n·L)` |

Semiring table (the recurrence shape is fixed; only `add`/`mul`/identity change):

```text
semiring     add    mul    zero(0̄)   one(1̄)     val(n) means
boolean      OR     AND    false     true        is s segmentable? (WB-I)
counting     +      ×      0         1            # segmentations (mod p)
min-plus     min    +      +∞        0            fewest words
viterbi      max    +      −∞        0            best-scoring split
list         ∪      prepend ∅        {""}         all sentences (WB-II)
```

Core algorithm:

```text
wordBreak(s, dict):
    dp[0..n] = false
    dp[0] = true                          # empty prefix base case
    for i in 1..n:
        for j in max(0, i-maxLen)..i-1:
            if dp[j] and s[j..i) in dict:
                dp[i] = true; break       # OR satisfied
    return dp[n]                          # O(n * maxLen)
```

Key facts:
- **`dp[i]` indexes prefix length**, not a character. `dp[0]=true` (empty prefix).
- **Cap the look-back** at `maxWordLen`: no longer chunk can be a word.
- **Counting overflows** → take mod `p`. **Enumerating** WB-II is exponential.
- A **Trie** removes the `O(L)` substring allocation per check.

---

## Junior Questions (12 Q&A)

### J1. What does `dp[i]` represent in Word Break?
`dp[i]` is a boolean: *can the prefix `s[0..i)` (the first `i` characters) be segmented into dictionary words?* The final answer is `dp[n]` where `n = len(s)`. Indexing by "characters consumed so far" is what makes the DP one-dimensional.

### J2. What is the recurrence?
`dp[i] = OR over j in [0,i) of (dp[j] AND s[j..i) ∈ dict)`. In words: the prefix up to `i` is segmentable if there is an earlier breakpoint `j` such that everything before `j` is segmentable and the chunk `s[j..i)` is a single dictionary word.

### J3. What is the base case and why?
`dp[0] = true`. The empty prefix is segmentable using zero words. Without this seed, every `dp[i]` evaluates to false and the algorithm always returns "no" — a classic bug.

### J4. Why store the dictionary in a hash set?
To make the membership test `s[j..i) ∈ dict` fast — `O(1)` average per comparison instead of `O(dict)` for a linear scan. The substring construction is still `O(L)`, so each check is `O(L)`.

### J5. What is the time complexity?
`O(n · maxWordLen)` with the length cap (or `O(n²)` without it). There are `n` end positions, each looking back over `≤ maxWordLen` split points, each check `O(L)`. The dictionary size only affects the one-time set construction.

### J6. Why can you cap the inner loop at `maxWordLen`?
No chunk longer than the longest dictionary word can ever be a word, so `s[j..i)` with `i - j > maxWordLen` can never match. Limiting `j` to `[max(0, i-maxWordLen), i)` is correct and bounds the inner loop.

### J7. What goes wrong with naive recursion (no memo)?
It is `O(2ⁿ)` — it re-solves the same suffix exponentially many times. On inputs like `"aaaa…ab"` with dict `{"a","aa","aaa",…}` it times out. Memoization or bottom-up DP fixes this.

### J8. Is the empty string segmentable?
Yes. `s = ""` has `dp[0] = dp[n] = true` (zero words segment the empty string). Return `true`.

### J9. What is the difference between top-down and bottom-up here?
Bottom-up fills `dp[0..n]` iteratively (no recursion, stack-safe). Top-down is memoized recursion `canBreak(start)` with a cache. Same `O(n·L)` complexity; bottom-up is usually cleaner for the boolean version.

### J10. How do you handle duplicate words in the dictionary?
The hash set deduplicates them automatically. No effect on correctness.

### J11. Why break early once `dp[i]` is true?
The recurrence is an OR. Once any split point makes `dp[i]` true, no other split point can change it, so you stop the inner loop — a small but free optimization.

### J12 (analysis). Why is the DP polynomial when the naive recursion is exponential?
There are only `n+1` distinct subproblems (`dp[0..n]`). Memoization/tabulation computes each once; the naive recursion recomputes shared suffixes exponentially. Caching the `n+1` overlapping subproblems is exactly what collapses `O(2ⁿ)` to `O(n·L)`.

---

## Middle Questions (12 Q&A)

### M1. Prove the recurrence is correct.
A segmentation of `s[0..i)` (for `i>0`) has a *last word* `s[j..i) ∈ dict`; removing it leaves a segmentation of `s[0..j)`, so `dp[j]` is true. Conversely, any segmentable `s[0..j)` plus a dictionary word `s[j..i)` segments `s[0..i)`. Hence `dp[i] = OR_j (dp[j] AND s[j..i)∈dict)`. The empty-prefix base `dp[0]=true` anchors the induction.

### M2. How do you return ALL segmentations (Word Break II)?
Memoized backtracking: `solve(start)` returns the list of all sentences segmenting `s[start..n)`, recursing on each dictionary word starting at `start`. Memoize per `start`. Base case `solve(n) = [""]`.

### M3. Why can Word Break II be exponential?
For `s = "aaaa…a"` and dict `{"a","aa"}`, the number of segmentations is the Fibonacci number `F(n+1) ≈ φⁿ`. With all run-length words it is `2^{n-1}`. The *output itself* is exponentially large, so no algorithm lists all sentences in polynomial time — it is output-sensitive.

### M4. How do you count segmentations without listing them?
Replace the boolean OR with integer addition: `count[i] = Σ_j (count[j] if s[j..i)∈dict else 0)`, `count[0]=1`. This is `O(n·L)` — polynomial — even though enumerating is exponential. Take it mod a prime to avoid overflow (counts grow like `φⁿ`).

### M5. How does a Trie speed up Word Break?
From each start position, walk the characters `s[start..]` down the Trie; at each end-of-word node mark `dp[start+depth] = true`. This replaces the `s[j:i] in dict` substring construction (an `O(L)` allocation each check) with pure pointer-following — same `O(n·L)` asymptotics, much better constant factor and no garbage.

### M6. When do you prefer top-down vs bottom-up?
Bottom-up for the boolean and counting versions (stack-safe, cache-friendly). Top-down for Word Break II, where the recursion tree naturally mirrors the sentence structure and you build sentence lists as you return.

### M7. How do you reconstruct just ONE segmentation?
Run WB-I but store `from[i] = j` when `dp[i]` becomes true via split `j`. Then walk back from `n` following `from` to recover the words — `O(n)`, no exponential blow-up.

### M8. How do you avoid wasted work in Word Break II?
Precompute `canReachEnd[i]` ("is `s[i..n)` segmentable?") and only recurse into split points that can reach the end. This prunes dead branches — the difference between instant return and a timeout on `"aaaa…ab"`.

### M9. What is the "count then decide" pattern?
Because counting is polynomial and enumerating is exponential, compute the count first; if it exceeds a safe threshold, refuse or stream the output instead of materializing an exponential list. Essential for any endpoint exposed to untrusted input (DoS protection).

### M10. How does Word Break relate to tokenization?
Segmenting space-less text (Chinese/Japanese), subword tokenizers (WordPiece does greedy longest-match Word Break), and lexers all use this skeleton. Real tokenizers add scoring (Viterbi max-probability DP) to resolve ambiguity among the many valid segmentations.

### M11. What is the semiring view of Word Break?
The recurrence `val(i) = ⊕_j (edge(j,i) ⊗ val(j))` works over any semiring: `(OR,AND)` decides, `(+,×)` counts, `(min,+)` finds fewest words, `(max,+)` finds best score, and the list semiring enumerates. Only the element type and operations change.

### M12 (analysis). Why is counting easy but enumerating hard?
`count[i]` is a single number satisfying a polynomial recurrence — `O(n·L)`. The set of sentences has exponentially many *elements*, so any algorithm that produces them all is `Ω(output) = Ω(φⁿ)`. The count is one number; the objects are exponentially numerous.

---

## Senior Questions (10 Q&A)

### S1. How would you handle a dictionary with millions of words?
Build a Trie (or Aho-Corasick) once, reused across queries. The hash-set version allocates `O(n²)` substrings per query (GC thrash); the Trie walks characters in place. For a fixed dictionary queried against many strings, Aho-Corasick reports all matches in `O(n + matches)` per string.

### S2. When is Aho-Corasick preferable to a plain Trie?
When the dictionary is large, stable, and queried against many input strings: its failure links let you scan each string once in `O(n + total matches)` and report every word ending at every position, decoupling matching from the DP. A plain Trie is simpler and better for one-off or small dictionaries.

### S3. How do you guard Word Break II against exponential output?
Decide first (WB-I); prune with a reachability array; count (polynomially) before enumerating; and stream or refuse above a threshold. A short adversarial string can otherwise demand exponential output — a denial-of-service vector.

### S4. How do you keep the segmentation count exact for large n?
The count grows like `φⁿ`, overflowing 64-bit around `n≈90`. Reduce mod a prime for a modular count, use big integers for the exact value, or run under several primes and combine via CRT for large exact counts. Each prime is an independent DP pass.

### S5. How do you make one implementation serve all variants?
Parameterize the DP by a semiring `(add, mul, zero, one)` and the element type. The recurrence skeleton never changes; `(OR,AND)` decides, `(+,×)` counts, `(min,+)` fewest words, `(max,+)` Viterbi best, list semiring enumerates. Store the identity per semiring so it is never mismatched.

### S6. How does Word Break power a real tokenizer?
Word segmentation for space-less languages is Word Break over a lexicon; subword tokenizers (BPE/WordPiece) do greedy or DP longest-match against a learned vocabulary; lexers match keywords/patterns. Ambiguity is resolved by a max-probability (Viterbi) DP or by returning the segmentation lattice (DAG) for downstream scoring.

### S7. How do you verify correctness when you cannot enumerate?
Keep a naive recursion oracle for tiny strings. Assert `wordBreak("")==true` and `dp[0]==true`. Cross-check the Trie result against the hash-set result. Most powerfully: the polynomial counting DP must equal `len(WordBreakII output)` on small inputs — a base-case/duplication bug shows up as a mismatch.

### S8. What are the main performance levers?
Kill substring allocation with a Trie; cap the look-back at `maxWordLen`; build the dictionary structure once and share it read-only; prune Word Break II with a reachability array; reduce the count mod `p`; and match the character encoding (bytes vs runes vs code points) between `s` and the dictionary.

### S9. How do you find the segmentation with the fewest words?
A min-DP: `fewest[i] = min_j (fewest[j] + 1)` over `j` with `s[j..i)∈dict`, `fewest[0]=0`. Each dictionary word is a unit-cost edge; this is shortest-path on the segmentation DAG, `O(n·L)`. The weighted generalization (word scores) is the Viterbi tokenization DP.

### S10 (analysis). Why is #WB in FP while counting simple paths is #P-hard?
Word Break's count `N(i)` depends only on the index `i`, not on which words were used — the recurrence is *memoryless*, with `n+1` states. Counting simple paths must track a visited set (`2^V` states), which is #P-hard. Word Break is the easy, memoryless case; its DAG is acyclic and its subproblems are independent.

---

## Professional Questions (8 Q&A)

### P1. Design a tokenization service over a fixed vocabulary handling arbitrary input strings.
Build the Trie/Aho-Corasick once at startup, shared read-only across handlers. Each request runs the prefix DP in `O(n·L)`. For ambiguity, return the best segmentation via a Viterbi max-probability DP, or the segmentation lattice (DAG) for a downstream model. Cap input length and add a timeout; refuse to enumerate all segmentations above a count threshold.

### P2. How do you report the exact number of tokenizations when it exceeds 64 bits?
The count has `Θ(n)` digits. Use big integers (DP becomes `O(n²·L/wordsize)`, still polynomial), or run the modular count under several coprime primes and reconstruct via CRT. Estimate the magnitude (e.g. `~φⁿ` for the worst case) to choose the number of primes.

### P3. Your hash-set Word Break is too slow on long strings. What do you do?
Profile — the cost is almost certainly `O(n²)` substring allocation. Switch to a Trie that walks characters in place (no allocation). Cap the look-back at `maxWordLen`. If you query the same dictionary against many strings, build Aho-Corasick once. Cache the dictionary structure; never rebuild per request.

### P4. How do you debug "Word Break returns the wrong answer" in production?
Run the naive recursion oracle on the same small input and diff. Check the three usual suspects: missing `dp[0]=true`, off-by-one in the substring range (use half-open `[j,i)`), and treating the dictionary as a list not a set. For the count version, verify it equals the enumeration count on small inputs and that you reduced mod `p`.

### P5. When is greedy longest-match the wrong tokenization strategy?
When correctness depends on global context. Greedy longest-match is fast but can mis-segment (it commits to the longest first word even when a shorter one yields the only valid or best overall split). Use the max-probability Viterbi DP when accuracy matters, and document that greedy is a heuristic.

### P6. How would you represent all segmentations without exponential memory?
Build the segmentation DAG `G_s`: vertices `0..n`, edge `j→i` for each `s[j..i)∈dict`. This is `O(n·L)` size and encodes all (exponentially many) segmentations as paths `0⇝n`. Count/shortest/best are polynomial DPs on the DAG; only full enumeration is exponential. Pass the lattice downstream instead of materializing sentences.

### P7. How do automata and regular languages connect to Word Break?
`s` is segmentable iff `s ∈ D*`, a regular language. The Trie-with-back-edges (Aho-Corasick) realizes the recognizing DFA; `dp[i]` is "is the automaton accepting after reading `s[0..i)`". The counting generating function `1/(1−Σx^ℓ)` being rational is the algebraic statement that `D*` is regular. Replacing literals with regexes generalizes to maximal-munch lexing.

### P8 (analysis). Why does the counting DP stay polynomial while the output is exponential?
The counting recurrence `count[i] = Σ_j [s[j..i)∈dict] count[j]` evaluates `n+1` numbers, each in `O(L)` work — `O(n·L)`. It computes the *number* of segmentations without constructing them. Enumeration must produce each of the (up to `2^{n-1}`) sentences, so it is `Ω(output)`. A single number satisfying a linear recurrence is cheap; the exponentially many objects it counts are not.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential algorithm with a polynomial one.
Look for a concrete story: a recursive segmentation/parsing task that timed out, the realization that subproblems overlapped (only `O(n)` distinct prefixes), adding memoization or a `dp` array, and the measured speedup. Strong answers cite verifying against the old slow version on small inputs.

### B2. A teammate's Word Break II crashed the server with an OOM. How do you handle it?
Explain the output-sensitivity calmly: for inputs like `"aaaa…a"` there are exponentially many sentences, so materializing the full list is intrinsically unsafe. The fix is to count first (polynomial), refuse or stream above a threshold, and prune dead branches. Frame it as an architecture lesson — guard the exponential output — not blame.

### B3. Design a feature that splits hashtags like `#ilovenewyork` into words.
This is Word Break over an English lexicon. Discuss the ambiguity ("newyork" vs "new york"), scoring with word frequencies (max-probability Viterbi DP) to pick the most likely split, handling unknown words (fall back to character-level or a penalty), and returning the top-K splits from the lattice. Mention case-insensitivity and the dictionary build.

### B4. How would you explain Word Break to a junior engineer?
Start from the no-spaces-sign analogy: reading `"GOODSAMARITAN"` as `"GOOD SAMARITAN"`. Then the bookmark idea: `dp[i]` says "everything up to here reads as valid words." Show the recurrence as "I can read up to `i` if a real word ends here and I could already read everything before it." Lead with the two gotchas: seed `dp[0]=true`, and Word Break II output can explode.

### B5. Your tokenization job is using too much memory at scale. How do you investigate?
Check whether you are rebuilding the Trie per request (should be built once, shared). Confirm the hash-set version is not allocating `O(n²)` substrings — switch to a Trie. For Word Break II, verify you are not materializing sentence lists — use the DAG or parent-pointer reconstruction. Profile allocations; the fix is usually structure reuse plus killing substring construction.

---

## Coding Challenges

### Challenge 1: Word Break I (decision)

**Problem.** Given a string `s` and a list of words `wordDict`, return whether `s` can be segmented into a space-separated sequence of dictionary words.

**Example.**
```text
s = "leetcode", wordDict = ["leet","code"]   -> true   ("leet code")
s = "catsandog", wordDict = ["cats","dog","sand","and","cat"] -> false
```

**Constraints.** `1 ≤ len(s) ≤ 300`, `1 ≤ len(wordDict) ≤ 1000`.

**Brute force.** Naive recursion, `O(2ⁿ)` — infeasible.

**Optimal.** Bottom-up boolean DP, `O(n · maxWordLen)`.

**Go.**
```go
package main

import "fmt"

func wordBreak(s string, wordDict []string) bool {
	dict := make(map[string]bool)
	maxLen := 0
	for _, w := range wordDict {
		dict[w] = true
		if len(w) > maxLen {
			maxLen = len(w)
		}
	}
	n := len(s)
	dp := make([]bool, n+1)
	dp[0] = true
	for i := 1; i <= n; i++ {
		start := 0
		if i-maxLen > 0 {
			start = i - maxLen
		}
		for j := start; j < i; j++ {
			if dp[j] && dict[s[j:i]] {
				dp[i] = true
				break
			}
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(wordBreak("leetcode", []string{"leet", "code"}))            // true
	fmt.Println(wordBreak("catsandog",
		[]string{"cats", "dog", "sand", "and", "cat"}))                     // false
}
```

**Java.**
```java
import java.util.*;

public class WordBreakI {
    static boolean wordBreak(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        int maxLen = 0;
        for (String w : wordDict) maxLen = Math.max(maxLen, w.length());
        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;
        for (int i = 1; i <= n; i++) {
            int start = Math.max(0, i - maxLen);
            for (int j = start; j < i; j++) {
                if (dp[j] && dict.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break;
                }
            }
        }
        return dp[n];
    }

    public static void main(String[] args) {
        System.out.println(wordBreak("leetcode", List.of("leet", "code")));   // true
        System.out.println(wordBreak("catsandog",
            List.of("cats", "dog", "sand", "and", "cat")));                   // false
    }
}
```

**Python.**
```python
def word_break(s, word_dict):
    dict_set = set(word_dict)
    max_len = max((len(w) for w in word_dict), default=0)
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            if dp[j] and s[j:i] in dict_set:
                dp[i] = True
                break
    return dp[n]


if __name__ == "__main__":
    print(word_break("leetcode", ["leet", "code"]))                          # True
    print(word_break("catsandog", ["cats", "dog", "sand", "and", "cat"]))    # False
```

---

### Challenge 2: Word Break II (all sentences)

**Problem.** Return all sentences (space-joined word sequences) that segment `s`, in any order.

**Example.**
```text
s = "catsanddog", wordDict = ["cat","cats","and","sand","dog"]
  -> ["cats and dog", "cat sand dog"]
```

**Optimal.** Memoized backtracking, output-sensitive.

**Go.**
```go
package main

import "fmt"

func wordBreakII(s string, wordDict []string) []string {
	dict := map[string]bool{}
	for _, w := range wordDict {
		dict[w] = true
	}
	memo := map[int][]string{}
	n := len(s)
	var solve func(int) []string
	solve = func(start int) []string {
		if start == n {
			return []string{""}
		}
		if v, ok := memo[start]; ok {
			return v
		}
		var res []string
		for end := start + 1; end <= n; end++ {
			w := s[start:end]
			if dict[w] {
				for _, tail := range solve(end) {
					if tail == "" {
						res = append(res, w)
					} else {
						res = append(res, w+" "+tail)
					}
				}
			}
		}
		memo[start] = res
		return res
	}
	return solve(0)
}

func main() {
	fmt.Println(wordBreakII("catsanddog",
		[]string{"cat", "cats", "and", "sand", "dog"}))
}
```

**Java.**
```java
import java.util.*;

public class WordBreakII {
    static List<String> wordBreakII(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        Map<Integer, List<String>> memo = new HashMap<>();
        return solve(s, 0, dict, memo);
    }

    static List<String> solve(String s, int start, Set<String> dict,
                              Map<Integer, List<String>> memo) {
        if (memo.containsKey(start)) return memo.get(start);
        List<String> res = new ArrayList<>();
        if (start == s.length()) {
            res.add("");
            return res;
        }
        for (int end = start + 1; end <= s.length(); end++) {
            String w = s.substring(start, end);
            if (dict.contains(w)) {
                for (String tail : solve(s, end, dict, memo))
                    res.add(tail.isEmpty() ? w : w + " " + tail);
            }
        }
        memo.put(start, res);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(wordBreakII("catsanddog",
            List.of("cat", "cats", "and", "sand", "dog")));
    }
}
```

**Python.**
```python
from functools import lru_cache


def word_break_ii(s, word_dict):
    dict_set = set(word_dict)
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
                    res.append(w if tail == "" else w + " " + tail)
        return res

    return solve(0)


if __name__ == "__main__":
    print(word_break_ii("catsanddog", ["cat", "cats", "and", "sand", "dog"]))
```

---

### Challenge 3: Count Segmentations (mod p)

**Problem.** Return the number of distinct segmentations of `s`, modulo `10^9 + 7`.

**Example.**
```text
s = "aaaa", wordDict = ["a","aa"]  -> 5   (Fibonacci-like)
```

**Optimal.** Counting DP, `O(n · maxWordLen)`.

**Go.**
```go
package main

import "fmt"

const MOD = 1_000_000_007

func countSeg(s string, wordDict []string) int64 {
	dict := map[string]bool{}
	maxLen := 0
	for _, w := range wordDict {
		dict[w] = true
		if len(w) > maxLen {
			maxLen = len(w)
		}
	}
	n := len(s)
	cnt := make([]int64, n+1)
	cnt[0] = 1
	for i := 1; i <= n; i++ {
		start := 0
		if i-maxLen > 0 {
			start = i - maxLen
		}
		for j := start; j < i; j++ {
			if cnt[j] > 0 && dict[s[j:i]] {
				cnt[i] = (cnt[i] + cnt[j]) % MOD
			}
		}
	}
	return cnt[n]
}

func main() {
	fmt.Println(countSeg("aaaa", []string{"a", "aa"})) // 5
}
```

**Java.**
```java
import java.util.*;

public class CountSeg {
    static final long MOD = 1_000_000_007L;

    static long countSeg(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        int maxLen = 0;
        for (String w : wordDict) maxLen = Math.max(maxLen, w.length());
        int n = s.length();
        long[] cnt = new long[n + 1];
        cnt[0] = 1;
        for (int i = 1; i <= n; i++) {
            int start = Math.max(0, i - maxLen);
            for (int j = start; j < i; j++) {
                if (cnt[j] > 0 && dict.contains(s.substring(j, i)))
                    cnt[i] = (cnt[i] + cnt[j]) % MOD;
            }
        }
        return cnt[n];
    }

    public static void main(String[] args) {
        System.out.println(countSeg("aaaa", List.of("a", "aa"))); // 5
    }
}
```

**Python.**
```python
MOD = 1_000_000_007


def count_seg(s, word_dict):
    dict_set = set(word_dict)
    max_len = max((len(w) for w in word_dict), default=0)
    n = len(s)
    cnt = [0] * (n + 1)
    cnt[0] = 1
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            if cnt[j] and s[j:i] in dict_set:
                cnt[i] = (cnt[i] + cnt[j]) % MOD
    return cnt[n]


if __name__ == "__main__":
    print(count_seg("aaaa", ["a", "aa"]))  # 5
```

---

### Challenge 4: Trie-Accelerated Word Break

**Problem.** Decide if `s` is segmentable, using a Trie for the dictionary so the inner check does no substring construction. Return a boolean.

**Approach.** Build a Trie of the dictionary. For each segmentable position `i`, walk `s[i..]` down the Trie; at every end-of-word node, mark the corresponding `dp` index true. `O(n · maxWordLen)`, no substring allocation.

**Go.**
```go
package main

import "fmt"

type node struct {
	ch  [26]*node
	end bool
}

func wordBreakTrie(s string, wordDict []string) bool {
	root := &node{}
	for _, w := range wordDict {
		cur := root
		for i := 0; i < len(w); i++ {
			c := w[i] - 'a'
			if cur.ch[c] == nil {
				cur.ch[c] = &node{}
			}
			cur = cur.ch[c]
		}
		cur.end = true
	}
	n := len(s)
	dp := make([]bool, n+1)
	dp[0] = true
	for i := 0; i < n; i++ {
		if !dp[i] {
			continue
		}
		cur := root
		for j := i; j < n; j++ {
			cur = cur.ch[s[j]-'a']
			if cur == nil {
				break
			}
			if cur.end {
				dp[j+1] = true
			}
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(wordBreakTrie("leetcode", []string{"leet", "code"})) // true
}
```

**Java.**
```java
import java.util.*;

public class WordBreakTrie {
    static class Node { Node[] ch = new Node[26]; boolean end; }

    static boolean wordBreakTrie(String s, List<String> wordDict) {
        Node root = new Node();
        for (String w : wordDict) {
            Node cur = root;
            for (char c : w.toCharArray()) {
                int k = c - 'a';
                if (cur.ch[k] == null) cur.ch[k] = new Node();
                cur = cur.ch[k];
            }
            cur.end = true;
        }
        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;
        for (int i = 0; i < n; i++) {
            if (!dp[i]) continue;
            Node cur = root;
            for (int j = i; j < n; j++) {
                cur = cur.ch[s.charAt(j) - 'a'];
                if (cur == null) break;
                if (cur.end) dp[j + 1] = true;
            }
        }
        return dp[n];
    }

    public static void main(String[] args) {
        System.out.println(wordBreakTrie("leetcode", List.of("leet", "code"))); // true
    }
}
```

**Python.**
```python
def word_break_trie(s, word_dict):
    root = {}
    for w in word_dict:
        node = root
        for ch in w:
            node = node.setdefault(ch, {})
        node["$"] = True  # end marker
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(n):
        if not dp[i]:
            continue
        node = root
        for j in range(i, n):
            if s[j] not in node:
                break
            node = node[s[j]]
            if node.get("$"):
                dp[j + 1] = True
    return dp[n]


if __name__ == "__main__":
    print(word_break_trie("leetcode", ["leet", "code"]))  # True
```

---

## Final Tips

- Lead with the one-liner: *"`dp[i]` is true if some dictionary word ends at `i` and the prefix before it was segmentable; fill it in `O(n·maxWordLen)`."*
- Immediately flag the two gotchas: **seed `dp[0]=true`** and **Word Break II output can be exponential**.
- If asked for *all* sentences, reach for **memoized backtracking** and mention pruning + counting first to guard the blow-up.
- For counting, note it is **polynomial** (sum DP, mod `p`) even though listing is exponential.
- Mention the **Trie** as the constant-factor optimization that removes substring allocation, and **Aho-Corasick** for huge fixed dictionaries.
- Always offer to verify against a brute-force naive recursion on small inputs, and the count-equals-enumeration invariant.
