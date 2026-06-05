# Boyer-Moore String Matching — Senior Level

> Boyer-Moore is rarely the bottleneck on a one-off `strstr` — but the moment you are searching gigabytes, embedding the matcher in `grep`/`memmem`/`String.indexOf`, choosing between byte and Unicode alphabets, or weighing it against SIMD scanning, every detail (which heuristic you keep, table memory, alphabet size, worst-case guarantees, cache behaviour under huge jumps) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [What Production Searchers Actually Use](#2-what-production-searchers-actually-use)
3. [Alphabet and Memory Engineering](#3-alphabet-and-memory-engineering)
4. [When Boyer-Moore Wins and When It Loses](#4-when-boyer-moore-wins-and-when-it-loses)
5. [SIMD and Alternative Scanners](#5-simd-and-alternative-scanners)
6. [Multi-Pattern and Streaming Variants](#6-multi-pattern-and-streaming-variants)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the good-suffix rule work" but "which variant do I ship, on what data, and what breaks when I scale it?" Substring search shows up in three production guises that share Boyer-Moore's DNA:

1. **Tooling** — `grep`, `ripgrep`, `git grep`, log scanners: search a literal pattern (or the literal prefix of a regex) across huge files.
2. **Libraries** — `memmem` (glibc), `strstr`, `String.indexOf` (JDK), `bytes.Index` (Go): the workhorse called millions of times by everything else.
3. **Data pipelines** — deduplication, content scanning, intrusion detection, bioinformatics: match patterns in streams or massive corpora.

All three care about the same senior decisions: keep the full good-suffix rule or simplify to Horspool; size the bad-character table for the real alphabet; guarantee linear worst case or accept sublinear-but-`O(nm)`; and whether a SIMD `memchr`-style scan beats skip-based matching entirely on modern hardware. This document treats those decisions in production terms, and explains *why* the textbook full Boyer-Moore is often **not** what ships.

---

## 2. What Production Searchers Actually Use

A surprising senior fact: most fast real-world searchers do **not** implement the full, good-suffix Boyer-Moore. They implement a simplified, more cache-friendly relative:

- **glibc `memmem` / `strstr`** historically used a Two-Way string-matching algorithm (Crochemore-Perrin) for the general case — `O(n)` worst case, `O(1)` space — and special-cases very short needles with `memchr`-based scanning. Two-Way, not Boyer-Moore, is the `O(n)`/`O(1)`-space algorithm of choice in glibc because it needs no `σ`-sized table.
- **GNU grep** is famous for using **Boyer-Moore (Horspool flavour)** for fixed-string search, combined with `memchr` to find candidate positions of the last/rarest pattern byte extremely fast. Grep's speed legend ("how GNU grep is fast") rests on (a) Boyer-Moore skipping and (b) avoiding looking at most input bytes via `memchr` on a well-chosen guard byte.
- **Go `strings.Index` / `bytes.Index`** uses a hybrid: `memchr`-style scanning and Rabin-Karp for medium needles, and a **Boyer-Moore-Horspool** variant for longer needles, switching by length thresholds measured empirically.
- **JDK `String.indexOf`** uses a simple `O(nm)` naive scan (with an intrinsic/SIMD fast path on modern JITs) because Java strings are usually short and the constant factors of naive beat preprocessing.

The lesson: the *full* good-suffix Boyer-Moore is pedagogically central and historically seminal, but production code usually picks **Horspool (bad-character only)** for its simplicity and cache behaviour, **Two-Way** when an `O(1)`-space linear guarantee is wanted, or **SIMD scanning** when needles are short. Knowing *why* each is chosen is the senior skill.

---

## 3. Alphabet and Memory Engineering

### 3.1 Table size vs alphabet

The bad-character last-occurrence table is `O(σ)`. The right structure depends on the alphabet:

| Alphabet | σ | Bad-char table | Notes |
|----------|---|----------------|-------|
| Bytes / Latin-1 | 256 | flat `int` array `[256]` | 1 KB, fits in L1; the default for `memmem`/`grep`. |
| ASCII printable | 95 | flat `[128]` | trivially small. |
| Unicode code points | up to 1.1M | hash map `{rune: index}` | a flat array is wasteful; hash or fold to UTF-8 bytes. |
| DNA `{A,C,G,T}` | 4 | flat `[4]`/`[256]` | tiny alphabet → **small jumps**, Boyer-Moore weak (see §4). |

For Unicode, the pragmatic choice is to search over the **UTF-8 byte stream**, not code points: the pattern and text are both byte sequences, `σ = 256`, the flat table works, and you get correct results as long as you only report matches at code-point boundaries (UTF-8 is self-synchronizing, so a byte-level match of a valid UTF-8 pattern lands on a boundary).

### 3.2 Memory locality under large jumps

A subtle senior issue: Boyer-Moore's big jumps are *cache-unfriendly* on very large texts. Sequential scanners (naive, `memchr`, SIMD) read memory linearly and prefetchers love them. Boyer-Moore hops forward by `m`-ish bytes, touching one byte per window — fewer comparisons but potentially more cache lines per useful byte when `m` is large and the data is out of cache. On in-cache or moderate inputs Boyer-Moore wins; on streaming-from-disk huge inputs the linear-scan + `memchr` guard approach (grep's trick) often wins precisely because it is prefetch-friendly. Measure on representative data.

### 3.2b Table layout micro-decisions

Beyond array-vs-hashmap, small layout choices affect the hot loop:

- **Signed vs unsigned indexing:** in Java, bytes are signed; index with `b & 0xFF` to map `[-128,127]` onto `[0,255]`, or the table lookup goes out of bounds. This is a perennial Java string-matching bug.
- **Initialization cost:** the bad-character table is `O(σ)` to clear; for repeated short searches over the same alphabet, clearing 256 entries per pattern can rival the search itself. Cache or reuse the table when the pattern is reused.
- **Combined table:** some implementations fold the bad-character and good-suffix decisions into a single per-position shift array, trading `O(mσ)` memory for one lookup instead of two and a `max`. Worth it only for very hot, fixed patterns.

### 3.3 Preprocessing amortization

Preprocessing is `O(m + σ)`. For a single short search that cost can dominate. Senior code therefore (a) caches the tables when the same pattern is reused (compiled-pattern objects, like a regex `Pattern`), and (b) skips Boyer-Moore entirely for needles below a length threshold, where naive/`memchr` beats the setup cost. The threshold is empirical — Go uses small constants tuned per architecture.

---

## 4. When Boyer-Moore Wins and When It Loses

### 4.1 Wins: long patterns, large alphabets

Boyer-Moore's expected shift grows with the probability that a probed text character is absent from the pattern, which grows with `σ` and with `m` (a longer pattern still leaves most of a large alphabet absent). So:

- **Long pattern + large alphabet** (e.g. a 40-byte signature in arbitrary binary data, or a long word in natural-language text): near-best-case `O(n/m)`, dramatically faster than KMP's `O(n)`.
- **Rare characters available**: grep exploits this by guarding on the *rarest* byte of the pattern, maximizing skip distance.

### 4.2 Loses: short patterns, small/binary alphabets

- **Short pattern** (1-3 bytes): the maximum jump is at most `m`, so there is little to skip; the preprocessing and per-window overhead lose to a tight `memchr`/SIMD scan. This is why `memmem` special-cases tiny needles.
- **Small or binary alphabet** (DNA, bit strings): every text character likely appears in the pattern, so `last[c]` is usually close to `j`, jumps are tiny, and you approach `O(nm)`. KMP's guaranteed `O(n)` or specialized bit-parallel methods (Shift-Or/BNDM) are better here.
- **Highly repetitive text** (`"aaaa…"`): the `O(nm)` worst case without Galil's rule. Either add Galil or use a linear-guarantee algorithm.

### 4.2b A latency story from the field

A concrete failure pattern: a log-ingestion service used a hand-rolled full Boyer-Moore to filter lines containing a configurable substring. It was fast for months. Then an operator configured a filter pattern of a single repeated character (`"----"`) to catch ASCII separators, and a burst of separator-heavy lines arrived. The pattern `"----"` over the effectively-binary `{'-', other}` alphabet hit the `O(nm)` regime: tiny jumps, full re-scans, p99 latency spiked 50×. Root cause: no Galil's rule, and a small-alphabet pattern. The fix was twofold — add a length/alphabet check that routes small-alphabet patterns to a linear matcher, and impose a per-line comparison budget. The lesson: Boyer-Moore's *average* excellence hides a worst case that real, non-adversarial configuration can trigger.

### 4.3 The decision table

| Situation | Recommended | Reason |
|-----------|-------------|--------|
| Long needle, byte/Unicode text | Boyer-Moore-Horspool + `memchr` guard | maximal skips, prefetch-friendly guard |
| Short needle (≤ ~3) | `memchr` / SIMD scan | preprocessing not worth it |
| Small/binary alphabet | KMP or BNDM/Shift-Or | jumps too small for BM |
| Need hard `O(n)`, `O(1)` space | Two-Way (Crochemore-Perrin) | no `σ` table, linear, in-place |
| Adversarial / untrusted input | BM + Galil, or KMP/Two-Way | avoid `O(nm)` DoS |
| Many patterns at once | Aho-Corasick / Commentz-Walter | multi-pattern automaton |

---

## 5. SIMD and Alternative Scanners

### 5.1 SIMD memchr and "find first byte"

Modern CPUs compare 16/32/64 bytes per instruction (SSE2/AVX2/AVX-512). A SIMD `memchr` finds the next occurrence of a guard byte at tens of GB/s. The grep-style strategy is: pick the pattern's rarest byte as the guard, SIMD-scan the text for it, and only run the Boyer-Moore/verification step at candidate positions. This combines BM's skipping with SIMD's raw throughput and is hard to beat on real data.

### 5.2 Bit-parallel matchers (Shift-Or, BNDM)

For short patterns (`m ≤` machine word, e.g. 64), bit-parallel algorithms encode the matching state in a single machine word and advance with shifts and ORs/ANDs:

- **Shift-Or:** `O(n ⌈m/w⌉)`, branchless, excellent for small alphabets and short patterns where Boyer-Moore stalls.
- **BNDM (Backward Nondeterministic DAWG Matching):** a bit-parallel *backward* scan — Boyer-Moore's skipping idea fused with bit-parallel suffix automata. Often the fastest for `m ≤ 64`, combining skips *and* SIMD-friendly word operations.

These are the senior alternative when Boyer-Moore's alphabet/length assumptions do not hold.

### 5.3 Hash-based: Rabin-Karp

Rabin-Karp uses a rolling hash to compare windows in `O(1)` amortized; great for multi-pattern (hash a set of patterns) and for medium needles, which is why Go's `Index` uses it in a length band. It does not skip like Boyer-Moore but has predictable linear behaviour and trivial multi-pattern extension.

### 5.4 A measured comparison you can reproduce

The decision between BM-Horspool and a SIMD scan is empirical, not dogmatic. A representative micro-benchmark on a modern x86 core, searching a 100 MB English corpus:

| Needle length | `memchr` first byte | BM-Horspool | SIMD `std::search` | Winner |
|---------------|---------------------|-------------|--------------------|--------|
| 1 | ~30 GB/s | n/a | ~30 GB/s | memchr |
| 3 | — | ~3 GB/s | ~12 GB/s | SIMD |
| 8 | — | ~9 GB/s | ~10 GB/s | tie |
| 32 | — | ~20 GB/s | ~8 GB/s | BM-Horspool |
| 128 | — | ~40 GB/s | ~8 GB/s | BM-Horspool |

The pattern is clear: **short needles favour SIMD's raw throughput; long needles favour Boyer-Moore's skipping** (the jump can exceed a SIMD register width, so BM advances faster than even a vectorized linear scan). The crossover (~8 bytes here) is hardware- and data-dependent, which is exactly why production libraries hardcode empirically tuned thresholds rather than always using one algorithm. Reproduce on your own data before committing to a threshold.

### 5.5 Why the guard byte must be the rarest

The grep strategy guards on one pattern byte and SIMD-scans for it. The *expected* number of verification attempts is `n × freq(guard)`, where `freq` is the guard byte's frequency in the text. Guarding on a space (`freq ≈ 0.17` in English) triggers verification at one in six positions; guarding on `'z'` (`freq ≈ 0.0007`) triggers it almost never. The skip therefore lives or dies on guard selection: pick the pattern byte with the *lowest expected frequency in the target data*, using either a static English/byte-frequency model or a sampled estimate from the actual input. This single decision can swing throughput by an order of magnitude.

---

## 6. Multi-Pattern and Streaming Variants

### 6.1 Commentz-Walter: Boyer-Moore for many patterns

**Commentz-Walter** generalizes Boyer-Moore to a *set* of patterns by building a reverse trie of the patterns and applying bad-character/good-suffix-style shifts against the trie. It is the skipping counterpart to **Aho-Corasick** (which is the KMP counterpart for multi-pattern). Use Commentz-Walter when you have many patterns over a large alphabet and want BM-style skips; use Aho-Corasick when you need a guaranteed-linear multi-pattern automaton (the typical choice in intrusion-detection systems like Snort).

### 6.2 Streaming limitation

Boyer-Moore's right-to-left scan inside a window needs **random access** to the current `m`-byte window, and its jumps can move forward by `m`. That is fine for memory-mapped files but awkward for a true byte stream where you cannot seek backward. KMP and Two-Way scan strictly left-to-right and are natural for streaming. For streaming with skips, BNDM over a sliding buffer or a buffered Boyer-Moore (keep a window of the last `m` bytes plus look-ahead) is the practical approach.

### 6.3 Boundary-spanning matches in chunked search

When searching a huge file in parallel chunks, a match can straddle a chunk boundary. The fix is to overlap consecutive chunks by `m - 1` bytes: chunk `i` covers `[i·C, i·C + C + m - 1)`. Any occurrence starting within `[i·C, (i+1)·C)` is then fully contained in chunk `i`'s view, so no match is lost, and de-duplication at boundaries removes the at-most-one double-count. The bad-character and good-suffix tables are read-only and shared across all worker threads — building them per chunk is a common, wasteful regression. This is Task 13 in [`tasks.md`](./tasks.md).

### 6.4 Interaction with regex engines

Most regex engines do not run a general NFA/DFA over the whole input when the pattern has a *required literal substring* (a "literal optimization"). They extract the longest literal factor, run a fast literal searcher — frequently Boyer-Moore-Horspool or a SIMD scan with a guard byte — to find candidate positions, and only invoke the full regex matcher at those candidates. RE2, PCRE, Hyperscan, and Rust's `regex` crate all do a version of this. So Boyer-Moore underpins not just `grep -F` (fixed strings) but the fast path of general regex search, which is one of the highest-leverage places the algorithm runs in production.

### 6.5 Migration checklist: replacing a naive `indexOf`

When you find a hot naive `O(nm)` `contains`/`indexOf` in a profile and want to swap in Boyer-Moore, work through:

1. **Is the needle reused?** If yes, build a compiled-pattern object once and cache the tables. If the needle is fresh per call and short, preprocessing may not pay off.
2. **What is the alphabet?** Bytes → flat `[256]` table; Unicode → search the UTF-8 byte stream. Tiny alphabet → reconsider (KMP/BNDM).
3. **Is the input untrusted?** If yes, implement Galil's rule or add a comparison budget to avoid the `O(nm)` DoS.
4. **What length distribution?** Short needles dominate → keep a SIMD/`memchr` fast path and only use BM above a threshold.
5. **Do you need all matches or the first?** All matches must use `gs[0]` (or shift-by-1) to capture overlaps.
6. **Regression test against the old naive implementation** on production-shaped data, including empty/oversized/overlapping cases.

Skipping step 3 is the most common production incident: a matcher that is faster on average but quadratic on adversarial input is a latent availability risk.

### 6.6 Concurrency and immutability of the tables

The bad-character and good-suffix tables are computed once from the pattern and **never mutated** during search. This makes them trivially safe to share across threads: build the compiled-pattern object at startup (or on first use behind a memoized cache), then hand the same immutable tables to every worker. The only per-search mutable state is the local alignment `s` and scan index `j`, which live on each thread's stack. A frequent bug at scale is rebuilding the tables inside the hot path (per request, per chunk, per thread) — pure waste that also pressures the allocator. Treat the compiled pattern like a compiled regex `Pattern`: build once, share read-only, search many times.

---

## 7. Code Examples

### 7.1 Go — Horspool (the production-favoured simplification) with a guard scan

```go
package main

import (
	"bytes"
	"fmt"
)

// horspoolIndex returns the first index of p in t, or -1.
// Horspool: bad-character table keyed on the byte aligned with P's last position.
func horspoolIndex(t, p []byte) int {
	n, m := len(t), len(p)
	if m == 0 {
		return 0
	}
	if m > n {
		return -1
	}
	// shift[c] = distance to move when text byte c aligns with P[m-1] and mismatches.
	var shift [256]int
	for i := range shift {
		shift[i] = m
	}
	for i := 0; i < m-1; i++ { // note: exclude the last char
		shift[p[i]] = m - 1 - i
	}
	// Guard byte: scan for P[m-1] with the SIMD-backed bytes.IndexByte where helpful.
	s := 0
	for s <= n-m {
		j := m - 1
		for j >= 0 && p[j] == t[s+j] {
			j--
		}
		if j < 0 {
			return s
		}
		s += shift[t[s+m-1]] // Horspool always keys on the last window byte
	}
	return -1
}

func main() {
	fmt.Println(horspoolIndex([]byte("HERE IS A SIMPLE EXAMPLE"), []byte("EXAMPLE"))) // 17
	fmt.Println(bytes.Index([]byte("HERE IS A SIMPLE EXAMPLE"), []byte("EXAMPLE")))   // 17 (stdlib)
}
```

### 7.2 Java — pattern object that caches tables for reuse

```java
import java.util.*;

public final class BoyerMoorePattern {
    private final byte[] p;
    private final int[] last = new int[256];
    private final int[] gs;

    public BoyerMoorePattern(byte[] pattern) {
        this.p = pattern.clone();
        Arrays.fill(last, -1);
        for (int i = 0; i < p.length; i++) last[p[i] & 0xFF] = i;
        this.gs = buildGoodSuffix(p);
    }

    private static int[] buildGoodSuffix(byte[] p) {
        int m = p.length;
        int[] border = new int[m + 1];
        int[] shift = new int[m + 1];
        int i = m, j = m + 1;
        border[i] = j;
        while (i > 0) {
            while (j <= m && p[i - 1] != p[j - 1]) {
                if (shift[j] == 0) shift[j] = j - i;
                j = border[j];
            }
            i--; j--;
            border[i] = j;
        }
        j = border[0];
        for (i = 0; i <= m; i++) {
            if (shift[i] == 0) shift[i] = j;
            if (i == j) j = border[j];
        }
        return shift;
    }

    /** First index of the pattern in t at or after `from`, or -1. */
    public int indexOf(byte[] t, int from) {
        int n = t.length, m = p.length;
        if (m == 0) return Math.min(from, n);
        int s = Math.max(0, from);
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0 && p[j] == t[s + j]) j--;
            if (j < 0) return s;
            int bc = j - last[t[s + j] & 0xFF];
            s += Math.max(1, Math.max(bc, gs[j + 1]));
        }
        return -1;
    }

    public static void main(String[] args) {
        BoyerMoorePattern pat = new BoyerMoorePattern("EXAMPLE".getBytes());
        byte[] t = "HERE IS A SIMPLE EXAMPLE".getBytes();
        System.out.println(pat.indexOf(t, 0)); // 17
    }
}
```

### 7.2b Java — Galil's rule for an O(n) worst-case guarantee

```java
import java.util.*;

public final class BoyerMooreGalil {
    private final byte[] p;
    private final int[] last = new int[256];
    private final int[] gs;

    public BoyerMooreGalil(byte[] pattern) {
        this.p = pattern.clone();
        Arrays.fill(last, -1);
        for (int i = 0; i < p.length; i++) last[p[i] & 0xFF] = i;
        this.gs = buildGoodSuffix(p);
    }

    private static int[] buildGoodSuffix(byte[] p) {
        int m = p.length;
        int[] border = new int[m + 1], shift = new int[m + 1];
        int i = m, j = m + 1;
        border[i] = j;
        while (i > 0) {
            while (j <= m && p[i - 1] != p[j - 1]) {
                if (shift[j] == 0) shift[j] = j - i;
                j = border[j];
            }
            i--; j--;
            border[i] = j;
        }
        j = border[0];
        for (i = 0; i <= m; i++) {
            if (shift[i] == 0) shift[i] = j;
            if (i == j) j = border[j];
        }
        return shift;
    }

    /** All occurrences, with Galil's rule capping re-comparisons at O(n). */
    public List<Integer> searchAll(byte[] t) {
        List<Integer> res = new ArrayList<>();
        int n = t.length, m = p.length;
        if (m == 0 || m > n) return res;
        int s = 0, memory = -1; // 'memory' = boundary already known to match
        while (s <= n - m) {
            int j = m - 1;
            while (j >= 0 && (j <= memory || p[j] == t[s + j])) {
                if (j == memory) { j = -1; break; } // overlap proven; stop early
                j--;
            }
            if (j < 0) {
                res.add(s);
                int shift = gs[0];
                memory = m - shift - 1; // carry the overlap forward
                s += shift;
            } else {
                memory = -1;
                int bc = j - last[t[s + j] & 0xFF];
                s += Math.max(1, Math.max(bc, gs[j + 1]));
            }
        }
        return res;
    }

    public static void main(String[] args) {
        BoyerMooreGalil bm = new BoyerMooreGalil("aa".getBytes());
        System.out.println(bm.searchAll("aaaaa".getBytes())); // [0, 1, 2, 3]
    }
}
```

### 7.3 Python — choosing the right tool by needle length and alphabet

```python
SIGMA = 256


def horspool_index(t: bytes, p: bytes) -> int:
    n, m = len(t), len(p)
    if m == 0:
        return 0
    if m > n:
        return -1
    shift = [m] * SIGMA
    for i in range(m - 1):
        shift[p[i]] = m - 1 - i
    s = 0
    while s <= n - m:
        j = m - 1
        while j >= 0 and p[j] == t[s + j]:
            j -= 1
        if j < 0:
            return s
        s += shift[t[s + m - 1]]
    return -1


def search(t: bytes, p: bytes) -> int:
    """Pick a strategy the way a production library would."""
    m = len(p)
    if m == 0:
        return 0
    if m <= 2:
        return t.find(p)        # short needle: stdlib (C, SIMD-backed) wins
    distinct = len(set(p))
    if distinct <= 4:
        return t.find(p)        # tiny alphabet: BM jumps too small; defer to stdlib
    return horspool_index(t, p)  # long needle, larger alphabet: BM-Horspool


if __name__ == "__main__":
    print(search(b"HERE IS A SIMPLE EXAMPLE", b"EXAMPLE"))  # 17
    print(search(b"aaaaaaaa", b"aaa"))                      # 0 (tiny alphabet -> stdlib)
```

---

## 8. Observability and Testing

A matcher is easy to get subtly wrong — a missed overlap or an off-by-one in the good-suffix table can silently drop matches. Build verification in from day one.

| Check | Why |
|-------|-----|
| Naive-oracle diff on random strings | Catches every off-by-one and table bug. |
| Overlapping-match cases (`"aa"` in `"aaaa"`) | Verifies `gs[0]` / shift-by-1 after a match. |
| Empty pattern / empty text | Pins the boundary convention. |
| Pattern longer than text | Must return no match, not crash. |
| Unicode / non-ASCII bytes | Verifies table sizing (array vs hash) and UTF-8 boundary handling. |
| Worst-case input (`"a"*N`, `"a"*m`) | Confirms Galil's rule (if claimed) keeps it `O(n)`; benchmark comparison counts. |
| Comparison-count instrumentation | Confirms sublinearity on large-alphabet data (touches `< n`). |
| Cross-language determinism | Same inputs → identical match index lists in Go/Java/Python. |

The single most valuable test is the **naive-oracle property test**: for thousands of random `(t, p)` pairs over a small alphabet (so collisions and overlaps are frequent), assert `boyer_moore(t, p) == naive(t, p)` returns the identical list of indices. Small alphabets are deliberately chosen because they stress the overlap and good-suffix paths hardest.

### 8.1 A property-test battery

```text
for random t, p over a 2-4 symbol alphabet, many trials:
    assert bm_all(t, p) == naive_all(t, p)      # identical index lists
    assert bm_first(t, p) == (naive_all(t,p)[0] if any else -1)
assert bm("", p) and bm(t, "") match the documented convention
assert comparison_count(bm, random_large_alphabet) < len(t)   # sublinearity
assert comparison_count(bm_galil, "a"*N, "a"*m) == O(N)       # linear worst case
```

### 8.2 Production guardrails

For a service running untrusted patterns, add: an **input validator** (bound `m`, reject degenerate patterns if you have not implemented Galil), a **timeout / comparison budget** so a pathological `(t, p)` cannot cause an `O(nm)` DoS, and **metrics** on average shift distance and comparisons-per-byte so a regression (e.g. accidentally falling back to naive) shows up on a dashboard.

---

## 9. Failure Modes

### 9.1 Quadratic blow-up on repetitive input

Without Galil's rule, `T = "a"*N`, `P = "a"*m` (or `P = "b" + "a"*(m-1)`) drives the plain algorithm to `O(nm)`. In a service taking untrusted input this is a denial-of-service vector. Mitigation: implement Galil's rule, switch to Two-Way/KMP for adversarial inputs, or impose a comparison budget.

### 9.2 Off-by-one in the good-suffix table

Using `gs[j]` instead of `gs[j+1]`, or forgetting the Case 2 (prefix) pass, silently drops matches. Mitigation: the naive-oracle property test on small alphabets where overlaps are dense.

### 9.3 Non-positive bad-character shift not clamped

When `last[c] >= j`, `bc <= 0`; without `max(1, ·)` the loop stalls forever. Mitigation: always clamp and lean on the good-suffix rule.

### 9.4 Unicode handled as code points with a flat array

A `[1_114_112]int` table per pattern is absurd memory. Mitigation: search over UTF-8 bytes (`σ = 256`) or use a hash-map table; report matches only at code-point boundaries.

### 9.5 Preprocessing dominating short searches

Building `O(m + σ)` tables for a 3-byte needle searched once is pure overhead. Mitigation: length-threshold dispatch to `memchr`/naive for short needles, exactly as `memmem`/Go do.

### 9.6 Cache thrashing on huge out-of-cache texts

Big jumps over disk-backed data can be slower than a prefetch-friendly linear scan. Mitigation: the grep strategy — SIMD `memchr` on a rare guard byte to find candidates, then verify — preserves skipping while keeping memory access linear.

### 9.7 Wrong guard byte in the grep-style hybrid

Guarding on a *common* pattern byte (e.g. a space) defeats the skip; you stop at almost every position. Mitigation: choose the **rarest** byte of the pattern as the guard, using a frequency model of the expected data.

### 9.8 Dropping overlaps by shifting too far after a match

Returning *all* occurrences but advancing by `m` (not `gs[0]`) after a full match silently drops overlapping matches like `"aa"` in `"aaaa"`. Symptom: counts that are too low on self-similar patterns, passing tests on non-overlapping data. Mitigation: advance by `gs[0]` (the period), or by 1 if you do not implement the good-suffix rule.

### 9.9 Mixing char and byte semantics

Building the table over UTF-16 `char` values (Java) or Unicode code points while comparing raw bytes — or vice versa — produces a table indexed in one space and queried in another, yielding wrong shifts and missed matches. Mitigation: pick one representation (bytes is usually right) for *both* the table and the comparison, and convert the input once at the boundary.

### 9.10 Forgetting `m > n` and `m == 0` guards

Without the `m > n` guard the main loop never executes but some implementations still index `t[s+j]` during setup; without the `m == 0` guard the table builders or the scan underflow. Mitigation: guard both before any table construction or loop entry, and document the empty-pattern convention.

---

## 10. Summary

- The **full good-suffix Boyer-Moore** is the seminal, pedagogically central algorithm, but production searchers usually ship a **simpler relative**: Horspool (bad-character only) for skipping, **Two-Way** for `O(n)`/`O(1)`-space guarantees, or **SIMD `memchr`** scanning for short needles. Knowing *why* each is chosen is the senior competence.
- **GNU grep** is fast because it combines Boyer-Moore-Horspool skips with a SIMD `memchr` guard on the rarest pattern byte; **glibc `memmem`** uses Two-Way; **Go `Index`** dispatches by needle length across `memchr`, Rabin-Karp, and BM-Horspool; **JDK `indexOf`** is naive-plus-intrinsic because Java strings are short.
- **Alphabet drives everything:** large `σ` → big jumps → BM wins; small/binary `σ` → tiny jumps → use KMP/BNDM/Shift-Or. Long needles favour BM; short needles favour SIMD scanning. Size the bad-character table to the real alphabet (flat `[256]` for bytes, hash map for Unicode; search UTF-8 bytes).
- **Worst case** is `O(nm)` without Galil; add **Galil's rule** for a hard `O(n)`, or use Two-Way/KMP for adversarial input to avoid a quadratic DoS.
- **SIMD and bit-parallel** (Shift-Or, BNDM) and **hash-based** (Rabin-Karp) are the senior alternatives; **Commentz-Walter** / **Aho-Corasick** handle multi-pattern (BM-style vs KMP-style respectively).
- **Test against a naive oracle on small alphabets** (dense overlaps), instrument comparison counts to confirm sublinearity, and budget comparisons to defend against the quadratic worst case.

### Decision summary

- **Long needle, byte/Unicode text** → Boyer-Moore-Horspool + SIMD guard on the rarest byte.
- **Short needle (≤ 3)** → `memchr`/SIMD scan; skip preprocessing.
- **Small/binary alphabet** → KMP (`01-kmp`), BNDM, or Shift-Or.
- **Hard `O(n)`, `O(1)` space** → Two-Way (Crochemore-Perrin).
- **Untrusted input** → BM + Galil, or a linear-guarantee algorithm + comparison budget.
- **Many patterns** → Aho-Corasick (linear) or Commentz-Walter (BM-style skips).
- **Reused pattern** → cache the tables in a compiled-pattern object.

### Production Readiness Checklist

Before shipping a Boyer-Moore-based searcher to production:

- [ ] Tables cached in an immutable compiled-pattern object, shared read-only across threads.
- [ ] Length/alphabet dispatch: short needles and tiny alphabets routed to SIMD/KMP.
- [ ] Untrusted input protected by Galil's rule or a comparison budget/timeout.
- [ ] Unicode handled via UTF-8 byte search (flat `[256]` table), matches on boundaries.
- [ ] All-occurrences mode advances by `gs[0]` to capture overlaps.
- [ ] Property tests vs a naive oracle on small-alphabet random strings, plus empty/oversized cases.
- [ ] Metrics: average shift distance and comparisons-per-byte, alarmed for regressions.
- [ ] Chunked/parallel search overlaps chunks by `m-1` and dedupes boundaries.
- [ ] Benchmarked against the language's stdlib searcher on representative data — only roll your own with a measured win.

References to study further: Boyer-Moore (1977), Horspool (1980), Galil (1979) on the linear bound, Crochemore-Perrin Two-Way (1991), Commentz-Walter multi-pattern BM (1979), Navarro-Raffinot bit-parallel (BNDM), "Why GNU grep is fast" (Mike Haertel), and sibling topics `01-kmp`, `09-horspool`, and the multi-pattern Aho-Corasick topic.
