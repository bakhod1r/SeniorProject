# Rabin-Karp (Rolling-Hash String Matching) — Interview Preparation

Rabin-Karp is a favourite interview topic because it rewards a single crisp insight — *"hash each window and compare integers, rolling the hash in `O(1)`"* — and then tests whether you can (a) keep it fast with the `O(1)` roll and a precomputed power, (b) keep it correct with verification on hash hits, (c) generalize the rolling hash to count distinct substrings, find the longest duplicate substring, and search 2D grids, and (d) reason about collisions, base/modulus choice, and the `O(n·m)` adversarial worst case. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Find all occurrences of `P` in `T` | rolling hash + verify | expected `O(n + m)` |
| Compare any two substrings for equality | prefix hashes | `O(1)` after `O(n)` prep |
| Count distinct substrings of length `L` | hash all windows into a set | `O(n)` expected per `L` |
| Count all distinct substrings | prefix hashes + set per length | `O(n² )` expected (or suffix automaton for `O(n)`) |
| Longest duplicate substring | binary search length + hashing | `O(n log n)` expected |
| Search `r×c` pattern in `R×C` grid | 2D rolling hash (roll twice) | expected `O(R·C + r·c)` |
| Many equal-length patterns | hash set of patterns, one scan | expected `O(n + k·m)` |
| Defend against worst case | random private base + verify | restores expected `O(n+m)` |

Core algorithm:

```text
rabinKarp(T, P):
    highPow = base^(m-1) mod p          # precompute once
    patHash = hornerHash(P)
    winHash = hornerHash(T[0..m-1])
    for i in 0 .. n-m:
        if winHash == patHash and T[i..i+m-1] == P:   # verify!
            report i
        if i+m < n:
            winHash = ((winHash - T[i]*highPow) * base + T[i+m]) mod p
# expected O(n + m); verification keeps it correct despite collisions
```

---

## Conceptual Questions by Seniority

### Junior

**Q1. What does Rabin-Karp compute and what is its key idea?**
It finds all occurrences of a pattern in a text by hashing each length-`m` window and comparing to the pattern hash. The key idea is the rolling hash: the window hash updates in `O(1)` when sliding by one position, so the whole scan is `O(n)` instead of `O(n·m)`.

**Q2. Why must you verify after a hash match?**
Because hashing is lossy: two different strings can share a hash (a collision). A hash match is only a *candidate*; comparing characters confirms it is real. Without verification the algorithm reports wrong matches.

**Q3. What is the rolling-update formula?**
`H_{i+1} = ((H_i − c(T[i])·b^{m−1})·b + c(T[i+m])) mod p`. Remove the leading char's contribution, shift by multiplying by the base, add the trailing char, reduce.

**Q4. Why take everything modulo a prime?**
To keep the hash inside a machine word (preventing overflow) and to spread values evenly so collisions stay near `1/p`. A prime modulus makes the hash a polynomial over a field, which bounds collisions.

### Middle

**Q5. What is the time complexity, expected and worst case?**
Expected `O(n + m)` with a good base/modulus, because spurious hits are rare (`~(n−m)(m−1)/p`). Worst case `O(n·m)` when verification fires at every window — possible against a fixed, public hash with adversarial input.

**Q6. How do you choose the base and modulus?**
Base larger than the alphabet (256/257 for bytes, 31/131 for letters), ideally random for adversarial safety. Modulus a large prime near `10^9` (overflow-safe in 64 bits) or `2^61−1` for a far lower collision rate. Offset character codes by 1.

**Q7. What is double hashing and why use it?**
Compute two independent hashes (different base+modulus) and require both to match. Joint collision probability drops to `~p^{-2}`, taming the birthday effect when many strings are compared. Often used in place of verification in contest code.

**Q8. How do you search for many equal-length patterns at once?**
Hash all patterns into a set, then roll one window across the text and look up each window hash in `O(1)`; verify candidates. Expected `O(n + k·m)` — a single scan regardless of pattern count.

### Senior

