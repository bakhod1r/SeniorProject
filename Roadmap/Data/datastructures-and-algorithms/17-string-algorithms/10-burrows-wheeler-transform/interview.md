# Burrows-Wheeler Transform (BWT) and the FM-index — Interview Preparation

The BWT is a favourite interview topic because it rewards two crisp insights — *"sort the rotations of `s$` and take the last column"* (forward) and *"the LF-mapping `LF(i) = C[L[i]] + Occ(L[i], i)` walks the original string backward"* (inverse) — and then tests whether you can (a) build it fast from a suffix array, (b) wrap it into an FM-index, (c) run backward search to count occurrences in `O(m)`, and (d) explain why it compresses (`bzip2`) and why it dominates genomics (BWA/bowtie). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Forward BWT (naive) | sort all rotations, take last column | `O(n² log n)` |
| Forward BWT (production) | `BWT[i] = s[SA[i]-1]` from suffix array | `O(n)` |
| Inverse BWT | iterate LF-mapping from the `$` row | `O(n)` |
| Count occurrences of `P` | FM-index backward search | `O(m)` |
| Locate occurrences | backward search + sampled SA | `O(m + occ·s)` |
| Compress a file | BWT → MTF → RLE → Huffman (`bzip2`) | per-block |
| Index a genome | FM-index over reference | build `O(n)`, query `O(m)` |

Core formulas:

```text
$ is unique and smaller than every real character.
F = first column = sorted characters of s$.
L = last column = the BWT output.
C[c]      = number of characters strictly smaller than c.
Occ(c, i) = number of c in L[0..i-1]   (rank).
LF(i)     = C[L[i]] + Occ(L[i], i).     (last-to-first mapping)
BWT[i]    = s[(SA[i] - 1 + n) % n].     (build from suffix array)
```

Backward search skeleton:

```text
count(P):
    sp = 0; ep = n
    for c in reversed(P):
        sp = C[c] + Occ(c, sp)
        ep = C[c] + Occ(c, ep)
        if sp >= ep: return 0
    return ep - sp          # O(m)
```

Key facts:
- The BWT is a **permutation** of `s$` — same length, not compressed; it *aids* compression by clustering runs.
- Reversible because the **LF-mapping** is a single `n`-cycle (the unique `$` guarantees this).
- Backward search is `O(m)` — **independent of text length `n`**.
- FM-index = `L` + `C` + `Occ`; a **self-index** that can replace the text.

---

## Junior Questions (12 Q&A)

### J1. What is the Burrows-Wheeler Transform?
A reversible reordering of a string's characters. You append a unique sentinel `$`, sort all cyclic rotations, and read the last column. The output is a permutation of the input that clusters identical characters into runs, aiding compression.

### J2. Why do we append `$`?
The sentinel `$` is unique and smaller than every real character. It makes all rotations distinct (so sorting is unambiguous) and marks the end of the original string so the inverse transform knows where to start. Without it the transform may not be invertible.

### J3. What is the first column of the sorted rotation matrix?
It is simply the **sorted characters** of the string. You never need to store it; you can regenerate it by sorting the BWT (last column).

### J4. What is the last column?
The last column of the sorted rotation matrix **is** the BWT output.

### J5. Is the BWT output smaller than the input?
No. It has the same length and same multiset of characters — it is a permutation. Compression happens in a later stage (run-length + entropy coding); the BWT just makes the data more compressible.

### J6. What is `BWT("banana$")`?
`annb$aa`. The two `n`s and trailing `a`s cluster together, showing the run-forming property.

### J7. Why does the BWT help compression?
Sorting rotations groups characters that share the same following context. In real text those contexts are usually preceded by the same few characters, so the last column fills with runs like `aaaa`, which compressors squeeze easily.

### J8. What is the LF-mapping, in one sentence?
A function that maps a row to the row of the *preceding* character's rotation; iterating it reconstructs the original string backward.

### J9. What is the `C` array?
`C[c]` is the number of characters in the string strictly smaller than `c` — equivalently, where the block of `c`s begins in the sorted first column.

### J10. What is `Occ(c, i)` (rank)?
The number of times character `c` appears in the last column `L` before index `i` (i.e. in `L[0..i-1]`).

