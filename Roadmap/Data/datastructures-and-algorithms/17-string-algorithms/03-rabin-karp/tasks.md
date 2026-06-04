# Rabin-Karp (Rolling-Hash String Matching) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the rolling-hash logic and validate against the evaluation criteria.
> **Always test against a brute-force naive matcher on small inputs, and always verify characters on a hash hit before reporting a match.**

---

## Beginner Tasks (5)

### Task 1 — Horner hash of a string

**Problem.** Implement `hashString(s, base, mod)` returning the polynomial hash `Σ (s[i]+1)·base^(|s|-1-i) mod mod` using Horner's method. Offset codes by 1.

**Input / Output spec.**
- Read string `s`, integers `base` and `mod`.
- Print the hash.

**Constraints.** `1 ≤ |s| ≤ 10^6`, `base < mod ≤ 2^31 − 1`, products in 64-bit.

**Hint.** `h = (h*base + ord(c)+1) % mod` per character.

**Starter — Go.**
```go
package main

import "fmt"

func hashString(s string, base, mod int64) int64 {
	// TODO: Horner loop
	return 0
}

func main() {
	var s string
	var base, mod int64
	fmt.Scan(&s, &base, &mod)
	fmt.Println(hashString(s, base, mod))
}
```

**Starter — Java.**
```java
import java.util.*;
public class Task1 {
    static long hashString(String s, long base, long mod) {
        // TODO
        return 0;
    }
    public static void main(String[] a) {
        Scanner sc = new Scanner(System.in);
        System.out.println(hashString(sc.next(), sc.nextLong(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
def hash_string(s, base, mod):
    # TODO: Horner loop
    return 0

if __name__ == "__main__":
    s, base, mod = input().split()
    print(hash_string(s, int(base), int(mod)))
```

**Evaluation.** Matches a direct power-sum computation for random strings.

### Task 2 — Precompute `base^(m-1) mod p`

**Problem.** Implement `highPow(base, m, mod)` returning `base^(m-1) mod mod` by a simple loop (or fast exponentiation).

**I/O spec.** Read `base`, `m`, `mod`; print result.

**Constraints.** `1 ≤ m ≤ 10^6`, `base, mod ≤ 2^31 − 1`.

**Hint.** Multiply-and-reduce `m-1` times; for large `m` use binary exponentiation.

**Starter — Go.**
```go
package main
import "fmt"
func highPow(base, m, mod int64) int64 {
	// TODO
	return 1
}
func main() { var b, m, p int64; fmt.Scan(&b, &m, &p); fmt.Println(highPow(b, m, p)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task2 {
    static long highPow(long base, long m, long mod) { return 1; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        System.out.println(highPow(s.nextLong(), s.nextLong(), s.nextLong()));
    }
}
```

**Starter — Python.**
```python
def high_pow(base, m, mod):
    return pow(base, m - 1, mod)  # or implement the loop yourself

if __name__ == "__main__":
    b, m, p = map(int, input().split())
    print(high_pow(b, m, p))
```

**Evaluation.** Equals `pow(base, m-1, mod)` for all inputs.

### Task 3 — Single roll step

**Problem.** Given a window hash `h` over `T[i..i+m-1]`, the leaving char `out`, the entering char `in`, `highPow`, `base`, `mod`, return the hash of `T[i+1..i+m]`.

**I/O spec.** Read `h out in highPow base mod` (chars as integer codes already +1). Print the new hash.

**Constraints.** All values `< mod ≤ 2^31 − 1`; guard against negative residue.

**Hint.** `h = ((h - out*highPow) % mod + mod) % mod; h = (h*base + in) % mod`.

