# Lyndon Words & Duval's Algorithm — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Duval / Lyndon logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs before trusting the linear result** (e.g. `is_lyndon` by comparing all rotations, or least-rotation by enumerating all `n` rotations).

---

## Beginner Tasks (5)

### Task 1 — Is this a Lyndon word?

**Problem.** Implement `is_lyndon(w)` that returns `true` iff `w` is a Lyndon word — strictly smaller than all of its proper rotations. The empty string is not a Lyndon word.

**Input / Output spec.**
- Read one string `w`.
- Print `true` or `false`.

**Constraints.**
- `0 ≤ |w| ≤ 2000` (brute force `O(n²)` is acceptable here).
- Compare by character / byte order.

**Hint.** `w` is Lyndon iff `w < w[i:] + w[:i]` for every `1 ≤ i < |w|`. A single character is Lyndon; `aa` and `abab` are not (they are periodic).

**Starter — Go.**
```go
package main

import "fmt"

func isLyndon(w string) bool {
	// TODO: w is Lyndon iff strictly smaller than every proper rotation
	return false
}

func main() {
	var w string
	fmt.Scan(&w)
	fmt.Println(isLyndon(w))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static boolean isLyndon(String w) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String w = sc.next();
        System.out.println(isLyndon(w));
    }
}
```

**Starter — Python.**
```python
import sys


def is_lyndon(w: str) -> bool:
    # TODO: strictly smaller than all proper rotations
    return False


def main():
    w = sys.stdin.readline().strip()
    print(str(is_lyndon(w)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `is_lyndon("a") == True`, `is_lyndon("aab") == True`, `is_lyndon("ab") == True`.
- `is_lyndon("aa") == False`, `is_lyndon("aba") == False`, `is_lyndon("abab") == False`, `is_lyndon("") == False`.
- Uses strict `<` (equality disqualifies).

---

### Task 2 — Duval factorization

**Problem.** Given a string `s`, output its Chen-Fox-Lyndon factorization (the non-increasing list of Lyndon words). Use Duval's algorithm.

**Input / Output spec.**
- Read `s`.
- Print the factors separated by single spaces, in order.

**Constraints.** `1 ≤ |s| ≤ 10⁶`. Must be `O(n)` time, `O(1)` extra space.

**Hint.** Inner loop guard is `s[k] <= s[j]`; reset `k = i` only on strict `s[k] < s[j]`, advance `k` on equality. Emit factors of length `j - k` while `i <= k`.

**Reference oracle (Python) — use this to validate.**
```python
def is_lyndon(w):
    return len(w) > 0 and all(w < w[i:] + w[:i] for i in range(1, len(w)))

def verify_factorization(s, factors):
    assert "".join(factors) == s
    assert all(is_lyndon(f) for f in factors)
    assert all(factors[i] >= factors[i + 1] for i in range(len(factors) - 1))
    return True
```

**Evaluation criteria.**
- `"banana" -> b an an a`; `"aaa" -> a a a`; `"abcabc" -> abcabc` (already Lyndon? check: abcabc = (abc)², so `-> abc abc`).
- Factors are non-increasing and each is Lyndon (validate with the oracle).
- `O(n)` time.

---

### Task 3 — Smallest cyclic rotation

**Problem.** Given a string `s`, output its lexicographically smallest cyclic rotation. Use Duval on `s + s`.

**Input / Output spec.**
- Read `s`.
- Print the smallest rotation string.

**Constraints.** `1 ≤ |s| ≤ 10⁶`.

**Hint.** Run Duval on `t = s + s`; the answer index is the last factor start `< n`. Build the rotation as `s[idx:] + s[:idx]`. The index is always in `[0, n)`.

**Reference oracle (Python).**
```python
def brute_least_rotation(s):
    n = len(s)
    return min(s[i:] + s[:i] for i in range(n))