### J11. What is the time complexity of the naive forward BWT?
`O(n² log n)` time and `O(n²)` space, because it builds and sorts all `n` rotations of length `n`. Production code builds it in `O(n)` from a suffix array instead.

### J12 (analysis). Why is the BWT reversible at all?
Because the LF-mapping is a permutation forming a single `n`-cycle (guaranteed by the unique `$`). Following it from the `$` row visits every position exactly once and spells out the original, so no information is lost.

---

## Middle Questions (12 Q&A)

### M1. Derive the LF-mapping formula.
The `i`-th occurrence of `c` in `L` corresponds to the `i`-th occurrence of `c` in `F` (the LF property). `c`'s block in `F` starts at `C[c]`, and this is the `Occ(c, i)`-th `c`, so its row is `C[c] + Occ(c, i)`. Hence `LF(i) = C[L[i]] + Occ(L[i], i)`.

### M2. How do you invert the BWT?
Compute `C` and a rank structure over `L`. Start at the `$` row, repeatedly emit `L[row]` and set `row = LF(row)`. After `n` steps you have the original (reversed); reverse it. `O(n)` total.

### M3. How do you build the BWT in linear time?
From the suffix array: `BWT[i] = s[(SA[i]-1+n) % n]`. Sorting suffixes of `s$` gives the same order as sorting rotations (because `$` is unique and smallest), and the last column character of the rotation at `SA[i]` is the character just before it.

### M4. What is the FM-index?
A compressed self-index consisting of the BWT string `L`, the `C` array, and an `Occ`/rank structure. It supports inversion, counting, and (with a sampled suffix array) locating pattern occurrences — without storing the original text.

### M5. Explain backward search.
Process the pattern right to left, maintaining a range `[sp, ep)` of matching rows. For each character `c`: `sp = C[c] + Occ(c, sp)`, `ep = C[c] + Occ(c, ep)`. If `sp >= ep`, no match. The final `ep - sp` is the occurrence count. `O(m)`.

### M6. Why is backward search `O(m)` and not `O(m·n)`?
Each character does exactly two `Occ` lookups, each `O(1)` with a constant-time rank structure. There are `m` characters, so `O(m)` — independent of the text length.

### M7. What is run-length BWT?
Because the BWT clusters characters into runs, you store it as `(char, run-length)` pairs, using `O(r)` space where `r` is the number of runs. For repetitive data `r ≪ n`, giving large savings.

### M8. How do you locate (not just count) occurrences?
Backward search gives the row range `[sp, ep)`. For each row, follow `LF` until you reach a sampled suffix-array position, then add the number of steps. Sampling at rate `s` makes locate `O(s)` per occurrence.

### M9. How does the FM-index compare to a suffix tree?
Same `O(m)` count, but the FM-index uses far less space — a compressed form that can replace the text (`O(n log σ)` bits or less), versus a suffix tree's `O(n)` words with a large constant (~10-20× text). The trade-off is more complex code and slower locate.

### M10. Why is the DNA alphabet good for the FM-index?
`σ = 4` (A, C, G, T), so the `C` array is tiny and the rank structure is shallow/compact, making `Occ` extremely fast and the index small. This is why BWA/bowtie use it for genome indexing.

### M11. What goes wrong if `$` is not the smallest character?
The rotation sort order is wrong, `C` and the blocks are misaligned, and the transform may not invert. Always ensure `$` is strictly smaller than every input character (and appears once).

### M12 (analysis). Why does the FM-index need a rank structure rather than a plain count table?
A plain `Occ` table is `O(n·σ)` space, fine for tiny alphabets but wasteful for large ones. A wavelet tree gives `O(n log σ)` bits with `O(log σ)` rank; sampled checkpoints give `O(1)` rank with modest space. These keep the index compressed while supporting LF and backward search.

---

## Senior Questions (10 Q&A)

### S1. Walk through the bzip2 pipeline.
Per block: (1) BWT clusters bytes into runs; (2) Move-To-Front recodes by recency so runs become long stretches of small/zero values; (3) Run-Length Encoding collapses the zero-runs; (4) Huffman entropy-codes the skewed distribution. The BWT compresses nothing alone — it makes stages 2–4 effective. Decompression reverses the chain, ending in the LF-mapping inverse BWT.