**Starter — Go.**
```go
package main
import "fmt"
func roll(h, out, in, high, base, mod int64) int64 {
	// TODO
	return 0
}
func main() { var h, o, i, hp, b, m int64; fmt.Scan(&h,&o,&i,&hp,&b,&m); fmt.Println(roll(h,o,i,hp,b,m)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task3 {
    static long roll(long h, long out, long in, long high, long base, long mod) { return 0; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        System.out.println(roll(s.nextLong(),s.nextLong(),s.nextLong(),s.nextLong(),s.nextLong(),s.nextLong()));
    }
}
```

**Starter — Python.**
```python
def roll(h, out, in_, high, base, mod):
    # TODO
    return 0

if __name__ == "__main__":
    h, out, in_, high, base, mod = map(int, input().split())
    print(roll(h, out, in_, high, base, mod))
```

**Evaluation.** Equals hashing the new window from scratch.

### Task 4 — Does P occur in T? (boolean)

**Problem.** Return `true` if pattern `P` occurs anywhere in text `T`, else `false`. Use a rolling hash with verification.

**I/O spec.** Read `T` then `P`; print `true`/`false`.

**Constraints.** `1 ≤ |P| ≤ |T| ≤ 10^6`.

**Hint.** Stop at the first verified match.

**Starter — Go.**
```go
package main
import "fmt"
func contains(t, p string) bool {
	// TODO: rolling hash + verify
	return false
}
func main() { var t, p string; fmt.Scan(&t, &p); fmt.Println(contains(t, p)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task4 {
    static boolean contains(String t, String p) { return false; /* TODO */ }
    public static void main(String[] a) {
        Scanner s = new Scanner(System.in);
        System.out.println(contains(s.next(), s.next()));
    }
}
```

**Starter — Python.**
```python
def contains(t, p):
    # TODO
    return False

if __name__ == "__main__":
    import sys
    t, p = sys.stdin.read().split()
    print(str(contains(t, p)).lower())
```

**Evaluation.** Matches `p in t` for random strings.

### Task 5 — Count occurrences

**Problem.** Count how many times `P` occurs in `T` (overlaps count).

**I/O spec.** Read `T`, `P`; print the count.

**Constraints.** `1 ≤ |P| ≤ |T| ≤ 10^6`.

**Hint.** Increment on each *verified* hit; do not stop early.

**Starter — Python.**
```python
def count_occ(t, p):
    # TODO: rolling hash + verify, count all
    return 0

if __name__ == "__main__":
    import sys
    t, p = sys.stdin.read().split()
    print(count_occ(t, p))
```
*(Provide Go and Java analogously, returning an int.)*

**Evaluation.** Matches a naive count for `"aaaa"`, `"aa"` → 3.

---

## Intermediate Tasks (4)

### Task 6 — Double-hash matcher

**Problem.** Implement substring search with **two** independent hashes; a position is a candidate only if both hashes match, then verify. Return all indices.

**I/O spec.** Read `T`, `P`; print space-separated indices (or empty line).

**Constraints.** `1 ≤ |P| ≤ |T| ≤ 10^6`. Use distinct `(base, mod)` pairs.

**Hint.** Keep two rolling hashes in lockstep; both must equal the pattern's pair.

**Starter — Go.**
```go
package main
import "fmt"
func search(t, p string) []int {
	// TODO: two rolling hashes + verify
	return nil
}
func main() { var t, p string; fmt.Scan(&t, &p); fmt.Println(search(t, p)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task6 {
    static List<Integer> search(String t, String p) { return new ArrayList<>(); /* TODO */ }
    public static void main(String[] a){ Scanner s=new Scanner(System.in); System.out.println(search(s.next(), s.next())); }
}
```

**Starter — Python.**
```python
def search(t, p):
    # TODO: two rolling hashes + verify
    return []

if __name__ == "__main__":
    import sys
    t, p = sys.stdin.read().split()
    print(*search(t, p))
```

**Evaluation.** Identical index list to naive search on random data; spurious-hit count near zero.

### Task 7 — Count distinct substrings of length L

**Problem.** Count distinct length-`L` substrings of `s` using a rolling hash and a set. Use a 61-bit modulus or double hashing.

