# Lyndon Words & Duval's Algorithm — Interview Preparation

Lyndon factorization is a favorite interview topic because it rewards a single crisp insight — *"a Lyndon word is strictly smaller than all its rotations, and Duval factors any string into non-increasing Lyndon words in `O(n)`"* — and then tests whether you can (a) compute the factorization with the three-pointer scan, (b) turn it into the **smallest cyclic rotation** via `s + s`, (c) recognize the `O(1)`-space, `O(n)`-time guarantee, and (d) avoid the classic traps (strict vs non-strict comparison, building substrings in the inner loop, the non-increasing factor order). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Is `w` a Lyndon word? | strict-rotation test / it is its own single Duval factor | `O(n²)` brute / `O(n)` via Duval |
| Factor `s` into Lyndon words | Duval's algorithm | `O(n)` time, `O(1)` space |
| Smallest cyclic rotation | Duval on `s + s` | `O(n)` |
| Largest cyclic rotation | Duval on `s + s` with inverted alphabet | `O(n)` |
| Canonical necklace form | smallest rotation | `O(n)` |
| Generate Lyndon words ≤ length `n` | FKM / Duval generation | amortized `O(1)` per word |
| de Bruijn sequence `B(σ, k)` | concat Lyndon words with `len | k` | `O(σᵏ)` |
| `# Lyndon words` of length `n` | Witt's formula `(1/n)Σ_{d|n} μ(d) σ^{n/d}` | — |

Core algorithm:

```text
duval(s):                       # Chen-Fox-Lyndon factorization
    i = 0
    while i < n:
        j = i + 1; k = i
        while j < n and s[k] <= s[j]:
            k = i if s[k] < s[j] else k + 1
            j += 1
        while i <= k:
            output s[i : i + (j - k)]   # one Lyndon factor
            i += j - k
# O(n) time, O(1) extra space; factors come out NON-INCREASING.
```

Key facts:
- A Lyndon word is **strictly** smaller than all its proper rotations (and all proper suffixes).
- A Lyndon word is **primitive** (aperiodic): `aa`, `abab` are NOT Lyndon.
- Factors are in **non-increasing** order: `w₁ ≥ w₂ ≥ … ≥ w_m`.
- **Smallest rotation**: run Duval on `s + s`, take the last factor start `< n`.
- Inner loop: on `s[k] < s[j]` reset `k = i`; on equality advance `k`.

---

## Junior Questions (12 Q&A)

### J1. What is a Lyndon word?
A non-empty string that is **strictly** smaller (lexicographically) than every one of its proper rotations. For example `aab` is Lyndon because `aab < aba < baa`. Equivalently, it is strictly smaller than each of its proper suffixes.

### J2. Is `aa` a Lyndon word?
No. `aa` equals its only proper rotation (`aa`), so it is not *strictly* smaller. A Lyndon word must be aperiodic (primitive); `aa = a²` is a power, hence not Lyndon.

### J3. What is the Chen-Fox-Lyndon factorization?
The unique decomposition of any string into Lyndon words `w₁w₂…w_m` with `w₁ ≥ w₂ ≥ … ≥ w_m` (non-increasing). For example `banana = b · an · an · a`.

### J4. What does Duval's algorithm do, and how fast?
It computes the Chen-Fox-Lyndon factorization in `O(n)` time and `O(1)` extra space using a single forward scan with three index pointers `i`, `j`, `k`.

### J5. What are the three pointers in Duval?
`i` = start of the part still being factored; `j` = a look-ahead reading new characters; `k` = a trailing pointer such that `j - k` is the current period length being tested.

### J6. How do you find the smallest cyclic rotation of a string?
Run Duval on `s + s` (length `2n`) and take the start index of the last Lyndon factor that begins before position `n`. The smallest rotation is `t[p : p+n)`. This is `O(n)`.