```

**Worked check.** `"dcab"` has rotations `dcab, cabd, abdc, bdca`; the smallest is `abdc`. For `"aaaa"` every rotation is `aaaa`.

**Evaluation criteria.**
- Matches `brute_least_rotation` for random small strings.
- Returns an index in `[0, n)` internally.
- `O(n)` (no pairwise rotation comparison).

---

### Task 4 — Largest cyclic rotation

**Problem.** Given a string `s`, output its lexicographically **largest** cyclic rotation.

**Input / Output spec.**
- Read `s`. Print the largest rotation.

**Constraints.** `1 ≤ |s| ≤ 10⁶`.

**Hint.** Invert the alphabet (`c → 0xFF - c` on bytes, or `255 - ord(c)`), run the smallest-rotation routine, and slice the *original* string at the returned index. Reuse one routine; do not hand-flip comparisons.

**Reference oracle (Python).**
```python
def brute_greatest_rotation(s):
    n = len(s)
    return max(s[i:] + s[:i] for i in range(n))
```

**Evaluation criteria.**
- Matches `brute_greatest_rotation` for random small strings.
- Reuses the least-rotation routine via alphabet inversion.
- `O(n)`.

---

### Task 5 — Count Lyndon factors

**Problem.** Given `s`, output how many Lyndon factors its Chen-Fox-Lyndon factorization has (the value `m`), without storing the factor strings.

**Input / Output spec.**
- Read `s`. Print the integer count `m`.

**Constraints.** `1 ≤ |s| ≤ 10⁷`. Use `O(1)` extra space beyond the input.

**Hint.** Stream Duval: increment a counter each time you emit a factor (each `i += j - k` step). Do not build a list.

**Worked check.** `"banana"` has factorization `b an an a`, so `m = 4`. `"aaaa"` has `m = 4` (each `a`).

**Evaluation criteria.**
- Matches the length of the factor list from Task 2 for small inputs.
- Uses only `O(1)` extra space (a counter and pointers).
- `O(n)` time.

---

## Intermediate Tasks (5)

### Task 6 — Canonical form & rotation-equivalence

**Problem.** Implement `same_necklace(a, b)` that returns `true` iff strings `a` and `b` are rotations of each other. Use the smallest-rotation canonical form (do not enumerate all rotations).

**Constraints.** `1 ≤ |a|, |b| ≤ 10⁶`.

**Hint.** They are rotations of each other iff `|a| == |b|` and `canonical(a) == canonical(b)`, where `canonical` is the smallest rotation via Duval on `s + s`. (A quick alternative: `b` is a rotation of `a` iff `b` is a substring of `a + a` and `|a| == |b|` — useful as a cross-check.)

**Reference oracle (Python).**
```python
def brute_same_necklace(a, b):
    return len(a) == len(b) and b in (a + a)
```

**Evaluation criteria.**
- `same_necklace("abcde", "cdeab") == True`; `same_necklace("abc", "acb") == False`.
- Matches the `b in a+a` oracle.
- `O(n)` via canonical forms.

---

### Task 7 — Generate all Lyndon words ≤ length n

**Problem.** Given alphabet size `σ` and maximum length `n`, output all Lyndon words of length `≤ n` over `{0,…,σ-1}` in lexicographic order. Use the FKM / Duval generation algorithm.

**Constraints.** `1 ≤ σ ≤ 10`, `1 ≤ n ≤ 20` (keep total output bounded).

**Hint.** Start with `w = [0]`. Each round: output `w`; repeat `w` to length `n`; strip trailing `σ-1` letters; increment the last remaining letter. Stop when `w` becomes empty.

**Reference oracle (Python).**
```python
from itertools import product

def brute_lyndon(sigma, n):
    def is_lyndon(w):
        return all(w < w[i:] + w[:i] for i in range(1, len(w)))
    res = []
    for L in range(1, n + 1):
        for tup in product(range(sigma), repeat=L):
            w = "".join(map(str, tup))
            if is_lyndon(w):
                res.append(w)
    return sorted(res)
```

**Evaluation criteria.**
- For `σ=2, n=3`: `0, 001, 01, 011, 1`.
- Matches the brute-force enumeration (as a set, then sorted).
- Amortized `O(1)` per emitted word.

---

### Task 8 — de Bruijn sequence

**Problem.** Given `σ` and `k`, output a de Bruijn sequence `B(σ, k)` of length `σᵏ` in which every length-`k` word appears exactly once cyclically. Use the FKM construction (concatenate Lyndon words whose length divides `k`).

**Constraints.** `1 ≤ σ ≤ 6`, `1 ≤ k ≤ 8` (so `σᵏ` stays manageable).

**Hint.** Generate Lyndon words up to length `k`; concatenate those with `len(word)` dividing `k`, in lexicographic order. The result has length exactly `σᵏ`.

**Reference oracle (Python).**
```python
def verify_de_bruijn(seq, sigma, k):
    n = len(seq)
    if n != sigma ** k:
        return False
    seen = set()
    for i in range(n):
        window = tuple(seq[(i + j) % n] for j in range(k))  # cyclic window
        if window in seen:
            return False
        seen.add(window)
    return len(seen) == sigma ** k