### S2. How do BWA and bowtie use the BWT?
They build an FM-index over the reference genome (and its reverse complement). Exact seeds are found by `O(m)` backward search; inexact matching (mismatches/gaps from sequencing errors and variants) is done by turning backward search into a bounded backtracking tree, or by seed-and-extend (MEM seeding via FM-index, then Smith-Waterman extension).

### S3. What is a wavelet tree and why use it?
A succinct structure storing the BWT in `O(n log σ)` bits that answers `rank(c, i)` in `O(log σ)` by walking `log σ` levels of bitvector ranks. It makes the FM-index a true compressed self-index, supporting the rank queries that drive LF-mapping and backward search.

### S4. How do you sample the suffix array, and what does `s` trade off?
Store `SA[i]` only for a subset of rows (e.g. every text position multiple of `s`). To locate an unsampled row, apply `LF` until you hit a sampled one (`< s` steps), then add the step count. Small `s` → faster locate, more memory; large `s` → less memory, slower locate. Count-only services store no samples.

### S5. What is the r-index and when do you use it?
An FM-index built over the run-length BWT, occupying `O(r)` space (runs) while supporting backward search and locate, by sampling the SA at run boundaries. Use it for highly repetitive collections (thousands of similar genomes) where `r ≪ n`; useless when `r ≈ n`.

### S6. How do you handle non-ACGT characters in a DNA aligner?
Map the alphabet explicitly with a dedicated `N` symbol and a policy: skip, mask, or treat as a mismatch. Assuming pure `σ = 4` mis-indexes ambiguous bases and breaks the `C` array.

### S7. How do you verify a BWT/FM-index implementation?
Round-trip: `inverse(forward(s)) == s`. Permutation: `sorted(L) == sorted(s+"$")`. Count oracle: `count(P)` equals a naive overlapping substring count. Locate check: each reported position `p` satisfies `s[p:p+m] == P`. Cross-check the SA-based BWT against the rotation-based one on small inputs.

### S8. What is the main performance lever in backward search?
The two `rank`/`Occ` calls per character. Keep them `O(1)` (sampled checkpoints sized to cache for small `σ`) or `O(log σ)` (wavelet tree). Dense alphabet mapping and cache-resident checkpoints are the dominant constant-factor wins.

### S9. How do you build the BWT for a 3-gigabase genome without running out of RAM?
Use a linear-time, memory-bounded construction: SA-IS plus the SA formula, or an incremental/external-memory BWT builder (ropebwt2, BCR) that never materializes a full `int32` suffix array (which would be ~12 GB). Pack DNA into 2 bits per base.

### S10 (analysis). Why does the FM-index achieve order-`k` entropy with an order-0 coder on the BWT?
Sorting rotations groups all characters that share a length-`k` right-context into a contiguous block of `L`. Coding each block at its local order-0 entropy sums to `nH_k(T)`. So the BWT implicitly performs context modeling, and a simple coder on `L` attains high-order entropy on the original — simultaneously for all `k = o(log_σ n)`.

---

## Professional Questions (8 Q&A)

### P1. Prove the LF property.
Rows starting with `c` occupy `c`'s block in `F`, sorted by the suffix following `c`. Rows ending in `c` are the left-rotations of those rows; left-rotating prepends `c` and preserves their relative order (the shared trailing `c` does not break ties because the unique `$` makes all rotations distinct). Hence the `i`-th `c` in `L` maps to the `i`-th `c` in `F`. This justifies `LF(i) = C[L[i]] + Occ(L[i], i)`.

### P2. Why is rotation order the same as suffix order?
Because `$` is unique and smallest and ends `s$`, comparing two rotations reaches the `$` of the shorter underlying suffix before wrap-around matters, so the comparison reduces to comparing suffixes. Thus `M[r] = rot_{SA[r]}`, giving `BWT[i] = s[SA[i]-1]`.