**Q9. What is hash flooding and how do you defend against it?**
An attacker crafts input that forces collisions at every window against a fixed public hash, triggering the `O(n·m)` worst case as a denial-of-service. Defense: pick the base uniformly at random and keep it private, plus always verify (caps damage) and optionally fall back to KMP if spurious hits spike.

**Q10. How does the rolling hash power content-defined chunking?**
Slide a small window over a byte stream maintaining a rolling hash; cut a chunk boundary wherever the hash's low bits hit a fixed value. Boundaries depend only on local content, so an insertion changes only one chunk — enabling `rsync` and dedup backup systems to transfer/store only the changed parts.

**Q11. When would you NOT use Rabin-Karp?**
When you need a guaranteed worst-case linear bound on adversarial single-pattern input — use KMP or Z, which are exact and worst-case `O(n+m)` with no verification. Rabin-Karp wins for multi-pattern equal-length, 2D, and `O(1)` substring comparison, where its flexibility is unmatched.

**Q12. How do prefix hashes give `O(1)` substring comparison?**
Precompute `pre[k] = hash(T[0..k-1])`. Then `hash(T[l..r]) = (pre[r+1] − pre[l]·b^{r-l+1}) mod p`. Any substring's hash is then `O(1)`, so two equal-length substrings compare in `O(1)` — the engine behind distinct-substring counting and longest-duplicate-substring.

---

## Behavioral Prompts

- **"Tell me about a time you chose a probabilistic algorithm over a deterministic one."** Frame the expected-vs-worst-case trade: Rabin-Karp's simplicity and flexibility (multi-pattern, 2D) against KMP's hard guarantee, and how you mitigated the worst case with a randomized base and verification.
- **"Describe debugging a subtle correctness bug."** A great answer: a rolling hash that occasionally reported phantom matches because verification was dropped "for speed"; you restored it and added a differential test against naive search.
- **"How do you decide when an approximate answer is acceptable?"** Discuss similarity/dedup contexts where collisions are tolerable versus exact search where verification is mandatory — matching verification strength to the cost of being wrong.
- **"How would you make this safe in a public-facing service?"** Randomized private base, double hashing or 61-bit modulus, verification, and a spurious-hit metric that alarms on flooding.

---

## Coding Challenge 1 — Substring Search (all occurrences)

**Problem.** Return every start index where `P` occurs in `T`. Expected `O(n+m)`.

### Go

```go
package main

import "fmt"

const base, mod = 256, 1_000_000_007

func search(t, p string) []int {
	n, m := len(t), len(p)
	var res []int
	if m == 0 || m > n {
		return res
	}
	var high int64 = 1
	for i := 0; i < m-1; i++ {
		high = high * base % mod
	}
	var ph, wh int64
	for i := 0; i < m; i++ {
		ph = (ph*base + int64(p[i])) % mod
		wh = (wh*base + int64(t[i])) % mod
	}
	for i := 0; i+m <= n; i++ {
		if wh == ph && t[i:i+m] == p {
			res = append(res, i)
		}
		if i+m < n {
			wh = (wh - int64(t[i])*high%mod + mod) % mod
			wh = (wh*base + int64(t[i+m])) % mod
		}
	}
	return res
}

func main() { fmt.Println(search("abxabcabcaby", "abcaby")) } // [6]
```

### Java

```java
import java.util.*;

public class Search {
    static final long BASE = 256, MOD = 1_000_000_007L;
    static List<Integer> search(String t, String p) {
        int n = t.length(), m = p.length();
        List<Integer> res = new ArrayList<>();
        if (m == 0 || m > n) return res;
        long high = 1;
        for (int i = 0; i < m - 1; i++) high = high * BASE % MOD;
        long ph = 0, wh = 0;
        for (int i = 0; i < m; i++) {
            ph = (ph * BASE + p.charAt(i)) % MOD;
            wh = (wh * BASE + t.charAt(i)) % MOD;
        }
        for (int i = 0; i + m <= n; i++) {
            if (wh == ph && t.regionMatches(i, p, 0, m)) res.add(i);
            if (i + m < n) {
                wh = (wh - t.charAt(i) * high % MOD + MOD) % MOD;
                wh = (wh * BASE + t.charAt(i + m)) % MOD;
            }
        }
        return res;
    }
    public static void main(String[] a) { System.out.println(search("abxabcabcaby", "abcaby")); }
}
```