```

**Evaluation criteria.**
- `de_bruijn(2, 3)` has length 8 and passes `verify_de_bruijn`.
- Every length-`k` cyclic window is distinct.
- Only Lyndon words with `len | k` are concatenated.

---

### Task 9 — Lyndon array (longest Lyndon word at each position)

**Problem.** Given `s`, compute the Lyndon array `λ`, where `λ[i]` is the length of the longest Lyndon word starting at position `i`. Output `λ` as a space-separated list.

**Constraints.** `1 ≤ |s| ≤ 10⁵`.

**Hint.** A correct (if not the fastest) method: `λ[i]` equals `nss[i] - i`, where `nss[i]` is the start of the next suffix to the right that is lexicographically smaller than `s[i:]` (or `n` if none). A simpler `O(n²)`-ish brute force is acceptable here for validation; the linear method uses a right-to-left stack.

**Reference oracle (Python).**
```python
def brute_lyndon_array(s):
    n = len(s)
    def is_lyndon(w):
        return all(w < w[i:] + w[:i] for i in range(1, len(w)))
    lam = [1] * n
    for i in range(n):
        best = 1
        for ell in range(1, n - i + 1):
            if is_lyndon(s[i:i + ell]):
                best = ell
        lam[i] = best
    return lam
```

**Evaluation criteria.**
- Matches `brute_lyndon_array` for random small strings.
- `λ[i] ≥ 1` for all `i` (every single character is Lyndon).
- Documents the `nss` relationship in a comment.

---

### Task 10 — Minimal rotation without building s+s

**Problem.** Re-implement the smallest-rotation finder using **modular indexing** (`s[idx % n]`) instead of materializing `s + s`. Output the smallest rotation. The goal is `O(n)` time and `O(n)` total memory (no doubled buffer).

**Constraints.** `1 ≤ |s| ≤ 10⁷`.

**Hint.** Replace every `t[idx]` with `s[idx % n]` in the Duval scan; the look-ahead `j` ranges up to `2n` but never indexes out of `s`. Stop once `i ≥ n`.

**Evaluation criteria.**
- Produces the same result as Task 3 on all inputs.
- Allocates no `s + s` copy (verify memory usage on a large input).
- `O(n)` time, `O(1)` extra space beyond the input string.

---

## Advanced Tasks (5)

### Task 11 — Streaming Duval over chunked input

**Problem.** Factor a large input that arrives in fixed-size chunks (you cannot hold it all in memory at once). Emit each Lyndon factor as `(start_offset, length)` against the global stream position. Handle factors that straddle a chunk boundary correctly.

**Constraints.** Total length up to `10⁹`; chunk size `≤ 10⁶`.

**Hint.** Duval's look-ahead can read ahead by up to the current candidate length. Buffer trailing context at least as long as the current candidate; do not factor each chunk independently or you will produce wrong factors at the seams. A correct design carries the unfinished candidate (its start and the pointers) across chunk loads.

**Evaluation criteria.**
- Output matches a single-pass Duval over the concatenated input for several chunk sizes.
- No factor is split or duplicated at a chunk boundary.
- Working memory is `O(chunk size + max candidate length)`, not `O(total length)`.

---

### Task 12 — Count distinct necklaces in a list

**Problem.** Given `m` strings of possibly different lengths, count how many *distinct necklaces* they represent (group rotation-equivalent strings of the same length). Use canonical forms.

**Constraints.** `1 ≤ m ≤ 10⁵`; total input length `≤ 10⁷`.

**Hint.** Map each string to `(len, canonical(s))` and count distinct keys with a hash set. Strings of different lengths are never the same necklace. Hash the canonical *string*, not the raw input.

**Reference oracle (Python).**
```python
def brute_distinct_necklaces(strings):
    seen = set()
    for s in strings:
        canon = min(s[i:] + s[:i] for i in range(len(s)))
        seen.add((len(s), canon))
    return len(seen)