### P3. Prove inversion correctness and its `O(n)` bound.
`LF` is an order-preserving bijection (P1) whose orbit is a single `n`-cycle (forced by the unique `$`). Iterating it from the `$` row visits all `n` rows exactly once, emitting each character of `s$` once. Each step is `O(1)` with `C` and a rank structure, so `O(n)` total.

### P4. Prove backward search correctness.
Invariant: after consuming `P[i..]`, `[sp, ep)` is exactly the rows whose suffix is prefixed by `P[i..]`. Base: empty pattern → `[0, n)`. Step: extending by `c` selects rows in `c`'s `F`-block whose continuation lies in the old range, which by the LF property are `[C[c]+Occ(c,sp), C[c]+Occ(c,ep))`. By induction the final range counts all occurrences of `P`.

### P5. Why is the count step `O(1)` and the whole search `O(m)`?
Each character requires two `Occ` lookups and constant arithmetic; with `O(1)` rank that is `O(1)` per character, `O(m)` for the pattern — crucially independent of `n`.

### P6. When is a string a valid BWT?
Iff iterating its induced `LF` permutation from the `$` row is a single `n`-cycle (visits all rows). A corrupted `L` may induce multiple cycles and silently mis-invert; checking the single-cycle condition is `O(n)` validation.

### P7. State the BWT's entropy-compression bound.
With a good local coder, the BWT can be compressed to `nH_k(T) + o(n log σ)` bits simultaneously for all `k = o(log_σ n)`, because it sorts symbols by right-context so order-0 coding of `L` attains order-`k` entropy of `T`. The FM-index achieves this *and* supports `O(m)` search — a compressed index, not just a compressed file.

### P8 (analysis). What is the construction lower bound?
Reading the input and writing the `n`-symbol output force `Ω(n)`. For integer alphabets SA-IS achieves `O(n)`, optimal up to constants. For comparison alphabets, suffix sorting needs `Ω(n log n)` comparisons.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you reduced an index's memory footprint.
Look for a concrete story: a full suffix array or suffix tree that did not fit in RAM, the switch to an FM-index (or r-index for repetitive data), the chosen rank representation and SA sampling rate, and the measured memory/latency trade-off. Strong answers cite the round-trip and count-oracle tests used to keep correctness while shrinking the structure.

### B2. A teammate used the BWT output directly as "compressed" data. How do you respond?
Explain calmly that the BWT is a permutation — same size, not compressed — and that the actual reduction comes from the follow-up stages (MTF/RLE/Huffman). Show the character counts matching before and after. Frame it as a teaching moment: the BWT *enables* compression by clustering runs.

### B3. Design a substring-search service over a large fixed corpus.
Build an FM-index offline: suffix array → BWT → `C` + rank structure, with a sampled SA for locate. Counting queries are `O(m)`; locate is `O(m + occ·s)`. Discuss the rank backend (wavelet tree vs checkpoints), the SA sampling rate as a memory/latency knob, alphabet mapping, and a versioned serialized index with a checksum.

### B4. How would you explain the BWT to a junior engineer?
Use the bracelet analogy: photocopy the circular string from each starting bead, alphabetize the copies, and read the bead just before each start. Show `banana$ → annb$aa` and point at the runs. Lead with the two gotchas: it is a permutation (not compression by itself) and it needs the `$` sentinel to be reversible.

### B5. Your genome aligner returns wrong positions intermittently. How do you investigate?
Check the usual suspects: an off-by-one in `C` (must be strictly-smaller) or `Occ` (prefix before `i`); a sentinel collision (a real `$`/`N` in the data); a too-large SA sampling rate or a corrupted serialized index (no checksum). Add the round-trip and count-oracle tests, verify each located position with a direct substring compare, and checksum the loaded index.

---

## Coding Challenges

### Challenge 1: Forward BWT (rotations + sort)

**Problem.** Given a string `s` (no `$`), return `BWT(s$)` by sorting all rotations of `s$` and reading the last column.

**Example.**
```text
s = "banana"      -> "annb$aa"
s = "abracadabra" -> "ard$rcaaaabb"
```

**Constraints.** `1 ≤ |s| ≤ 2000` (naive method acceptable at this size).

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func bwt(s string) string {
	s += "$"
	n := len(s)
	rot := make([]string, n)
	for i := 0; i < n; i++ {
		rot[i] = s[i:] + s[:i]
	}
	sort.Strings(rot)
	out := make([]byte, n)
	for i, r := range rot {
		out[i] = r[n-1]
	}
	return string(out)
}