### J7. Why concatenate `s + s` for the rotation problem?
Because every rotation of `s` appears as a length-`n` substring of `s + s` starting at some index in `[0, n)`. The doubled string lets the factorization "see" the wrap-around rotations.

### J8. Are the factors increasing or decreasing?
**Non-increasing**: `w₁ ≥ w₂ ≥ … ≥ w_m`. Reversing this expected order is a classic mistake.

### J9. Is a single character a Lyndon word?
Yes. A single character has no proper rotations, so the "strictly smaller than all proper rotations" condition is vacuously true.

### J10. What is the smallest rotation a canonical form of?
A **necklace** — the equivalence class of strings under rotation. Two strings are rotation-equivalent iff they share the same smallest rotation, so it is a canonical representative.

### J11. What is the time complexity of brute-force smallest rotation, and why is Duval better?
Brute force compares all `n` rotations, `O(n²)` in the worst case (e.g. `aaaa…ab`). Duval on `s + s` is `O(n)` — linear instead of quadratic.

### J12 (analysis). Why is Duval `O(1)` extra space?
Because it stores only the integer pointers `i`, `j`, `k` (and the period `p`) and streams each factor as it is found — no auxiliary array whose size grows with `n`.

---

## Middle Questions (12 Q&A)

### M1. State the two equivalent definitions of a Lyndon word.
(A) `w` is strictly smaller than every proper rotation; (B) `w` is strictly smaller than every proper suffix. They are equivalent; Duval exploits (B) because suffixes are comparable with a left-to-right scan.

### M2. Walk through the inner-loop cases of Duval.
Comparing `s[j]` to `s[k]`: if `s[j] == s[k]`, the period continues — advance both `j` and `k`. If `s[j] > s[k]`, the candidate extends into a longer Lyndon word — reset `k = i`, advance `j`. If `s[j] < s[k]`, the run of equal Lyndon words is finished — emit factors of length `j - k`.

### M3. Why is Duval `O(n)` despite the resets?
`i` and `j` only move forward; the unconsumed prefix of one outer round becomes the input of the next and is re-scanned at most once. Each character is read a constant number of times, giving `O(n)` by amortization.

### M4. How do you find the *largest* cyclic rotation?
Invert the alphabet (map each character `c → MAX - c`, or negate the comparator) and run the smallest-rotation routine; the index it returns is the largest rotation of the original. Reusing one tested routine beats hand-flipping comparisons.

### M5. How do you generate all Lyndon words up to length `n`?
The FKM (Fredricksen-Kessler-Maiorana) algorithm: repeat the current word to length `n`, strip trailing maximal letters, increment the last non-maximal letter. It emits Lyndon words in lexicographic order in amortized `O(1)` each.

### M6. How is a de Bruijn sequence built from Lyndon words?
Concatenate, in lexicographic order, all Lyndon words whose **length divides `k`**. The result has length `σᵏ` and is a de Bruijn sequence `B(σ, k)` — every length-`k` string appears exactly once cyclically (the FKM theorem).

### M7. What is the relationship between Lyndon words and necklaces?
Lyndon words are in bijection with *aperiodic* necklaces: each aperiodic rotation class has exactly one Lyndon representative (its minimal rotation). This is why Witt's formula counts both.

### M8. How does Duval relate to Booth's algorithm?
Both find the least rotation in `O(n)`. Booth uses a KMP-style modified failure function specialized to rotations; Duval-on-`s+s` reuses the general factorization engine. They return the same index.

### M9. What is the worst case for brute-force least rotation, and does Duval suffer from it?
`aaaa…ab` (long run of equal characters) makes pairwise rotation comparison `O(n²)`. Duval handles it in `O(n)` because equal characters just advance the period pointer `k` without re-comparison.

### M10. Why must comparison be on characters, not substrings, inside Duval?
Building `s[i:]` to compare costs `O(n)` per comparison, turning the whole algorithm quadratic. Comparing single code units `s[k]` vs `s[j]` keeps it linear.