### Python

```python
BASE, MOD = 256, 1_000_000_007

def search(t, p):
    n, m = len(t), len(p)
    if m == 0 or m > n:
        return []
    high = pow(BASE, m - 1, MOD)
    ph = wh = 0
    for i in range(m):
        ph = (ph * BASE + ord(p[i])) % MOD
        wh = (wh * BASE + ord(t[i])) % MOD
    res = []
    for i in range(n - m + 1):
        if wh == ph and t[i:i + m] == p:
            res.append(i)
        if i + m < n:
            wh = (wh - ord(t[i]) * high) % MOD
            wh = (wh * BASE + ord(t[i + m])) % MOD
    return res

print(search("abxabcabcaby", "abcaby"))  # [6]
```

---

## Coding Challenge 2 — Count Distinct Substrings of Length L

**Problem.** Given `s` and a length `L`, count how many *distinct* substrings of length `L` occur in `s`. Use a rolling hash and a set of hashes (verify-free is acceptable with double hashing; here we use a 61-bit modulus for a tiny collision rate).

### Go

```go
package main

import "fmt"

const B, M = 131, (1 << 61) - 1

func mulmod(a, b uint64) uint64 {
	// safe for our sizes via big split; for brevity use 128-bit emulation
	const lo32 = (1 << 32) - 1
	aL, aH := a&lo32, a>>32
	res := (aH*b)%M*( (1<<32)%M )%M + aL*b%M
	return res % M
}

func countDistinct(s string, L int) int {
	n := len(s)
	if L <= 0 || L > n {
		return 0
	}
	var high uint64 = 1
	for i := 0; i < L-1; i++ {
		high = mulmod(high, B)
	}
	var h uint64
	for i := 0; i < L; i++ {
		h = (mulmod(h, B) + uint64(s[i]) + 1) % M
	}
	set := map[uint64]struct{}{h: {}}
	for i := 0; i+L < n; i++ {
		h = (h + M - mulmod(uint64(s[i])+1, high)) % M
		h = (mulmod(h, B) + uint64(s[i+L]) + 1) % M
		set[h] = struct{}{}
	}
	return len(set)
}

func main() { fmt.Println(countDistinct("ababa", 2)) } // 2: "ab","ba"
```

### Java

```java
import java.util.*;

public class DistinctSub {
    static final long B = 131, M = (1L << 61) - 1;
    static long mul(long a, long b) {
        long hi = Math.multiplyHigh(a, b), lo = a * b;
        long r = (lo & M) + ((lo >>> 61) | (hi << 3));
        r = (r & M) + (r >>> 61);
        return r >= M ? r - M : r;
    }
    static int countDistinct(String s, int L) {
        int n = s.length();
        if (L <= 0 || L > n) return 0;
        long high = 1;
        for (int i = 0; i < L - 1; i++) high = mul(high, B);
        long h = 0;
        for (int i = 0; i < L; i++) h = (mul(h, B) + s.charAt(i) + 1) % M;
        Set<Long> set = new HashSet<>();
        set.add(h);
        for (int i = 0; i + L < n; i++) {
            h = (h + M - mul(s.charAt(i) + 1, high)) % M;
            h = (mul(h, B) + s.charAt(i + L) + 1) % M;
            set.add(h);
        }
        return set.size();
    }
    public static void main(String[] a) { System.out.println(countDistinct("ababa", 2)); } // 2
}
```

### Python

```python
B, M = 131, (1 << 61) - 1

def count_distinct(s, L):
    n = len(s)
    if L <= 0 or L > n:
        return 0
    high = pow(B, L - 1, M)
    h = 0
    for i in range(L):
        h = (h * B + ord(s[i]) + 1) % M
    seen = {h}
    for i in range(n - L):
        h = (h - (ord(s[i]) + 1) * high) % M
        h = (h * B + ord(s[i + L]) + 1) % M
        seen.add(h)
    return len(seen)

print(count_distinct("ababa", 2))  # 2  ("ab", "ba")
```

