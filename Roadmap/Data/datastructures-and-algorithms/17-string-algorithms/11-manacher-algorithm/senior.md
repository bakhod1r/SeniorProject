# Manacher's Algorithm (All Palindromic Substrings in O(n)) — Senior Level

> Manacher is rarely the bottleneck on a short string — but the moment the input is megabytes of Unicode text, the counts must not overflow, the separator must not collide with the alphabet, or the same scan must feed a streaming/online pipeline, every detail (encoding, sentinel choice, memory layout, when to prefer hashing or the eertree, how to test an opaque radius array) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Unicode and Encoding Correctness](#2-unicode-and-encoding-correctness)
3. [Separator and Sentinel Engineering](#3-separator-and-sentinel-engineering)
4. [When Manacher vs Hashing vs Eertree](#4-when-manacher-vs-hashing-vs-eertree)
5. [Memory and Cache Engineering](#5-memory-and-cache-engineering)
6. [Online and Streaming Variants](#6-online-and-streaming-variants)
7. [Counting at Scale](#7-counting-at-scale)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does the mirror trick give `O(n)`" but "what text am I actually scanning, and what breaks when I scale it?". Manacher shows up in production in a few recurring guises that share one engine:

1. **Longest-palindrome extraction** over large documents (DNA, logs, natural language) where the input may be Unicode and the `O(n²)` baseline is out of the question.
2. **All-occurrence palindrome counting** for text-statistics or plagiarism-style features, where the count itself can be `Θ(n²)` in magnitude and must not overflow.
3. **A linear preprocessing pass** feeding a larger pipeline (palindromic factorization, shortest-palindrome-by-prepend, bioinformatics motif search), where the radius array is an intermediate artifact consumed by downstream code.
4. **An interactive per-keystroke feature** (highlighting palindromes as the user types), where the *online* form — not the offline array rebuild — is what keeps latency flat.

All three reduce to: *transform the input to an odd-length sequence, run one linear scan maintaining the box `[l, r]`, and read the radius array.* The senior-level decisions are: how to keep the character model correct (encoding), how to keep the separator from colliding, how to make the scan cache-friendly, how to verify an opaque integer array, and when a different tool (hashing, eertree) is a better fit. This document treats those decisions in production terms.

The recurring theme is that the *algorithm* is trivially correct and linear; the *production risk* lives entirely in the layer around it — what counts as a "character," whether the separator is safe, how the result is recovered and stored, and whether the question being asked (all vs distinct, occurrences vs ranges) is even the one Manacher answers. A senior engineer spends almost no time on the box/mirror loop and almost all of it on these boundary concerns.

---

## 2. Unicode and Encoding Correctness

### 2.1 Bytes are not characters

The textbook Manacher indexes `s[i]` as a single character. On a UTF-8 byte string, `s[i]` is a *byte*, and a multibyte code point (e.g. `é`, `→`, an emoji) spans several bytes. Running Manacher over raw UTF-8 bytes can:

- **Split a code point** so the algorithm "matches" half of one character against half of another — semantically meaningless palindromes.
- **Report byte offsets** that do not align to character boundaries, breaking substring recovery.

The fix is to run Manacher over a sequence of **code points** (runes), not bytes:

- **Go:** convert `string` to `[]rune` first; index the rune slice.
- **Java:** beware `char` is a UTF-16 code *unit*; characters outside the BMP (emoji) are surrogate pairs spanning two `char`s. Use `int[]` of code points (`s.codePoints().toArray()`).
- **Python 3:** `str` is already a sequence of code points, so plain indexing is correct.

### 2.2 Grapheme clusters

Even code points are not the end. A "character" a user sees (a **grapheme cluster**) may be several code points: `é` can be `e` + combining acute accent; flag emoji and skin-tone modifiers combine multiple code points. Whether a palindrome should respect grapheme clusters is a **product decision**. For most algorithmic uses (DNA, ASCII logs) code points suffice; for user-facing "is this name a palindrome" features, segment into grapheme clusters first (ICU, `unicode-segmentation`) and run Manacher over cluster IDs.

### 2.3 Normalization

`café` may be encoded as `c a f é` (precomposed) or `c a f e ´` (decomposed). Two visually identical strings can differ byte-for-byte and even code-point-for-code-point. Normalize (NFC) before running Manacher if visual equality is the intent. This is the same class of bug as case-folding: decide explicitly whether the palindrome check is case-sensitive and normalization-sensitive, and apply the folding *before* the transform so the algorithm sees a canonical sequence.

### 2.4 A concrete Unicode failure

Consider the user input `"aé a"` reversed-ish, encoded in UTF-8 where `é` is two bytes `0xC3 0xA9`. Running byte-Manacher, the algorithm compares `0xA9` against some other byte and may "match" the second byte of `é` against the first byte of a different multibyte character, reporting a palindrome that does not exist at the *character* level. Worse, the recovered `start`/`length` are byte offsets that, when used to slice the original UTF-8 string, can split a code point and produce invalid UTF-8 in the output. The fix is uniform: decode to code points first, run Manacher over the code-point array, and map results back to code-point indices (then to byte ranges only at the very end if byte offsets are required by the API).

### 2.5 Reverse-complement palindromes (bioinformatics)

In DNA, a "palindrome" usually means a **reverse-complement** palindrome: the sequence equals the reverse complement of itself (`A↔T`, `C↔G`). This is *not* the ordinary palindrome Manacher detects. The adaptation: when comparing `t[left]` against `t[right]` in the expansion, test `complement(t[left]) == t[right]` instead of equality. The box/mirror machinery and the `O(n)` bound are unchanged — only the character-comparison predicate changes. This is a clean illustration that Manacher's structure is independent of the specific equality test, as long as the test is symmetric.

---

## 3. Separator and Sentinel Engineering

### 3.1 The separator must be outside the alphabet

The `#`-transform assumes `#` never appears in `s`. If it can, palindromes around a *real* `#` and palindromes around a *separator* `#` become indistinguishable, and the radius-equals-length invariant can be subtly violated. Options:

- **Map characters to integers** and use a sentinel integer like `-1` for the separator; run Manacher over an `int[]` rather than a `String`. This is the robust, alphabet-agnostic approach and is recommended for any non-trivial input.
- **Pick a separator provably absent**: if the alphabet is known (e.g. `ACGT` for DNA), any other byte works.
- **Use two distinct end sentinels** `^` and `$` (also outside the alphabet) so the expansion loop never runs off either end without a bounds check.

### 3.2 The sentinel-wrapped layout

The production-grade layout is:

```
t = [ ^ , #, c0, #, c1, #, ..., #, cn-1, #, $ ]
```

with `^`, `#`, `$` three *distinct* values not in the alphabet. The two sentinels guarantee `t[left] != t[right]` at the boundaries, so the inner loop drops its bounds checks — fewer instructions and one fewer off-by-one bug class. Operating on an integer array also sidesteps encoding issues entirely once you have mapped code points to integers.

### 3.3 The two-array (no-transform) alternative

Maintaining `d1` (odd) and `d2` (even) radius arrays on the raw string avoids the 2× memory of `t`. At scale, halving the working-set memory can matter (a 100 MB string becomes a 200 MB `t`). The trade-off is two near-identical loops with their own off-by-one subtleties. For very large inputs where memory is the constraint, the two-array form is worth the extra care; for clarity, the transform form is preferred.

The two forms are provably equivalent: `d1[i] = (p[2i+1] + 1) / 2` and `d2[i] = p[2i] / 2` relate the raw-string radii to the transformed radii. A robust strategy in code review is to implement the transform form first (clearer, easier to verify against the oracle), then, only if profiling shows memory pressure, switch to the two-array form and cross-check that it produces identical longest/count results on the test suite. Premature use of the two-array form trades clarity for memory you may not need.

---

## 4. When Manacher vs Hashing vs Eertree

The senior choice is picking the right tool, not reflexively reaching for Manacher.

| Need | Best tool | Why |
|------|-----------|-----|
| Longest palindromic substring | **Manacher** | `O(n)`, exact, tiny memory |
| Count **all** palindromic substrings (occurrences) | **Manacher** | `Σ⌈p/2⌉` in one pass |
| Count / enumerate **distinct** palindromes | **Eertree** (sibling `14`) | a node per distinct palindrome; ≤ `n` of them |
| Number of distinct palindromes per prefix (online) | **Eertree** | inherently online, per-append updates |
| Palindromic factorization (min cuts) | Manacher or eertree + DP | radii / palindrome links feed the DP |
| Arbitrary "is `s[a..b]` a palindrome?" range queries | **Hashing** (fwd+rev) | `O(1)` per query after `O(n)` prep |
| Approximate / k-mismatch palindromes | Hashing + binary search | Manacher is exact-match only |
| Per-center longest with simplest code | Hashing + binary search (`O(n log n)`) | acceptable when `n log n` is fine and you already have a hash |

**Decision heuristics:**

- If the question is about the *longest* palindrome or *total occurrences*, Manacher is the linear, exact, minimal-memory answer.
- If the question is about *distinct* palindromes or a *streaming per-prefix* count, the eertree is purpose-built; Manacher cannot give distinct counts directly.
- If you need flexible *range* palindrome checks or *approximate* palindromes, hashing's `O(1)` query and tolerance for mismatches win, accepting a tiny collision probability (use double hashing).

### 4.1 Worked tool-selection scenarios

| Scenario | Right tool | Reasoning |
|----------|-----------|-----------|
| "Longest palindrome in a 50 MB DNA file" | Manacher | linear, exact, tiny memory; alphabet `ACGT` so `#` never collides |
| "How many palindromic substrings does this log line have?" | Manacher | `Σ⌈p/2⌉` in one pass |
| "Distinct palindromes across a streamed chat feed" | Eertree | online, distinct counts, per-append updates |
| "Is `text[a..b]` a palindrome?" for 10^5 ad-hoc ranges | Hashing | `O(1)` per query after `O(n)` prep |
| "Longest palindrome allowing 1 mismatch" | Hashing + expansion | Manacher is exact-match only |
| "Min palindromic factorization" | Manacher (oracle) + DP | radii feed the partition DP |
| "Number of distinct palindromes per prefix" | Eertree | running node count, not available from `p[]` |

The recurring mistake is reaching for Manacher reflexively on a *distinct* or *range* question. Always ask: occurrences or distinct? fixed center-profile or arbitrary range? exact or approximate? The answer routes you to Manacher, the eertree, or hashing.

### 4.2 Combining tools

Real pipelines often run two. A plagiarism feature might use Manacher for the longest-palindrome fingerprint and hashing for fast range membership; a combinatorics-on-words analysis might run Manacher for occurrence counts and the eertree for the distinct/defect statistics. The tools compose cleanly because each is an independent `O(n)` pass over the same input — there is no shared mutable state to coordinate.

---

## 5. Memory and Cache Engineering

### 5.1 The working set

The transformed sequence `t` has length `2n + 1`; the radius array `p` has the same length. For `n = 10^8` characters, that is on the order of hundreds of MB for `t` plus `4(2n+1)` bytes for `p` (≈ 800 MB if `p` is `int32`). Decisions:

- **Avoid building `t` explicitly** with the two-array (`d1`/`d2`) form if memory is the binding constraint.
- **Use `int32` for `p`** when `n < 2^31` (radii never exceed `n`), halving the radius-array memory versus `int64`.
- **Map to a compact integer alphabet** (`uint8` if ≤ 256 symbols) so `t` is one byte per slot.

### 5.2 Cache behavior

The main scan is mostly sequential (the center `i` and the box edge `r` advance monotonically), which is cache-friendly. The mirror read `p[2c - i]` is a *backward* random-ish access, but it is into recently-written, likely-cached memory (within the current box), so it rarely misses. Keep `t` and `p` as flat contiguous arrays — arrays-of-arrays or boxed integers destroy this locality. In Java, prefer `int[]` over `Integer[]`; in Go, prefer `[]int32`/`[]byte` over `[]interface{}`.

### 5.3 Allocation discipline

If Manacher is called many times (per line of a log, per record), do **not** reallocate `t` and `p` each call. Preallocate a scratch buffer sized to the largest expected input and reuse it; this eliminates GC churn that otherwise dominates the runtime for short inputs.

### 5.4 Memory budget table

| Input size `n` | `t` (1 byte/slot) | `p` as `int32` | `p` as `int64` | Total (`int32` p) |
|----------------|-------------------|----------------|----------------|-------------------|
| 10^4 | ~20 KB | ~80 KB | ~160 KB | ~100 KB |
| 10^6 | ~2 MB | ~8 MB | ~16 MB | ~10 MB |
| 10^8 | ~200 MB | ~800 MB | ~1.6 GB | ~1 GB |

The table shows why the choices matter at the high end: at `n = 10^8`, `int64` radii alone are 1.6 GB. Dropping to `int32` and the two-array form (no explicit `t`) roughly halves the footprint to a manageable range. For inputs beyond `~10^8`, consider chunked/streaming processing or the online form, since even the compact layout approaches typical memory limits.

---

## 6. Online and Streaming Variants

Manacher's *original* formulation is **online**: it processes characters left to right and, after reading the `i`-th character, knows the longest palindromic suffix ending there. The array form most people memorize is offline (it needs the whole string), but the online property is recoverable and useful:

- **Longest palindromic suffix after each append** — directly supported by the online scan; the box `[l, r]` and the per-position radius are computed incrementally.
- **Streaming detection** — "alert when the stream so far ends in a palindrome of length ≥ k" — maintain the box across appended characters.

That said, for *distinct* palindrome tracking in a stream, the eertree is the natural online structure (each append adds at most one new distinct palindrome and updates suffix links in amortized `O(1)`). Use Manacher's online form for *suffix-palindrome* questions and the eertree for *distinct-palindrome* questions in a streaming setting.

### 6.1 Production applications of the radius array

The radius array is rarely the final deliverable; it is preprocessing for a larger feature. Common downstream uses:

- **Bioinformatics — inverted repeats.** DNA hairpins and restriction sites are (reverse-complement) palindromes. Over a `{A,C,G,T}` alphabet, Manacher finds the longest palindromic region in linear time; the reverse-complement variant maps complementary pairs before the transform.
- **Shortest palindrome by prepending (LeetCode 214).** The longest palindromic *prefix* (from `p[]`) determines how few characters must be prepended; a core building block in some compression and DNA-assembly heuristics.
- **Palindromic partitioning / minimum cuts (LeetCode 132).** The radii feed a DP that finds the fewest palindromic pieces, used in some text-segmentation and formatting tasks.
- **Text-statistics features.** Palindromic-substring counts (occurrence and, via the eertree, distinct) appear as features in stylometry and plagiarism detection.
- **Symmetry detection in signals.** Quantized signal samples treated as a string let Manacher flag the longest locally-symmetric window.

### 6.2 Latency and reuse at scale

For a service that runs Manacher per request, the latency is dominated by allocating and building `t` for each input. Reuse a preallocated scratch buffer (sized to the largest expected input) and reset rather than reallocate; for short inputs this turns allocation-bound latency into compute-bound, often a large win. The radius array, once computed, can be cached alongside the document if the same document is queried repeatedly for different palindrome statistics — it is the reusable `O(n)` summary from which longest, count, prefix/suffix, and factorization inputs are all read.

---

## 7. Counting at Scale

### 7.1 The count can be quadratic

The number of palindromic substrings of `aaaa…a` (length `n`) is `n(n+1)/2` — quadratic in magnitude even though Manacher computes it in linear *time*. For `n = 10^6` that is ≈ `5×10^11`, well past `int32`. **Always accumulate the count in 64-bit.** If you need it modulo a prime (some problems ask for the count mod `10^9+7`), reduce as you sum.

### 7.2 Distinct counts need the eertree

`Σ⌈p[i]/2⌉` counts occurrences. A string of length `n` has at most `n` *distinct* palindromic substrings (a classic bound), retrievable only via the eertree. Do not attempt to derive distinct counts from `p[]` — there is no simple formula because different centers can produce the same palindrome string.

A frequent "clever" attempt is to dedupe by hashing every nested palindrome at every center into a set. This *works* but is `O(n²)` time and space in the worst case (`a^n` has `Θ(n²)` nested occurrences), defeating the point of a linear algorithm. The eertree achieves the distinct count in genuine `O(n)` by never materializing duplicate occurrences. If you find yourself building a hash set of substrings to dedupe Manacher's output, that is the signal to switch to the eertree.

### 7.3 Weighted / filtered counts

Real features often want filtered counts: "palindromes of length ≥ L", "palindromes over a sub-alphabet", "palindromes at even positions". These are still one pass: filter the per-center contribution while summing `p[]`. For "length ≥ L" the per-center contribution becomes `max(0, ⌈(p[i] - L + 1)/2⌉)`-style arithmetic — derive it carefully and unit-test against the brute oracle.

### 7.4 Modular counting

Some competitive/analytics problems ask for the count modulo a prime (because the exact value is astronomically large or to fingerprint). Reduce as you accumulate: `total = (total + (p[i] + 1) / 2) % MOD`. The per-center term `⌈p[i]/2⌉` is at most `n`, so the running sum reduced mod `p` never overflows a 64-bit accumulator even before reduction. This is purely a downstream change to the summation; the scan that computes `p[]` is unaffected.

---

## 8a. Performance Engineering of the Scan

### 8a.1 The constant factor lives in the inner comparison

Manacher's asymptotic cost is fixed at `O(n)`, so all tuning is constant-factor. The hot operation is the expansion comparison `t[i - p[i] - 1] == t[i + p[i] + 1]`, executed `O(n)` times total. Wins:

- **Operate on a primitive array** (`[]byte`, `char[]`, `int[]`), never on a `String` whose `charAt` may bounds-check or decode on every access.
- **Sentinels over bounds checks.** Wrapping `t` with distinct sentinels removes the two comparisons `i - p[i] - 1 >= 0` and `i + p[i] + 1 < N` from the inner loop, leaving a single character compare. On long inputs this is a measurable speedup.
- **Avoid `min` via a branch** in hot paths if the language's `min` is a function call; an `if (r - i < p[mirror]) ... else ...` can be marginally faster, though most JITs inline `min`.
- **Keep `t` and `p` cache-resident together.** They are scanned in lockstep; interleaving them (struct-of-arrays vs array-of-structs) rarely helps because the access patterns differ (forward for `i`, backward random-ish for the mirror), so two flat arrays are the right layout.

### 8a.2 Avoiding the transform entirely (two-array form)

The single biggest memory win is computing `d1[i]` (odd radius at `i`) and `d2[i]` (even radius centered before `i`) directly on `s`, avoiding the `2n+1`-length `t` and its construction cost. The two loops are near-identical but operate on original indices, halving the working set. The trade-off is two code paths with their own off-by-one subtleties; reserve this form for memory-bound inputs (hundreds of MB) and keep it behind the same property-test battery as the transform form.

### 8a.3 Benchmark methodology

When benchmarking Manacher, control for:

- **Input family.** Random strings barely expand (the box advances quickly), so they understate the work; `a^n` is the stress case where every center's mirror copy is large. Benchmark both.
- **Warm-up.** JIT (Java) and branch predictors need warm-up runs; discard the first few iterations.
- **Exclude transform construction** from the scan timing if you are measuring the algorithm, or include it if you are measuring end-to-end latency — be explicit about which.
- **Compare against the `O(n²)` baseline** only on small `n`; on `a^{10^6}` the baseline is infeasible and the point is precisely that Manacher is not.

A typical result: `n = 10^6` of `a^n` runs in low tens of milliseconds in compiled languages and ~100 ms in CPython, versus the baseline's many minutes — the linear-vs-quadratic gap made concrete.

### 8a.4 When the constant factor still matters

Even at `O(n)`, the constant factor decides whether a real-time feature meets its latency budget. For a keystroke-latency-sensitive editor feature, the per-keystroke online update must be amortized `O(1)`; the offline array rebuild on every keystroke would be `O(n)` per stroke and visibly laggy on long documents. The lesson: match the *form* of the algorithm (online vs offline array) to the access pattern, not just its asymptotic class. For batch document processing the offline array is fine; for interactive per-character updates the online form (or the eertree) is required.

---

## 8. Code Examples

### 8.1 Go — Unicode-correct, integer-alphabet, sentinel-wrapped

```go
package main

import "fmt"

// manacherRunes runs Manacher over an int slice (code points or mapped symbols),
// wrapped with three distinct out-of-alphabet sentinels. Returns radii over t.
func manacherInts(s []int32) []int {
	// sentinels: -1 (#), -2 (^), -3 ($), all outside any real alphabet
	t := make([]int32, 0, 2*len(s)+3)
	t = append(t, -2) // ^
	for _, ch := range s {
		t = append(t, -1, ch) // # ch
	}
	t = append(t, -1, -3) // # $
	n := len(t)
	p := make([]int, n)
	c, r := 0, 0
	for i := 1; i < n-1; i++ { // sentinels guard the boundaries
		if i < r {
			if m := 2*c - i; r-i < p[m] {
				p[i] = r - i
			} else {
				p[i] = p[m]
			}
		}
		for t[i-p[i]-1] == t[i+p[i]+1] { // no bounds check: sentinels differ
			p[i]++
		}
		if i+p[i] > r {
			c, r = i, i+p[i]
		}
	}
	return p
}

func longestPalindrome(s string) string {
	runes := []rune(s)
	if len(runes) == 0 {
		return ""
	}
	si := make([]int32, len(runes))
	for i, r := range runes {
		si[i] = r
	}
	p := manacherInts(si)
	bestLen, bestC := 0, 0
	for i, v := range p {
		if v > bestLen {
			bestLen, bestC = v, i
		}
	}
	// in the sentinel layout, real chars sit at odd t-indices offset by the leading ^
	start := (bestC - 1 - bestLen) / 2
	return string(runes[start : start+bestLen])
}

func main() {
	fmt.Println(longestPalindrome("babad"))     // bab
	fmt.Println(longestPalindrome("amassé»éssam")) // unicode-safe demo
}
```

### 8.2 Java — code-point array (surrogate-safe)

```java
public class ManacherUnicode {
    // sentinels encoded as negative ints; real symbols are code points (>= 0)
    static int[] manacher(int[] s) {
        int[] t = new int[2 * s.length + 3];
        int k = 0;
        t[k++] = -2;                 // ^
        for (int ch : s) { t[k++] = -1; t[k++] = ch; }
        t[k++] = -1; t[k++] = -3;    // # $
        int n = t.length;
        int[] p = new int[n];
        int c = 0, r = 0;
        for (int i = 1; i < n - 1; i++) {
            if (i < r) p[i] = Math.min(r - i, p[2 * c - i]);
            while (t[i - p[i] - 1] == t[i + p[i] + 1]) p[i]++;
            if (i + p[i] > r) { c = i; r = i + p[i]; }
        }
        return p;
    }

    static String longest(String s) {
        int[] cps = s.codePoints().toArray();   // surrogate-safe
        if (cps.length == 0) return "";
        int[] p = manacher(cps);
        int bestLen = 0, bestC = 0;
        for (int i = 0; i < p.length; i++)
            if (p[i] > bestLen) { bestLen = p[i]; bestC = i; }
        int start = (bestC - 1 - bestLen) / 2;
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < start + bestLen; i++) sb.appendCodePoint(cps[i]);
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(longest("babad")); // bab
        System.out.println(longest("level")); // level
    }
}
```

### 8.3 Python — count with 64-bit safety and filtered variant

```python
def manacher(seq):
    """seq: a list/str of comparable symbols. Returns radius array p over t."""
    t = ["#"] * (2 * len(seq) + 1)
    for i, ch in enumerate(seq):
        t[2 * i + 1] = ch
    n = len(t)
    p = [0] * n
    c = r = 0
    for i in range(n):
        if i < r:
            p[i] = min(r - i, p[2 * c - i])
        while (i - p[i] - 1 >= 0 and i + p[i] + 1 < n
               and t[i - p[i] - 1] == t[i + p[i] + 1]):
            p[i] += 1
        if i + p[i] > r:
            c, r = i, i + p[i]
    return p


def count_all(s):
    # Python ints are arbitrary precision, but the *intent* is 64-bit; documents the scale.
    return sum((v + 1) // 2 for v in manacher(s))


def count_at_least(s, L):
    """Count palindromic substrings of length >= L."""
    total = 0
    for v in manacher(s):
        # contributions are lengths v, v-2, v-4, ...; keep those >= L
        # number of terms >= L among v, v-2, ... down to 1 or 2
        if v >= L:
            total += (v - L) // 2 + 1
    return total


if __name__ == "__main__":
    print(count_all("aaa"))        # 6
    print(count_at_least("aaa", 2))  # aa, aa, aaa = 3
```

---

## 9. Observability and Testing

A radius array is opaque — one wrong entry looks like any other small integer. Build checks from day one.

| Check | Why |
|-------|-----|
| Brute-force center-expansion oracle on small `n` | Catches the mirror-cap bug and recovery off-by-ones. |
| `len(longest_manacher) == len(longest_brute)` | The longest *length* must match even if the substring choice ties. |
| `count_manacher == count_brute` | Validates `Σ⌈p/2⌉` against an `O(n²)` enumeration. |
| Reverse-string symmetry | The longest palindrome of `s` reversed has the same length. |
| Radius bound `p[i] ≤ min(i, n-1-i)` (transformed) | A radius cannot exceed the distance to either end. |
| Sentinel integrity | Assert sentinels never equal a real symbol. |
| Determinism across languages | Same input → identical `p[]` in Go/Java/Python. |

The single most valuable test is the **brute-force oracle**: center-expansion that recomputes the longest length and the total count for `n ≤ 50` over a small alphabet (`ab`), property-tested on thousands of random strings. It catches the overwhelming majority of bugs, especially the missing mirror cap (which only fails on specific overlapping-palindrome inputs).

### 9.1 A property-test battery

```text
for random small string s over alphabet {a, b}:
    p = manacher(s)
    assert max_len(p) == brute_longest_len(s)
    assert sum((v+1)//2 for v in p) == brute_count(s)
    assert manacher(reverse(s)) gives same max length
    assert all p[i] <= min(i, len(t)-1-i)
    assert recovered substring is an actual palindrome and a substring of s
```

These five invariants on a few thousand instances give high confidence. The "recovered substring is actually a palindrome and actually a substring" check is especially good at catching recovery-formula errors that the length-only check would miss.

### 9.2 Targeted adversarial inputs

Random testing under-exercises the mirror cap because random strings rarely produce deeply overlapping palindromes. Add *hand-picked* adversarial cases to the suite:

- `a^n` for several `n` — maximal radii everywhere; stresses the count overflow and the tent shape.
- `(ab)^n` and `(abc)^n` — periodic strings with many overlapping odd palindromes; stresses the cap (`p[i]` must clamp to `r - i`).
- `aacecaaa`, `abacaba`, `forgeeksskeegfor` — known textbook cases with specific expected longest substrings.
- Strings with a unique long palindrome buried in noise (`xyz...abccba...xyz`) — checks recovery offsets.
- The empty string and single characters — boundary correctness.

A regression suite mixing these deterministic cases with thousands of random small strings is the standard guard. The deterministic cases pin known answers; the random cases catch unanticipated interactions, both diffed against the center-expansion oracle.

### 9.3 Differential testing across the three languages

Because this topic ships Go, Java, and Python implementations, run all three on the same inputs and assert byte-identical radius arrays (and identical longest/count). Any divergence localizes a language-specific bug — most often Java's `char` surrogate handling or Go/Python encoding differences. Differential testing is cheap (same inputs, three runs) and catches the encoding bugs that single-language tests miss entirely.

---

## 10. Failure Modes

### 10.1 Byte/character confusion
Running over UTF-8 bytes splits multibyte code points; results are garbage offsets and meaningless matches. Mitigation: run over runes/code points (Section 2).

### 10.2 Separator collision
Using `#` when the input contains `#` corrupts the radius-equals-length invariant. Mitigation: map to integers with negative sentinels, or pick a provably-absent separator (Section 3).

### 10.3 Missing mirror cap
Dropping `min(r - i, …)` claims palindromes past the box without verification; wrong on overlapping-palindrome inputs and — insidiously — *correct on many random inputs*, so it survives weak testing. Mitigation: keep the cap; property-test against the oracle.

### 10.4 Count overflow
The all-occurrence count is `Θ(n²)`; a 32-bit accumulator overflows for `n` beyond ~65k of repeated characters. Mitigation: 64-bit accumulation, or modular reduction if the problem asks for it.

### 10.5 Distinct vs all confusion
Using Manacher's `Σ⌈p/2⌉` to answer a *distinct*-palindrome question over-counts. Mitigation: use the eertree (sibling `14`) for distinct.

### 10.6 Memory blowup on huge inputs
The explicit `t` doubles memory; for hundred-MB inputs this can OOM. Mitigation: two-array (`d1`/`d2`) form, compact alphabets, `int32` radii (Section 5).

### 10.7 Recovery off-by-one
`start = (center - radius) / 2` (transform form) vs `(center - 1 - radius) / 2` (sentinel-with-leading-`^` form) differ by the sentinel offset. Mixing them shifts every substring by one. Mitigation: pin the layout, comment the formula, and test recovery (not just length) against the oracle.

### 10.8 Grapheme/normalization surprises
A user-facing "is this a palindrome" feature that ignores grapheme clusters or normalization reports counterintuitive results on accented or emoji text. Mitigation: normalize (NFC) and optionally segment graphemes before the transform; treat this as a product requirement, not an algorithm detail.

### 10.9 Box not updated after expansion
Forgetting the `if i + p[i] > r { c = i; r = i + p[i] }` update (or placing it before the expansion) leaves the box stale, so later centers copy from an outdated mirror and produce wrong radii. This bug often *passes* short tests because the first few centers establish the box correctly; it surfaces only when a later, longer palindrome should have advanced `r` but did not. Mitigation: update the box immediately after the expansion loop, every iteration, and property-test on periodic strings where the box advances repeatedly.

### 10.10 Reusing a stale scratch buffer
At scale, reusing a preallocated `t`/`p` buffer across calls is a performance win — but failing to *clear* or correctly re-slice it for a shorter input leaves stale data that corrupts the next result. Mitigation: track the active length explicitly and only read the live prefix; do not rely on residual array contents from a previous, longer input.

---

## 11. Summary

- Manacher computes the per-center palindrome radius in `O(n)` — the `#`-transform and the capped mirror reuse inside the box `[l, r]` are the whole engine; `r` only moves forward, giving amortized linear time.
- **Encoding is a correctness issue at scale:** run over code points (runes), not bytes; in Java use `codePoints()` to dodge surrogate pairs; consider grapheme clusters and NFC normalization for user-facing features.
- **The separator must be outside the alphabet:** map to an integer alphabet with negative sentinels, and wrap with two distinct end sentinels to drop bounds checks. This is the robust production layout.
- **Pick the right tool:** Manacher for longest / all-occurrence counts; the eertree (sibling `14`) for distinct palindromes and online per-prefix counts; hashing for arbitrary range or approximate palindrome queries.
- **Memory and cache:** keep `t` and `p` flat and contiguous, use `int32` radii and compact alphabets, prefer the two-array form when memory is the constraint, and reuse scratch buffers across calls.
- **Counting overflows:** the all-occurrence count is `Θ(n²)` in magnitude — accumulate in 64-bit; distinct counts require the eertree.
- **Test relentlessly:** a center-expansion oracle plus property tests (length match, count match, reverse symmetry, recovered-substring-is-a-palindrome) catch the missing-cap bug and recovery off-by-ones that opaque radii otherwise hide. Add adversarial periodic inputs and differential testing across languages.
- **Adapt the comparison, not the structure:** reverse-complement (DNA) palindromes and other symmetric predicates plug into the same box/mirror machinery by changing only the equality test, keeping the `O(n)` bound.
- **The radius array is reusable preprocessing:** longest, count, prefix/suffix, and factorization inputs are all reads of one `p[]`; cache it with the document and reuse scratch buffers across requests.

### Decision summary

- **Longest palindrome / all-occurrence count, large `n`** → Manacher (`O(n)`), Unicode-correct, integer alphabet.
- **Distinct palindromes / online per-prefix counts** → eertree (sibling `14`).
- **Arbitrary range or approximate palindrome queries** → polynomial hashing.
- **Memory-constrained huge input** → two-array (`d1`/`d2`) Manacher, compact alphabet, `int32` radii.
- **User-facing palindrome check on natural language** → normalize + grapheme-segment, then Manacher over cluster IDs.
- **Reverse-complement (DNA) palindromes** → Manacher with a complement-equality predicate; structure and `O(n)` bound unchanged.
- **Palindromic factorization / shortest-palindrome-by-prepend** → Manacher radii as the oracle feeding a DP / construction.
- **Both longest and distinct needed** → run Manacher and the eertree as two independent `O(n)` passes; neither subsumes the other.

### Production checklist

Before shipping a Manacher-based feature, confirm:

1. Input is decoded to code points (or grapheme clusters), not raw bytes.
2. The separator/sentinels are provably outside the alphabet (or you mapped to integers).
3. The mirror copy is capped with `min(r - i, …)`.
4. The box update `if i + p[i] > r` runs after every expansion.
5. Counts accumulate in 64-bit (or mod a prime if required).
6. Recovery uses the formula matching your layout, tested against the oracle.
7. Scratch buffers are reused and correctly re-sliced per input.
8. The test suite includes adversarial periodic inputs and differential cross-language checks.
9. The access pattern (batch vs interactive) is matched to the form (offline array vs online incremental).
10. The question is confirmed to be *occurrences/longest* (Manacher), not *distinct* (eertree) or *range/approximate* (hashing).

Working through this checklist takes minutes and prevents the entire catalogue of Section 10 failure modes. The algorithm itself almost never needs revisiting; the boundary decisions are where production correctness is won or lost.

A closing principle: at the senior level, the value you add is not knowing the box/mirror loop — any mid-level engineer has that — but knowing *which question* the loop answers, *what input model* it assumes, and *how it fails silently* on real data. The encoding bug, the separator collision, the all-vs-distinct mismatch, and the stale-buffer corruption are the incidents that actually page you; the loop itself is solved. Spend your review attention accordingly.

### One-paragraph takeaway for code review

When reviewing a Manacher PR, ask four questions in order: (1) Is the input a code-point sequence, not bytes? (2) Is the separator outside the alphabet (or did they map to integers)? (3) Is the mirror copy capped and the box updated every iteration? (4) Does the feature actually want occurrences/longest, or did someone reach for Manacher when the eertree or hashing was the right tool? If all four pass, the implementation is almost certainly correct and linear; if any fails, you have found the bug before it ships.

References to study further: Manacher (1975) original online algorithm, Gusfield's *Algorithms on Strings, Trees, and Sequences*, the eertree paper (Rubinchik-Shur 2015) for distinct palindromes, Unicode Annex #29 (grapheme cluster segmentation), and sibling topics `14-palindromic-tree` and string hashing.