func main() {
	fmt.Println(bwt("banana"))      // annb$aa
	fmt.Println(bwt("abracadabra")) // ard$rcaaaabb
}
```

**Java.**
```java
import java.util.Arrays;

public class ForwardBWT {
    static String bwt(String s) {
        s += "$";
        int n = s.length();
        String[] rot = new String[n];
        for (int i = 0; i < n; i++) rot[i] = s.substring(i) + s.substring(0, i);
        Arrays.sort(rot);
        StringBuilder sb = new StringBuilder();
        for (String r : rot) sb.append(r.charAt(n - 1));
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(bwt("banana"));      // annb$aa
        System.out.println(bwt("abracadabra")); // ard$rcaaaabb
    }
}
```

**Python.**
```python
def bwt(s: str) -> str:
    s += "$"
    n = len(s)
    rot = sorted(s[i:] + s[:i] for i in range(n))
    return "".join(r[-1] for r in rot)


if __name__ == "__main__":
    print(bwt("banana"))       # annb$aa
    print(bwt("abracadabra"))  # ard$rcaaaabb
```

---

### Challenge 2: Inverse BWT via LF-mapping

**Problem.** Given a BWT string `L` (containing exactly one `$`), reconstruct the original string `s$` using the LF-mapping. Return it without the trailing `$`.

**Example.**
```text
L = "annb$aa" -> "banana"
```

**Constraints.** `1 ≤ |L| ≤ 10^6`; must be `O(n)`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func inverseBWT(L string) string {
	n := len(L)
	cnt := map[byte]int{}
	for i := 0; i < n; i++ {
		cnt[L[i]]++
	}
	chars := []byte{}
	for c := range cnt {
		chars = append(chars, c)
	}
	sort.Slice(chars, func(a, b int) bool { return chars[a] < chars[b] })
	C := map[byte]int{}
	run := 0
	for _, c := range chars {
		C[c] = run
		run += cnt[c]
	}
	seen := map[byte]int{}
	LF := make([]int, n)
	for i := 0; i < n; i++ {
		c := L[i]
		LF[i] = C[c] + seen[c]
		seen[c]++
	}
	row := 0
	for i := 0; i < n; i++ {
		if L[i] == '$' {
			row = i
			break
		}
	}
	out := make([]byte, n)
	for i := n - 1; i >= 0; i-- {
		out[i] = L[row]
		row = LF[row]
	}
	return string(out[:n-1]) // drop trailing '$'
}

func main() {
	fmt.Println(inverseBWT("annb$aa")) // banana
}
```

**Java.**
```java
public class InverseBWT {
    static String inverseBWT(String L) {
        int n = L.length();
        int[] cnt = new int[256];
        for (int i = 0; i < n; i++) cnt[L.charAt(i)]++;
        int[] C = new int[256];
        int run = 0;
        for (int c = 0; c < 256; c++) { C[c] = run; run += cnt[c]; }
        int[] seen = new int[256];
        int[] LF = new int[n];
        for (int i = 0; i < n; i++) {
            int c = L.charAt(i);
            LF[i] = C[c] + seen[c];
            seen[c]++;
        }
        int row = 0;
        for (int i = 0; i < n; i++) if (L.charAt(i) == '$') { row = i; break; }
        char[] out = new char[n];
        for (int i = n - 1; i >= 0; i--) { out[i] = L.charAt(row); row = LF[row]; }
        return new String(out, 0, n - 1);
    }

    public static void main(String[] args) {
        System.out.println(inverseBWT("annb$aa")); // banana
    }
}
```

**Python.**
```python
def inverse_bwt(L: str) -> str:
    n = len(L)
    chars = sorted(set(L))
    cnt = {c: L.count(c) for c in chars}
    C, run = {}, 0
    for c in chars:
        C[c] = run
        run += cnt[c]
    seen = {c: 0 for c in chars}
    LF = [0] * n
    for i, c in enumerate(L):
        LF[i] = C[c] + seen[c]
        seen[c] += 1
    row = L.index("$")
    out = [""] * n
    for i in range(n - 1, -1, -1):
        out[i] = L[row]
        row = LF[row]
    return "".join(out)[:-1]  # drop trailing '$'


if __name__ == "__main__":
    print(inverse_bwt("annb$aa"))  # banana
```