---

## Coding Challenge 3 — Longest Duplicate Substring (binary search + hashing)

**Problem.** Find the longest substring that appears at least twice in `s` (LeetCode 1044). Binary search the length `L`; for each `L`, hash all length-`L` windows and check for a repeated hash. `O(n log n)` expected.

### Go

```go
package main

import "fmt"

const Bp, Mp = 131, (1 << 61) - 1

func mm(a, b uint64) uint64 {
	const lo32 = (1 << 32) - 1
	aL, aH := a&lo32, a>>32
	return ((aH*b)%Mp*((1<<32)%Mp)%Mp + aL*b%Mp) % Mp
}

func dupOfLen(s string, L int) int {
	n := len(s)
	var high uint64 = 1
	for i := 0; i < L-1; i++ {
		high = mm(high, Bp)
	}
	var h uint64
	for i := 0; i < L; i++ {
		h = (mm(h, Bp) + uint64(s[i]) + 1) % Mp
	}
	seen := map[uint64]int{h: 0}
	for i := 0; i+L < n; i++ {
		h = (h + Mp - mm(uint64(s[i])+1, high)) % Mp
		h = (mm(h, Bp) + uint64(s[i+L]) + 1) % Mp
		if j, ok := seen[h]; ok {
			_ = j
			return i + 1
		}
		seen[h] = i + 1
	}
	return -1
}

func longestDup(s string) string {
	lo, hi, start, length := 1, len(s)-1, -1, 0
	for lo <= hi {
		mid := (lo + hi) / 2
		if p := dupOfLen(s, mid); p != -1 {
			start, length = p, mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	if start == -1 {
		return ""
	}
	return s[start : start+length]
}

func main() { fmt.Println(longestDup("banana")) } // "ana"
```

### Java

```java
import java.util.*;

public class LongestDup {
    static final long B = 131, M = (1L << 61) - 1;
    static long mul(long a, long b) {
        long hi = Math.multiplyHigh(a, b), lo = a * b;
        long r = (lo & M) + ((lo >>> 61) | (hi << 3));
        r = (r & M) + (r >>> 61);
        return r >= M ? r - M : r;
    }
    static int dupOfLen(String s, int L) {
        int n = s.length();
        long high = 1;
        for (int i = 0; i < L - 1; i++) high = mul(high, B);
        long h = 0;
        for (int i = 0; i < L; i++) h = (mul(h, B) + s.charAt(i) + 1) % M;
        Set<Long> seen = new HashSet<>();
        seen.add(h);
        for (int i = 0; i + L < n; i++) {
            h = (h + M - mul(s.charAt(i) + 1, high)) % M;
            h = (mul(h, B) + s.charAt(i + L) + 1) % M;
            if (!seen.add(h)) return i + 1;
        }
        return -1;
    }
    static String longestDup(String s) {
        int lo = 1, hi = s.length() - 1, start = -1, len = 0;
        while (lo <= hi) {
            int mid = (lo + hi) / 2, p = dupOfLen(s, mid);
            if (p != -1) { start = p; len = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return start == -1 ? "" : s.substring(start, start + len);
    }
    public static void main(String[] a) { System.out.println(longestDup("banana")); } // "ana"
}
```

### Python

```python
B, M = 131, (1 << 61) - 1

def dup_of_len(s, L):
    n = len(s)
    high = pow(B, L - 1, M)
    h = 0
    for i in range(L):
        h = (h * B + ord(s[i]) + 1) % M
    seen = {h: 0}
    for i in range(n - L):
        h = (h - (ord(s[i]) + 1) * high) % M
        h = (h * B + ord(s[i + L]) + 1) % M
        if h in seen:
            return i + 1
        seen[h] = i + 1
    return -1

def longest_dup(s):
    lo, hi, start, length = 1, len(s) - 1, -1, 0
    while lo <= hi:
        mid = (lo + hi) // 2
        p = dup_of_len(s, mid)
        if p != -1:
            start, length, lo = p, mid, mid + 1
        else:
            hi = mid - 1
    return s[start:start + length] if start != -1 else ""

print(longest_dup("banana"))  # "ana"
```

