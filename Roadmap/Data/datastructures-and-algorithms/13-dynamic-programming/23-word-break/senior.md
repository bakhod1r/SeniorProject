# Word Break (String Segmentation DP) — Senior Level

> Word Break is a textbook DP on a whiteboard — but the moment the dictionary holds millions of entries, the input is adversarial, the segmentation count explodes, or the same string-splitting logic powers a real tokenizer/NLP pipeline, every detail (Trie vs Aho-Corasick, substring allocation, exponential output guards, modular counting, failure modes) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Huge Dictionaries: Trie and Aho-Corasick](#2-huge-dictionaries-trie-and-aho-corasick)
3. [Avoiding Exponential Blow-Up](#3-avoiding-exponential-blow-up)
4. [Tokenization and NLP Relevance](#4-tokenization-and-nlp-relevance)
5. [Modular and Big-Integer Counting at Scale](#5-modular-and-big-integer-counting-at-scale)
6. [Memory and Allocation Engineering](#6-memory-and-allocation-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "what system am I building, and what breaks when I scale it?". Word Break shows up in three guises that look different but share one engine:

1. **Feasibility / counting under a fixed vocabulary** — "can this be tokenized?", "how many tokenizations?". The dictionary may be huge; the answer is a boolean or an exact (often modular) count.
2. **Enumeration with an exponential ceiling** — "give me all segmentations", where the output itself can be exponential and must be guarded, streamed, or capped.
3. **Real text segmentation / tokenization** — word segmentation for languages without spaces (Chinese, Japanese, Thai), subword tokenization (BPE/WordPiece), and lexer construction, where Word Break is the skeleton and the scoring/ambiguity resolution is the production complication.

All three reduce to: *build a fast membership/longest-match structure over the dictionary, run the prefix DP, and choose the right output mode (decide / count / one / all).* The senior decisions are: which dictionary structure (hash set, Trie, Aho-Corasick), how to keep enumeration from exploding, how to keep the count exact and overflow-free, and how to make the inner loop allocation-free.

---

## 2. Huge Dictionaries: Trie and Aho-Corasick

### 2.1 Why the hash set degrades

The hash-set DP does `s[j:i] in dict` for each `(j, i)`. Each check **constructs a substring** (`O(L)` allocation + copy) and hashes it (`O(L)`). For a long string against a big dictionary, this allocation churn dominates — `O(n²)` substring builds, each producing garbage for the collector. The asymptotics hide a brutal constant factor.

### 2.2 The Trie: longest-match without allocation

A Trie over the dictionary lets you, from each start position, walk `s[start], s[start+1], …` down the tree and emit every dictionary word starting there — *zero substring allocation*, pure pointer-following. From a segmentable position `i`, descend the Trie along `s[i..]`; at every end-of-word node at depth `d`, mark `dp[i + d] = true`. This is the standard production upgrade and the basis for everything below. Build cost is `O(total dictionary characters)`; query is `O(maxWordLen)` per start, `O(n · maxWordLen)` overall, with no per-check garbage.

### 2.3 Aho-Corasick: all matches in one pass

When you want *all* dictionary words ending at *every* position of `s` in a single linear scan, **Aho-Corasick** is the tool. It is a Trie augmented with **failure links** (like KMP, but over the whole dictionary), letting you scan `s` once in `O(n + total matches)` and report, at each position `i`, every dictionary word that ends at `i`. Feed those matches into the DP: for each match `(start, end)`, if `dp[start]` then set `dp[end] = true`. This decouples matching (`O(n + Σ matches)`) from the DP and is ideal when the dictionary is fixed and reused across many input strings.

The trade-off: Aho-Corasick has higher build complexity and memory (failure links, output links) than a plain Trie. Use it when the dictionary is large, stable, and queried against many strings; use a plain Trie for one-off or smaller dictionaries.

### 2.3a Choosing the dictionary structure — a decision table

| Structure | Build | Per-query | Memory | Best for |
|-----------|-------|-----------|--------|----------|
| Hash set + substring | `O(‖D‖)` | `O(n²)` substrings | `O(‖D‖)` | tiny inputs, prototypes |
| Hash set + rolling hash | `O(‖D‖)` | `O(n·L)` expected | `O(‖D‖)` | medium, want no Trie code |
| Trie | `O(‖D‖)` | `O(n·L)`, no alloc | `O(‖D‖)` nodes | the default production choice |
| Aho-Corasick | `O(‖D‖)` + links | `O(n + matches)` | larger (links) | huge fixed dict, many strings |
| DAWG / radix | `O(‖D‖)` | `O(n·L)` | far smaller | natural-language lexicons |
| Succinct (LOUDS) | `O(‖D‖)` | `O(n·L)` × small const | near-optimal bits | memory-constrained, web-scale |

The recurrence never changes; only this oracle does. Treat it as a pluggable interface so you can swap a hash set for a Trie for Aho-Corasick without touching the DP — the same abstraction-boundary discipline as the semiring choice.

### 2.4 Compressed and external dictionaries

For dictionaries too large for RAM (web-scale vocabularies), options include:

- **Compressed tries (radix trees / DAWG)** — collapse single-child chains and share suffixes; a **DAWG** (directed acyclic word graph) merges equivalent suffixes for major memory savings on natural-language lexicons.
- **Succinct tries** (LOUDS, etc.) — store the structure in near information-theoretic minimum space, trading a small constant-factor query slowdown for huge memory wins.
- **Sharded / external membership** — for truly massive vocabularies, a bloom filter front-end (to reject non-words cheaply) backed by an on-disk or distributed exact set.

The DP recurrence never changes; only the membership/longest-match oracle does. This is the same abstraction-boundary discipline as choosing a semiring in matrix problems — keep the DP generic over the dictionary structure.

---

## 3. Avoiding Exponential Blow-Up

### 3.1 The output-sensitivity wall

Word Break II is **output-sensitive**: its complexity is `Ω(total length of all sentences)`, which for `"aaaa…a"` with `{"a","aa"}` is `Θ(n · φⁿ)`. No cleverness escapes this — the answer set is exponentially large. The senior responsibility is to never *accidentally* trigger it.

### 3.2 Guards before you enumerate

1. **Decide first.** Run Word Break I. If `dp[n]` is false, return empty immediately.
2. **Prune with reachability.** Precompute `canReachEnd[i]` (= "is `s[i..n)` segmentable?"). During backtracking, only recurse into `end` when `canReachEnd[end]`. This eliminates dead-end branches that produce nothing — the difference between instant failure and a timeout on `"aaaa…ab"`.
3. **Cap or stream.** If the caller wants "up to `K` sentences" or "the lexicographically first", do **not** materialize the whole list — use a generator/iterator that yields on demand and stops after `K`.
4. **Detect the blow-up early.** The counting DP (`O(n·L)`, polynomial) tells you *how many* sentences exist before you try to list them. If the count exceeds a threshold, refuse or switch to streaming.

### 3.3 The count-then-decide pattern

Because counting is polynomial and enumerating is exponential, a robust API computes the count first (mod a large prime, or exactly with big integers if it fits), and only enumerates when the count is small enough to be safe. This is the single most important architectural decision for any Word Break II endpoint exposed to untrusted input — it is a denial-of-service vector otherwise (a short adversarial string can demand exponential output).

### 3.4 A worked blow-up: `"aaaa…a"`

Concretely, `s = "a" * 40`, `D = {"a", "aa"}`:

```
decide  (WB-I):     true,  instant (O(n·L))
count   (#WB):      F(41) = 165,580,141  ... in O(n·L), instant
enumerate (WB-II):  165,580,141 sentences, each ~40 chars
                    => ~6.6 GB of output text. OOM on any normal machine.
```

The decision and the count both finish in microseconds; the enumeration is physically impossible to materialize. A naive `wordBreakII` call on this input takes down the process. The count (cheaply computed first) tells you *in advance* that enumeration is unsafe. This is why the senior rule is absolute: **never call the enumerator without a count guard.**

### 3.5 The reachability pruning, with code

```python
def reachable_to_end(s, dict_set, max_len):
    n = len(s)
    reach = [False] * (n + 1)
    reach[n] = True  # empty suffix is segmentable
    for i in range(n - 1, -1, -1):
        for end in range(i + 1, min(n, i + max_len) + 1):
            if s[i:end] in dict_set and reach[end]:
                reach[i] = True
                break
    return reach  # reach[i] == "is s[i..n) segmentable?"
```

During Word Break II backtracking, recurse into `end` only when `reach[end]` is true. On `"aaaa…ab"` (segmentable prefix, dead `b`), `reach[0]` is false, so the entire search is cut at the root — `O(n)` instead of an exponential dead-end walk.

---

## 4. Tokenization and NLP Relevance

### 4.1 Word segmentation for space-less languages

Chinese, Japanese, and Thai text has no spaces; segmenting it into words is *exactly* Word Break, with the lexicon as the dictionary. The naive Word Break is ambiguous (many valid segmentations), so production systems add **scoring**: choose the segmentation that maximizes a probability (e.g., the product of unigram word frequencies, or an HMM/CRF score). The DP recurrence changes from boolean OR to a max over scores — a min-plus/Viterbi-style DP:

```
best[i] = max over j of ( best[j] + logProb(s[j..i)) ),  if s[j..i) ∈ lexicon
```

This is the **maximum-probability / longest-matching / shortest-path** segmentation, and it is the same prefix DP with a scoring semiring instead of booleans.

### 4.2 Subword tokenization (BPE, WordPiece, SentencePiece)

Modern NLP tokenizers (used by LLMs) segment words into subword units from a learned vocabulary. WordPiece, in particular, does **greedy longest-match Word Break** against its vocabulary (with a special continuation prefix like `##`). The DP/greedy-segmentation skeleton is identical; the vocabulary is learned rather than given. Understanding Word Break is directly understanding how a tokenizer splits text into the tokens an LLM consumes.

### 4.3 Lexing / regex tokenization

A lexer splits source code into tokens by matching against token patterns. When patterns are literal keywords/identifiers, this is Word Break with the keyword set as the dictionary; with regular expressions it generalizes to maximal-munch matching against a DFA. The connection: **Word Break is the literal-dictionary special case of regular-expression tokenization**, and the Trie/Aho-Corasick acceleration is the literal-set analogue of the DFA the regex engine builds.

### 4.4 The ambiguity problem

Real tokenization must resolve ambiguity, which pure Word Break does not. Strategies: greedy longest-match (fast, sometimes wrong), maximum-probability DP (Viterbi), or returning the full lattice of segmentations (the Word Break II output as a DAG) for a downstream model to score. The **segmentation lattice** — a DAG where edges are dictionary matches — is the compact representation of all segmentations without exponential enumeration, and it is what production NLP pipelines actually pass downstream.

### 4.5 Worked Viterbi segmentation

Maximum-probability segmentation in log-space (the production word-segmentation DP):

```python
import math

def best_segmentation(s, log_prob, max_len):
    """log_prob: dict word -> log probability. Returns the most likely split."""
    n = len(s)
    NEG = float("-inf")
    best = [NEG] * (n + 1)
    parent = [-1] * (n + 1)
    best[0] = 0.0
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            w = s[j:i]
            if best[j] != NEG and w in log_prob:
                score = best[j] + log_prob[w]
                if score > best[i]:
                    best[i] = score
                    parent[i] = j
    if best[n] == NEG:
        return None  # not segmentable
    words, i = [], n
    while i > 0:
        words.append(s[parent[i]:i])
        i = parent[i]
    return list(reversed(words))


# For "thtable" with P("the")>P("th"), the high-prob words win the max.
```

The recurrence is the `(max, +)` semiring over log-probabilities; working in log-space avoids the floating-point underflow that multiplying many small probabilities would cause. This is exactly how a tokenizer picks the most likely segmentation of space-less text among the (possibly exponentially many) valid ones — without enumerating them.

---

## 5. Modular and Big-Integer Counting at Scale

### 5.1 Overflow budget

The number of segmentations grows like `φⁿ` (or faster), overflowing 64-bit integers around `n ≈ 90` for the `{"a","aa"}` family. Two strategies:

- **Modular count:** reduce `count[i]` mod a prime (`10⁹+7`) at every addition. Always safe, gives the count mod `p`.
- **Big integers:** when the *exact* count is required (e.g., reporting "there are N tokenizations"), use arbitrary-precision integers; each addition is `O(digits)` and `digits = Θ(n)`, so the DP becomes `O(n² · n / wordsize)` — still polynomial, but no longer linear in arithmetic.

### 5.2 CRT for large exact counts

As with other counting DPs, if you need an exact count larger than one prime can represent but want to avoid full big-integer cost, run the modular count under several coprime primes and reconstruct via CRT. Each prime is an independent DP pass — embarrassingly parallel.

### 5.3 Counting the *shortest* or *longest* segmentation

Beyond counting *all* segmentations, you often want the segmentation with **fewest words** (`min` DP) or **most words** (`max` DP):

```
fewest[i] = min over j of ( fewest[j] + 1 ),  if s[j..i) ∈ dict
fewest[0] = 0
```

This is a shortest-path-style DP (each dictionary word is a unit-cost edge); it answers "minimum number of words to tile `s`" in `O(n·L)`. The scoring/probability variant of Section 4.1 is the weighted generalization.

### 5.4 Which query, which DP — a quick map

| Business question | DP variant | Semiring |
|-------------------|-----------|----------|
| "Is this a valid token stream?" | boolean | `(OR, AND)` |
| "How many ways to tokenize?" | counting (mod `p`) | `(+, ×)` |
| "Fewest tokens?" | min DP | `(min, +1)` |
| "Most likely tokenization?" | Viterbi (log-prob) | `(max, +)` |
| "Give me one tokenization" | boolean + parent ptrs | `(OR, AND)` |
| "Give me all tokenizations" | backtracking (guarded!) | list |

Pin down which of these the requirement actually asks for *before* writing code — the wrong choice (e.g. enumerating when they only wanted the count) is the most common and most expensive senior-level mistake here.

---

## 6. Memory and Allocation Engineering

### 6.1 Kill substring allocation

The dominant hidden cost in the hash-set DP is `s[j:i]` substring construction — `O(n²)` allocations. The Trie walk eliminates this entirely (it follows characters in place). In Go, prefer indexing `s[j]` byte-by-byte over slicing; in Java, the Trie avoids `String.substring`; in Python, the Trie avoids slice objects.

### 6.2 The `dp` array

The boolean `dp` is `O(n)` — negligible. For Word Break II, the memo stores lists of sentences per index, which is where memory explodes. Prefer:

- **Storing the DAG of matches** (`O(n + matches)`) instead of materialized sentences.
- **Reconstructing on demand** from parent pointers rather than caching full sentence lists.

### 6.3 Reuse the dictionary structure

Build the Trie/Aho-Corasick **once** and reuse it across all queries. A classic production regression is rebuilding the dictionary structure per request — wasting `O(dict)` build time and allocating fresh nodes each call. The structure is read-only after construction, so it is trivially shareable across threads and request handlers.

### 6.4 Encoding and Unicode

For real text, "character" is ambiguous: bytes vs runes vs grapheme clusters. Word Break must agree with the dictionary's notion of a character. In Go, iterate runes (not bytes) for multi-byte UTF-8; in Java, beware surrogate pairs; in Python, strings are already code points. Mismatched encoding between `s` and the dictionary is a silent correctness bug — the Trie walk follows the wrong units.

### 6.5 Allocation comparison, measured

The difference between the hash-set and Trie versions is almost entirely allocation, not asymptotics:

| Version | Substring allocations | GC pressure | Wall-clock (n=10⁵, big dict) |
|---------|-----------------------|-------------|------------------------------|
| Hash set + `s[j:i]` | `O(n·L)` per query | high | seconds, GC-bound |
| Trie walk | `0` | minimal | tens of ms |

```go
// HOT PATH ANTI-PATTERN: allocates a fresh string every inner iteration.
if dict[s[j:i]] { dp[i] = true }   // s[j:i] is a new string each time

// PREFERRED: walk the trie, follow bytes in place, zero allocation.
node = node.children[s[j]]          // no new string built
```

For a service processing many requests, this allocation difference is the gap between meeting and missing a latency SLO. Always prefer the in-place Trie walk on the hot path, and build the Trie once at startup.

### 6.6 Cross-query caching with a shared dictionary

When many queries hit the *same* dictionary (a tokenizer service, an autocomplete backend), the dictionary structure is shared (Section 6.3) but the per-string `dp` is not — yet repeated or overlapping inputs recur. Two complementary caches help:

- **Result cache (string → answer).** Memoize the boolean/count answer keyed by the input string. For a hot working set (popular queries), an LRU turns an `O(n·L)` recompute into an `O(1)` lookup. The key insight: the answer is a pure function of `(string, dictionary version)`, so the cache must be **invalidated on dictionary mutation** — bump a version counter on every dictionary update and fold it into the key, or the cache will serve stale segmentability after a word is added/removed.
- **Incremental segmentation (append-only streaming).** When a string grows by appending characters (a streaming tokenizer fed one chunk at a time), the prefix DP is *monotone*: `dp[0..n]` computed for the old prefix is still valid; appending `m` characters only requires filling `dp[n+1..n+m]`, reusing the retained `dp` array. This makes incremental work `O(m·L)` per append instead of recomputing `O((n+m)·L)` from scratch — the same forward-only structure that lets the DP extend without revisiting decided cells.

A streaming segmenter therefore keeps the shared read-only Trie plus a per-stream `dp` slice that it grows in place. The result cache sits in front for whole-string repeats; the incremental `dp` handles the grow-by-suffix case. Both depend on the dictionary being immutable for the lifetime of a cached answer.

```go
// Incremental, append-only Word Break: extend dp without recomputing the prefix.
type Segmenter struct {
	root *trieNode
	s    []byte
	dp   []bool // dp[k] = s[:k] segmentable; len(dp) == len(s)+1
}

func NewSegmenter(root *trieNode) *Segmenter {
	return &Segmenter{root: root, dp: []bool{true}} // dp[0] = true
}

// Append one chunk; only fills the new dp cells, reusing the old prefix DP.
func (sg *Segmenter) Append(chunk []byte) bool {
	old := len(sg.s)
	sg.s = append(sg.s, chunk...)
	n := len(sg.s)
	for len(sg.dp) <= n {
		sg.dp = append(sg.dp, false)
	}
	for i := 0; i < n; i++ {
		if !sg.dp[i] {
			continue
		}
		node := sg.root
		for j := i; j < n; j++ {
			node = node.children[sg.s[j]]
			if node == nil {
				break
			}
			if node.end && j+1 > old { // only newly reachable cells
				sg.dp[j+1] = true
			}
		}
	}
	return sg.dp[n]
}
```

```java
// LRU result cache keyed by (string, dictionary version) for a shared dictionary.
import java.util.*;

public class CachedWordBreak {
    private final Node root;          // shared, read-only after build
    private volatile long dictVersion; // bump on any dictionary mutation
    private final LinkedHashMap<String, Boolean> cache;

    public CachedWordBreak(Node root, int capacity) {
        this.root = root;
        this.cache = new LinkedHashMap<>(capacity, 0.75f, true) {
            protected boolean removeEldestEntry(Map.Entry<String, Boolean> e) {
                return size() > capacity;
            }
        };
    }

    public synchronized void onDictionaryChanged() {
        dictVersion++;     // invalidate logically...
        cache.clear();     // ...and physically drop stale answers
    }

    public boolean query(String s) {
        String key = dictVersion + " " + s; // version folded into key
        synchronized (this) {
            Boolean hit = cache.get(key);
            if (hit != null) return hit;
        }
        boolean ans = wordBreak(s);              // O(n*L) Trie walk
        synchronized (this) { cache.put(key, ans); }
        return ans;
    }

    private boolean wordBreak(String s) {
        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;
        for (int i = 0; i < n; i++) {
            if (!dp[i]) continue;
            Node cur = root;
            for (int j = i; j < n; j++) {
                cur = cur.ch.get(s.charAt(j));
                if (cur == null) break;
                if (cur.end) dp[j + 1] = true;
            }
        }
        return dp[n];
    }

    static class Node { Map<Character, Node> ch = new HashMap<>(); boolean end; }
}
```

```python
# Result cache invalidated by dictionary version; pure-function key.
from functools import lru_cache


class CachedSegmenter:
    def __init__(self, trie_root, max_len):
        self.root = trie_root           # shared, read-only
        self.max_len = max_len
        self.version = 0                # bump on dictionary change

    def on_dictionary_changed(self, new_root, new_max_len):
        self.root, self.max_len = new_root, new_max_len
        self.version += 1
        self._query.cache_clear()       # drop stale answers

    def query(self, s):
        return self._query(self.version, s)

    @lru_cache(maxsize=100_000)
    def _query(self, _version, s):       # version in key => auto-invalidated
        n = len(s)
        dp = [False] * (n + 1)
        dp[0] = True
        for i in range(n):
            if not dp[i]:
                continue
            node = self.root
            for j in range(i, n):
                node = node.children.get(s[j])
                if node is None:
                    break
                if node.end:
                    dp[j + 1] = True
        return dp[n]
```

The recurring senior bug here is a cache that outlives a dictionary edit: a hot string answered `true`, a word is then removed, and the stale `true` keeps being served. Folding an explicit version into the key (and clearing on mutation) makes that class of bug impossible by construction.

---

## 7. Code Examples

### 7.1 Go — Trie-accelerated Word Break with reachability pruning

```go
package main

import "fmt"

type trieNode struct {
	children map[byte]*trieNode
	end      bool
}

func newNode() *trieNode { return &trieNode{children: map[byte]*trieNode{}} }

func buildTrie(words []string) *trieNode {
	root := newNode()
	for _, w := range words {
		node := root
		for i := 0; i < len(w); i++ {
			c := w[i]
			if node.children[c] == nil {
				node.children[c] = newNode()
			}
			node = node.children[c]
		}
		node.end = true
	}
	return root
}

func wordBreak(s string, words []string) bool {
	root := buildTrie(words)
	n := len(s)
	dp := make([]bool, n+1)
	dp[0] = true
	for i := 0; i < n; i++ {
		if !dp[i] {
			continue
		}
		node := root
		for j := i; j < n; j++ {
			node = node.children[s[j]]
			if node == nil {
				break
			}
			if node.end {
				dp[j+1] = true
			}
		}
	}
	return dp[n]
}

func main() {
	fmt.Println(wordBreak("applepie", []string{"apple", "pie", "pen"})) // true
}
```

### 7.2 Java — Aho-Corasick-style: all matches feed the DP

```java
import java.util.*;

public class WordBreakMatches {
    // Simplified: for each start, collect dictionary words via a Trie walk,
    // then run the prefix DP. (Full Aho-Corasick adds failure links.)
    static class Node {
        Map<Character, Node> ch = new HashMap<>();
        boolean end;
    }

    static Node build(List<String> words) {
        Node root = new Node();
        for (String w : words) {
            Node cur = root;
            for (char c : w.toCharArray())
                cur = cur.ch.computeIfAbsent(c, k -> new Node());
            cur.end = true;
        }
        return root;
    }

    static boolean wordBreak(String s, List<String> words) {
        Node root = build(words);
        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true;
        for (int i = 0; i < n; i++) {
            if (!dp[i]) continue;
            Node cur = root;
            for (int j = i; j < n; j++) {
                cur = cur.ch.get(s.charAt(j));
                if (cur == null) break;
                if (cur.end) dp[j + 1] = true;
            }
        }
        return dp[n];
    }

    public static void main(String[] args) {
        System.out.println(wordBreak("applepie",
            List.of("apple", "pie", "pen"))); // true
    }
}
```

### 7.3 Python — count-then-decide guard for Word Break II

```python
MOD = 1_000_000_007


def count_segmentations(s, dict_set, max_len):
    n = len(s)
    cnt = [0] * (n + 1)
    cnt[0] = 1
    for i in range(1, n + 1):
        for j in range(max(0, i - max_len), i):
            if cnt[j] and s[j:i] in dict_set:
                cnt[i] = (cnt[i] + cnt[j]) % MOD
    return cnt[n]


def safe_word_break_ii(s, word_dict, limit=10_000):
    """Enumerate only if the count is below `limit`; else refuse."""
    dict_set = set(word_dict)
    max_len = max((len(w) for w in word_dict), default=0)
    # cheap polynomial pre-check
    total = count_segmentations(s, dict_set, max_len)
    if total == 0:
        return []
    if total > limit:  # note: mod count can alias; use exact int for true guard
        raise ValueError(f"too many segmentations (~{total} mod p); refusing to enumerate")

    n = len(s)
    from functools import lru_cache

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


if __name__ == "__main__":
    print(safe_word_break_ii("catsanddog",
                             ["cat", "cats", "and", "sand", "dog"]))
```

---

## 8. Observability and Testing

A Word Break result is easy to get subtly wrong — an off-by-one or a missing base case looks like any other false. Build in checks from day one.

| Check | Why |
|-------|-----|
| Naive recursion oracle on small `s` | Catches base-case and off-by-one bugs. |
| `dp[0] == true` and `wordBreak("") == true` | Confirms the empty-prefix base case. |
| Count DP vs `len(WordBreakII output)` | The polynomial count must equal the number of enumerated sentences (small inputs). |
| Trie result == hash-set result | Cross-checks the two membership oracles. |
| Reachability-pruned WB-II == unpruned WB-II | Pruning must not drop valid sentences. |
| Encoding round-trip (Unicode) | Same answer whether dict and `s` use bytes or code points. |
| Adversarial `"aaaa…ab"` returns fast | Confirms dead-branch pruning works. |

The single most valuable test is the **count-equals-enumeration** invariant: on small inputs, the polynomial counting DP must produce exactly the number of sentences the exponential enumeration returns. If they disagree, one of them has a base-case or duplication bug.

### 8.1 Production guardrails

For a service exposing Word Break II, add: a **count pre-check** that refuses or streams when the segmentation count exceeds a threshold (DoS protection); an **input-length cap**; a **timeout** on enumeration; and structured logging of `(input length, dictionary size, segmentation count, output size)` so an anomalous request stands out.

---

## 9. Failure Modes

### 9.1 Exponential output DoS

A short adversarial string (`"aaaa…a"` with `{"a","aa"}`) demands exponential Word Break II output, exhausting memory/CPU. Mitigation: count first (polynomial), refuse or stream above a threshold.

### 9.2 Substring-allocation thrash

The hash-set DP allocates `O(n²)` substrings, crushing the GC. Mitigation: use a Trie that walks characters in place — no allocation.

### 9.3 Missing base case

Forgetting `dp[0] = true` makes every answer false. Mitigation: assert `wordBreak("") == true` and the base case in tests.

### 9.4 Count overflow

Segmentation counts grow like `φⁿ`; an unmodded `int64` silently wraps to garbage around `n ≈ 90`. Mitigation: reduce mod a prime, or use big integers when exact.

### 9.5 Rebuilding the dictionary structure per request

Constructing the Trie/Aho-Corasick on every query wastes `O(dict)` and churns allocations. Mitigation: build once at startup, share read-only across handlers.

### 9.6 Encoding mismatch

The string and dictionary disagree on what a "character" is (bytes vs runes vs grapheme clusters), so the Trie walk follows wrong units and silently mis-segments. Mitigation: normalize both to the same unit (usually Unicode code points) up front.

### 9.7 Greedy longest-match assumed optimal

In tokenization, greedy longest-match is fast but not always the best segmentation; assuming it is correct ships wrong tokenizations. Mitigation: use the max-probability Viterbi DP when correctness matters, and document that greedy is a heuristic.

### 9.8 Stale memo across calls

A module-level memo not reset between top-level invocations returns answers for a previous input. Mitigation: scope the memo to the call, or clear it explicitly.

---

## 10. Summary

- Word Break's recurrence is trivial; the senior work is choosing the **dictionary structure** (hash set → Trie → Aho-Corasick → compressed/succinct/external) and the **output mode** (decide / count / one / all).
- **Trie** eliminates the hash-set version's `O(n²)` substring allocation by walking characters in place; **Aho-Corasick** reports all matches in one linear pass, ideal for a fixed dictionary queried against many strings.
- Word Break II is **output-sensitive and exponential** in the worst case. Guard it: decide first, prune with a reachability array, count (polynomially) before enumerating, and stream or refuse above a threshold — otherwise it is a DoS vector.
- **Counting** segmentations is polynomial (`O(n·L)`) but the count grows like `φⁿ`; take it mod a prime, or use big integers / CRT for exact values.
- Word Break is the skeleton of real **tokenization**: space-less-language word segmentation, subword (BPE/WordPiece) tokenizers, and lexers, with scoring (Viterbi/max-probability) added to resolve ambiguity. The segmentation **lattice/DAG** compactly represents all segmentations without exponential enumeration.
- Performance lives in **allocation**: kill substring construction with a Trie, build the dictionary structure once and share it, and match the character encoding between input and dictionary.
- Always keep a naive oracle and the **count-equals-enumeration** invariant; they catch the base-case, off-by-one, and duplication bugs that account for nearly every real defect.

### Decision summary

- **Decide if segmentable** → boolean prefix DP (`O(n·L)`); Trie for big dictionaries.
- **Count segmentations** → sum DP mod a prime (`O(n·L)`); big-int/CRT if exact.
- **One segmentation** → boolean DP with parent pointers, `O(n)` reconstruct.
- **All segmentations** → memoized backtracking, but count first and guard the exponential output.
- **Real tokenization** → max-probability/Viterbi DP over the lexicon; return the lattice for downstream scoring.
- **Huge fixed dictionary, many queries** → Aho-Corasick built once, shared read-only.

References to study further: Aho-Corasick automaton, DAWG / radix trees / succinct tries (LOUDS), Viterbi algorithm and CRF/HMM word segmentation, BPE / WordPiece / SentencePiece subword tokenization, the segmentation-lattice (word lattice) representation, and sibling skills `string-algorithms`, `tree-traversals`, and `dynamic-programming`.

### Senior Checklist Before Shipping

- [ ] Dictionary structure chosen for the workload (Trie default; Aho-Corasick for huge fixed dict).
- [ ] Dictionary built once at startup, shared read-only — never per request.
- [ ] No substring allocation on the hot path (Trie walks in place).
- [ ] Output mode pinned: decide / count / one / all — and the right algorithm for each.
- [ ] Word Break II guarded: count first, prune dead branches, stream or refuse above a threshold.
- [ ] Counts taken mod a prime (or big-int/CRT when exact); overflow impossible.
- [ ] Character encoding matched between input and dictionary (bytes vs runes vs code points).
- [ ] Naive oracle and count-equals-enumeration invariant in the test suite.
- [ ] Input length cap + timeout on any enumeration endpoint exposed to untrusted callers.
- [ ] Cross-query caches keyed by dictionary version and cleared on mutation — no stale answers.

If every box is checked, the implementation is robust against the failure modes of Section 9: no exponential DoS, no allocation thrash, no overflow, no encoding mismatch, and no stale-state or rebuild regressions. These are the differences between a whiteboard solution and a production one.