```

**Evaluation criteria.**
- Rotations of one string count once: `["abc","bca","cab"]` → `1`.
- Different lengths never merge: `["ab","aba"]` → `2`.
- Matches the oracle; canonicalize before hashing.

---

### Task 13 — Largest rotation via co-Lyndon factorization

**Problem.** Implement the largest cyclic rotation **two ways** — (a) alphabet inversion + smallest-rotation, and (b) a directly flipped Duval (the "co-Lyndon" / maximal factorization where the inner guard becomes `s[k] >= s[j]`). Assert both agree on random inputs.

**Constraints.** `1 ≤ |s| ≤ 10⁶`.

**Hint.** For (b), flip the inner comparison: the loop continues while `s[k] >= s[j]`; reset `k = i` on strict `s[k] > s[j]`, advance `k` on equality. Track the last factor start `< n`. Compare against (a) for a few hundred random strings.

**Evaluation criteria.**
- (a) and (b) produce identical largest rotations on all test strings.
- Both are `O(n)`.
- A comment explains why inverting the alphabet is the lower-risk production choice.

---

### Task 14 — Witt's formula: count Lyndon words

**Problem.** Given `σ` and `n`, compute the number of Lyndon words of length exactly `n` over a `σ`-letter alphabet, using Witt's formula `L(σ,n) = (1/n) Σ_{d|n} μ(d) σ^{n/d}`. Verify against brute-force enumeration for small `n`.

**Constraints.** `1 ≤ σ ≤ 26`, `1 ≤ n ≤ 60` (use 64-bit or big integers as needed).

**Hint.** Implement the Möbius function `μ(d)` (square-free check + parity of prime factors). Sum over divisors of `n`. The division by `n` is exact (the sum is always divisible by `n`).

**Reference oracle (Python).**
```python
def brute_count_lyndon(sigma, n):
    from itertools import product
    def is_lyndon(w):
        return all(w < w[i:] + w[:i] for i in range(1, len(w)))
    cnt = 0
    for tup in product(range(sigma), repeat=n):
        if is_lyndon("".join(map(str, tup))):
            cnt += 1
    return cnt
```

**Evaluation criteria.**
- `L(2,1)=2`, `L(2,2)=1`, `L(2,3)=2`, `L(2,4)=3`, `L(2,6)=9`.
- Matches `brute_count_lyndon` for `n ≤ 8`, small `σ`.
- The `Σ ... / n` is computed as an exact integer.

---

### Task 15 — Decide the right tool for a cyclic-string problem

**Problem.** You are given a problem statement and must decide which technique applies. Implement `classify(problem)` (or write a short analysis) returning one of: `DUVAL_FACTORIZE`, `SMALLEST_ROTATION`, `SUFFIX_ARRAY`, `KMP_SEARCH`, or `FKM_DE_BRUIJN`. Justify each decision.

**Constraints / cases to handle.**
- "Split a string into non-increasing Lyndon words" → `DUVAL_FACTORIZE`.
- "Find the canonical form of a circular sequence / least rotation" → `SMALLEST_ROTATION`.
- "Many substring/rotation queries on one fixed string" → `SUFFIX_ARRAY`.
- "Find occurrences of a pattern in a text" → `KMP_SEARCH` (sibling `01-kmp`).
- "Produce a sequence containing every length-`k` word once" → `FKM_DE_BRUIJN`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is reaching for Lyndon machinery on a plain substring-search problem, where KMP/Z-function is the right tool.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `KMP_SEARCH` branch explicitly notes Lyndon tools are the wrong fit for plain search.
- Justification cites the right complexity (`O(n)` Duval, `O(n)` least rotation, `O(σᵏ)` de Bruijn, etc.).

---

### Task 16 — Bijective BWT via Lyndon factorization (stretch)

**Problem.** Implement the bijective Burrows-Wheeler transform (BWTS): factor `s` into Lyndon words with Duval, form the cyclic rotations of each factor, sort all rotations under infinite (`ω`) comparison, and read the last character of each. No sentinel `$`. Output the transformed string.

**Constraints.** `1 ≤ |s| ≤ 10⁴` (the naive sort is acceptable at this size).

**Hint.** Each Lyndon factor `w` contributes `|w|` distinct rotations (it is primitive). For the `ω`-comparison of two rotations `r1, r2`, compare `r1` repeated and `r2` repeated up to `lcm` or until they differ (a few periods suffice because the underlying factors are aperiodic). Read the last character of each sorted rotation in order.

**Reference oracle (Python) — classical-vs-bijective length check.**
```python
def duval(s):
    n, i, out = len(s), 0, []
    while i < n:
        j, k = i + 1, i
        while j < n and s[k] <= s[j]:
            k = i if s[k] < s[j] else k + 1
            j += 1
        while i <= k:
            out.append(s[i:i + j - k]); i += j - k
    return out