---

## Coding Challenge 4 — 2D Pattern Search

**Problem.** Given an `R×C` grid of characters and an `r×c` pattern, return the top-left coordinates of every occurrence. Hash each row's horizontal windows, then roll vertically. Expected `O(R·C + r·c)`.

### Go

```go
package main

import "fmt"

const b1, p1, b2, p2 = 257, 1_000_000_007, 263, 998_244_353

func search2D(grid, pat []string) [][2]int {
	R, C := len(grid), len(grid[0])
	r, c := len(pat), len(pat[0])
	var res [][2]int
	if r > R || c > C {
		return res
	}
	// hash pattern: rows via base b1, then column via b2
	patRow := make([]int64, r)
	var hp1 int64 = 1
	for i := 0; i < c-1; i++ {
		hp1 = hp1 * b1 % p1
	}
	for i := 0; i < r; i++ {
		var h int64
		for j := 0; j < c; j++ {
			h = (h*b1 + int64(pat[i][j])) % p1
		}
		patRow[i] = h
	}
	var patHash int64
	for i := 0; i < r; i++ {
		patHash = (patHash*b2 + patRow[i]) % p2
	}
	var hp2 int64 = 1
	for i := 0; i < r-1; i++ {
		hp2 = hp2 * b2 % p2
	}
	// rowHash[i][startCol] = hash of grid[i][startCol..startCol+c-1]
	cols := C - c + 1
	rowHash := make([][]int64, R)
	for i := 0; i < R; i++ {
		rowHash[i] = make([]int64, cols)
		var h int64
		for j := 0; j < c; j++ {
			h = (h*b1 + int64(grid[i][j])) % p1
		}
		rowHash[i][0] = h
		for j := 1; j < cols; j++ {
			h = (h - int64(grid[i][j-1])*hp1%p1 + p1) % p1
			h = (h*b1 + int64(grid[i][j+c-1])) % p1
			rowHash[i][j] = h
		}
	}
	for col := 0; col < cols; col++ {
		var h int64
		for i := 0; i < r; i++ {
			h = (h*b2 + rowHash[i][col]) % p2
		}
		for top := 0; top+r <= R; top++ {
			if h == patHash {
				res = append(res, [2]int{top, col})
			}
			if top+r < R {
				h = (h - rowHash[top][col]*hp2%p2 + p2) % p2
				h = (h*b2 + rowHash[top+r][col]) % p2
			}
		}
	}
	return res
}

func main() {
	grid := []string{"abcd", "efgh", "abcd"}
	pat := []string{"bc", "fg"}
	fmt.Println(search2D(grid, pat)) // [[0 1]]
}
```

### Java

```java
import java.util.*;

public class Search2D {
    static final long B1 = 257, P1 = 1_000_000_007L, B2 = 263, P2 = 998_244_353L;
    static List<int[]> search(String[] g, String[] pat) {
        int R = g.length, C = g[0].length(), r = pat.length, c = pat[0].length();
        List<int[]> res = new ArrayList<>();
        if (r > R || c > C) return res;
        long hp1 = 1; for (int i = 0; i < c - 1; i++) hp1 = hp1 * B1 % P1;
        long[] pr = new long[r];
        for (int i = 0; i < r; i++) { long h = 0; for (int j = 0; j < c; j++) h = (h * B1 + pat[i].charAt(j)) % P1; pr[i] = h; }
        long ph = 0; for (int i = 0; i < r; i++) ph = (ph * B2 + pr[i]) % P2;
        long hp2 = 1; for (int i = 0; i < r - 1; i++) hp2 = hp2 * B2 % P2;
        int cols = C - c + 1;
        long[][] rh = new long[R][cols];
        for (int i = 0; i < R; i++) {
            long h = 0; for (int j = 0; j < c; j++) h = (h * B1 + g[i].charAt(j)) % P1;
            rh[i][0] = h;
            for (int j = 1; j < cols; j++) {
                h = (h - g[i].charAt(j - 1) * hp1 % P1 + P1) % P1;
                h = (h * B1 + g[i].charAt(j + c - 1)) % P1;
                rh[i][j] = h;
            }
        }
        for (int col = 0; col < cols; col++) {
            long h = 0; for (int i = 0; i < r; i++) h = (h * B2 + rh[i][col]) % P2;
            for (int top = 0; top + r <= R; top++) {
                if (h == ph) res.add(new int[]{top, col});
                if (top + r < R) {
                    h = (h - rh[top][col] * hp2 % P2 + P2) % P2;
                    h = (h * B2 + rh[top + r][col]) % P2;
                }
            }
        }
        return res;
    }
    public static void main(String[] a) {
        var out = search(new String[]{"abcd","efgh","abcd"}, new String[]{"bc","fg"});
        for (int[] p : out) System.out.println(Arrays.toString(p)); // [0, 1]
    }
}
```