**I/O spec.** Read `s`, `L`; print the count.

**Constraints.** `1 ≤ L ≤ |s| ≤ 10^5`.

**Hint.** Roll across all windows, insert each hash into a set, return the set size.

**Starter — Python.**
```python
def count_distinct(s, L):
    # TODO: rolling hash into a set
    return 0

if __name__ == "__main__":
    data = input().split()
    print(count_distinct(data[0], int(data[1])))
```
*(Go and Java analogous, using a `map`/`HashSet` of 64-bit hashes.)*

**Evaluation.** Matches `len(set(s[i:i+L] for i in range(len(s)-L+1)))`.

### Task 8 — Multi-pattern (equal length) search

**Problem.** Given a text and `k` patterns **all of length `m`**, report for each pattern its occurrence indices. One text scan only.

**I/O spec.** Read `T`, `k`, then `k` patterns. Print `k` lines, each the indices for that pattern.

**Constraints.** `1 ≤ k ≤ 10^4`, all patterns length `m`, `|T| ≤ 10^6`.

**Hint.** Hash all patterns into a map `hash → list of patterns`; roll one window; look up; verify candidates.

**Starter — Python.**
```python
def multi_search(t, patterns):
    # TODO: build pattern hash table, single scan over t, verify
    return {p: [] for p in patterns}

if __name__ == "__main__":
    import sys
    data = sys.stdin.read().split()
    t, k = data[0], int(data[1])
    pats = data[2:2 + k]
    res = multi_search(t, pats)
    for p in pats:
        print(*res[p])
```
*(Go and Java analogous, using a hash map keyed by the hash pair.)*

**Evaluation.** Each pattern's indices match naive per-pattern search; total time is one scan.

### Task 9 — Substring equality via prefix hashes

**Problem.** Preprocess `s` so that queries `(l1, l2, len)` answer "are `s[l1..l1+len-1]` and `s[l2..l2+len-1]` equal?" in `O(1)` using prefix hashes (double hash, no per-query verification needed for the task).

**I/O spec.** Read `s`, then `q` queries; print `YES`/`NO` per query.

**Constraints.** `1 ≤ |s|, q ≤ 2·10^5`.

**Hint.** `hash(l, r) = (pre[r+1] − pre[l]·base^(r-l+1)) mod p`. Precompute powers.

**Starter — Python.**
```python
class SubHash:
    def __init__(self, s):
        # TODO: prefix hashes + powers (double hash recommended)
        pass
    def equal(self, l1, l2, length):
        # TODO: compare substring hashes in O(1)
        return False

if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    s = next(it); q = int(next(it)); sh = SubHash(s)
    for _ in range(q):
        l1, l2, ln = int(next(it)), int(next(it)), int(next(it))
        print("YES" if sh.equal(l1, l2, ln) else "NO")
```
*(Go and Java analogous, storing prefix-hash and power arrays.)*

**Evaluation.** Matches direct substring comparison on random queries.

---

## Advanced Tasks (3)

### Task 10 — Longest duplicate substring

**Problem.** Find the longest substring of `s` that occurs at least twice (LeetCode 1044). Binary search the length; hash all windows per length.

**I/O spec.** Read `s`; print the longest duplicated substring (any if ties), or empty line if none.

**Constraints.** `1 ≤ |s| ≤ 3·10^5`. Use a 61-bit modulus or double hashing to keep collisions negligible.

**Hint.** `O(n log n)`: binary search `L`; `dupOfLen(L)` returns a start index of a repeated length-`L` hash or `-1`.

**Starter — Go.**
```go
package main
import "fmt"
func longestDup(s string) string {
	// TODO: binary search length + rolling hash per length
	return ""
}
func main() { var s string; fmt.Scan(&s); fmt.Println(longestDup(s)) }
```

**Starter — Java.**
```java
import java.util.*;
public class Task10 {
    static String longestDup(String s) { return ""; /* TODO */ }
    public static void main(String[] a){ System.out.println(longestDup(new Scanner(System.in).next())); }
}
```