---

### Challenge 3: FM-Index — Count Occurrences (backward search)

**Problem.** Given a text `s` and a pattern `P`, count the occurrences of `P` in `s` using an FM-index and backward search. Build `BWT`, `C`, and `Occ`, then run the `O(|P|)` backward search.

**Example.**
```text
s = "banana", P = "ana" -> 2
s = "banana", P = "ban" -> 1
s = "banana", P = "xyz" -> 0
```

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ |P| ≤ |s|`.

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func bwtFromRot(s string) string {
	s += "$"
	n := len(s)
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return s[idx[a]:]+s[:idx[a]] < s[idx[b]:]+s[:idx[b]] })
	out := make([]byte, n)
	for i, k := range idx {
		out[i] = s[(k-1+n)%n]
	}
	return string(out)
}

func countOcc(s, P string) int {
	L := bwtFromRot(s)
	n := len(L)
	set := map[byte]bool{}
	for i := 0; i < n; i++ {
		set[L[i]] = true
	}
	chars := []byte{}
	for c := range set {
		chars = append(chars, c)
	}
	sort.Slice(chars, func(a, b int) bool { return chars[a] < chars[b] })
	C := map[byte]int{}
	run := 0
	for _, c := range chars {
		cnt := 0
		for i := 0; i < n; i++ {
			if L[i] == c {
				cnt++
			}
		}
		C[c] = run
		run += cnt
	}
	occ := map[byte][]int{}
	for _, c := range chars {
		occ[c] = make([]int, n+1)
	}
	for i := 0; i < n; i++ {
		for _, c := range chars {
			occ[c][i+1] = occ[c][i]
			if L[i] == c {
				occ[c][i+1]++
			}
		}
	}
	sp, ep := 0, n
	for i := len(P) - 1; i >= 0; i-- {
		c := P[i]
		if _, ok := C[c]; !ok {
			return 0
		}
		sp = C[c] + occ[c][sp]
		ep = C[c] + occ[c][ep]
		if sp >= ep {
			return 0
		}
	}
	return ep - sp
}

func main() {
	fmt.Println(countOcc("banana", "ana")) // 2
	fmt.Println(countOcc("banana", "ban")) // 1
	fmt.Println(countOcc("banana", "xyz")) // 0
}
```

**Java.**
```java
import java.util.*;

public class FMCount {
    static String bwt(String s) {
        s += "$";
        int n = s.length();
        Integer[] idx = new Integer[n];
        for (int i = 0; i < n; i++) idx[i] = i;
        final String t = s;
        Arrays.sort(idx, (a, b) -> (t.substring(a) + t.substring(0, a))
                                  .compareTo(t.substring(b) + t.substring(0, b)));
        StringBuilder sb = new StringBuilder();
        for (int k : idx) sb.append(t.charAt((k - 1 + n) % n));
        return sb.toString();
    }

    static int count(String s, String P) {
        String L = bwt(s);
        int n = L.length();
        int[] cnt = new int[256];
        for (int i = 0; i < n; i++) cnt[L.charAt(i)]++;
        int[] C = new int[256];
        int run = 0;
        for (int c = 0; c < 256; c++) { C[c] = run; run += cnt[c]; }
        int[][] occ = new int[256][n + 1];
        for (int i = 0; i < n; i++)
            for (int c = 0; c < 256; c++)
                occ[c][i + 1] = occ[c][i] + (L.charAt(i) == c ? 1 : 0);
        int sp = 0, ep = n;
        for (int i = P.length() - 1; i >= 0; i--) {
            int c = P.charAt(i);
            sp = C[c] + occ[c][sp];
            ep = C[c] + occ[c][ep];
            if (sp >= ep) return 0;
        }
        return ep - sp;
    }

    public static void main(String[] args) {
        System.out.println(count("banana", "ana")); // 2
        System.out.println(count("banana", "ban")); // 1
        System.out.println(count("banana", "xyz")); // 0
    }
}
```

