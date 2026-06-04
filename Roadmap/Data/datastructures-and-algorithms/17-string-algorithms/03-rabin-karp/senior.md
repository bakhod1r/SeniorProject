# Rabin-Karp (Rolling-Hash String Matching) — Senior Level

> Rabin-Karp is rarely the bottleneck on a single small search — but the moment the input is adversarial, the modulus pushes against 64-bit limits, or the rolling hash becomes the fingerprint engine inside a backup, dedup, or sync system, every detail (hash flooding, overflow, reduction strategy, chunk-boundary stability, verification policy) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Hash Flooding and Adversarial Inputs](#2-hash-flooding-and-adversarial-inputs)
3. [64-bit Overflow, Mersenne Primes, and Montgomery/Barrett](#3-64-bit-overflow-mersenne-primes-and-montgomerybarrett)
4. [Fingerprinting and Rabin Fingerprints](#4-fingerprinting-and-rabin-fingerprints)
5. [Content-Defined Chunking (rsync, backup, dedup)](#5-content-defined-chunking-rsync-backup-dedup)
6. [Verification Policy in Production](#6-verification-policy-in-production)
7. [Code Examples](#7-code-examples)
8. [Testing and Observability](#8-testing-and-observability)
9. [Concurrency, Streaming, and Memory](#9-concurrency-streaming-and-memory)
10. [Migration, Benchmarking, and Tool Selection](#10-migration-benchmarking-and-tool-selection)
11. [Security Boundaries: What a Rolling Hash Is Not](#11-security-boundaries-what-a-rolling-hash-is-not)
12. [Production Incident Patterns](#12-production-incident-patterns)
13. [Testing and Observability](#13-testing-and-observability)
14. [Failure Modes](#14-failure-modes)
15. [Summary](#15-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the rolling hash work" but "what system am I embedding it in, and what breaks when it scales or is attacked?" Rolling hashes show up in three guises that look different but share one engine:

1. **Pattern matching under adversarial or untrusted input** — a user-supplied text and pattern, where a fixed hash invites a deliberate `O(n·m)` slowdown (hash flooding).
2. **Fingerprinting** — reducing a block of bytes to a short, stable identifier for equality, indexing, or change detection (Rabin fingerprints, document similarity, plagiarism detection).
3. **Content-defined chunking** — splitting a byte stream into variable-length chunks at *content-determined* boundaries so that an insertion shifts only one chunk, not all of them (the heart of `rsync`, `restic`, `borg`, `ZFS dedup`, Dropbox, and Git's pack heuristics).

All three reduce to: *maintain a polynomial hash of a sliding window in `O(1)`, and make a decision when the hash satisfies some predicate* — equals a target, lands in a set, or hits zero in its low bits. The senior decisions are: how to keep the hash unforgeable, how to keep the arithmetic exact and overflow-free at speed, how to keep chunk boundaries stable, and how to verify and observe the result in production.

These four decisions recur as a checklist throughout this document:

1. **Unforgeability** — randomized private base (Section 2), never a fixed public hash on untrusted input.
2. **Exact arithmetic** — modulus chosen for the word width (Section 3), reduce every step, guard the sign.
3. **Verification policy** — match the strength of the equality check to the cost of being wrong (Section 6).
4. **Boundary/identity stability** — content-defined boundaries and strong per-block hashes for dedup (Sections 4–5).

Getting any one of these implicitly wrong is the root cause of essentially every rolling-hash production incident (Section 12).

---

## 2. Hash Flooding and Adversarial Inputs

### 2.1 The attack

Rabin-Karp's `O(n·m)` worst case is not academic; it is a reproducible denial-of-service primitive against any service that hashes user-controlled strings with fixed parameters. If the base and modulus are **fixed and public**, an attacker can construct a text where *every* window collides with the pattern hash, forcing a full `O(m)` verification at every position. The same vulnerability underlies algorithmic-complexity DoS attacks against any deterministic hash (the classic "hash flooding" against language hash tables). A search service that hashes user input with a hard-coded `(31, 10^9+7)` can be driven to a crawl by a crafted query.

### 2.2 The defense: randomize the base

Pick the base **uniformly at random** from `[256, p)` at process start (or per request), keeping it secret from the attacker. By the polynomial-root argument, for any two fixed distinct strings the collision probability over a random base is at most `(m−1)/p` — and the attacker, not knowing the base, cannot construct colliding inputs in advance. This converts the worst case from "adversary-triggerable" to "negligibly improbable." The base is drawn once per process (or per request for stronger isolation) and never exposed to clients; the pattern hash is recomputed under the new base at startup, so the change is transparent to the rest of the matcher.

```
base = 256 + secureRandomInt(p - 256)   // chosen once, kept private
```

Use a **cryptographically seeded** RNG if the threat model includes an adversary who can observe timing and infer the base; a plain PRNG suffices for accidental-worst-case avoidance. Note: a randomized rolling hash is *not* a MAC — it resists complexity attacks, not forgery of the hash value itself. For authentication use a keyed cryptographic hash.

### 2.3 Defense in depth

- **Always verify.** Even a flooded hash cannot produce a false *reported* match if you verify characters. Flooding attacks degrade *performance*, not correctness — verification caps the damage and randomization removes the trigger.
- **Cap verification work.** In a service, bound total verification time and bail out (or fall back to KMP) if spurious hits exceed a threshold — a sign of an attack or a pathological input.
- **Rate-limit and size-limit.** Independent of the hash, cap pattern and text lengths per request; an `O(nm)` worst case is bounded by `O(L_max²)` if both are capped.
- **Prefer a deterministic fallback for guarantees.** If a tenant requires a hard latency SLO regardless of input, run KMP/Z for them; reserve Rabin-Karp for the multi-pattern/2D workloads where it is genuinely better.

### 2.4 Threat-model checklist

Before shipping a rolling hash in a service, answer:

1. **Can the input be adversarial?** If yes, randomize the base and keep it private per process.
2. **Can timing leak the base?** If the threat model includes timing side channels, use constant-time verification or a keyed cryptographic hash instead.
3. **What is the cost of a wrong answer?** Substring search: keep verification. Dedup: add a strong per-block hash. Similarity: approximate is fine.
4. **What is the maximum input size?** Cap it; the worst case is quadratic in the cap.
5. **Is the hash ever exposed to clients?** If so, never treat it as authentication — it is forgeable.

---

## 3. 64-bit Overflow, Mersenne Primes, and Montgomery/Barrett

### 3.1 The overflow hazard

The roll computes products like `h · b` and `T[i] · highPow`. With `h, b < p` and `p ≈ 10^9`, the product is `< 10^{18}`, which fits in a signed 64-bit integer (`< 9.2·10^{18}`). So a **30-bit modulus is overflow-safe in 64 bits** — this is why `10^9 + 7` is the workhorse. But a `2^61 − 1` modulus produces products up to `2^{122}`, which overflows 64 bits and needs 128-bit multiplication or a custom `mulmod`.

### 3.2 The 61-bit Mersenne prime

`p = 2^61 − 1` is prime and admits an exceptionally fast reduction without a hardware divide. Because `2^61 ≡ 1 (mod p)`, a 122-bit product `x` splits as `x = hi·2^61 + lo`, and `x mod p = (hi + lo) mod p`, finished with at most one conditional subtraction. With `__int128` (C/C++/Rust) or `math/bits.Mul64` (Go) or `Math.multiplyHigh` (Java 9+), this is a handful of instructions and gives a ~`10^{-18}` collision rate from a *single* hash.

```
// reduce a 128-bit product x modulo 2^61 - 1
lo = x & ((1<<61) - 1)
hi = x >> 61
r  = lo + hi
if r >= (1<<61)-1: r -= (1<<61)-1
```

### 3.3 Montgomery and Barrett reduction

When the modulus is arbitrary (not a Mersenne form) and you do millions of reductions, the hardware `%` (a divide) dominates. Two divide-free techniques:

- **Barrett reduction** precomputes `μ = ⌊2^{2k}/p⌋` and replaces each `% p` with two multiplies and a shift. Good when `p` is fixed and known at compile time.
- **Montgomery reduction** works in a transformed "Montgomery domain" where reduction is multiply-shift-subtract with no divide; ideal for long chains of modular multiplies (e.g., big-integer or NTT code). For a single rolling hash Barrett is usually simpler and sufficient.

In practice, for string matching, **a 30-bit prime in 64-bit arithmetic needs neither** — the native `%` is fine. Reach for Barrett/Montgomery only when profiling shows the modulo dominating a hot loop, or when you must use a large arbitrary prime.

### 3.4 Choosing the integer width deliberately

The arithmetic width is a design decision, not a default:

| Modulus | Product range | Width needed | Reduction |
|---------|---------------|--------------|-----------|
| `~10^9` (30-bit) | `< 10^{18}` | signed 64-bit | native `%` |
| `~2·10^9` (31-bit) | `< 4·10^{18}` | signed 64-bit (tight) | native `%`, watch sign |
| `2^{61}−1` | `< 2^{122}` | 128-bit product | Mersenne fold |
| arbitrary 62-bit | `< 2^{124}` | 128-bit product | Barrett/Montgomery |

The 31-bit row is a common trap: `(2·10^9)² ≈ 4·10^{18}` is close to the signed 64-bit ceiling `9.2·10^{18}`, so a stray unreduced addition can overflow. Either stay at 30 bits with comfortable headroom, or jump to a 128-bit-product scheme; the in-between is fragile.

### 3.5 Constant-time considerations

If verification timing could leak whether a hit was spurious (a side channel revealing the secret base), use a constant-time comparison for the verification step (compare all `m` bytes regardless of the first mismatch, accumulating a difference flag). This matters only in adversarial-base threat models; ordinary search should short-circuit on the first mismatch for speed.

---

## 4. Fingerprinting and Rabin Fingerprints

A **Rabin fingerprint** treats a byte string as the coefficients of a polynomial over `GF(2)` and reduces it modulo a fixed irreducible polynomial — arithmetic that maps directly onto XOR and shifts, making it extremely fast in hardware and software. The polynomial-hash Rabin-Karp uses over `Z_p` is the integer analogue. Both share the rolling property: a fingerprint of a window updates in `O(1)` as the window slides.

Applications:

- **Document similarity / plagiarism detection.** Fingerprint every length-`w` window (a "shingle") of two documents; the fraction of shared fingerprints estimates similarity. **Winnowing** selects a deterministic subset of window fingerprints (the minimum in each local range) so that document alignment is preserved and the comparison stays sparse — the basis of MOSS-style plagiarism detectors.
- **Deduplication index.** Fingerprint fixed-size blocks; store each block once keyed by fingerprint; references point to the fingerprint. Two identical blocks collapse to one. (Fixed-size blocking is fragile under insertion — see chunking below.)
- **Cache and CDN keys.** A rolling fingerprint of a request body yields a stable cache key.

The fingerprint is a *hint*: equal fingerprints still require a byte comparison before declaring blocks identical in a dedup store, exactly as Rabin-Karp verifies a hash hit. Storing colliding-but-different blocks as identical would corrupt data.

### 4.1 Winnowing in detail

Naively comparing *all* window fingerprints of two documents is `O(document size)` per document but produces a huge, position-sensitive fingerprint set. **Winnowing** (Schleimer, Wilkerson, Aiken 2003) selects a sparse, robust subset with two guarantees: (i) **density** — at most `2/(w−t+2)` of windows are selected for a guarantee window of size `w`, bounding storage; (ii) **robustness** — if two documents share a substring of length at least `w + t − 1`, at least one fingerprint is guaranteed to be selected in both, so the shared region is detected. The algorithm slides a window of `w` consecutive `t`-gram fingerprints and selects the *minimum* fingerprint in each window (breaking ties by rightmost position). Because the minimum is a local, position-stable choice, inserting or deleting text outside a region leaves its selected fingerprints unchanged — the same boundary-stability principle as CDC, applied to fingerprint selection rather than chunk boundaries. This is the core of MOSS and similar plagiarism detectors: rolling-hash `t`-grams + winnowing + an inverted index from fingerprint to document.

### 4.2 Similarity estimation pipeline

A typical plagiarism/dedup similarity pipeline layers the techniques: (1) roll a hash over every `t`-gram (the rolling hash of this document); (2) winnow to a sparse fingerprint set; (3) index fingerprints to documents; (4) for each query document, look up its winnowed fingerprints and count shared ones per candidate; (5) verify top candidates with an exact alignment (e.g. local sequence alignment) on the raw text. Steps 1–2 are the Rabin-Karp rolling hash; step 5 is the verification, scaled up from "compare `m` characters" to "align two regions." The hash-then-verify discipline is invariant across the scale.

---

## 5. Content-Defined Chunking (rsync, backup, dedup)

### 5.1 The boundary-shift problem

Fixed-size chunking splits a file every `B` bytes. Insert one byte at the front and *every* subsequent boundary shifts, so every chunk's fingerprint changes and dedup fails completely. Content-defined chunking (CDC) fixes this by placing boundaries where the *content* dictates, not where a byte counter says.

### 5.2 The rolling-hash cut criterion

Slide a small window (say 48 bytes) across the stream maintaining a rolling hash `h`. Declare a chunk boundary wherever the hash satisfies a fixed predicate, e.g.

```
if (h & (mask)) == magic:   // e.g. low 13 bits == some constant → ~8 KiB average chunk
    cut here
```

The expected chunk size is `2^{bits}` because each position cuts with probability `2^{−bits}`. Because the boundary depends only on the local window content, inserting bytes changes *only the chunk containing the insertion* (and possibly its neighbor) — every other chunk's content, boundary, and fingerprint is unchanged. This is what lets `rsync` transfer only the changed parts of a file and lets `restic`/`borg`/`bup` deduplicate across snapshots.

### 5.3 Production refinements

- **Min/max chunk size.** Enforce a minimum (skip cutting until the window has advanced `min` bytes) to avoid tiny chunks, and a maximum (force a cut) to bound chunk size. Without these, pathological inputs produce degenerate chunk distributions.
- **rsync's two-tier checksum.** rsync uses a fast rolling Adler-style checksum to *find* candidate matches and a strong MD5 (now often a faster strong hash) to *verify* — the same hash-then-verify discipline as Rabin-Karp, applied to block matching.
- **FastCDC and gear hashing.** Modern systems (FastCDC) replace the polynomial roll with a "gear" table lookup roll that is faster and produces a more uniform chunk-size distribution; the principle is identical, only the hash function changes.
- **Boundary-shift resistance, not collision resistance,** is the property that matters here. A weak hash that distributes cut points uniformly is fine for chunking; data integrity is guaranteed by the strong per-chunk hash, not the rolling one.

> Pointer: this section is a roadmap, not a full CDC implementation. The senior takeaway is that the *same `O(1)` rolling hash* you wrote for substring search is the kernel of petabyte-scale dedup systems — the application changes, the roll does not.

### 5.4 Where CDC is used in the wild

- **rsync** — rolling checksum to locate matching blocks between a local and remote file, transferring only the differences.
- **restic, borg, bup** — content-defined chunking so deduplicated backups store each unique chunk once across all snapshots; a small edit re-uploads only its chunk.
- **ZFS / dedup filesystems** — block-level dedup keyed by strong hashes, with CDC variants to resist insertion-shift.
- **Dropbox / cloud sync** — chunked delta sync so editing the middle of a large file uploads only the changed chunk.
- **Git (heuristic)** — packfile delta compression finds similar objects; while not classic CDC, it shares the "find similar regions cheaply, then diff" structure.

In every case the rolling hash is the cheap *locator*; a strong hash or byte diff is the *verifier*. The economic payoff is enormous: a one-byte change to a 10 GB file transfers ~8 KiB (one chunk) instead of 10 GB.

---

## 6. Verification Policy in Production

Decide explicitly, per use case, how much you trust the hash:

| Context | Policy |
|---------|--------|
| Library substring search (must be exact) | Always verify on hit. |
| Contest / throwaput code | Double hash, skip verification (residual `~p^{-2}` accepted). |
| Dedup / backup store (data integrity) | Strong cryptographic hash per block + byte compare on collision. |
| Chunking boundary detection | No verification — the rolling hash only *places* boundaries; integrity is a separate strong hash. |
| Similarity estimation | No verification — approximate by design. |

The unifying rule: **a rolling hash is a fast filter; correctness comes from a verification step whose strength matches the cost of being wrong.** Reporting a wrong substring match is a bug; deduplicating two different blocks is data loss.

---

## 7. Code Examples

### Example: Randomized-base, 61-bit-Mersenne rolling hash (overflow-safe)

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
	"math/rand"
)

const M61 = (uint64(1) << 61) - 1

func mulmod(a, b uint64) uint64 {
	hi, lo := bits.Mul64(a, b)            // 128-bit product
	// fold using 2^61 ≡ 1 (mod 2^61-1)
	lo61 := lo & M61
	rest := (lo >> 61) | (hi << 3)        // remaining high bits
	r := lo61 + (rest & M61) + (rest >> 61)
	for r >= M61 {
		r -= M61
	}
	return r
}

func search(txt, pat string, base uint64) []int {
	n, m := len(txt), len(pat)
	var res []int
	if m == 0 || m > n {
		return res
	}
	var highPow uint64 = 1
	for i := 0; i < m-1; i++ {
		highPow = mulmod(highPow, base)
	}
	hash := func(s string) uint64 {
		var h uint64
		for i := 0; i < len(s); i++ {
			h = (mulmod(h, base) + uint64(s[i]) + 1) % M61
		}
		return h
	}
	ph := hash(pat)
	wh := hash(txt[:m])
	for i := 0; i+m <= n; i++ {
		if wh == ph && txt[i:i+m] == pat { // verify
			res = append(res, i)
		}
		if i+m < n {
			sub := mulmod(uint64(txt[i])+1, highPow)
			wh = (wh + M61 - sub) % M61
			wh = (mulmod(wh, base) + uint64(txt[i+m]) + 1) % M61
		}
	}
	return res
}

func main() {
	base := uint64(256 + rand.Intn(1<<20)) // randomized → anti-flooding
	fmt.Println(search("abracadabra", "abra", base))
}
```

#### Java

```java
import java.util.*;

public class MersenneRK {
    static final long M61 = (1L << 61) - 1;

    static long mulmod(long a, long b) {
        long hi = Math.multiplyHigh(a, b);   // Java 9+
        long lo = a * b;
        long lo61 = lo & M61;
        long rest = (lo >>> 61) | (hi << 3);
        long r = lo61 + (rest & M61) + (rest >>> 61);
        while (Long.compareUnsigned(r, M61) >= 0) r -= M61;
        return r;
    }

    static long hash(String s, long base) {
        long h = 0;
        for (int i = 0; i < s.length(); i++)
            h = (mulmod(h, base) + s.charAt(i) + 1) % M61;
        return h;
    }

    static List<Integer> search(String txt, String pat, long base) {
        int n = txt.length(), m = pat.length();
        List<Integer> res = new ArrayList<>();
        if (m == 0 || m > n) return res;
        long highPow = 1;
        for (int i = 0; i < m - 1; i++) highPow = mulmod(highPow, base);
        long ph = hash(pat, base), wh = hash(txt.substring(0, m), base);
        for (int i = 0; i + m <= n; i++) {
            if (wh == ph && txt.regionMatches(i, pat, 0, m)) res.add(i);
            if (i + m < n) {
                long sub = mulmod(txt.charAt(i) + 1, highPow);
                wh = (wh + M61 - sub) % M61;
                wh = (mulmod(wh, base) + txt.charAt(i + m) + 1) % M61;
            }
        }
        return res;
    }

    public static void main(String[] args) {
        long base = 256 + new Random().nextInt(1 << 20);
        System.out.println(search("abracadabra", "abra", base));
    }
}
```

#### Python

```python
import random

M61 = (1 << 61) - 1  # Python ints are arbitrary precision: no overflow worries


def make_hash(base):
    def h(s):
        v = 0
        for ch in s:
            v = (v * base + ord(ch) + 1) % M61
        return v
    return h


def search(txt, pat, base):
    n, m = len(txt), len(pat)
    res = []
    if m == 0 or m > n:
        return res
    H = make_hash(base)
    high_pow = pow(base, m - 1, M61)
    ph, wh = H(pat), H(txt[:m])
    for i in range(n - m + 1):
        if wh == ph and txt[i:i + m] == pat:   # verify
            res.append(i)
        if i + m < n:
            wh = (wh - (ord(txt[i]) + 1) * high_pow) % M61
            wh = (wh * base + ord(txt[i + m]) + 1) % M61
    return res


if __name__ == "__main__":
    base = 256 + random.randrange(1 << 20)   # randomized base
    print(search("abracadabra", "abra", base))
```

### Example: Content-defined chunk boundaries (Python sketch)

```python
def cdc_boundaries(data, window=48, avg_bits=13, min_size=2048, max_size=65536):
    """Yield chunk end offsets using a rolling-hash cut criterion."""
    MOD, BASE = (1 << 61) - 1, 1000003
    mask = (1 << avg_bits) - 1
    high = pow(BASE, window - 1, MOD)
    h, start = 0, 0
    for i, byte in enumerate(data):
        if i >= window:
            h = (h - (data[i - window] + 1) * high) % MOD
        h = (h * BASE + byte + 1) % MOD
        size = i - start + 1
        if size >= max_size or (size >= min_size and (h & mask) == 0):
            yield i + 1            # boundary after position i
            start, h = i + 1, 0
    if start < len(data):
        yield len(data)
```

---

## 9. Concurrency, Streaming, and Memory

### 9.1 Streaming over a single pass

Rabin-Karp is naturally a **streaming** algorithm: the roll needs only the character entering and the character leaving the window. For a search over data that does not fit in memory (a multi-gigabyte log, a network stream), keep a circular buffer of the last `m` bytes plus the current hash. Each incoming byte triggers one roll and one hash compare; verification, when it fires, reads the `m` buffered bytes. Memory is `O(m)`, independent of stream length. This is the property that lets `rsync` and dedup engines process petabyte streams: the chunking rolling hash never holds more than one window.

### 9.2 Parallelizing a search

To use multiple cores on a large in-memory text, split it into `P` overlapping segments, each of length `n/P + (m−1)` — the `m−1` overlap ensures no match straddling a segment boundary is missed. Each worker runs an independent Rabin-Karp (recomputing its first window hash from scratch) and emits local match indices, offset to global coordinates; merge and dedup the boundary region. Speedup is near-linear because the roll is embarrassingly parallel and shares no state. Use the *same* base and modulus across workers so pattern hashes are computed once.

### 9.3 Incremental re-hashing under edits

When the text is edited (an editor's find-as-you-type, or a document store), prefix hashes (Section 4 of `professional.md`) let you avoid recomputing from scratch. An insertion/deletion invalidates prefix hashes only from the edit point onward; a balanced-BST or rope of segment hashes supports `O(log n)` updates and `O(log n)` substring-hash queries, turning the static prefix-hash array into a dynamic one. This is how some collaborative editors maintain document fingerprints cheaply across keystrokes.

### 9.4 Memory layout

The hot loop touches two bytes and a handful of registers per step, so it is L1-resident and bandwidth-bound on the text scan. Keep the text contiguous (a byte slice, not a linked structure), iterate forward (hardware prefetch friendly), and avoid per-step allocation. In managed languages, hoist the character access out of bounds-checked APIs where possible (`charAt` vs a `char[]` in Java; indexing a `[]byte` rather than ranging a `string` in Go for the rune-free byte case).

---

## 10. Migration, Benchmarking, and Tool Selection

### 10.1 When to migrate off the standard library

Most languages' `strings.Contains` / `String.indexOf` / `str.find` use a tuned naive or two-way (Crochemore-Perrin) algorithm that is excellent for single short patterns. Reach for Rabin-Karp when the *workload shape* changes: many equal-length patterns, 2D search, repeated substring-equality queries, or fingerprinting/dedup. Migrating a single-pattern search to Rabin-Karp rarely pays — benchmark first.

### 10.2 Benchmark methodology

- **Vary the regime.** Measure across (i) random text/pattern (expected case), (ii) highly periodic text (variance stress), (iii) adversarial collision input against a fixed base (worst case), and (iv) realistic corpora (logs, DNA, source code).
- **Report distribution, not just mean.** The variance analysis (`professional.md` Section 12) means a single average hides the tail; report p50/p99 latency.
- **Compare apples to apples.** Pit Rabin-Karp against KMP, Z, and the standard library on identical inputs; include preprocessing time for fairness on short texts.
- **Isolate the modulo.** Profile to see whether the `%` dominates; only then evaluate Barrett/Montgomery or a Mersenne fold.

### 10.3 Decision matrix

| Workload | Recommended | Why |
|----------|-------------|-----|
| Single short pattern, trusted input | stdlib / two-way | Tuned, no verification, no setup. |
| Single pattern, adversarial, hard guarantee | KMP or Z | Worst-case `O(n+m)`, deterministic. |
| Many equal-length patterns | Rabin-Karp set | One scan, `O(n + k·m)`. |
| Many patterns, varying length | Aho-Corasick | Collision-free, `O(n + Σ|P| + occ)`. |
| 2D / grid search | 2D Rabin-Karp | Roll twice, `O(R·C)`. |
| Repeated substring-equality queries | prefix hashes | `O(1)` per query. |
| Dedup / backup / sync | rolling-hash CDC + strong hash | Boundary stability + integrity. |

---

## 11. Security Boundaries: What a Rolling Hash Is Not

A recurring senior-level mistake is overreaching with the rolling hash. Be precise about what it does and does not provide.

- **It is not a cryptographic hash.** A polynomial hash mod a prime is trivially invertible and forgeable: given the base and modulus, an attacker can construct a string with any target hash by solving a linear/polynomial equation over `Z_p`. Never use it where you need preimage or collision resistance against a motivated adversary (signatures, integrity tokens, password handling). Use SHA-256/BLAKE3 there.
- **A random base resists *complexity* attacks, not *forgery*.** Randomizing and hiding the base prevents an attacker from precomputing colliding inputs (defeating hash flooding), but if the base ever leaks (e.g. via a timing side channel that reveals which inputs collide), the protection evaporates. Treat the base as a secret only for DoS resistance, not as a cryptographic key.
- **It is not a MAC.** Authentication of a message requires a keyed cryptographic primitive (HMAC, Poly1305). Poly1305 *looks* like a polynomial hash — and indeed is one over a carefully chosen prime field — but its security comes from a secret key, careful field choice, and a one-time-use nonce, none of which a casual Rabin-Karp hash provides.
- **Fingerprints for dedup need a strong final check.** In a content-addressable store, the rolling/fingerprint hash *indexes* candidates; equality of stored blocks must be confirmed by a cryptographic hash or a byte compare, or two different blocks could be silently merged — data loss.

The mental model: the rolling hash is a *fast, adversary-resistant-for-DoS, non-cryptographic* equality filter. Its job ends at "these are probably equal, and an attacker can't cheaply make me waste time"; everything stronger is a different primitive.

---

## 12. Production Incident Patterns

Patterns drawn from how rolling-hash code actually fails in services:

- **The "we removed verify for speed" regression.** A profiler showed verification on the hot path; someone deleted it, trusting a single 30-bit hash. Months later, on a corpus with `>10^5` distinct keys, a birthday collision silently returned a wrong match. *Fix:* restore verification, or move to a 61-bit/double hash with documented Monte-Carlo error budget.
- **The fixed-base DoS.** A search endpoint hard-coded `base = 31`. An attacker submitted crafted queries forcing collisions at every window; CPU saturated and latency SLOs blew. *Fix:* randomize the base per process, cap per-request verification work, add a spurious-hit-rate alarm.
- **The 64-bit overflow on long patterns.** Code used a 31-bit `int` for the product `h*base`; for large `base` and `h` near the modulus the multiply overflowed before the modulo, corrupting hashes only on long inputs that escaped the test suite. *Fix:* 64-bit products, reduce every step, add long-input fuzz tests.
- **The chunking re-sync storm.** A backup system used fixed-size chunking; a one-byte header change shifted every boundary, so a nightly incremental backup re-uploaded the entire dataset, saturating the network. *Fix:* switch to content-defined chunking so only the changed chunk re-uploads.
- **The negative-residue flake.** A Go service occasionally missed matches; the cause was a subtraction underflow after removing the leading character (`h - x*high` went negative, and Go's `%` returned a negative residue, never equal to the pattern hash). *Fix:* `(h - x*high%p + p) % p`, plus an invariant assert that hashes stay in `[0, p)`.

Each incident traces to one of the four senior decisions (unforgeability, overflow-safe arithmetic, verification policy, boundary stability) being made implicitly instead of deliberately.

### 12.1 Postmortem template

When a rolling-hash incident occurs, walk the four decisions in order:

1. **Was the base fixed and public?** If yes, suspect flooding; check the spurious-hit metric and the input source.
2. **Could arithmetic have overflowed or gone negative?** Re-run the offending input through a from-scratch hash comparison; assert residues stay in `[0, p)`.
3. **Was verification present and correct?** A wrong (not slow) result almost always means verification was removed or the comparison length was wrong.
4. **Did boundaries or block identity shift unexpectedly?** For dedup/sync, diff the chunk list before and after the triggering change; a whole-file re-chunk indicates fixed-size chunking crept back in.

Most incidents resolve at step 1 or 3. Recording which step caught it builds an institutional sense of which decision is most often made implicitly.

---

## 12.5 Language-Specific Arithmetic Notes

The same algorithm has materially different overflow and performance characteristics per language:

- **Go.** `int64` products of two `< 10^9` values stay `< 10^{18}`, safe. For `2^{61}−1` use `math/bits.Mul64` for the 128-bit product and fold. `string` indexing yields bytes; range over `[]byte` to avoid rune decoding. The `%` on negative `int64` returns a negative result, so guard with `(x%p + p) % p`.
- **Java.** `long` mirrors Go. For 61-bit moduli use `Math.multiplyHigh` (Java 9+) or `Math.multiplyHigh`-free `BigInteger` fallback on older JDKs. `String.charAt` is bounds-checked; for hot loops copy to `char[]` or use `regionMatches` for verification to avoid allocation. Beware autoboxing in `HashSet<Long>` for multi-pattern sets — use a primitive-long set (e.g. a third-party `LongHashSet`) at scale.
- **Python.** Integers are arbitrary-precision, so overflow never happens, but every operation is slower and allocates. Use `pow(base, e, mod)` for the high power (C-optimized), precompute `ord` codes into a `bytes`/`bytearray`, and prefer slice comparison `t[i:i+m] == p` for verification (C-level memcmp) over a Python character loop. For very large inputs, the pure-Python roll may be the bottleneck; `bytes` operations and `memoryview` help.
- **C/C++/Rust.** `__int128` makes the 61-bit fold trivial and fast; this is the language tier where `2^{61}−1` hashing is essentially free, and where Barrett/Montgomery reduction for arbitrary primes is worth implementing.

A cross-language correctness suite should feed identical inputs to all implementations and assert identical hash values and match lists — catching, for example, a Java `int` overflow that the Python reference never exhibits.

---

## 12.6 FastCDC and Gear Hashing in Depth

The polynomial roll of Section 5 is pedagogically clean but not the fastest chunker. Production systems (FastCDC, used in `restic`'s newer modes and many dedup engines) replace it with **gear hashing**:

```
h = (h << 1) + GEAR[byte]      // GEAR is a fixed 256-entry random table of 64-bit values
cut when (h & mask) == 0
```

Each step is one shift, one table lookup, one add — faster than the polynomial roll's two multiplies, and there is no "remove the leading byte" step because the left shift naturally ages out old bytes (after 64 steps a byte's influence has shifted out of the 64-bit window). FastCDC adds two refinements: **normalized chunking** uses a stricter mask before the target size and a looser mask after, tightening the chunk-size distribution around the average; and **cut-point skipping** jumps the minimum chunk size without hashing, since no cut can occur there anyway. The principle is identical to Rabin-Karp — a rolling function over a window plus a predicate on its value — but the hash is chosen for *speed and distribution uniformity* rather than the field-theoretic collision bound, because chunk integrity is guaranteed downstream by a strong per-chunk hash, not by the roller. This is the same separation of concerns as "rolling hash proposes, verification disposes," applied to boundary placement.

---

## 13. Testing and Observability

- **Differential testing.** Run Rabin-Karp and a naive matcher on millions of random (text, pattern) pairs; assert identical match lists. This is the single highest-value test.
- **Adversarial corpus.** Include all-same-character strings, periodic strings, strings engineered to collide under a *fixed* base, and verify the randomized version stays fast.
- **Property tests.** `H(a + b)` relates to `H(a)` and `H(b)` by the shift formula; assert the prefix-hash substring formula matches direct hashing for random substrings.
- **Metrics to emit.** Spurious-hit rate (verifications per match), average verification length, and hash distribution (chi-squared over buckets). A rising spurious-hit rate signals a weak hash, a hash-flooding attempt, or a bug.
- **Chunking metrics.** Chunk-size histogram, dedup ratio, and boundary stability across a single-byte-insertion test (only one chunk should change).
- **Fuzz the arithmetic.** Generate random long patterns and assert the rolling hash equals the from-scratch Horner hash at every window — this catches overflow, sign, and off-by-one bugs that small unit tests miss.
- **Seed determinism for reproducibility.** When the base is randomized, log the seed so a production failure can be replayed exactly. A non-reproducible randomized matcher is far harder to debug.

### 13.1 What a good metric dashboard shows

A search/dedup service running rolling hashes should surface, per minute: the spurious-hit rate (alarm if it climbs above a few × `E[spurious]`), p99 verification length, the chunk-size distribution's mean and tail, and the dedup ratio. A sudden spurious-hit spike on a single tenant is the signature of a hash-flooding attempt; a collapsing dedup ratio after a deploy signals a chunking regression (often a switch back to fixed-size boundaries). These are the rolling-hash analogues of cache-hit-rate and GC-pause dashboards — cheap to emit, invaluable in an incident.

---

## 14. Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|-----------|------------|
| Hash flooding | Search latency spikes on certain inputs | Fixed, public base | Randomize base; cap verification work; fall back to KMP. |
| Silent wrong match | Reports a non-match as a match | Verification removed for "speed" | Restore verification (or accept double-hash residual only in non-critical code). |
| Overflow corruption | Hash mismatches on long patterns | `%` skipped or 64-bit product overflowed | Reduce every step; use Mersenne fold or 128-bit mul. |
| Negative residue | Sporadic missed matches | Underflow after removing leading char | `(h − x·highPow + p) % p`. |
| Dedup data loss | Restored data differs from original | Trusted rolling hash for block identity | Add strong per-block hash + byte compare. |
| Chunk explosion | Millions of tiny chunks | No min-size guard, or low-entropy data | Enforce min/max chunk sizes; use FastCDC normalization. |
| Boundary instability | Insertion re-chunks whole file | Fixed-size chunking instead of CDC | Use content-defined boundaries. |
| Correlated double hash | Collisions persist with two hashes | Shared base or modulus | Independent `(base, modulus)` pairs. |

---

## 15. Summary

The senior view of Rabin-Karp reduces to four deliberate decisions — unforgeability, exact arithmetic, verification policy, boundary stability — and one reusable kernel, the `O(1)` rolling hash, that appears unchanged across substring search, fingerprinting, similarity detection, and content-defined chunking. The remainder of this summary states each takeaway crisply for reference.

At senior scale, the rolling hash stops being "a clever substring trick" and becomes a reusable kernel with sharp edges. **Adversarial input** turns the `O(n·m)` worst case into a real DoS — defended by a *randomized, private base* plus mandatory verification. **Arithmetic at the word boundary** dictates the modulus: a 30-bit prime is overflow-safe in 64 bits, `2^61 − 1` buys a `10^{-18}` collision rate with a fast Mersenne fold, and Barrett/Montgomery reduction earns its keep only when the modulo dominates a profiled hot loop. The *same* `O(1)` roll is the engine of **Rabin fingerprinting**, **plagiarism detection via winnowing**, and **content-defined chunking** in `rsync`, `restic`, and dedup stores — where its job is merely to *place* boundaries or *propose* matches, with correctness always backstopped by a stronger verification whose strength is matched to the cost of being wrong.
