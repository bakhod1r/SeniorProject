# Burrows-Wheeler Transform (BWT) and the FM-index — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code or hints in all three languages. Implement the BWT / FM-index logic and validate against the evaluation criteria.
> **Always round-trip-test (`inverse(forward(s)) == s`) and validate counts against a brute-force substring scan on small inputs before trusting the fast version.**

---

## Beginner Tasks (5)

### Task 1 — Forward BWT by sorting rotations

**Problem.** Implement `bwt(s)` that appends `$` to `s`, sorts all cyclic rotations of `s$`, and returns the last column.

**Input / Output spec.**
- Read a line containing `s` (no `$`).
- Print `BWT(s$)`.

**Constraints.**
- `1 ≤ |s| ≤ 2000`, characters are printable ASCII greater than `$` (`0x24`).
- `$` must not appear in `s`.

**Hint.** Rotation `i` is `s[i:] + s[:i]`. In ASCII, `$` already sorts before letters, so a default string sort is correct.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func bwt(s string) string {
	// TODO: append '$', build rotations, sort, take last column
	_ = sort.Strings
	return ""
}

func main() {
	r := bufio.NewReader(os.Stdin)
	var s string
	fmt.Fscan(r, &s)
	fmt.Println(bwt(s))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static String bwt(String s) {
        // TODO
        return "";
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(bwt(sc.next()));
    }
}
```

**Starter — Python.**
```python
import sys


def bwt(s: str) -> str:
    # TODO: append '$', sort rotations, return last column
    return ""


if __name__ == "__main__":
    print(bwt(sys.stdin.readline().strip()))