# The output length of BWTS equals len(s) (a permutation of its characters).
```

**Evaluation criteria.**
- Output is a permutation of `s` (same multiset of characters), length `|s|`, no sentinel added.
- The transform is invertible (implement or describe the inverse for credit).
- Uses the Duval factorization as the first step; documents why aperiodicity makes `ω`-comparison well-defined.

---

## Benchmark Task

### Task B — Brute-force vs Duval smallest-rotation crossover

**Problem.** Empirically find the input length `n` at which Duval-on-`s+s` overtakes brute-force least rotation. Implement two workloads on a fixed-seed random string:

- **(a) Brute force:** compute `min(s[i:] + s[:i] for i in range(n))` — `O(n²)` in the worst case.
- **(b) Duval on `s + s`:** the linear least-rotation routine — `O(n)`.

Measure wall-clock time for `n ∈ {10, 100, 1000, 10⁴, 10⁵, 10⁶}` (use the large `n` only for the Duval method). Report a table and identify the crossover `n`.

**Starter — Python.**
```python
import random
import time
from typing import List


def gen_string(n: int, seed: int, alphabet: str = "ab") -> str:
    r = random.Random(seed)
    return "".join(r.choice(alphabet) for _ in range(n))


def brute_least_rotation(s: str) -> str:
    n = len(s)
    return min(s[i:] + s[:i] for i in range(n))


def duval_least_rotation(s: str) -> str:
    # TODO: Duval on s + s; return the smallest rotation string. O(n).
    return s


def bench(fn, s) -> float:
    start = time.perf_counter()
    fn(s)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n            brute_ms          duval_ms")
    for n in [10, 100, 1000, 10_000, 100_000, 1_000_000]:
        s = gen_string(n, 42)
        rb = [bench(duval_least_rotation, s) for _ in range(3)]
        if n <= 100_000:  # brute force only where it finishes quickly
            ra = [bench(brute_least_rotation, s) for _ in range(3)]
            print(f"{n:<12d} {mean_ms(ra):<17.3f} {mean_ms(rb):<14.3f}")
        else:
            print(f"{n:<12d} {'(skipped)':<17} {mean_ms(rb):<14.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same string across Go, Java, and Python.
- Brute force (a) wins or ties for tiny `n`; Duval (b) wins decisively for large `n`. Report the crossover.
- Duval completes `n = 10⁶` in well under a second; brute force is infeasible there (especially on adversarial inputs like `"a"*n`).
- Report the mean across at least 3 runs and does not time string generation.
- Writeup: a short note on the measured crossover and the worst-case input (`"a"*(n-1) + "b"`) that makes brute force quadratic.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every task above ships with (or references) a slow oracle. Run it on small inputs, diff, and only then trust the linear version on large inputs.
- **Use strict `<` for the Lyndon test.** A Lyndon word is *strictly* smaller than all its rotations; `aa` and `abab` are not Lyndon.
- **Factors come out non-increasing.** `w₁ ≥ w₂ ≥ … ≥ w_m`; assert this in tests.
- **Inner loop discipline.** Guard `j < n` (or `j < 2n`); reset `k = i` only on strict `s[k] < s[j]`; advance `k` on equality.
- **Never build substrings in the inner loop.** Compare single characters/bytes; substring construction turns `O(n)` into `O(n²)`.
- **Smallest rotation index is always `< n`.** Use modular indexing to avoid the `s + s` copy when memory matters.
- **Pin the alphabet order** as a named convention; the canonical form and the entire factorization depend on it.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