**Python.**
```python
def bwt(s: str) -> str:
    s += "$"
    n = len(s)
    rot = sorted(range(n), key=lambda i: s[i:] + s[:i])
    return "".join(s[(k - 1) % n] for k in rot)


def count_occ(s: str, P: str) -> int:
    L = bwt(s)
    n = len(L)
    chars = sorted(set(L))
    C, run = {}, 0
    for c in chars:
        C[c] = run
        run += L.count(c)
    occ = {c: [0] * (n + 1) for c in chars}
    for i, ch in enumerate(L):
        for c in chars:
            occ[c][i + 1] = occ[c][i] + (1 if ch == c else 0)
    sp, ep = 0, n
    for c in reversed(P):
        if c not in C:
            return 0
        sp = C[c] + occ[c][sp]
        ep = C[c] + occ[c][ep]
        if sp >= ep:
            return 0
    return ep - sp


if __name__ == "__main__":
    print(count_occ("banana", "ana"))  # 2
    print(count_occ("banana", "ban"))  # 1
    print(count_occ("banana", "xyz"))  # 0
```

---

### Challenge 4: BWT from a Suffix Array

**Problem.** Given a string `s`, build the suffix array of `s$`, then derive the BWT via `BWT[i] = s$[(SA[i]-1) mod n]`. This is the production forward method.

**Example.**
```text
s = "banana" -> SA of "banana$" -> BWT = "annb$aa"
```

**Constraints.** `1 ≤ |s| ≤ 10^5` (a simple `O(n² log n)` SA is fine here; production uses SA-IS).

**Python.**
```python
def suffix_array(s: str):
    return sorted(range(len(s)), key=lambda i: s[i:])


def bwt_from_sa(s: str) -> str:
    s += "$"
    n = len(s)
    sa = suffix_array(s)
    return "".join(s[(sa[i] - 1) % n] for i in range(n))


if __name__ == "__main__":
    print(bwt_from_sa("banana"))  # annb$aa
```

**Go.**
```go
package main

import (
	"fmt"
	"sort"
)

func suffixArray(s string) []int {
	n := len(s)
	sa := make([]int, n)
	for i := range sa {
		sa[i] = i
	}
	sort.Slice(sa, func(a, b int) bool { return s[sa[a]:] < s[sa[b]:] })
	return sa
}

func bwtFromSA(s string) string {
	s += "$"
	n := len(s)
	sa := suffixArray(s)
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		out[i] = s[(sa[i]-1+n)%n]
	}
	return string(out)
}

func main() {
	fmt.Println(bwtFromSA("banana")) // annb$aa
}
```

**Java.**
```java
import java.util.*;

public class BWTFromSA {
    static int[] suffixArray(String s) {
        int n = s.length();
        Integer[] sa = new Integer[n];
        for (int i = 0; i < n; i++) sa[i] = i;
        Arrays.sort(sa, (a, b) -> s.substring(a).compareTo(s.substring(b)));
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = sa[i];
        return out;
    }

    static String bwtFromSA(String s) {
        s += "$";
        int n = s.length();
        int[] sa = suffixArray(s);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(s.charAt((sa[i] - 1 + n) % n));
        return sb.toString();
    }

    public static void main(String[] args) {
        System.out.println(bwtFromSA("banana")); // annb$aa
    }
}
```

---

## Final Tips

- Lead with the two one-liners: *"forward = sort rotations of `s$`, take the last column"* and *"inverse = follow `LF(i) = C[L[i]] + Occ(L[i], i)` from the `$` row."*
- Immediately flag the gotchas: the output is a **permutation** (not compression alone), and the `$` must be **unique and smallest**.
- For search, reach for **backward search** — `O(m)`, independent of `n`.
- Mention building the BWT from a **suffix array** (`BWT[i] = s[SA[i]-1]`) as the scalable forward method.
- Name the applications: **`bzip2`** (BWT → MTF → RLE → Huffman) and **BWA/bowtie** (FM-index seeding).
- Always offer to verify with a **round-trip** (`inverse(forward(s)) == s`) and a brute-force count oracle.