### Python

```python
B1, P1, B2, P2 = 257, 1_000_000_007, 263, 998_244_353

def search_2d(grid, pat):
    R, C, r, c = len(grid), len(grid[0]), len(pat), len(pat[0])
    if r > R or c > C:
        return []
    hp1 = pow(B1, c - 1, P1)
    patrow = []
    for row in pat:
        h = 0
        for ch in row:
            h = (h * B1 + ord(ch)) % P1
        patrow.append(h)
    ph = 0
    for h in patrow:
        ph = (ph * B2 + h) % P2
    hp2 = pow(B2, r - 1, P2)
    cols = C - c + 1
    rh = [[0] * cols for _ in range(R)]
    for i in range(R):
        h = 0
        for j in range(c):
            h = (h * B1 + ord(grid[i][j])) % P1
        rh[i][0] = h
        for j in range(1, cols):
            h = (h - ord(grid[i][j - 1]) * hp1) % P1
            h = (h * B1 + ord(grid[i][j + c - 1])) % P1
            rh[i][j] = h
    res = []
    for col in range(cols):
        h = 0
        for i in range(r):
            h = (h * B2 + rh[i][col]) % P2
        for top in range(R - r + 1):
            if h == ph:
                res.append((top, col))
            if top + r < R:
                h = (h - rh[top][col] * hp2) % P2
                h = (h * B2 + rh[top + r][col]) % P2
    return res

print(search_2d(["abcd", "efgh", "abcd"], ["bc", "fg"]))  # [(0, 1)]
```

---

## Interview Tips

- **State the verify step out loud.** Interviewers watch for whether you report on hash equality alone (a bug) or verify characters.
- **Mention the worst case unprompted.** Saying "expected `O(n+m)`, worst `O(n·m)` against a fixed hash, mitigated by a random base" signals depth.
- **Precompute `b^{m-1}` outside the loop.** Recomputing it inside is the most common efficiency slip and turns the roll back into `O(m)`.
- **Guard the modular subtraction.** `(h − x·high + p) % p` — interviewers test whether you handle negative residues.
- **Know when to switch tools.** For a single adversarial pattern, KMP/Z; for multi-pattern or 2D, Rabin-Karp shines. Articulating the trade-off is senior signal.
- **Use 64-bit products.** Multiplying two ~`10^9` values needs 64 bits before the modulo; mention overflow explicitly in Go/Java.

---

## Summary

Rabin-Karp interviews reduce to one mechanism and four extensions. The mechanism: a polynomial rolling hash that updates in `O(1)`, compared to the pattern hash, with **verification** on hits guaranteeing correctness. The extensions — counting distinct substrings, longest duplicate substring via binary search, equal-length multi-pattern set matching, and 2D grid search — all reuse the same roll, often through prefix hashes for `O(1)` substring access. Demonstrate the `O(1)` roll, name the expected `O(n+m)` / worst `O(n·m)` split, defend the worst case with a random base, and always verify. The Go/Java/Python solutions above are runnable end to end; practice reproducing the roll and the modular-subtraction guard from memory.