### M11. What does Witt's formula give?
The number of Lyndon words of length exactly `n` over a `σ`-letter alphabet: `L(σ,n) = (1/n) Σ_{d|n} μ(d) σ^{n/d}`, where `μ` is the Möbius function. It equals the count of aperiodic necklaces.

### M12 (analysis). Prove the concatenation lemma intuition: if `u, v` Lyndon and `u < v`, then `uv` is Lyndon.
`uv` must beat every proper suffix. A suffix is either a suffix of `v` (and `uv < v ≤` it because `u < v`) or `u'v` with `u'` a proper suffix of `u` (and `u < u'` since `u` is Lyndon, so `uv < u'v`). Hence `uv` is smaller than all suffixes, so it is Lyndon.

---

## Senior Questions (10 Q&A)

### S1. How would you canonicalize a million circular sequences for deduplication?
Compute each one's smallest rotation (canonical form) via Duval on `s + s` in `O(n)`, then hash the canonical *string* (not the raw input) into a set. Total `O(N)` for total length `N`. Canonicalizing before hashing is essential, and the alphabet order must match any downstream storage collation.

### S2. How do you avoid the `s + s` memory doubling?
Index modulo `n`: define `at(idx) = s[idx % n]` and run the scan against `at` instead of a materialized `s + s`. You never read past `2n` positions, and you can stop once `i ≥ n`, keeping memory at `O(n)` with no copy.

### S3. Why does the smallest rotation begin at a Lyndon-factor boundary of `s + s`?
The smallest rotation is strictly smaller than all *its* rotations, so it is a Lyndon word (or a power for periodic `s`), hence begins a Lyndon factor in the factorization of `s + s`. Tracking the last factor start `< n` selects exactly the minimal rotation point.

### S4. How does Lyndon factorization connect to the BWT?
The **bijective BWT** is defined via the Lyndon factorization: factor the string into Lyndon words, sort the cyclic rotations of those factors, and read the last column — no end-of-string sentinel `$` required, unlike the classical BWT. The Lyndon array also feeds linear-time suffix-array construction.

### S5. When is a suffix array a better choice than Duval-on-`s+s`?
When you need many other substring/rotation queries on the same string. For a single least-rotation query, Duval is cheaper and simpler. A suffix array of `s + s` amortizes when its `O(n)`/`O(n log n)` preprocessing is reused across many queries.

### S6. How would you verify a smallest-rotation implementation in CI?
Property test: for random small `s` and every rotation amount `r`, assert `canonical(rotate(s, r)) == canonical(s)` (rotation invariance) and `canonical(s) <= rotate(s, r)` (minimality). Also keep a brute-force least-rotation oracle for small `n` and diff.

### S7. What breaks if your alphabet order differs from a downstream system's collation?
Two systems compute *different* smallest rotations for the same necklace, so the canonical forms disagree and deduplication silently fails. Fix: pin one ordering, document it, and make every consumer (DB collation, test comparator, other services) use it.

### S8. How do you stream Duval over a multi-gigabyte input?
Duval emits each factor as soon as it is sealed and holds only three pointers, so you can process and discard factors with `O(1)` working state. The one caveat: chunked input must carry trailing context at least as long as the current candidate, because the look-ahead can cross a chunk boundary.

### S9. How do you build a de Bruijn sequence efficiently and verify it?
Generate Lyndon words up to length `k` (FKM, amortized `O(1)` each), keep those with `len | k`, concatenate in order — `O(σᵏ)`, optimal in output size. Verify by sliding a length-`k` window cyclically and asserting all `σᵏ` windows are distinct.

### S10 (analysis). Why is the smallest rotation a *total order* canonical form, and why does that matter?
Because canonical forms are ordinary strings comparable with `<`, you can sort them, index them in a B-tree, and range-query them — unlike an opaque rotation class. This is what makes the smallest rotation usable as a database key, not just an in-memory dedup helper.

---

## Professional Questions (8 Q&A)