**Starter — Python.**
```python
def longest_dup(s):
    # TODO: binary search length + rolling hash per length
    return ""

if __name__ == "__main__":
    print(longest_dup(input().strip()))
```

**Evaluation.** `"banana"` → `"ana"`; correct length on random strings vs an `O(n²)` brute force.

### Task 11 — 2D pattern search

**Problem.** Find all top-left positions where an `r×c` character pattern occurs in an `R×C` grid. Hash horizontal row-windows, then roll vertically.

**I/O spec.** Read `R C`, then `R` grid rows; read `r c`, then `r` pattern rows. Print each match `top col` on its own line.

**Constraints.** `1 ≤ r ≤ R ≤ 1000`, `1 ≤ c ≤ C ≤ 1000`. Verify on a hash hit.

**Hint.** Build `rowHash[i][startCol]` for every row, then treat each column of row-hashes as a 1D string and roll a height-`r` window.

**Starter — Python.**
```python
def search_2d(grid, pat):
    # TODO: row hashes (base1), then vertical roll (base2), verify
    return []

if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    R, C = int(next(it)), int(next(it))
    grid = [next(it) for _ in range(R)]
    r, c = int(next(it)), int(next(it))
    pat = [next(it) for _ in range(r)]
    for top, col in search_2d(grid, pat):
        print(top, col)
```
*(Go and Java analogous; see `interview.md` Challenge 4 for a full reference implementation.)*

**Evaluation.** Matches a naive `O(R·C·r·c)` 2D scan on random grids.

### Task 12 — Content-defined chunk boundaries

**Problem.** Split a byte stream into variable-length chunks using a rolling-hash cut criterion: cut where the low `avg_bits` of the rolling hash equal 0, subject to min and max chunk sizes. Report chunk end offsets.

**I/O spec.** Read `avg_bits min_size max_size`, then the byte stream (as space-separated integers `0..255`). Print one chunk-end offset per line.

**Constraints.** Stream up to `10^6` bytes; `8 ≤ avg_bits ≤ 16`.

**Hint.** Maintain a fixed-width window rolling hash; cut when `size ≥ max_size` or (`size ≥ min_size` and `hash & mask == 0`).

**Starter — Python.**
```python
def chunk_boundaries(data, window=48, avg_bits=13, min_size=2048, max_size=65536):
    # TODO: rolling hash over a fixed window; emit cut offsets
    return []

if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    avg_bits, min_size, max_size = int(next(it)), int(next(it)), int(next(it))
    data = [int(x) for x in it]
    for off in chunk_boundaries(data, 48, avg_bits, min_size, max_size):
        print(off)
```
*(Go and Java analogous; see `senior.md` for the rolling-hash cut sketch.)*

**Evaluation.** (1) Chunk sizes respect min/max; (2) **boundary stability**: inserting one byte changes only the chunk containing the insertion (and possibly its immediate neighbor), not every subsequent chunk — verify by diffing chunk lists before/after a single-byte insertion.

---

## Stretch Challenges (3)

### Task 13 — Longest common substring of two strings

**Problem.** Given strings `a` and `b`, find the length of the longest string that is a substring of both. Binary search the length `L`; for each `L`, hash all length-`L` windows of `a` into a set and scan `b`'s windows for a hit (verify on collision).

**I/O spec.** Read `a`, `b`; print the length of the longest common substring.

**Constraints.** `1 ≤ |a|, |b| ≤ 10^5`. `O((|a|+|b|) log(min))` expected.

**Hint.** Property `P(L)` = "some length-`L` substring is shared" is monotone, so binary search applies. Store `a`'s window hashes (with the start index for verification).