```

**Evaluation criteria.**
- `bwt("banana") == "annb$aa"`.
- Output is a permutation of `s + "$"`.
- Exactly one `$` in the output.

---

### Task 2 — Identify the first column from the BWT

**Problem.** Given a BWT string `L`, output the **first column** `F` of the sorted rotation matrix. Recall `F` is just the sorted characters of `L`.

**Input / Output spec.**
- Read `L`.
- Print `F` (the sorted characters of `L`).

**Constraints.** `1 ≤ |L| ≤ 10^5`, exactly one `$`.

**Hint.** `F = "".join(sorted(L))`. This demonstrates that you never need to store `F` separately.

**Evaluation criteria.**
- For `L = "annb$aa"`, `F == "$aaabnn"`.
- `F` is sorted and a permutation of `L`.

---

### Task 3 — Build the C array

**Problem.** Given a BWT string `L`, build the `C` array where `C[c]` = number of characters in `L` strictly smaller than `c`. Print `C[c]` for each distinct character `c` in sorted order.

**Input / Output spec.**
- Read `L`.
- For each distinct `c` (sorted), print `c C[c]` on its own line.

**Constraints.** `1 ≤ |L| ≤ 10^5`.

**Hint.** Count occurrences of each character, then take a running prefix sum over the sorted distinct characters. `C['$'] = 0`.

**Worked check.** For `L = "annb$aa"`: `$→0, a→1, b→4, n→5`.

**Evaluation criteria.**
- `C` is non-decreasing.
- Matches the worked check above.
- `C[smallest char] == 0`.

---

### Task 4 — Inverse BWT via LF-mapping

**Problem.** Given a BWT string `L` (exactly one `$`), reconstruct and print the original string `s` (without the trailing `$`) using the LF-mapping.

**Input / Output spec.**
- Read `L`.
- Print the reconstructed `s`.

**Constraints.** `1 ≤ |L| ≤ 10^6`; must be `O(n)`.

**Hint.** `LF(i) = C[L[i]] + (#L[i] in L[0..i-1])`. Start at the `$` row, emit `L[row]`, set `row = LF(row)`, repeat `n` times, then reverse and drop the `$`.

**Reference oracle (Python) — naive inverse by rebuilding the matrix.**
```python
def inverse_naive(L):
    n = len(L)
    rows = [""] * n
    for _ in range(n):
        rows = sorted(L[i] + rows[i] for i in range(n))  # prepend column, re-sort
    # the row ending in '$' is the original rotation
    for r in rows:
        if r.endswith("$"):
            return r[:-1]
```

**Evaluation criteria.**
- `inverse_bwt("annb$aa") == "banana"`.
- Matches `inverse_naive` for small inputs.
- Runs in `O(n)` (no rebuilding the matrix).

---

### Task 5 — Round-trip self-test

**Problem.** Implement both `bwt(s)` and `inverse_bwt(L)`, then verify `inverse_bwt(bwt(s)) == s` for a batch of test strings. Print `OK` if all pass, else the first failing string.

**Input / Output spec.**
- Read an integer `t`, then `t` strings.
- Print `OK` or the first failing string.

**Constraints.** `1 ≤ t ≤ 100`, each `|s| ≤ 1000`.

**Hint.** Reuse Task 1 and Task 4. This is the single most valuable test for any BWT implementation.

**Evaluation criteria.**
- Catches an injected off-by-one bug in `C` or `Occ`.
- Passes on `banana`, `mississippi`, `aaaa`, `a`, `abracadabra`.

---

## Intermediate Tasks (5)

### Task 6 — Build the BWT from a suffix array

**Problem.** Build the suffix array of `s$`, then derive the BWT via `BWT[i] = s$[(SA[i]-1) mod n]`. This avoids the `O(n²)` rotation matrix.

**Input / Output spec.**
- Read `s`.
- Print `BWT(s$)`.

**Constraints.** `1 ≤ |s| ≤ 10^5`. A simple `O(n² log n)` SA is acceptable; note where SA-IS would replace it.

**Hint.** Sorting suffixes of `s$` gives the same order as sorting rotations (because `$` is unique and smallest). The BWT character at row `i` is the char just before `SA[i]`.

**Evaluation criteria.**
- Output equals the rotation-based BWT (Task 1) for the same input.
- Handles `SA[i] == 0` with the wrap convention (`-> '$'`).
- `O(n)` derivation once `SA` is available.

---

### Task 7 — FM-index count (backward search)

**Problem.** Given a text `s` and `q` patterns, build an FM-index over `s` once and answer each "how many times does `P` occur in `s`?" query with backward search in `O(|P|)`.

**Input / Output spec.**
- Read `s`, then `q`, then `q` patterns.
- For each pattern, print its occurrence count.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ q ≤ 10^4`, `Σ|P| ≤ 10^6`.

**Hint.** Precompute `BWT`, `C`, and prefix-sum `Occ` once. Per query: `sp = C[c] + Occ(c, sp)`, `ep = C[c] + Occ(c, ep)` for `c` right-to-left; answer is `ep - sp`.

**Reference oracle (Python).**
```python
def brute_count(s, P):
    return sum(1 for i in range(len(s) - len(P) + 1) if s[i:i + len(P)] == P)
```

**Evaluation criteria.**
- Matches `brute_count` for every query on small inputs (overlapping counts).
- Per-query cost is `O(|P|)` (index built once).
- Returns 0 for patterns with characters not in `s`.

---

### Task 8 — Locate occurrences with a sampled suffix array

**Problem.** Extend Task 7 to **report the positions** of each occurrence, not just the count, using a suffix array sampled at rate `sRate`. For an unsampled row, follow `LF` until a sampled row, then add the step count.

**Input / Output spec.**
- Read `s`, `sRate`, then `q`, then `q` patterns.
- For each pattern, print its occurrence positions in ascending order.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `1 ≤ sRate ≤ 32`.

**Hint.** Store `SA[i]` only where `SA[i] % sRate == 0`. `locate(row)`: count `LF` steps until `row` is sampled, return `SA_sample[row] + steps`. Each locate is `O(sRate)`.

**Evaluation criteria.**
- Every reported position `p` satisfies `s[p:p+|P|] == P`.
- Positions match a brute-force scan.
- Smaller `sRate` uses more memory; larger `sRate` does more `LF` steps (document the trade-off).

---

### Task 9 — Move-To-Front encode/decode

**Problem.** Implement MTF encode and decode over a 256-symbol alphabet. Show that running MTF on a BWT output produces many small/zero values (the `bzip2` bridge stage).

**Input / Output spec.**
- Read a string (treated as bytes).
- Print the BWT, then the MTF encoding of the BWT (space-separated ints), then confirm `mtf_decode(mtf_encode(L)) == L`.

**Constraints.** `1 ≤ |s| ≤ 10^5`.

**Hint.** Keep an ordered list of the 256 symbols. Encode: emit the index of each byte, then move it to the front. Decode mirrors it.

**Evaluation criteria.**
- `mtf_decode(mtf_encode(x)) == x` for random inputs.
- The MTF of a BWT shows a skew toward small values (more 0s than the MTF of the raw input).
- Correct over the full byte alphabet.

---

### Task 10 — Run-length encode the BWT

**Problem.** Given a BWT string `L`, output its run-length encoding as `(char, length)` pairs, and report the number of runs `r`. Compare `r` to `|L|` for a repetitive vs a random input.

**Input / Output spec.**
- Read `L`.
- Print the runs and `r`.

**Constraints.** `1 ≤ |L| ≤ 10^6`.

**Hint.** Scan `L`, grouping consecutive equal characters. `r` is the number of groups.

**Evaluation criteria.**
- Correct `(char, length)` pairs that reconstruct `L`.
- `r` is small for `bwt("a"*1000 + "b"*1000)` and near `|L|` for random text.
- Reconstructing from runs yields the original `L`.

---

## Advanced Tasks (5)

### Task 11 — Backward search with O(1) rank via checkpoints

**Problem.** Replace the `O(n·σ)` prefix-sum `Occ` table with **sampled checkpoints**: store cumulative counts every `B` positions, and compute `Occ(c, i)` by reading the nearest checkpoint and scanning at most `B` characters. Keep backward search at `O(|P|·B)` while using `O((n/B)·σ + n)` space.

**Input / Output spec.**
- Read `s`, `B`, then `q` patterns; print each count.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `1 ≤ B ≤ 64`.

**Hint.** `Occ(c, i) = checkpoint[i/B][c] + (count of c in L[(i/B)*B .. i-1])`. Choose `B` to fit checkpoints in cache.

**Evaluation criteria.**
- Counts match the full-table FM-index (Task 7).
- Space is `O((n/B)·σ + n)`, not `O(n·σ)`.
- Document the `B` space/time trade-off.

---

### Task 12 — Wavelet-tree rank (small alphabet)

**Problem.** Build a balanced **wavelet tree** over the BWT and answer `rank(c, i)` in `O(log σ)`. Use it to drive backward search.

**Input / Output spec.**
- Read `s`, then `q` patterns; print each count.

**Constraints.** `1 ≤ |s| ≤ 10^5`, `σ ≤ 64`.

**Hint.** The root bitvector marks whether each character is in the lower or upper half of the alphabet; recurse. `rank(c, i)` walks `log σ` levels doing one bitvector rank per level. For correctness you may back the bitvector rank with a simple prefix-sum at first.

**Evaluation criteria.**
- `rank(c, i)` matches a brute-force count for random `(c, i)`.
- Backward search counts match Task 7.
- Query is `O(log σ)` per rank (or document the simplification used).

---

### Task 13 — Inexact matching: 1-mismatch search

**Problem.** Using the FM-index, count occurrences of `P` in `s` allowing **at most one mismatch** (Hamming distance ≤ 1). Turn backward search into a small branching search: at each position, either match the pattern character or (if the mismatch budget remains) try every other character.

**Input / Output spec.**
- Read `s`, then `q` patterns; print each "≤1-mismatch" occurrence count.

**Constraints.** `1 ≤ |s| ≤ 10^4`, `1 ≤ |P| ≤ 50`.

**Hint.** Recurse with state `(sp, ep, posInP, mismatchesLeft)`. Branch to every alphabet character at each position; matching the real character costs no budget, others cost one. Prune when `sp >= ep`. Deduplicate occurrences carefully (count distinct text positions if required).

**Evaluation criteria.**
- Matches a brute-force Hamming-distance scan for small inputs.
- Correctly prunes branches where `sp >= ep`.
- Documents that this is the seed of how BWA/bowtie handle sequencing errors.

---

### Task 14 — Full bzip2-style block pipeline (encode/decode round-trip)

**Problem.** Implement a simplified block pipeline: **BWT → MTF → RLE-of-zeros → (any reversible entropy step or just store)** for a single block, plus the exact inverse. Verify round-trip on arbitrary byte input. Store the primary index (or rely on `$`).

**Input / Output spec.**
- Read a block (bytes).
- Print the encoded representation sizes at each stage and confirm `decode(encode(block)) == block`.

**Constraints.** Block size ≤ 100 KB.

**Hint.** Compose Task 1/4 (BWT + inverse), Task 9 (MTF), and a zero-run RLE. The inverse runs stages in reverse, ending with the LF-mapping inverse BWT. The trickiest part is the BWT/inverse boundary — test it in isolation first.

**Evaluation criteria.**
- Exact round-trip on random bytes, all-equal bytes, and text.
- Reports the symbol-count skew introduced by BWT+MTF (compressibility evidence).
- The inverse uses the LF-mapping, not matrix rebuilding.

---

### Task 15 — Decide when the BWT/FM-index is the wrong tool

**Problem.** Given a problem description with constraints `(text_size, query_type, repetitiveness, mutability)`, implement `classify(problem)` (or write a short analysis) returning one of: `FM_INDEX`, `R_INDEX`, `SUFFIX_TREE`, `BZIP2_PIPELINE`, or `WRONG_TOOL` (e.g. streaming/online-mutable text). Justify each decision.

**Constraints / cases to handle.**
- Static huge text, count/locate substrings → `FM_INDEX`.
- Thousands of near-identical genomes (`r ≪ n`) → `R_INDEX`.
- Memory not a concern, simplest fast index → `SUFFIX_TREE`.
- General file compression → `BZIP2_PIPELINE`.
- Frequently mutated / streamed text that cannot be blocked → `WRONG_TOOL`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap: the BWT needs the whole (blockable) input and is built offline; it is poor for online-mutable text.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `R_INDEX` branch references measuring `r/n`.
- The `WRONG_TOOL` branch cites the offline/blockable-input requirement.

---

## Extra Graded Tasks (3)

### Task 16 — Rebuild the original from `(L, primaryIndex)` without a sentinel (Beginner)

**Problem.** Some BWT implementations do **not** append a visible `$`. Instead they BWT the raw rotations of `s` and return the pair `(L, primaryIndex)`, where `primaryIndex` is the row in the sorted rotation matrix that holds the original string `s`. Implement `inverse_bwt_primary(L, primaryIndex)` that reconstructs `s` using the LF-mapping, starting the walk at `primaryIndex` instead of at the `$` row.

**Input / Output spec.**
- Read `L` on the first line and the integer `primaryIndex` on the second line.
- Print the reconstructed original string `s`.

**Constraints.**
- `1 ≤ |L| ≤ 10^5`, `0 ≤ primaryIndex < |L|`.
- `L` contains **no** sentinel; every character is a real symbol.

**Hint.** The LF-mapping is identical to the sentinel version: `LF(i) = C[L[i]] + Occ(L[i], i)`. The only differences are (a) you start at `row = primaryIndex`, and (b) you take exactly `n` steps and emit characters in reverse — there is no `$` to strip at the end. To produce a sentinel-style `L` for testing, BWT `s` and record which sorted row equals `s`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

func inverseBWTPrimary(L string, primaryIndex int) string {
	n := len(L)
	counts := make(map[byte]int)
	for i := 0; i < n; i++ {
		counts[L[i]]++
	}
	chars := make([]byte, 0, len(counts))
	for c := range counts {
		chars = append(chars, c)
	}
	sort.Slice(chars, func(i, j int) bool { return chars[i] < chars[j] })
	C := make(map[byte]int)
	run := 0
	for _, c := range chars {
		C[c] = run
		run += counts[c]
	}
	seen := make(map[byte]int)
	LF := make([]int, n)
	for i := 0; i < n; i++ {
		c := L[i]
		LF[i] = C[c] + seen[c]
		seen[c]++
	}
	out := make([]byte, n)
	row := primaryIndex
	for k := n - 1; k >= 0; k-- {
		out[k] = L[row]
		row = LF[row]
	}
	return string(out)
}

func main() {
	r := bufio.NewReader(os.Stdin)
	var L string
	var p int
	fmt.Fscan(r, &L)
	fmt.Fscan(r, &p)
	fmt.Println(inverseBWTPrimary(L, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task16 {
    static String inverseBWTPrimary(String L, int primaryIndex) {
        int n = L.length();
        int[] counts = new int[256];
        for (int i = 0; i < n; i++) counts[L.charAt(i)]++;
        int[] C = new int[256];
        int run = 0;
        for (int c = 0; c < 256; c++) { C[c] = run; run += counts[c]; }
        int[] seen = new int[256];
        int[] LF = new int[n];
        for (int i = 0; i < n; i++) {
            int c = L.charAt(i);
            LF[i] = C[c] + seen[c]++;
        }
        char[] out = new char[n];
        int row = primaryIndex;
        for (int k = n - 1; k >= 0; k--) {
            out[k] = L.charAt(row);
            row = LF[row];
        }
        return new String(out);
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String L = sc.next();
        int p = sc.nextInt();
        System.out.println(inverseBWTPrimary(L, p));
    }
}
```

**Starter — Python.**
```python
import sys


def inverse_bwt_primary(L: str, primary_index: int) -> str:
    n = len(L)
    counts = {}
    for c in L:
        counts[c] = counts.get(c, 0) + 1
    C, run = {}, 0
    for c in sorted(counts):
        C[c] = run
        run += counts[c]
    seen, LF = {}, [0] * n
    for i, c in enumerate(L):
        LF[i] = C[c] + seen.get(c, 0)
        seen[c] = seen.get(c, 0) + 1
    out = [""] * n
    row = primary_index
    for k in range(n - 1, -1, -1):
        out[k] = L[row]
        row = LF[row]
    return "".join(out)


if __name__ == "__main__":
    data = sys.stdin.read().split()
    print(inverse_bwt_primary(data[0], int(data[1])))
```

**Evaluation criteria.**
- Recovers `s` exactly for `(L, primaryIndex)` pairs produced by a sentinel-free forward BWT.
- Works when `s` contains repeated characters and when `s` is all one character.
- Runs in `O(n)` with no rotation-matrix rebuild.

---

### Task 17 — Reconstruct the full text from the FM-index using `extract(i, j)` (Intermediate)

**Problem.** An FM-index stores only `L`, `C`, and rank support — not the text. Yet you can still recover any substring. Implement `extract(l, r)` that returns the original text characters at positions `l..r-1` by repeatedly applying the LF-mapping from the row for text position `r-1` (found via a sampled suffix array or, for this task, a small `SA` you keep) and reading `F` characters. For simplicity, support full-text extraction `extract(0, n)` and verify it equals the original `s`.

**Input / Output spec.**
- Read `s`, then `q` queries; each query is a pair `l r`.
- For each query print the substring `s[l:r]`.

**Constraints.**
- `1 ≤ |s| ≤ 10^5`, `1 ≤ q ≤ 10^4`, `0 ≤ l < r ≤ |s|`.

**Hint.** Build `L` from `s$`. The character at text position `p` equals `F[row_p]` where `row_p` is the sorted-matrix row whose rotation begins at text position `p`. Walking `LF` from a known row moves you *backward* one text position at a time, so to read `s[l:r]` left-to-right you locate the row for position `r-1`, emit, step `LF` to reach `r-2`, and so on down to `l`, then reverse. Keep a (sampled) `SA` so you can find a starting row quickly.

**Reference oracle (Python).**
```python
def brute_extract(s, l, r):
    return s[l:r]
```

**Starter — Python.**
```python
import sys


def build_index(s):
    s = s + "$"
    n = len(s)
    sa = sorted(range(n), key=lambda i: s[i:])
    L = "".join(s[(sa[i] - 1) % n] for i in range(n))
    counts = {}
    for c in L:
        counts[c] = counts.get(c, 0) + 1
    C, run = {}, 0
    for c in sorted(counts):
        C[c] = run
        run += counts[c]
    seen, LF = {}, [0] * n
    for i, c in enumerate(L):
        LF[i] = C[c] + seen.get(c, 0)
        seen[c] = seen.get(c, 0) + 1
    # isa[p] = sorted row whose suffix starts at text position p
    isa = [0] * n
    for row, start in enumerate(sa):
        isa[start] = row
    return s, n, L, LF, isa


def extract(idx, l, r):
    s, n, L, LF, isa = idx
    # Walk from text position r-1 down to l, emitting L characters.
    row = isa[(r) % n]          # row for position r (one past the end), step into r-1
    out = []
    pos = r
    # Move LF to reach decreasing positions; emit L[row] which is char at pos-1.
    while pos > l:
        row = LF[row]
        out.append(L[row])
        pos -= 1
    return "".join(reversed(out))


if __name__ == "__main__":
    data = sys.stdin.read().split()
    s = data[0]
    idx = build_index(s)
    q = int(data[1])
    pos = 2
    for _ in range(q):
        l, r = int(data[pos]), int(data[pos + 1])
        pos += 2
        print(extract(idx, l, r))
```

**Evaluation criteria.**
- `extract(0, len(s))` reproduces `s` exactly (matches `brute_extract`).
- Arbitrary `extract(l, r)` matches `s[l:r]` for random ranges.
- Demonstrates that the text need not be stored alongside the index — `L` plus rank support suffices.

---

### Task 18 — Bidirectional / longest-suffix backward search statistics (Advanced)

**Problem.** Extend the FM-index backward search to report, for a query `P`, the length of the **longest suffix of `P` that occurs in `s`** together with that suffix's occurrence count. Process `P` right-to-left; as soon as extending by the next character empties the interval (`sp >= ep`), stop and report the suffix matched so far. This is the core primitive behind backward maximal-match seeding used in read aligners.

**Input / Output spec.**
- Read `s`, then `q`, then `q` patterns.
- For each pattern, print two integers: the longest-matching-suffix length and its occurrence count in `s`.

**Constraints.**
- `1 ≤ |s| ≤ 10^5`, `1 ≤ q ≤ 10^4`, `Σ|P| ≤ 10^6`.

**Hint.** Maintain `(sp, ep)` initialized to the full range `(0, n)`. For each character `c` from the end of `P`: compute `nsp = C[c] + Occ(c, sp)`, `nep = C[c] + Occ(c, ep)`. If `nsp >= nep`, the current `c` cannot extend the match — return the suffix length and the previous `ep - sp`. Otherwise update `(sp, ep) = (nsp, nep)` and increment the matched length. If the loop finishes, the whole `P` matched.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

type FM struct {
	L   string
	C   map[byte]int
	occ map[byte][]int // prefix counts, length n+1
	n   int
}

func buildFM(s string) *FM {
	s = s + "$"
	n := len(s)
	sa := make([]int, n)
	for i := range sa {
		sa[i] = i
	}
	sort.Slice(sa, func(a, b int) bool { return s[sa[a]:] < s[sa[b]:] })
	lb := make([]byte, n)
	for i := 0; i < n; i++ {
		lb[i] = s[(sa[i]-1+n)%n]
	}
	L := string(lb)
	counts := map[byte]int{}
	for i := 0; i < n; i++ {
		counts[L[i]]++
	}
	chars := []byte{}
	for c := range counts {
		chars = append(chars, c)
	}
	sort.Slice(chars, func(i, j int) bool { return chars[i] < chars[j] })
	C := map[byte]int{}
	run := 0
	for _, c := range chars {
		C[c] = run
		run += counts[c]
	}
	occ := map[byte][]int{}
	for _, c := range chars {
		occ[c] = make([]int, n+1)
	}
	for i := 0; i < n; i++ {
		for _, c := range chars {
			occ[c][i+1] = occ[c][i]
		}
		occ[L[i]][i+1]++
	}
	return &FM{L, C, occ, n}
}

func (f *FM) longestSuffix(P string) (int, int) {
	sp, ep := 0, f.n
	matched := 0
	for k := len(P) - 1; k >= 0; k-- {
		c := P[k]
		col, ok := f.occ[c]
		if !ok {
			break
		}
		nsp := f.C[c] + col[sp]
		nep := f.C[c] + col[ep]
		if nsp >= nep {
			break
		}
		sp, ep = nsp, nep
		matched++
	}
	return matched, ep - sp
}

func main() {
	r := bufio.NewReader(os.Stdin)
	var s string
	fmt.Fscan(r, &s)
	fm := buildFM(s)
	var q int
	fmt.Fscan(r, &q)
	for ; q > 0; q-- {
		var p string
		fmt.Fscan(r, &p)
		l, c := fm.longestSuffix(p)
		fmt.Println(l, c)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task18 {
    static String s;
    static int n;
    static String L;
    static int[] C = new int[256];
    static int[][] occ; // [256][n+1]

    static void build(String raw) {
        s = raw + "$";
        n = s.length();
        Integer[] sa = new Integer[n];
        for (int i = 0; i < n; i++) sa[i] = i;
        Arrays.sort(sa, (a, b) -> s.substring(a).compareTo(s.substring(b)));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(s.charAt((sa[i] - 1 + n) % n));
        L = sb.toString();
        int[] counts = new int[256];
        for (int i = 0; i < n; i++) counts[L.charAt(i)]++;
        int run = 0;
        for (int c = 0; c < 256; c++) { C[c] = run; run += counts[c]; }
        occ = new int[256][n + 1];
        for (int i = 0; i < n; i++) {
            for (int c = 0; c < 256; c++) occ[c][i + 1] = occ[c][i];
            occ[L.charAt(i)][i + 1]++;
        }
    }

    static int[] longestSuffix(String P) {
        int sp = 0, ep = n, matched = 0;
        for (int k = P.length() - 1; k >= 0; k--) {
            int c = P.charAt(k);
            int nsp = C[c] + occ[c][sp];
            int nep = C[c] + occ[c][ep];
            if (nsp >= nep) break;
            sp = nsp; ep = nep; matched++;
        }
        return new int[]{matched, ep - sp};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        build(sc.next());
        int q = sc.nextInt();
        StringBuilder out = new StringBuilder();
        while (q-- > 0) {
            int[] res = longestSuffix(sc.next());
            out.append(res[0]).append(' ').append(res[1]).append('\n');
        }
        System.out.print(out);
    }
}
```

**Starter — Python.**
```python
import sys


def build_fm(raw):
    s = raw + "$"
    n = len(s)
    sa = sorted(range(n), key=lambda i: s[i:])
    L = "".join(s[(sa[i] - 1) % n] for i in range(n))
    counts = {}
    for c in L:
        counts[c] = counts.get(c, 0) + 1
    C, run = {}, 0
    for c in sorted(counts):
        C[c] = run
        run += counts[c]
    occ = {c: [0] * (n + 1) for c in counts}
    for i in range(n):
        for c in counts:
            occ[c][i + 1] = occ[c][i]
        occ[L[i]][i + 1] += 1
    return n, C, occ


def longest_suffix(fm, P):
    n, C, occ = fm
    sp, ep, matched = 0, n, 0
    for c in reversed(P):
        if c not in occ:
            break
        nsp = C[c] + occ[c][sp]
        nep = C[c] + occ[c][ep]
        if nsp >= nep:
            break
        sp, ep, matched = nsp, nep, matched + 1
    return matched, ep - sp


def main():
    data = sys.stdin.read().split()
    fm = build_fm(data[0])
    q = int(data[1])
    out = []
    for i in range(q):
        m, c = longest_suffix(fm, data[2 + i])
        out.append(f"{m} {c}")
    print("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- For a `P` fully present in `s`, reports `len(P)` and the exact overlapping occurrence count.
- For a `P` whose longest matching suffix is shorter, reports that suffix length and its count, verified against a brute-force suffix scan.
- Per-query cost is `O(|P|)` with the full `Occ` table; note how it would degrade with sampled checkpoints.

---

## Benchmark Task

### Task B — Naive rotation BWT vs suffix-array BWT crossover

**Problem.** Empirically compare two forward-BWT methods on random strings:

- **(a) Rotation method:** build and sort all rotations — `O(n² log n)` time, `O(n²)` space.
- **(b) Suffix-array method:** build `SA`, then `BWT[i] = s[SA[i]-1]` — `O(n²log n)` with a naive SA, `O(n)` with SA-IS.

Measure wall-clock time for `n ∈ {100, 500, 1000, 2000, 5000}` and report where (b) overtakes (a), and how memory diverges.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_string(n: int, seed: int, alphabet: str = "acgt") -> str:
    r = random.Random(seed)
    return "".join(r.choice(alphabet) for _ in range(n))


def bwt_rotations(s: str) -> str:
    # TODO: O(n^2) memory rotation method
    return ""


def suffix_array(s: str) -> List[int]:
    # TODO: naive O(n^2 log n) or plug in SA-IS
    return sorted(range(len(s)), key=lambda i: s[i:])


def bwt_from_sa(s: str) -> str:
    # TODO: BWT[i] = (s+'$')[(SA[i]-1) % n]
    return ""


def bench(fn, s) -> float:
    start = time.perf_counter()
    fn(s)
    return time.perf_counter() - start


def main() -> None:
    print("n        rotations_ms     sa_method_ms")
    for n in [100, 500, 1000, 2000, 5000]:
        s = gen_string(n, 42)
        ra = [bench(bwt_rotations, s) for _ in range(3)] if n <= 2000 else None
        rb = [bench(bwt_from_sa, s) for _ in range(3)]
        a_ms = "(skipped)" if ra is None else f"{sum(ra)/len(ra)*1000:.2f}"
        print(f"{n:<8d} {a_ms:<16} {sum(rb)/len(rb)*1000:.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string across Go, Java, and Python.
- The SA method (b) scales far better in memory; the rotation method (a) becomes infeasible by `n = 5000`.
- Report the mean across at least 3 runs and exclude string generation from timing.
- Writeup: note that with a true linear-time SA (SA-IS) the SA method is `O(n)`, while the rotation method is fundamentally `O(n²)`.

---

## General Guidance for All Tasks

- **Always round-trip-test first.** `inverse_bwt(bwt(s)) == s` is the single most valuable check; it catches almost every off-by-one in `C`, `Occ`, or `LF`.
- **Validate counts against a brute-force overlapping substring scan** on small inputs before trusting backward search on large ones.
- **Pin the sentinel.** Use a `$` that is unique and strictly smaller than every input character; validate the input does not already contain it.
- **`C[c]` is strictly-smaller; `Occ(c, i)` is the prefix before `i`.** These two off-by-ones are the dominant bug class.
- **Build from the suffix array, not rotations,** for anything beyond toy sizes.
- **Use a real rank structure** (checkpoints or wavelet tree) once `n` or `σ` grows; the `O(n·σ)` table is for learning.
- **Exploit runs (RLBWT) only when `r ≪ n`;** measure `r/n` before choosing the r-index.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