### P1. Design a service that returns the canonical form of any circular identifier.
Each request canonicalizes one string via Duval on `s + s` in `O(|s|)`; the service is stateless and embarrassingly parallel across requests. Pin the alphabet order in config and assert it matches the storage collation. For large inputs use modular indexing to avoid the `s + s` copy. Cache nothing per request beyond the result.

### P2. You must store each distinct necklace exactly once in a relational table. How?
Compute `canonical(s)` (smallest rotation) and use it as a UNIQUE key. Ensure the database collation equals the Duval alphabet order, or the DB's notion of "equal canonical form" will diverge from yours. For very long sequences, store a cryptographic digest of the canonical form alongside it and de-dup on the digest with the full string as a tiebreak.

### P3. Counting: how many distinct binary necklaces of length 6 exist, and how many are Lyndon?
Necklaces: `N(2,6) = (1/6) Σ_{d|6} φ(d) 2^{6/d} = (1/6)(2^6 + 2^3 + 2·2^2 + 2·2^1) = (64+8+8+4)/6 = 14`. Lyndon (aperiodic): `L(2,6) = (1/6) Σ_{d|6} μ(d) 2^{6/d} = (1/6)(64 − 8 − 4 + 2) = 9`. So 9 of the 14 necklaces are aperiodic.

### P4. How do you debug "the canonical form is wrong" in production?
Run the brute-force least-rotation oracle on the same small inputs and diff. Check the three usual suspects: strict-vs-non-strict comparison flip (reset `k = i` only on strict `<`), `s + s` index off-by-one (answer must be `< n`), and hashing the raw rotation instead of the canonical form. Assert rotation-invariance on a sample.

### P5. When is max-plus... when is the *largest* rotation the wrong thing to compute?
When the domain wants a canonical form, use the *smallest* rotation (it is the conventional representative). The largest rotation is rarely the canonical choice; computing it by accident (e.g. by reusing a flipped comparator) silently produces a different, incompatible key. Be explicit about which extreme you need.

### P6. How would you parallelize generating a huge de Bruijn sequence?
The FKM generation is inherently sequential (each Lyndon word's successor depends on the previous), but you can parallelize by *partitioning the first-letter range*: Lyndon words starting with letter `c` are independent blocks you can generate and place concurrently, then concatenate in order. The output write dominates (`O(σᵏ)`), so stream it.

### P7. Explain the link between Lyndon words and the free Lie algebra.
Via the **standard factorization** (`w = uv` with `v` the longest proper Lyndon suffix), Lyndon words map to Lie brackets and form a basis of the free Lie algebra. The number of Lyndon words of length `n` equals the dimension of the degree-`n` component — Witt's formula in its original algebraic meaning. This is why the same count appears in combinatorics and algebra.

### P8 (analysis). Why can Duval not be beaten asymptotically for factorization?
The output (factor boundaries) plus reading the input is `Ω(n)`, and Duval achieves `O(n)` time with `O(1)` extra space, reading each character a constant number of times. It is therefore optimal up to constants; there is no room for a sub-linear factorizer since every character must be examined to determine its factor.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n²)` comparison with a linear algorithm.
Look for a concrete story: deduplicating or canonicalizing circular data where the naive "compare all rotations" was the bottleneck, the insight that the smallest rotation via Duval-on-`s+s` is `O(n)`, and a measured speedup. Strong answers mention validating against the old slow version and pinning the alphabet order.

### B2. A teammate's dedup keeps the same necklace twice. How do you help?
Calmly show that they likely hashed the *raw* rotation instead of the canonical (smallest) rotation, so `abc` and `bca` hashed differently. Demonstrate with a tiny example, then show canonicalizing before hashing fixes it. Frame it as a teaching moment about canonical forms.

### B3. Design a fuzz-testing input generator that covers every length-`k` byte window once.
This is a de Bruijn sequence `B(256, k)`. Build it by concatenating Lyndon words over the 256-byte alphabet whose length divides `k` (FKM), then slide a length-`k` window cyclically. Discuss the `256ᵏ` size budget, streaming the output, and why each window is guaranteed unique.

### B4. How would you explain Lyndon words to a junior engineer?
Use the necklace analogy: a Lyndon word is the unique "smallest reading" of a non-repeating circular bead pattern. Then show the smallest-rotation application: run Duval on `s + s` to pick where to cut the necklace. Lead with the two gotchas — the inequality is *strict*, and the factors come out *non-increasing*.

### B5. Your canonicalization service is slow on long inputs. How do you investigate?
Profile first. The usual culprit is building substrings inside Duval's inner loop (turns `O(n)` into `O(n²)`) — switch to single-character comparison. Next, check whether you materialize `s + s` (use modular indexing instead) and whether you copy candidate factors needlessly (emit indices). Confirm byte arrays for ASCII to cut per-character overhead.

---

## Coding Challenges

### Challenge 1: Lyndon (Chen-Fox-Lyndon) Factorization

**Problem.** Given a string `s`, return its Chen-Fox-Lyndon factorization as a list of factor strings (non-increasing Lyndon words).

**Example.**
```text
"banana"   -> ["b", "an", "an", "a"]
"bbababaa" -> ["b", "b", "ab", "ab", "a", "a"]
"aaa"      -> ["a", "a", "a"]
```

**Constraints.** `0 ≤ |s| ≤ 10⁶`.

**Optimal.** Duval's algorithm, `O(n)` time, `O(1)` extra space.

**Go.**
```go
package main

