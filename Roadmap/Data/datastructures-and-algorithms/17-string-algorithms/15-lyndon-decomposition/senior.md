# Lyndon Words & Duval's Algorithm — Senior Level

> Duval's factorization is rarely the bottleneck on a single short string — but the moment you use the **smallest rotation as a canonical key** at scale (deduplicating millions of cyclic sequences, hashing necklaces, normalizing circular genomes, feeding the BWT), every detail (alphabet ordering, sentinel handling, `s + s` memory, hash collisions on the canonical form, streaming versus buffering) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Smallest Rotation as a Canonical Form](#2-smallest-rotation-as-a-canonical-form)
3. [Hashing and Deduplicating Cyclic Strings](#3-hashing-and-deduplicating-cyclic-strings)
4. [The Burrows-Wheeler Connection](#4-the-burrows-wheeler-connection)
5. [Streaming, Memory, and the `s + s` Trick](#5-streaming-memory-and-the-s--s-trick)
6. [Alphabet Engineering and Sentinels](#6-alphabet-engineering-and-sentinels)
7. [Performance Engineering of the Scan](#7-performance-engineering-of-the-scan)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "why does Duval work" but "what system am I actually building, and what breaks when I scale it?". Lyndon-based machinery shows up in production in three guises that look different but share one engine — the linear factorization:

1. **Canonicalization** — "treat all rotations of a circular sequence as one object." The smallest rotation is the canonical key; you store/compare/hash that. Examples: circular DNA plasmids, cyclic peptide identifiers, repeating-pattern deduplication, ring-buffer signatures.
2. **Combinatorial generation** — "emit every distinct necklace / every length-`k` window once." de Bruijn sequences for testing, fuzzing input coverage, rotary encoders, and shift-register design.
3. **Suffix and BWT preprocessing** — Lyndon factorization accelerates suffix-array and BWT construction (bijective BWT is *defined* via Lyndon words).

All three reduce to: *run the linear scan, read off factors or the straddling rotation, and use the result as a key or a building block.* The senior decisions are: how to pick the alphabet order and sentinel so the canonical form is meaningful, how to keep memory bounded when `s + s` doubles the buffer, how to avoid hash collisions when the canonical form becomes a database key, and how to verify correctness when inputs are too large or too many to eyeball.

This document treats those decisions in production terms.

---

## 2. Smallest Rotation as a Canonical Form

### 2.1 Why the smallest rotation is the right canonical key

Two strings are **rotation-equivalent** (same necklace) iff they have the same smallest rotation. So the smallest rotation is a *canonical representative*: a deterministic, comparison-friendly, hashable label for an entire rotation class. This is the workhorse application — far more common in practice than the raw factorization.

```
canonical(s) := the lexicographically smallest rotation of s   (via Duval on s+s)
```

Properties that make it production-grade:

- **Determinism:** the same circular sequence always maps to the same string, independent of where the input happened to start.
- **Total order:** canonical forms compare with ordinary string `<`, so you can sort, index, and range-query them.
- **Linear cost:** `O(n)` per string, so canonicalizing a batch of total length `N` is `O(N)`.

### 2.2 Equal-length requirement and the periodic trap

Canonicalization compares rotations of one fixed-length string. A subtle trap: a *periodic* string like `abab` has the same smallest rotation as `ab` would if you stripped the period, but as length-4 strings `abab` and `baba` are one necklace while `ab` and `ba` are another. Always canonicalize at the **actual length**; do not silently reduce periods unless the domain says rotation classes of different lengths are equivalent (they usually are not).

### 2.3 Canonical form and the unique Lyndon factor

If `s` itself is a Lyndon word, it is *already* its own smallest rotation (a Lyndon word is strictly smaller than all its rotations). More generally, the smallest rotation of `s` is the rotation that *starts* a Lyndon word in the factorization of `s + s` and spans `n` characters. This ties the canonical form directly to the factorization engine — one routine, two outputs.

### 2.4 Worked canonicalization at scale

Suppose you ingest circular sensor IDs that arrive at arbitrary rotations: `"3A7F"`, `"7F3A"`, `"F3A7"`, `"A7F3"` are all the same physical ring. Canonicalizing each (smallest rotation, hex order `0 < … < F`) maps all four to `"3A7F"` (the rotation starting at the smallest leading run). Two distinct rings, say `"3A7F"` and `"3A8F"`, canonicalize to different strings, so they never collide. The dedup set therefore stores one entry per physical ring regardless of where each reading happened to start — the whole point of a canonical form. The cost is `O(len)` per ID, so a million 4-char IDs canonicalize in milliseconds.

### 2.5 When two strings are NOT the same necklace

A frequent senior mistake is to assume that sharing a *substring* or a *character multiset* implies rotation-equivalence. It does not: `"aabb"` and `"abab"` have the same multiset `{a,a,b,b}` but are different necklaces (their smallest rotations are `"aabb"` and `"abab"`, which differ). Only equal canonical forms certify rotation-equivalence. Always compare canonical forms, never proxies like sorted characters or hashes of the raw input.

---

## 3. Hashing and Deduplicating Cyclic Strings

### 3.1 The dedup pipeline

To deduplicate a stream of circular sequences:

```
for each incoming sequence s:
    c = canonical(s)            # smallest rotation, O(|s|)
    key = hash(c)               # or store c directly
    if key not in seen: emit s; seen.add(key)
```

The canonical form collapses every rotation of the same necklace to one key, so `abc`, `bca`, `cab` all dedup together. This is the standard senior use: a Lyndon-powered `O(N)` canonicalizer feeding a hash set.

### 3.2 Collision and correctness concerns

- **Hash the canonical string, not the raw input.** Hashing the raw rotation defeats the purpose (rotations hash differently).
- **Beware fingerprint collisions.** If you store only a 64-bit hash of `c` and not `c` itself, two different necklaces can collide. For correctness-critical dedup, store the canonical string (or a cryptographic digest), or verify on collision.
- **Rolling-hash shortcut, with care.** You *can* compute the minimal rotation's hash without materializing it, but the safest pattern is: get the start index from Duval, then hash `s[idx:] + s[:idx]` (or hash modulo `n` on the index). Mixing a buggy "rotation-invariant hash" with Duval gives silent wrong dedup.

### 3.3 Canonical form as a database key

When the canonical form becomes a primary/unique key (e.g. "store each distinct necklace once"), you inherit ordinary string-index concerns: length limits, collation/alphabet order matching your Duval order, and case/normalization. The alphabet order used by Duval **must** match the collation used by the database index, or two systems will disagree on "smallest."

---

## 4. The Burrows-Wheeler Connection

### 4.1 Rotations, sorting, and BWT

The Burrows-Wheeler Transform (sibling `10-burrows-wheeler-transform`) sorts all rotations of a string and reads the last column. Lyndon words and the BWT are deeply linked:

- The **bijective BWT** (Gil-Scott / Kufleitner) is *defined* using the Lyndon factorization: factor the string into Lyndon words, then sort the cyclic rotations of those words. It needs no end-of-string sentinel `$`, which the classic BWT requires.
- Sorting rotations is exactly the "smallest rotation" problem generalized to a full order; Duval's straddling-factor idea is the local version of the global sort the BWT performs.

### 4.2 Why this matters at scale

The bijective BWT avoids the sentinel, which simplifies streaming and concatenation of many records (no per-record `$` bookkeeping), and the Lyndon factorization gives a clean, sentinel-free decomposition that some suffix-array construction algorithms (e.g. those using the *Lyndon array*) exploit for linear-time builds. If you are building compression or full-text indexing infrastructure, the Lyndon factorization is a foundational primitive, not a curiosity.

### 4.2b Worked sketch: why no sentinel

The classical BWT of `"banana"` appends `$`: it sorts the 7 rotations of `"banana$"` and reads the last column. The bijective BWT instead factors `"banana"` into Lyndon words `b · an · an · a`, sorts the cyclic rotations of those factors under infinite (`ω`) comparison, and reads last characters — producing a permutation of `"banana"`'s six characters with *no* extra symbol. The payoff in a streaming pipeline: concatenating records `r1 r2 r3 …` needs no per-record `$`, so there is no sentinel-collision risk and no wasted alphabet symbol. The Lyndon factorization is precisely the structure that makes the sentinel unnecessary — the factors' aperiodicity guarantees the `ω`-comparison is well-defined.

### 4.3 The Lyndon array

The **Lyndon array** `L[i]` = length of the longest Lyndon word starting at position `i` — is computable in `O(n)` and feeds suffix-array and run-detection algorithms. Senior takeaway: when you see "longest Lyndon word starting here" in a suffix-structure paper, it is the same factorization machinery, indexed per position rather than streamed.

### 4.4 Choosing classical vs bijective BWT in production

| Concern | Classical BWT (`s$`) | Bijective BWT (Lyndon) |
|---------|----------------------|------------------------|
| Sentinel | needs a unique `$` smaller than all chars | none required |
| Concatenating many records | per-record `$` bookkeeping | clean, sentinel-free |
| Invertibility | standard LF-mapping | LF-mapping on Lyndon rotations |
| Alphabet pressure | one reserved symbol | full alphabet usable |
| Implementation maturity | ubiquitous (bzip2, FM-index) | rarer, but growing |

For a single large document, the classical BWT with a sentinel is the well-trodden path. For a pipeline that block-sorts *many short records* (log lines, k-mers, short reads), the bijective variant avoids reserving and tracking a sentinel per record, which simplifies streaming and removes an alphabet symbol you might need for data. The Lyndon factorization is the enabling primitive either way — it is what defines the sentinel-free transform.

### 4.5 A caution on alphabet symbols

If you do use the classical BWT, the sentinel `$` must be *strictly smaller* than every real byte. A common bug is choosing `0x00` as the sentinel when the data itself can contain `0x00`; then `$` is not unique and the inverse transform corrupts. The bijective/Lyndon route sidesteps this entirely, which at scale (binary payloads, arbitrary bytes) is a real operational advantage.

---

## 5. Streaming, Memory, and the `s + s` Trick

### 5.1 The doubling cost

The smallest-rotation routine concatenates `s + s`, doubling memory to `2n`. For large `n` (genomes, logs), that doubling matters. Two mitigations:

- **Modular indexing:** never build `s + s`; index `t[idx] := s[idx % n]`. The Duval scan reads at most `2n` positions, all expressible as `s[idx % n]`. This keeps memory at `O(n)` with no copy.
- **Bounded scan:** you only need to scan until `i ≥ n`, so you never read the full `2n` in practice — stop early.

### 5.2 Streaming the factorization

Duval naturally streams: it emits each factor as soon as it is sealed, holding only the three pointers. For a multi-gigabyte string you can:

- process each Lyndon factor (write it out, hash it, count it) and discard it,
- never materialize the factor list,
- keep `O(1)` working state beyond the input buffer.

The one caveat: the *smallest rotation* needs `s + s` semantics, so it is not purely one-pass streaming over an unbounded stream — you need random access to wrap around. Pure factorization, however, is streamable left-to-right.

### 5.3 Chunking large inputs

If the input arrives in chunks, remember Duval's look-ahead can cross a chunk boundary (the inner loop may read ahead by a full period). Buffer enough trailing context (at least the current candidate length) so a factor straddling a boundary is handled correctly. Naive per-chunk factorization without carry-over produces wrong factors at the seams.

### 5.4 What "carry the candidate" means concretely

When a chunk ends mid-candidate, you must preserve the algorithm's *full* working state across the chunk load: the pointers `i, j, k` (as offsets into the global stream), the period `p`, and enough buffered characters to re-read the unfinished candidate. The minimal buffer is the current candidate length `j - i`, because the next comparison needs `s[k]` and `s[j]` which both lie within `[i, j]`. A clean design keeps a sliding window anchored at `i`: discard everything before `i` (already emitted), keep `[i, j)` plus the incoming chunk. This bounds working memory to `O(max candidate length + chunk size)`, independent of total stream length — the streaming guarantee from Section 5.2, made operational for chunked I/O.

---

## 6. Alphabet Engineering and Sentinels

### 6.1 The alphabet order *is* the spec

Duval's output depends entirely on the character ordering. Decisions that bite later:

- **Case sensitivity:** `A < a` in ASCII; if the domain treats them as equal, normalize first.
- **Numeric vs lexicographic:** `"10" < "2"` lexicographically; if elements are numbers, encode them fixed-width or compare numerically via a custom order.
- **Multi-byte / Unicode:** decide whether you compare bytes (UTF-8 order ≈ code-point order, conveniently) or code points; mixing them corrupts the canonical form.

Pin the order once, document it, and make every consumer (database collation, comparison in tests, cross-service canonicalization) use the *same* order.

### 6.2 Sentinels and the largest rotation

- For the **largest** rotation, invert the alphabet (`c → MAX - c`) and reuse the smallest routine; do not maintain a second hand-tuned comparison.
- The **classic** BWT needs a unique smallest sentinel `$` smaller than all real characters; the **bijective** BWT (Section 4) avoids it via Lyndon factorization. Choose deliberately: a wrong/duplicated sentinel silently breaks the inverse transform.

### 6.3 Tie-breaking and equal elements

When characters can be equal (the common case), Duval's `s[k] == s[j]` branch handles ties by extending the period. If you build a *custom* comparator for a non-character alphabet, it must be a **total order** with consistent ties; a comparator that returns "equal" inconsistently makes the scan loop or emit non-Lyndon factors.

### 6.4 Normalization before canonicalization

Canonicalization composes with, but does not replace, *normalization*. If your domain treats `"Abc"` and `"abc"` as the same ring, you must case-fold *before* canonicalizing — otherwise `A` (0x41) and `a` (0x61) compare differently and the two strings get different canonical forms. The correct pipeline is: normalize (case fold, Unicode NFC, trim) → map to ranks under the agreed order → canonicalize (smallest rotation). Skipping or reordering these steps is a frequent source of "why didn't these dedup?" tickets. Pin the normalization rules in the same config as the alphabet order so they travel together across services.

---

## 7. Performance Engineering of the Scan

### 7.1 The character-comparison constant dominates

Duval is `O(n)` with a tiny constant: one comparison and a few integer updates per step. The levers:

- **Never build substrings in the inner loop.** Compare `s[k]` vs `s[j]` as raw code units. Building `s[i:]` is the single most common way to turn linear into quadratic.
- **Use byte slices/arrays** for ASCII/byte alphabets — avoids per-character object boxing in Java/Python and bounds-check overhead.
- **Modular indexing over copying** for `s + s` (Section 5.1) — halves memory traffic.
- **Emit indices, not copies.** For the rotation problem, return the start index and let the caller slice once; do not copy candidate factors during the scan.

### 7.2 Batch canonicalization

Canonicalizing many strings is embarrassingly parallel: each string is independent. Shard across worker threads/goroutines. The factorization itself is sequential (look-ahead depends on prior state), so parallelism lives *across* strings, not within one scan.

### 7.3 Generation throughput

FKM/Duval generation emits each Lyndon word in amortized `O(1)`. For de Bruijn construction the cost is `O(σᵏ)` (the output length), which is optimal — you cannot beat writing the answer. Memory is `O(k)` for the working word plus the output buffer; stream the output if `σᵏ` is large.

### 7.4 Throughput numbers to expect

On commodity hardware, a tight byte-array Duval scan canonicalizes on the order of hundreds of MB/s single-threaded (one comparison + a few integer ops per character, dominated by memory bandwidth). Practical implications:

| Workload | Rough cost |
|----------|-----------|
| Canonicalize 1M IDs of length 16 | tens of ms, single thread |
| Factor a 1 GB string (streaming) | a few seconds, memory-bandwidth bound |
| Dedup 100M short records by canonical form | minutes; bottleneck is the hash set, not Duval |
| Build `B(4, 12)` de Bruijn (`4¹² ≈ 1.7×10⁷`) | sub-second to write the output |

The lesson: at scale the **hash set / storage layer usually dominates**, not the linear scan. Optimize the canonical-form pipeline end to end (avoid per-record allocation, reuse buffers), and parallelize canonicalization across records since each is independent.

---

## 7b. A Worked Dedup-Pipeline Post-Mortem

A realistic failure: a team deployed a "necklace dedup" service that intermittently kept duplicates. Walking the diagnosis demonstrates the senior failure modes in context.

1. **Symptom.** The same circular plasmid sequence appeared twice in storage, with different starting offsets.
2. **First hypothesis (wrong).** "Hash collision." Ruled out: the stored keys were full canonical strings, not 64-bit hashes.
3. **Second hypothesis (correct).** The canonicalizer hashed the *raw* input in one code path (the fast path for "short" inputs) and the canonical form in the slow path. The fast path was a copy-paste that skipped `canonical()`. Rotations of one plasmid hit the fast path and were stored unmerged.
4. **Fix.** Route *all* inputs through `canonical()` before the set lookup; delete the fast path. Add a property test asserting `canonical(rotate(s, r)) == canonical(s)` that runs in CI on random inputs.
5. **Hardening.** Add an assertion at the storage boundary that the key equals `canonical(key)` (idempotence of canonicalization), catching any future code path that forgets to canonicalize.

The root cause — *hashing before canonicalizing on one path* — is Failure Mode 10.3 below, and the post-mortem's lasting fix is the **rotation-invariance property test** (Section 9). The broader lesson: canonicalization must be a single chokepoint, not duplicated logic, or one branch will eventually skip it.

---

## 8. Code Examples

### 8.1 Go — canonical form (smallest rotation) with modular indexing, no `s+s` copy

```go
package main

import "fmt"

// leastRotationIndex finds the start of the smallest rotation without building s+s.
func leastRotationIndex(s []byte) int {
	n := len(s)
	at := func(idx int) byte { return s[idx%n] } // modular wrap-around
	i, ans := 0, 0
	for i < n {
		ans = i
		j, k := i+1, i
		for j < 2*n && at(k) <= at(j) {
			if at(k) < at(j) {
				k = i
			} else {
				k++
			}
			j++
		}
		for i <= k {
			i += j - k
		}
	}
	return ans
}

func canonical(s string) string {
	b := []byte(s)
	idx := leastRotationIndex(b)
	return string(b[idx:]) + string(b[:idx])
}

func main() {
	for _, s := range []string{"bca", "cab", "abc", "bbaaccaadd"} {
		fmt.Printf("%-12s -> %s\n", s, canonical(s))
	}
}
```

### 8.2 Java — dedup a batch of cyclic strings by canonical form

```java
import java.util.*;

public class CyclicDedup {
    static int leastRotation(String s) {
        int n = s.length();
        int i = 0, ans = 0;
        while (i < n) {
            ans = i;
            int j = i + 1, k = i;
            while (j < 2 * n && s.charAt(k % n) <= s.charAt(j % n)) {
                if (s.charAt(k % n) < s.charAt(j % n)) k = i;
                else k++;
                j++;
            }
            while (i <= k) i += j - k;
        }
        return ans;
    }

    static String canonical(String s) {
        int idx = leastRotation(s);
        return s.substring(idx) + s.substring(0, idx);
    }

    static List<String> dedup(List<String> seqs) {
        Set<String> seen = new HashSet<>();
        List<String> out = new ArrayList<>();
        for (String s : seqs) {
            String c = canonical(s);
            if (seen.add(c)) out.add(s); // keep first occurrence of each necklace
        }
        return out;
    }

    public static void main(String[] args) {
        List<String> in = Arrays.asList("abc", "bca", "cab", "xy", "yx");
        System.out.println(dedup(in)); // [abc, xy]  (rotations collapsed)
    }
}
```

### 8.2b Python — custom alphabet order via a key map

When the alphabet is not raw bytes (e.g. tokens, or a case-insensitive order), map each symbol to a small integer rank *once*, then run Duval on the rank sequence. This keeps the comparison `O(1)` and the order explicit.

```python
def canonical_with_order(seq, rank: dict) -> list:
    """Smallest rotation of `seq` under the total order given by `rank`."""
    coded = [rank[x] for x in seq]          # map symbols to integer ranks
    n = len(coded)
    i, ans = 0, 0
    while i < n:
        ans = i
        j, k = i + 1, i
        while j < 2 * n and coded[k % n] <= coded[j % n]:
            k = i if coded[k % n] < coded[j % n] else k + 1
            j += 1
        while i <= k:
            i += j - k
    return seq[ans:] + seq[:ans]


if __name__ == "__main__":
    # case-insensitive order: A and a share rank
    order = {c: i for i, c in enumerate("abcdefghijklmnopqrstuvwxyz")}
    ranked = {**order, **{c.upper(): order[c] for c in order}}
    print(canonical_with_order(list("Bca"), ranked))  # ['a', 'B', 'c'] -> ring abc
```

The crucial discipline: the `rank` map is the spec. Every system that compares canonical forms must use the *same* map, or "smallest" diverges (Failure Mode 10.2).

### 8.3 Python — streaming Lyndon factorization (constant working state)

```python
from typing import Iterator


def duval_stream(s: str) -> Iterator[tuple[int, int]]:
    """Yield (start, length) of each Lyndon factor; never builds a factor list."""
    n, i = len(s), 0
    while i < n:
        j, k = i + 1, i
        while j < n and s[k] <= s[j]:
            k = i if s[k] < s[j] else k + 1
            j += 1
        p = j - k                       # period length
        while i <= k:
            yield (i, p)                # factor s[i:i+p]
            i += p


if __name__ == "__main__":
    s = "bbababaa"
    for start, length in duval_stream(s):
        print(start, length, s[start:start + length])
    # process each factor as it is produced; O(1) extra state beyond s.
```

---

## 9. Observability and Testing

A canonical-form result is opaque — a wrong smallest rotation looks like any other string. Build in checks from day one.

| Check | Why |
|-------|-----|
| Brute-force least-rotation oracle on small `n` | Catches off-by-one and `s+s` boundary bugs. |
| `canonical(rotate(s, r)) == canonical(s)` for all `r` | The defining invariant of a canonical form. |
| `is_lyndon` on every Duval factor | Confirms factors are genuinely Lyndon. |
| Non-increasing-order assertion on factors | Confirms the Chen-Fox-Lyndon ordering. |
| `concat(factors) == s` | Confirms the factorization covers the string exactly. |
| de Bruijn window-coverage test | Every length-`k` string appears exactly once. |
| Determinism across languages | Same alphabet order → identical Go/Java/Python canonical forms. |

The single most valuable test is the **rotation-invariance property**: for random small `s` and every rotation amount `r`, assert `canonical(rotate(s, r)) == canonical(s)`. It catches the overwhelming majority of bugs, including the subtle `s + s` index errors.

### 9.1 A property-test battery

```text
for random string s, random rotation r in [0, |s|):
    assert canonical(rotate(s, r)) == canonical(s)        # rotation invariance
    assert canonical(s) <= rotate(s, r)                    # canonical is the minimum
    factors = duval(s)
    assert "".join(factors) == s                           # coverage
    assert all(is_lyndon(f) for f in factors)              # each factor Lyndon
    assert non_increasing(factors)                         # CFL ordering
for de Bruijn B(sigma, k):
    assert len(B) == sigma**k
    assert every length-k window (cyclically) is distinct
```

These invariants, on a few hundred random instances, give high confidence. The `canonical(s) <= rotate(s, r)` minimality test is especially good at catching a smallest-rotation routine that returns *a* rotation start but not the *minimum* one.

### 9.2 Production guardrails

For a service canonicalizing cyclic keys at scale, add: an **alphabet-order assertion** (the comparison used must match the storage collation); a **length validator** (canonicalization is per-length — reject mixed-length comparisons unless intended); and a **collision audit** when storing only hashes of canonical forms (log and verify on hash equality if correctness is critical).

### 9.3 Metrics worth emitting

| Metric | Why it matters |
|--------|----------------|
| Canonicalization latency p50/p99 | Detects accidental `O(n²)` regressions (substring-in-loop). |
| Input length distribution | Long-tail inputs drive the `s+s` memory and latency. |
| Dedup hit rate | A sudden drop may signal an alphabet-order mismatch breaking dedup. |
| Idempotence violations | `canonical(key) != key` at the storage boundary flags a skipped canonicalization path. |
| Distinct-necklace count vs input count | Ratio sanity-checks the dedup logic over time. |

A latency regression on the canonicalizer is almost always the **substring-in-inner-loop** anti-pattern reappearing after a refactor; the p99 spike is the early-warning signal. The idempotence metric is the cheapest, highest-value guard: it catches the exact bug from the post-mortem in Section 7b.

### 9.4 Cross-language determinism

If Go, Java, and Python services all canonicalize, pin: (1) the same alphabet/byte order, (2) the same handling of multi-byte input (compare bytes, not code points, or all compare code points), and (3) the same normalization (case folding, Unicode NFC) *before* canonicalization. A property test that feeds the same random inputs to all three and asserts identical canonical forms is the definitive guard against subtle cross-runtime drift (e.g. one language comparing UTF-16 code units, another comparing UTF-8 bytes).

---

## 10. Failure Modes

### 10.1 Substring construction in the inner loop

Building `s[i:]` or `s[k:]` to compare turns Duval from `O(n)` into `O(n²)`. Symptom: linear-looking code that times out on long inputs. Mitigation: compare single code units only.

### 10.2 Alphabet-order mismatch across systems

The factorizer uses one order; a downstream database index or another service uses a different collation. Two systems disagree on "smallest," so the same necklace gets two canonical forms and dedup fails. Mitigation: pin and share the exact ordering; assert it at boundaries.

### 10.3 Hashing the raw rotation, not the canonical form

Hashing `s` instead of `canonical(s)` makes rotations hash differently, defeating dedup entirely. Mitigation: always canonicalize *before* hashing.

### 10.4 `s + s` index off-by-one

Returning a rotation start `≥ n`, or reading past `2n`, yields a wrong rotation. Mitigation: guard `j < 2n`, and remember the answer index is always `< n`.

### 10.5 Strict-vs-non-strict comparison flip

Using `<` where Duval needs `<=` (or resetting `k` on equality instead of on strict `<`) produces non-Lyndon factors that silently pass length checks. Mitigation: the inner guard is `s[k] <= s[j]`; reset `k = i` only on strict `s[k] < s[j]`.

### 10.6 Periodic-string canonicalization confusion

Treating `abab` as equivalent to `ab` (stripping the period) when the domain keeps them distinct. Mitigation: canonicalize at the actual length; only collapse periods if the spec says different-length rotation classes are equal.

### 10.7 Chunk-boundary factorization

Factorizing a large input chunk-by-chunk without carrying the candidate across the seam produces wrong factors at boundaries (the look-ahead crosses chunks). Mitigation: buffer trailing context at least as long as the current candidate, or factor the full buffer.

### 10.8 de Bruijn divisibility filter omitted

Concatenating *all* Lyndon words up to length `k` instead of only those whose length divides `k` yields a string that is not a de Bruijn sequence (wrong length, windows missing/duplicated). Mitigation: keep only Lyndon words with `len | k`.

### 10.9 Worked failure: the substring-in-loop regression

A subtle, recurring production regression: a refactor replaces the character comparison `s[k] <= s[j]` with a "cleaner" helper `lessOrEqual(s.substring(k), s.substring(j))`. Each call now builds two substrings of length up to `n`, so the inner loop is `O(n)` per step and the whole scan becomes `O(n²)`. Symptom: canonicalization latency p99 jumps from microseconds to seconds on long inputs, while short inputs look fine in tests. Diagnosis: profile shows time inside `substring`/string allocation. Fix: restore single-character comparison; add a benchmark on a long adversarial input (`"a"*100000 + "b"`) to CI so the regression cannot reappear silently. This is the single most common way to destroy Duval's linear guarantee, and it survives unit tests that only use short strings.

### 10.10 Mixed-length necklace comparison

Comparing canonical forms of strings of *different* lengths and treating equality as "same necklace" is meaningless — necklaces of different lengths are never equal. A guard `len(a) == len(b)` must precede any necklace-equality check. Omitting it produces false negatives (never equal) at best, or, if the lengths coincidentally match shorter periods, subtle false positives. Mitigation: always key by `(length, canonical_form)`.

---

## 11. Summary

- The headline senior use of Lyndon machinery is the **smallest rotation as a canonical form**: a deterministic, sortable, hashable label collapsing every rotation of a circular sequence into one key, computed in `O(n)` via Duval on `s + s`.
- Build the dedup/canonicalization pipeline by **canonicalizing before hashing**; store the canonical string (or verify on hash collision) when correctness matters.
- The **alphabet order is the spec** — it must match every downstream consumer's collation, or two systems disagree on "smallest" and dedup silently fails.
- Keep memory at `O(n)` with **modular indexing** instead of copying `s + s`; **stream** the factorization (only three pointers of state) for huge inputs, buffering trailing context across chunk boundaries.
- Lyndon factorization underpins the **bijective BWT** (sentinel-free), the **Lyndon array**, and linear suffix-array construction — a foundational primitive for compression and full-text indexing (sibling `10-burrows-wheeler-transform`).
- Performance lives in the **character-comparison constant**: never build substrings in the inner loop, use byte arrays, emit indices not copies, and parallelize *across* strings (the scan itself is sequential).
- Always keep a **brute-force least-rotation oracle** and the **rotation-invariance property test**; they catch the `s+s` off-by-one, the strict-vs-non-strict flip, and the alphabet-order mismatch that account for nearly every real bug.

### Decision summary

- **Canonicalize circular sequences / dedup necklaces** → smallest rotation via Duval on `s+s` (`O(n)`), hash the canonical form.
- **Largest rotation** → invert the alphabet, reuse the smallest routine.
- **Huge / streaming input, pure factorization** → stream Duval with modular indexing, `O(1)` extra state.
- **Compression / full-text indexing** → Lyndon factorization for bijective BWT and Lyndon-array suffix construction.
- **Coverage/fuzzing windows** → de Bruijn via Lyndon words whose length divides `k`.
- **Many other substring queries on the same string** → build a suffix array/automaton instead.
- **Mixed-length inputs** → key by `(length, canonical form)`; never compare canonical forms across lengths.
- **Multi-runtime services** → pin alphabet order, byte-vs-codepoint comparison, and pre-normalization; property-test cross-language identity.
- **Binary/arbitrary-byte payloads** → prefer the bijective (Lyndon) BWT to avoid sentinel-collision with in-band bytes like `0x00`.

### Operational checklist

Before shipping a Lyndon-based canonicalization service, confirm:

1. All inputs flow through a *single* `canonical()` chokepoint (no fast-path that skips it).
2. The comparison order matches every downstream consumer's collation, asserted at boundaries.
3. The inner loop compares single characters/bytes — no substring construction (CI benchmark on a long adversarial input).
4. `s + s` is avoided via modular indexing when memory matters; the rotation index is clamped to `[0, n)`.
5. Canonicalization is idempotent (`canonical(canonical(s)) == canonical(s)`), asserted at the storage boundary.
6. The rotation-invariance property test runs in CI on random inputs across Go, Java, and Python.
7. Metrics emit canonicalization p99, dedup hit rate, and idempotence-violation count.

These seven items turn a fragile snippet into a production-grade canonicalizer; items 1, 3, and 5 catch the three most common real incidents.

References to study further: Duval (1983) for the original algorithm; Gil-Scott and Kufleitner for the bijective BWT; the Lyndon-array suffix-construction literature; FKM (1978) for de Bruijn generation; and sibling topics `10-burrows-wheeler-transform`, `04-suffix-arrays`, and `12-suffix-automaton`.

### One-paragraph takeaway

At the senior level, Lyndon factorization is rarely interesting for its own sake — it earns its keep as the engine behind the **smallest-rotation canonical form**. Treat canonicalization as a single, well-tested chokepoint; pin the alphabet order and normalization rules so every consumer agrees on "smallest"; keep the inner loop comparing single characters so the linear guarantee survives refactors; and guard the pipeline with the rotation-invariance property test and an idempotence assertion at the storage boundary. Do those four things and the same humble three-pointer scan that factors a string also powers reliable, sortable, hashable canonical keys for circular data at scale — and feeds the sentinel-free bijective BWT and Lyndon-array suffix construction when you build indexing infrastructure on top.
