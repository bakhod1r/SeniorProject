# Word Break (String Segmentation DP) — Middle Level

> **Focus:** Word Break **II** (return *all* valid sentences) via memoized backtracking, **counting** the number of segmentations, the **Trie** optimization that replaces hash-set substring lookups, and the precise difference between **top-down memo** and **bottom-up** DP — including why the boolean version is polynomial but the "all sentences" version can be exponential.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [The Trie Optimization](#the-trie-optimization)
6. [Counting Segmentations](#counting-segmentations)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single recurrence: `dp[i] = OR_j (dp[j] AND s[j..i) ∈ dict)` answers the yes/no question in `O(n²)`. At middle level you graduate to the questions that separate "I can fill a boolean array" from "I understand the structure of the segmentation space":

- How do you return **every** valid sentence (Word Break II), and why can there be exponentially many?
- How do you **count** the number of segmentations without enumerating them — and how to keep that count from overflowing?
- How does a **Trie** replace the repeated `s[j..i) ∈ dict` substring construction, walking characters once instead of re-hashing?
- What is the real difference between **top-down memoization** and **bottom-up** tabulation here, and when does each shine?
- Why is Word Break I polynomial while Word Break II is fundamentally output-bounded by an exponential?

These are the engineering questions that decide whether your solution is correct, fast, and memory-safe.

---

## Deeper Concepts

### Word Break II: the recurrence on *sets of sentences*

Word Break I asks "is there a segmentation?" Word Break II asks "what are *all* of them?" The natural state is:

```
ways(start) = the list of all sentences (space-joined word sequences)
              that segment the suffix s[start..n)
```

with the recurrence

```
ways(start) = ⋃ over end>start with s[start..end) ∈ dict of
                  { s[start..end) + " " + tail : tail ∈ ways(end) }
ways(n)     = { "" }     (the empty suffix has exactly one segmentation: the empty sentence)
```

This is the *same* prefix/suffix decomposition as Word Break I, except instead of OR-ing booleans we **concatenate lists of strings**. Memoize `ways(start)` so each suffix is solved once.

### Why the output is exponential

Consider `s = "aaaa…a"` (length `n`) with `dict = {"a", "aa"}`. Every way to write `n` as an ordered sum of 1s and 2s is a distinct segmentation — that count is the Fibonacci number `F(n+1)`, which grows like `φⁿ ≈ 1.618ⁿ`. For `dict = {"a", "aa", "aaa"}` the count is the Tribonacci sequence, and with all prefixes it is `2^(n-1)`. So **no algorithm can list all sentences in polynomial time** — the *output itself* is exponentially large. Word Break II is "output-sensitive": its complexity is `O(n · (number of sentences) + DP overhead)`, and the number of sentences is the unavoidable blow-up.

### The pruning trick: solve Word Break I first

A subtle but important optimization: before generating sentences, run the boolean Word Break I. If `dp[n]` is false, return the empty list immediately — no sentences exist. More importantly, during backtracking you can consult a "is the suffix from here reachable to the end" array to **prune dead branches** that would otherwise waste time exploring suffixes that can never complete. Without this guard, inputs like `"aaaa…ab"` (segmentable prefix, dead end at the final `b`) explode into wasted recursion even though the answer set is empty.

### Top-down vs bottom-up, precisely

| Aspect | Top-down (memoized recursion) | Bottom-up (tabulation) |
|--------|-------------------------------|------------------------|
| Direction | Solves `ways(start)` / `dp[i]` lazily, on demand | Fills `dp[0..n]` in fixed order |
| Computes | Only states actually reached | Every state, reached or not |
| Word Break I | Natural as `canBreak(start)` with a cache | Natural as the forward `dp` array |
| Word Break II | Natural — recursion builds sentence lists | Awkward — must store lists per index |
| Stack risk | Deep recursion can overflow for large `n` | No recursion; iterative |
| Cache | Explicit memo map/array | The `dp` table itself |

For the **boolean** version, bottom-up is usually cleaner and avoids stack risk. For the **all-sentences** version, top-down memoized recursion is far more natural because the recursion tree mirrors the sentence structure.

---

## Comparison with Alternatives

### Word Break I solution strategies

| Approach | Time | Space | Good when |
|----------|------|-------|-----------|
| Naive recursion (no memo) | `O(2ⁿ)` | `O(n)` stack | never — exponential trap |
| Memoized recursion | `O(n² · L)` | `O(n)` cache | natural recursive style |
| Bottom-up hash-set DP | `O(n · L)` capped, else `O(n²)` | `O(n)` | the default; cache-friendly |
| Trie-accelerated DP | `O(n · L)` (no substring alloc) | `O(dict chars)` | many lookups, long words, big dict |
| BFS over positions | `O(n · L)` | `O(n)` | "shortest segmentation" variants |

The crossover is mostly about constant factors: the Trie avoids substring allocation and hashing, which dominates the hash-set version's hidden cost.

### Word Break II solution strategies

| Approach | Output complexity | Notes |
|----------|-------------------|-------|
| Memoized backtracking (returns sentence lists) | `O(n · #sentences)` | the standard answer; prune with WB-I first |
| DFS without memo | up to `O(2ⁿ · n)` | recomputes shared suffixes — avoid |
| Generator / lazy iterator | `O(1)` to start, output on demand | best when caller wants only the first few sentences |

When the caller only needs *one* sentence or the *count*, never materialize the full list — use Word Break I plus a parent pointer (reconstruct one) or the counting DP (count many).

---

## Advanced Patterns

### Pattern: Memoized backtracking for all sentences

The recursion returns, for each `start`, the cached list of all sentences segmenting `s[start..n)`. Memoization ensures shared suffixes are built once.

### Pattern: Reconstruct ONE segmentation cheaply

If you only need a single valid split (not all), run Word Break I but store a `from[i]` parent pointer: when `dp[i]` becomes true via split point `j`, set `from[i] = j`. Then walk back from `n` to `0` following `from` to recover the words — `O(n)` reconstruction, no exponential blow-up.

### Pattern: Prune with a reachability suffix array

Precompute `canReachEnd[i]` = "is `s[i..n)` segmentable?" (this is Word Break I run on suffixes, or equivalently `dp` over the reversed problem). During Word Break II backtracking, only recurse into `end` if `canReachEnd[end]` is true. This eliminates dead-end exploration.

---

## The Trie Optimization

A **Trie** (prefix tree) stores the dictionary so that, starting from any position `start`, you can walk the characters `s[start], s[start+1], …` down the tree and discover *every* dictionary word that starts at `start` in a single left-to-right pass — without ever constructing a substring or hashing it.

```
Trie of {"apple", "app", "pie"}:

        (root)
       /      \
      a        p
      |        |
      p        i
      |        |
      p*       e*
      |
      l
      |
      e*

(* marks end-of-word)
```

To find all words starting at `start`, descend from the root following `s[start..]`; whenever you hit an `end-of-word` node at depth `d`, you have found the word `s[start..start+d)`. This replaces the inner loop's `s[j:i] in dict_set` (which builds and hashes a substring each time) with pure pointer-following — `O(maxWordLen)` per starting position, no allocation.

The Trie shines when:

- The dictionary is large (substring hashing has high constant factor).
- Words are long (substring construction is `O(L)` each).
- You query the same string many times against the same dictionary.

The asymptotic bound is the same `O(n · L)`, but the constant factor and the allocation pressure drop dramatically — which is why production tokenizers and the senior-level Aho-Corasick approach (see `senior.md`) build on this idea.

---

## Counting Segmentations

To count the number of distinct segmentations (without listing them), replace the boolean OR with integer addition:

```
count[i] = Σ over j in [0, i) of ( count[j] if s[j..i) ∈ dict else 0 )
count[0] = 1     (empty prefix: exactly one segmentation, the empty one)
answer   = count[n]
```

`count[i]` is the number of ways to segment the prefix `s[0..i)`. This is the same DP shape as Word Break I, with `+` in place of OR and `1` in place of `true`. **Crucial caveat:** the count grows exponentially (Fibonacci-like for `{"a","aa"}`), so for large `n` you must take the count **modulo a prime** like `10⁹ + 7`, exactly as with other counting DPs, or use big integers if the exact value is needed.

This counting DP is `O(n²)` (or `O(n·L)`) — polynomial — even though *listing* the segmentations is exponential. Counting and enumerating are very different costs: you can count `1.6ⁿ` segmentations in polynomial time, but you cannot print them all in polynomial time.

---

## Code Examples

### Word Break II — memoized backtracking (all sentences)

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

func wordBreakII(s string, wordDict []string) []string {
	dict := make(map[string]bool)
	for _, w := range wordDict {
		dict[w] = true
	}
	memo := make(map[int][]string)
	n := len(s)

	var solve func(start int) []string
	solve = func(start int) []string {
		if start == n {
			return []string{""} // empty suffix: one empty sentence
		}
		if v, ok := memo[start]; ok {
			return v
		}
		var res []string
		for end := start + 1; end <= n; end++ {
			word := s[start:end]
			if dict[word] {
				for _, tail := range solve(end) {
					if tail == "" {
						res = append(res, word)
					} else {
						res = append(res, word+" "+tail)
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
	out := wordBreakII("catsanddog",
		[]string{"cat", "cats", "and", "sand", "dog"})
	fmt.Println(strings.Join(out, " | ")) // "cats and dog | cat sand dog"
}
```

#### Java

```java
import java.util.*;

public class WordBreakII {
    static Map<Integer, List<String>> memo = new HashMap<>();

    static List<String> wordBreakII(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        memo.clear();
        return solve(s, 0, dict);
    }

    static List<String> solve(String s, int start, Set<String> dict) {
        if (memo.containsKey(start)) return memo.get(start);
        List<String> res = new ArrayList<>();
        if (start == s.length()) {
            res.add(""); // empty suffix
            return res;
        }
        for (int end = start + 1; end <= s.length(); end++) {
            String word = s.substring(start, end);
            if (dict.contains(word)) {
                for (String tail : solve(s, end, dict)) {
                    res.add(tail.isEmpty() ? word : word + " " + tail);
                }
            }
        }
        memo.put(start, res);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(wordBreakII("catsanddog",
            List.of("cat", "cats", "and", "sand", "dog")));
        // [cats and dog, cat sand dog]
    }
}
```

#### Python

```python
from functools import lru_cache


def word_break_ii(s, word_dict):
    dict_set = set(word_dict)
    n = len(s)

    @lru_cache(maxsize=None)
    def solve(start):
        if start == n:
            return [""]  # empty suffix -> one empty sentence
        res = []
        for end in range(start + 1, n + 1):
            word = s[start:end]
            if word in dict_set:
                for tail in solve(end):
                    res.append(word if tail == "" else word + " " + tail)
        return res

    return solve(0)


if __name__ == "__main__":
    print(word_break_ii("catsanddog",
                        ["cat", "cats", "and", "sand", "dog"]))
    # ['cats and dog', 'cat sand dog']
```

### Counting segmentations (mod p)

#### Python

```python
MOD = 1_000_000_007


def count_segmentations(s, word_dict):
    dict_set = set(word_dict)
    max_len = max((len(w) for w in word_dict), default=0)
    n = len(s)
    count = [0] * (n + 1)
    count[0] = 1  # empty prefix: one segmentation
    for i in range(1, n + 1):
        start = max(0, i - max_len)
        for j in range(start, i):
            if count[j] and s[j:i] in dict_set:
                count[i] = (count[i] + count[j]) % MOD
    return count[n]


if __name__ == "__main__":
    print(count_segmentations("aaaa", ["a", "aa"]))  # 5 (Fibonacci-like)
```

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func countSegmentations(s string, wordDict []string) int64 {
	dict := make(map[string]bool)
	maxLen := 0
	for _, w := range wordDict {
		dict[w] = true
		if len(w) > maxLen {
			maxLen = len(w)
		}
	}
	n := len(s)
	count := make([]int64, n+1)
	count[0] = 1
	for i := 1; i <= n; i++ {
		start := 0
		if i-maxLen > 0 {
			start = i - maxLen
		}
		for j := start; j < i; j++ {
			if count[j] > 0 && dict[s[j:i]] {
				count[i] = (count[i] + count[j]) % MOD
			}
		}
	}
	return count[n]
}

func main() {
	fmt.Println(countSegmentations("aaaa", []string{"a", "aa"})) // 5
}
```

#### Java

```java
import java.util.*;

public class CountSegmentations {
    static final long MOD = 1_000_000_007L;

    static long count(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        int maxLen = 0;
        for (String w : wordDict) maxLen = Math.max(maxLen, w.length());
        int n = s.length();
        long[] cnt = new long[n + 1];
        cnt[0] = 1;
        for (int i = 1; i <= n; i++) {
            int start = Math.max(0, i - maxLen);
            for (int j = start; j < i; j++) {
                if (cnt[j] > 0 && dict.contains(s.substring(j, i))) {
                    cnt[i] = (cnt[i] + cnt[j]) % MOD;
                }
            }
        }
        return cnt[n];
    }

    public static void main(String[] args) {
        System.out.println(count("aaaa", List.of("a", "aa"))); // 5
    }
}
```

### Trie-accelerated Word Break I

#### Python

```python
class TrieNode:
    __slots__ = ("children", "end")

    def __init__(self):
        self.children = {}
        self.end = False


def build_trie(words):
    root = TrieNode()
    for w in words:
        node = root
        for ch in w:
            node = node.children.setdefault(ch, TrieNode())
        node.end = True
    return root


def word_break_trie(s, word_dict):
    root = build_trie(word_dict)
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(n):
        if not dp[i]:
            continue
        node = root
        # walk characters from i, marking dp[j] at every end-of-word
        for j in range(i, n):
            ch = s[j]
            if ch not in node.children:
                break
            node = node.children[ch]
            if node.end:
                dp[j + 1] = True
    return dp[n]


if __name__ == "__main__":
    print(word_break_trie("leetcode", ["leet", "code"]))  # True
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Word Break II OOMs | Materialized exponentially many sentences. | Use a generator, or only return the count / one sentence. |
| Count overflows 64-bit | Number of segmentations grows like `φⁿ`. | Reduce mod a prime, or use big integers if exact. |
| Memo not cleared between calls | Stale cache from a previous input. | Reset the memo per top-level call. |
| Trie misses a word | Forgot to mark `node.end = true` at the last char. | Mark end-of-word on every inserted word. |
| Empty-suffix base wrong in WB-II | Returned `[]` instead of `[""]` for `start == n`. | The empty suffix has exactly one (empty) sentence. |
| Dead-branch explosion | No reachability pruning in WB-II. | Precompute `canReachEnd[i]`, skip unreachable ends. |

---

## Performance Analysis

| Input | Word Break I | Count segmentations | Word Break II (list all) |
|-------|--------------|---------------------|--------------------------|
| `"leetcode"`, small dict | `O(n·L)`, instant | `O(n·L)`, instant | small list, instant |
| `"aaaa…a"` (n=40), `{"a","aa"}` | `O(n·L)`, instant | `O(n·L)`, instant (count = `F(41)`) | **`F(41) ≈ 1.6e8` sentences — OOM** |
| Long string, big dict | `O(n·L)` with Trie, no alloc | same | output-bounded |

The lesson: **deciding** and **counting** are polynomial; **enumerating** is exponential in the worst case. For the `"aaaa…"` family, Word Break I and the counting DP finish instantly, but listing every sentence is hopeless because there are exponentially many. Always ask the caller whether they need the boolean, the count, one sentence, or all sentences — the right algorithm depends entirely on that.

```python
# The Trie version avoids per-check substring allocation:
# hash-set version: s[j:i] builds a new string of length (i-j) every check.
# trie version: walks existing characters, no new strings. Big constant-factor win.
```

The single biggest constant-factor win for repeated queries on the same dictionary is building the Trie once and reusing it, plus pruning Word Break II with the reachability array so dead suffixes are never explored.

---

## Best Practices

- **Pick the variant deliberately:** boolean (`dp`), count (sum DP, mod `p`), one sentence (parent pointers), or all sentences (memoized backtracking).
- **Prune Word Break II** by first checking Word Break I and using a `canReachEnd` suffix array.
- **Use a Trie** when the dictionary is large or words are long, to kill substring allocation.
- **Take the count mod a prime** — segmentation counts grow exponentially and overflow fast.
- **Prefer bottom-up for the boolean version** (no stack risk); **top-down recursion for all-sentences** (mirrors the structure).
- **Always test against the naive recursion oracle** on short random strings.
- **Cap the look-back at `maxWordLen`** in every variant.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level relevance:
> - Watch the `dp` boolean array fill in left to right as each end index `i` is scanned.
> - See candidate chunks `s[j..i)` tested against the dictionary and `dp[i]` light up green when segmentable.
> - The final reconstructed segmentation shows *one* sentence; Word Break II would branch into all of them — visibly exponential on `"aaaa…"`.

---

## Variant Decision Guide

| The caller wants… | Use | Complexity | Notes |
|-------------------|-----|-----------|-------|
| yes/no segmentable | boolean DP | `O(n·L)` | bottom-up, stack-safe |
| how many segmentations | counting DP | `O(n·L)` | take mod `p` |
| one segmentation | DP + parent pointers | `O(n·L)` | `O(n)` reconstruct |
| all segmentations | memoized backtracking | output-sensitive | prune + count first |
| fast on huge dict | Trie DP | `O(n·L)` | no substring alloc |

Pick deliberately: returning all sentences when the caller only wanted the count can turn a microsecond query into an out-of-memory crash on adversarial input.

---

## Summary

Word Break II returns *all* segmentations via memoized backtracking on the same prefix/suffix decomposition as Word Break I, but with list concatenation instead of boolean OR — and its output can be exponentially large (Fibonacci-like for `{"a","aa"}`), so it is fundamentally output-bounded. **Counting** the segmentations uses the identical DP shape with `+` replacing OR and must be taken mod a prime to avoid overflow; counting is polynomial even though enumerating is not. The **Trie** replaces repeated `s[j..i) ∈ dict` substring hashing with a single character walk per starting position, the same `O(n·L)` asymptotics but far better constants. **Top-down memoization** is natural for all-sentences (the recursion mirrors sentence structure), while **bottom-up** tabulation is cleaner and stack-safe for the boolean and counting versions. Master these four variants and you can answer "yes/no", "how many", "give me one", or "give me all" — each with the right algorithm.