import "fmt"

func duval(s string) []string {
	n := len(s)
	var out []string
	i := 0
	for i < n {
		j, k := i+1, i
		for j < n && s[k] <= s[j] {
			if s[k] < s[j] {
				k = i
			} else {
				k++
			}
			j++
		}
		for i <= k {
			out = append(out, s[i:i+j-k])
			i += j - k
		}
	}
	return out
}

func main() {
	fmt.Println(duval("banana"))   // [b an an a]
	fmt.Println(duval("bbababaa")) // [b b ab ab a a]
	fmt.Println(duval("aaa"))      // [a a a]
}
```

**Java.**
```java
import java.util.*;

public class Duval {
    static List<String> duval(String s) {
        int n = s.length();
        List<String> out = new ArrayList<>();
        int i = 0;
        while (i < n) {
            int j = i + 1, k = i;
            while (j < n && s.charAt(k) <= s.charAt(j)) {
                if (s.charAt(k) < s.charAt(j)) k = i;
                else k++;
                j++;
            }
            while (i <= k) {
                out.add(s.substring(i, i + j - k));
                i += j - k;
            }
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(duval("banana"));   // [b, an, an, a]
        System.out.println(duval("bbababaa")); // [b, b, ab, ab, a, a]
        System.out.println(duval("aaa"));      // [a, a, a]
    }
}
```

**Python.**
```python
def duval(s: str) -> list[str]:
    n, i, out = len(s), 0, []
    while i < n:
        j, k = i + 1, i
        while j < n and s[k] <= s[j]:
            k = i if s[k] < s[j] else k + 1
            j += 1
        while i <= k:
            out.append(s[i:i + j - k])
            i += j - k
    return out


if __name__ == "__main__":
    print(duval("banana"))    # ['b', 'an', 'an', 'a']
    print(duval("bbababaa"))  # ['b', 'b', 'ab', 'ab', 'a', 'a']
    print(duval("aaa"))       # ['a', 'a', 'a']
```

---

### Challenge 2: Smallest Cyclic Rotation

**Problem.** Given a string `s`, return its lexicographically smallest cyclic rotation.

**Example.**
```text
"bca"  -> "abc"
"cba"  -> "acb"
"dcab" -> "abdc"  (rotations: dcab, cabd, abdc, bdca; smallest is abdc)
```

**Constraints.** `1 ≤ |s| ≤ 10⁶`.

**Optimal.** Duval on `s + s`, `O(n)`.

**Go.**
```go
package main

import "fmt"

func leastRotation(s string) int {
	n := len(s)
	t := s + s
	i, ans := 0, 0
	for i < n {
		ans = i
		j, k := i+1, i
		for j < 2*n && t[k] <= t[j] {
			if t[k] < t[j] {
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

func smallestRotation(s string) string {
	idx := leastRotation(s)
	return s[idx:] + s[:idx]
}

func main() {
	fmt.Println(smallestRotation("bca"))  // abc
	fmt.Println(smallestRotation("dcab")) // abdc
}
```

**Java.**
```java
public class SmallestRotation {
    static int leastRotation(String s) {
        int n = s.length();
        String t = s + s;
        int i = 0, ans = 0;
        while (i < n) {
            ans = i;
            int j = i + 1, k = i;
            while (j < 2 * n && t.charAt(k) <= t.charAt(j)) {
                if (t.charAt(k) < t.charAt(j)) k = i;
                else k++;
                j++;
            }
            while (i <= k) i += j - k;
        }
        return ans;
    }

    static String smallestRotation(String s) {
        int idx = leastRotation(s);
        return s.substring(idx) + s.substring(0, idx);
    }

    public static void main(String[] args) {
        System.out.println(smallestRotation("bca"));  // abc
        System.out.println(smallestRotation("dcab")); // abdc
    }
}
```

**Python.**
```python
def least_rotation(s: str) -> int:
    n = len(s)
    t = s + s
    i, ans = 0, 0
    while i < n:
        ans = i
        j, k = i + 1, i
        while j < 2 * n and t[k] <= t[j]:
            k = i if t[k] < t[j] else k + 1
            j += 1
        while i <= k:
            i += j - k
    return ans


def smallest_rotation(s: str) -> str:
    idx = least_rotation(s)
    return s[idx:] + s[:idx]


if __name__ == "__main__":
    print(smallest_rotation("bca"))   # abc
    print(smallest_rotation("dcab"))  # abdc
```

---

### Challenge 3: Largest Cyclic Rotation

**Problem.** Given a string `s`, return its lexicographically **largest** cyclic rotation.

**Approach.** Invert the alphabet (`c → 0xFF - c` for bytes) so "smallest under reversed order" equals "largest", reuse the `least_rotation` routine, and slice the original string at the returned index.

**Go.**
```go
package main

import "fmt"

func leastRotationBytes(b []byte) int {
	n := len(b)
	at := func(i int) byte { return b[i%n] }
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

func largestRotation(s string) string {
	inv := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		inv[i] = 0xFF - s[i] // invert order
	}
	idx := leastRotationBytes(inv)
	return s[idx:] + s[:idx]
}

func main() {
	fmt.Println(largestRotation("bca"))  // cab
	fmt.Println(largestRotation("dcab")) // dcab? -> largest rotation
}
```

**Java.**
```java
public class LargestRotation {
    static int leastRotation(byte[] b) {
        int n = b.length;
        int i = 0, ans = 0;
        while (i < n) {
            ans = i;
            int j = i + 1, k = i;
            while (j < 2 * n && (b[k % n] & 0xFF) <= (b[j % n] & 0xFF)) {
                if ((b[k % n] & 0xFF) < (b[j % n] & 0xFF)) k = i;
                else k++;
                j++;
            }
            while (i <= k) i += j - k;
        }
        return ans;
    }

    static String largestRotation(String s) {
        byte[] inv = new byte[s.length()];
        for (int i = 0; i < s.length(); i++)
            inv[i] = (byte) (0xFF - s.charAt(i));
        int idx = leastRotation(inv);
        return s.substring(idx) + s.substring(0, idx);
    }

    public static void main(String[] args) {
        System.out.println(largestRotation("bca")); // cab
    }
}
```

**Python.**
```python
def least_rotation_seq(seq) -> int:
    n = len(seq)
    i, ans = 0, 0
    while i < n:
        ans = i
        j, k = i + 1, i
        while j < 2 * n and seq[k % n] <= seq[j % n]:
            k = i if seq[k % n] < seq[j % n] else k + 1
            j += 1
        while i <= k:
            i += j - k
    return ans


def largest_rotation(s: str) -> str:
    inv = [255 - ord(c) for c in s]  # invert alphabet order
    idx = least_rotation_seq(inv)
    return s[idx:] + s[:idx]


if __name__ == "__main__":
    print(largest_rotation("bca"))   # cab
    print(largest_rotation("dcab"))  # largest rotation
```

---

### Challenge 4: Generate de Bruijn Sequence via Lyndon Words

**Problem.** Given alphabet size `σ` and order `k`, produce a de Bruijn sequence `B(σ, k)`: a string of length `σᵏ` in which every length-`k` word over `{0,…,σ-1}` appears exactly once cyclically. Use the FKM construction (concatenate Lyndon words whose length divides `k`).

**Example.**
```text
de_bruijn(2, 3) -> "00010111"   (length 8 = 2^3; every 3-bit window appears once)
```

**Python.**
```python
def de_bruijn(sigma: int, k: int) -> str:
    seq = []
    w = [0]
    while w:
        if k % len(w) == 0:
            seq.extend(w)            # keep Lyndon words whose length divides k
        m = len(w)
        while len(w) < k:
            w.append(w[len(w) - m])  # repeat up to length k
        while w and w[-1] == sigma - 1:
            w.pop()                  # strip trailing maximal letters
        if w:
            w[-1] += 1               # increment last non-maximal letter
    return "".join(map(str, seq))


if __name__ == "__main__":
    print(de_bruijn(2, 3))  # 00010111
    print(len(de_bruijn(2, 4)) == 2 ** 4)  # True
```

**Go.**
```go
package main

import (
	"fmt"
	"strconv"
	"strings"
)

func deBruijn(sigma, k int) string {
	var sb strings.Builder
	w := []int{0}
	for len(w) > 0 {
		if k%len(w) == 0 {
			for _, c := range w {
				sb.WriteString(strconv.Itoa(c))
			}
		}
		m := len(w)
		for len(w) < k {
			w = append(w, w[len(w)-m])
		}
		for len(w) > 0 && w[len(w)-1] == sigma-1 {
			w = w[:len(w)-1]
		}
		if len(w) > 0 {
			w[len(w)-1]++
		}
	}
	return sb.String()
}

func main() {
	fmt.Println(deBruijn(2, 3)) // 00010111
}
```

**Java.**
```java
import java.util.*;

public class DeBruijn {
    static String deBruijn(int sigma, int k) {
        StringBuilder sb = new StringBuilder();
        List<Integer> w = new ArrayList<>();
        w.add(0);
        while (!w.isEmpty()) {
            if (k % w.size() == 0)
                for (int c : w) sb.append(c);
            int m = w.size();
            while (w.size() < k) w.add(w.get(w.size() - m));
            while (!w.isEmpty() && w.get(w.size() - 1) == sigma - 1)
                w.remove(w.size() - 1);
            if (!w.isEmpty())
                w.set(w.size() - 1, w.get(w.size() - 1) + 1);
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(deBruijn(2, 3)); // 00010111
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"A Lyndon word is strictly smaller than all its rotations; Duval factors any string into non-increasing Lyndon words in `O(n)` time, `O(1)` space."*
- Immediately flag the two gotchas: the inequality is **strict** (so `aa` is not Lyndon), and the factors come out **non-increasing**.
- For the smallest rotation, reach for **Duval on `s + s`** and remember the answer index is always `< n`.
- For the largest rotation, **invert the alphabet** and reuse the smallest-rotation routine.
- Never build substrings in the inner loop — compare single characters to keep it linear.
- Mention **FKM + de Bruijn** and **Witt's formula** to show breadth; offer to validate against a brute-force oracle on small inputs.