**Starter — Python.**
```python
def longest_common_substr(a, b):
    # TODO: binary search L; hash a-windows into a set; probe b-windows; verify
    return 0

if __name__ == "__main__":
    import sys
    a, b = sys.stdin.read().split()
    print(longest_common_substr(a, b))
```
*(Go and Java analogous, using a `map`/`HashSet` of 64-bit hashes.)*

**Evaluation.** Matches a DP `O(|a|·|b|)` longest-common-substring on small inputs.

### Task 14 — Palindrome substring queries

**Problem.** Preprocess `s` with a forward and a reverse prefix hash so each query `(l, r)` answers "is `s[l..r]` a palindrome?" in `O(1)`.

**I/O spec.** Read `s`, then `q` queries `(l, r)`; print `YES`/`NO` each.

**Constraints.** `1 ≤ |s|, q ≤ 2·10^5`.

**Hint.** `s[l..r]` is a palindrome iff `forwardHash(l, r) == reverseHash(l, r)` where the reverse hash reads the same range right-to-left.

**Starter — Python.**
```python
class PalQuery:
    def __init__(self, s):
        # TODO: forward + reverse prefix hashes and power table
        pass
    def is_pal(self, l, r):
        # TODO: compare forward and reverse substring hashes
        return False

if __name__ == "__main__":
    import sys
    it = iter(sys.stdin.read().split())
    s = next(it); q = int(next(it)); pq = PalQuery(s)
    for _ in range(q):
        l, r = int(next(it)), int(next(it))
        print("YES" if pq.is_pal(l, r) else "NO")
```
*(Go and Java analogous.)*

**Evaluation.** Matches `s[l:r+1] == s[l:r+1][::-1]` on random queries.

### Task 15 — Randomized-base anti-flooding matcher

**Problem.** Implement substring search with a base chosen uniformly at random in `[256, mod)` at startup, plus verification. Demonstrate that an input crafted to flood a *fixed* base no longer forces many spurious hits.

**I/O spec.** Read `T`, `P`; print verified indices and the spurious-hit count.

**Constraints.** `|T| ≤ 10^6`. Seed the RNG; keep the base private.

**Hint.** Same matcher as Task 4/5 but with a random base; count verifications that fail.

**Starter — Python.**
```python
import random

def search_random_base(t, p, mod=(1 << 61) - 1):
    base = 256 + random.randrange(mod - 256)
    # TODO: rolling hash with this base + verify; count spurious hits
    return [], 0

if __name__ == "__main__":
    import sys
    t, p = sys.stdin.read().split()
    idx, spurious = search_random_base(t, p)
    print(*idx)
    print("spurious:", spurious)
```
*(Go and Java analogous, using a secure or seeded RNG.)*

**Evaluation.** On a fixed-base flooding corpus, the randomized version keeps the spurious-hit count near 0 across repeated runs.

---

## Reference Solutions

Full, runnable reference implementations for the search, distinct-substring, longest-duplicate, and 2D tasks appear in `interview.md` (Challenges 1-4) in Go, Java, and Python. Use them to check your output, then re-derive the rolling update and the modular-subtraction guard from memory — those two lines are where almost every bug lives.

---

## Testing Guidance

- **Differential test.** For Tasks 4-8, 10-11, compare against a naive matcher on thousands of random small inputs; assert identical output.
- **Edge inputs.** Empty results (`m > n`), `m == n`, all-identical characters (`"aaaa"`), single-character alphabet, and patterns at the very start/end of the text.
- **Overflow.** In Go/Java, confirm products use 64-bit and are reduced before they can overflow; in Python, large ints are automatic but `pow(base, e, mod)` is still the fast path.
- **Negative residue.** After removing the leading character, assert the hash stays in `[0, mod)`.
- **Collision drills.** For double-hash tasks, log the spurious-hit count; it should be ~0. For single-hash teaching with a tiny modulus, observe how spurious hits appear — motivation for large primes.
- **Performance.** Tasks with `|T| ≤ 10^6` should finish well under a second; if not, you likely recompute `highPow` inside the loop or build substrings unnecessarily.
