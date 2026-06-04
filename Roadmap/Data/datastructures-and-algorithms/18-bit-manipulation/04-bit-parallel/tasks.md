# Bit-Parallel Techniques (Word-Level Parallelism / Bitset Acceleration) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the bit-parallel logic and validate against the evaluation criteria.
> **Always test against a scalar oracle (the slow per-bool / per-cell version) on small inputs before trusting any bit-parallel result.**
> Reminder: the speedup is the **`/64` constant factor** (word width), not a Big-O improvement.

---

## Beginner Tasks (5)

### Task 1 — Single-bit set / clear / test

**Problem.** Implement `set(s)`, `clear(s)`, `test(s)` over a `uint64[]` bitset of `nbits` bits. Bit `s` lives in word `s>>6` at position `s&63`.

**Input / Output spec.**
- Read `nbits`, then a sequence of operations: `S s`, `C s`, `T s`.
- For each `T s`, print `1` or `0`.

**Constraints.**
- `1 ≤ nbits ≤ 10^6`, `0 ≤ s < nbits`.

**Hint.** `mask = 1 << (s & 63)`; set is `|= mask`, clear is `&= ~mask`, test is `(word >> (s&63)) & 1`.

**Starter — Go.**
```go
package main

import "fmt"

type Bitset struct{ w []uint64 }

func NewBitset(n int) *Bitset { return &Bitset{w: make([]uint64, (n+63)>>6)} }
func (b *Bitset) Set(s int)   { /* TODO */ }
func (b *Bitset) Clear(s int) { /* TODO */ }
func (b *Bitset) Test(s int) int { /* TODO */ return 0 }

func main() {
	var n int
	fmt.Scan(&n)
	b := NewBitset(n)
	var op string
	var s int
	for {
		if _, err := fmt.Scan(&op, &s); err != nil {
			break
		}
		switch op {
		case "S":
			b.Set(s)
		case "C":
			b.Clear(s)
		case "T":
			fmt.Println(b.Test(s))
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[] w;
    static void set(int s)   { /* TODO */ }
    static void clear(int s) { /* TODO */ }
    static int test(int s)   { /* TODO */ return 0; }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        w = new long[(n + 63) >> 6];
        while (sc.hasNext()) {
            String op = sc.next();
            int s = sc.nextInt();
            if (op.equals("S")) set(s);
            else if (op.equals("C")) clear(s);
            else System.out.println(test(s));
        }
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    idx = 0
    n = int(data[idx]); idx += 1
    B = 0  # Python int as bitset
    out = []
    while idx < len(data):
        op = data[idx]; s = int(data[idx + 1]); idx += 2
        if op == "S":
            B |= 1 << s
        elif op == "C":
            B &= ~(1 << s)
        else:
            out.append(str((B >> s) & 1))
    print("\n".join(out))


main()
```

**Evaluation.** Each `test` matches a scalar `bool[]` reference.

---

### Task 2 — Subset-sum reachability (Python big-int)

**Problem.** Given item weights, build the reachable-sums bitset with `B |= B << w` and answer membership queries.

**I/O spec.** Read `n`, the `n` weights, then `q` and `q` query targets. For each query print `1`/`0`.

**Constraints.** `1 ≤ n ≤ 1000`, `1 ≤ weight ≤ 1000`.

**Hint.** Start `B = 1`. For each weight, `B |= B << w`. Membership is `(B >> t) & 1`.

**Starter — Python.**
```python
def solve(weights, queries):
    B = 1
    for w in weights:
        B |= B << w           # TODO: confirm this is the whole algorithm
    return [(B >> t) & 1 for t in queries]
```

**Starter — Go / Java.** Use a `uint64[]` / `long[]` bitset with a cross-word `shiftLeftOr` (see Task 3); start with bit 0 set.

**Evaluation.** Matches a scalar boolean-DP oracle on random small inputs.

---

### Task 3 — Cross-word left shift

**Problem.** Implement `shiftLeftOr(B, amt)` performing `B |= B << amt` over a `uint64[]`, correctly carrying bits across word boundaries.

**I/O spec.** Read `nbits`, the initial set bits, and `amt`. Output the set bits of the result, ascending.

**Constraints.** `1 ≤ nbits ≤ 10^6`, `0 ≤ amt < nbits`.

**Hint.** `wordShift = amt>>6`, `bitShift = amt&63`. Iterate **high→low**; guard the carry with `if bitShift > 0`.

**Starter — Go.**
```go
func shiftLeftOr(b []uint64, amt int) {
	ws, bs := amt>>6, uint(amt&63)
	for i := len(b) - 1; i >= 0; i-- {
		// TODO: out = b[i-ws] << bs, plus carry from b[i-ws-1] >> (64-bs) if bs>0
		_ = ws
		_ = bs
	}
}
```

**Starter — Java.**
```java
static void shiftLeftOr(long[] b, int amt) {
    int ws = amt >> 6, bs = amt & 63;
    for (int i = b.length - 1; i >= 0; i--) {
        // TODO: long v = b[i-ws] << bs; if (bs>0 && i-ws-1>=0) v |= b[i-ws-1] >>> (64-bs);
        //       b[i] |= v;
    }
}
```

**Starter — Python.** `B |= B << amt` (native big-int handles the carry).

**Evaluation.** Result equals shifting a scalar `bool[]` by `amt` and OR-ing. Test `amt` a multiple of 64, `amt` spanning two words, and `amt = 0`.

---

### Task 4 — popcount and find-first-set

**Problem.** Given a bitset, return (a) the number of set bits and (b) the index of the lowest set bit (`-1` if empty).

**I/O spec.** Read `nbits`, the set bits, then print `count` and `ffs`.

**Constraints.** `1 ≤ nbits ≤ 10^6`.

**Hint.** Use `bits.OnesCount64` / `Long.bitCount` for count; scan for the first nonzero word, then count trailing zeros.

**Starter — Go.**
```go
import "math/bits"

func count(b []uint64) int {
	c := 0
	for _, x := range b {
		c += bits.OnesCount64(x)
	}
	return c
}

func ffs(b []uint64) int {
	for i, x := range b {
		if x != 0 {
			return i*64 + bits.TrailingZeros64(x)
		}
	}
	return -1
}
```

**Starter — Java.**
```java
static int count(long[] b) {
    int c = 0;
    for (long x : b) c += Long.bitCount(x);
    return c;
}

static int ffs(long[] b) {
    for (int i = 0; i < b.length; i++)
        if (b[i] != 0) return i * 64 + Long.numberOfTrailingZeros(b[i]);
    return -1;
}
```

**Starter — Python.**
```python
def count(B):
    return bin(B).count("1")


def ffs(B):
    return -1 if B == 0 else (B & -B).bit_length() - 1
```

**Evaluation.** Matches a scalar count / first-true scan.

---

### Task 5 — Word-parallel set union and intersection

**Problem.** Given two bitsets, output their union and intersection.

**I/O spec.** Read `nbits`, the set bits of `A`, then of `B`. Print set bits of `A ∪ B` then `A ∩ B`.

**Constraints.** `1 ≤ nbits ≤ 10^6`.

**Hint.** `union[i] = A[i] | B[i]`, `inter[i] = A[i] & B[i]` — one word op per 64 lanes.

**Starter — Go.**
```go
func union(a, b []uint64) []uint64 {
	c := make([]uint64, len(a))
	for i := range a {
		c[i] = a[i] | b[i] // TODO: also intersect with &
	}
	return c
}
```

**Starter — Python.**
```python
def set_ops(A, B):
    return A | B, A & B   # union, intersection as Python int-bitsets
```

**Evaluation.** Matches scalar `bool[]` union/intersection. Also report `popcount(A ^ B)` (symmetric-difference size) as a bonus check.

---

## Intermediate Tasks (4)

### Task 6 — Bounded subset-sum with a cap

**Problem.** Given weights and a cap `C`, report which totals in `[0, C]` are reachable, keeping the bitset width bounded to `C+1`.

**I/O spec.** Read `n`, the weights, `C`, then `q` queries (each `≤ C`). Print `1`/`0` per query.

**Constraints.** `1 ≤ n ≤ 2000`, `1 ≤ weight ≤ 10^5`, `1 ≤ C ≤ 10^6`.

**Hint.** After each `B |= B << w`, mask off bits beyond `C`: in Python `B &= (1 << (C+1)) - 1`; in Go/Java clear the high bits of the top word.

**Starter — Python.**
```python
def bounded_subset_sum(weights, C, queries):
    full = (1 << (C + 1)) - 1
    B = 1
    for w in weights:
        B = (B | (B << w)) & full   # TODO: confirm masking keeps width bounded
    return [(B >> t) & 1 for t in queries]
```

**Evaluation.** Matches a scalar capped DP. Memory stays `O(C/64)` words.

---

### Task 7 — Shift-Or substring search

**Problem.** Find all starting indices of pattern `P` (length ≤ 64) in text `T` via Shift-Or.

**I/O spec.** Read `T`, then `P`. Print all match start indices (space-separated), or `-1` if none.

**Constraints.** `1 ≤ |T| ≤ 10^6`, `1 ≤ |P| ≤ 64`.

**Hint.** Build `mask[c]` (bit `j` = 0 iff `P[j]==c`). `R = (R << 1) | mask[c]`; match when bit `m-1` of `R` is `0`.

**Starter — Go.**
```go
func shiftOr(text, pat string) []int {
	m := len(pat)
	var mask [256]uint64
	for i := range mask {
		mask[i] = ^uint64(0)
	}
	for j := 0; j < m; j++ {
		mask[pat[j]] &^= 1 << uint(j)
	}
	var R uint64 = ^uint64(0)
	// TODO: scan text, update R, collect matches when (R & (1<<(m-1))) == 0
	_ = R
	return nil
}
```

**Starter — Java / Python.** See `interview.md` Challenge 2 for full reference solutions.

**Evaluation.** Matches `strings.Index`-loop / naive search on random inputs.

---

### Task 8 — Boolean transitive closure with bitset rows

**Problem.** Compute the reflexive-transitive closure of a directed graph using bitset rows (`O(V³/64)`).

**I/O spec.** Read `V`, `E`, then `E` edges `u v`. Print, for each vertex, the sorted list of reachable vertices.

**Constraints.** `1 ≤ V ≤ 2000`.

**Hint.** `reach[i]` is a bitset row; set `reach[i][i]` and each edge. Warshall: if `reach[i]` has bit `k`, `reach[i] |= reach[k]` (word-parallel).

**Starter — Python.**
```python
def closure(V, edges):
    reach = [1 << i for i in range(V)]
    for u, v in edges:
        reach[u] |= 1 << v
    for k in range(V):
        kbit = 1 << k
        for i in range(V):
            if reach[i] & kbit:
                reach[i] |= reach[k]   # TODO: confirm this is the row-OR step
    return reach
```

**Evaluation.** Matches a scalar `bool[][]` Warshall on random small graphs.

---

### Task 9 — Approximate matching (Bitap with k errors)

**Problem.** Find positions where `P` (length ≤ 32) occurs in `T` with at most `k` edit/substitution errors, using `k+1` Shift-Or state words.

**I/O spec.** Read `T`, `P`, `k`. Print end indices of approximate matches.

**Constraints.** `1 ≤ |T| ≤ 10^5`, `1 ≤ |P| ≤ 32`, `0 ≤ k ≤ 5`.

**Hint.** Keep `R[0..k]`. `R[d]` is updated from the previous `R[d]` (match), and previous `R[d-1]` (allowing one more error). Report when bit `m-1` of any `R[d]` is `0`.

**Starter — Python.**
```python
def bitap_k(text, pat, k):
    m = len(pat)
    mask = [~0] * 256
    for j, ch in enumerate(pat):
        mask[ord(ch)] &= ~(1 << j)
    full = (1 << 64) - 1
    R = [(~0) & full for _ in range(k + 1)]
    match_bit = 1 << (m - 1)
    res = []
    for i, ch in enumerate(text):
        old = R[0]
        R[0] = ((R[0] << 1) | mask[ord(ch)]) & full
        for d in range(1, k + 1):
            cur = R[d]
            # substitution: old; match: shift; insertion/deletion variants:
            R[d] = ((((R[d] << 1) | mask[ord(ch)])
                     & (old << 1)
                     & (R[d - 1])
                     & (R[d - 1] << 1)) ) & full  # TODO: refine the Bitap recurrence
            old = cur
        if R[k] & match_bit == 0:
            res.append(i)
    return res
```

**Evaluation.** Matches a brute-force edit-distance scan for small inputs. (This task is intentionally tricky — get exact match `k=0` right first.)

---

## Advanced Tasks (4)

### Task 10 — Multi-word Shift-Or (pattern > 64)

**Problem.** Extend Shift-Or to patterns longer than 64 by storing the state across `⌈m/64⌉` words and carrying the shift between them.

**I/O spec.** Read `T`, `P` (`|P|` up to 200). Print match start indices.

**Constraints.** `1 ≤ |T| ≤ 10^5`, `1 ≤ |P| ≤ 200`.

**Hint.** The state is a `uint64[]`. Each step shifts the whole array left by 1 (carry bit 63 of word `i` into bit 0 of word `i+1`) and ORs in per-word masks `mask[c][word]`.

**Starter — Go.** Build `mask[256][nWords]`; maintain `R []uint64`; shift-by-1 with cross-word carry each character.

**Evaluation.** Matches single-word Shift-Or for `m ≤ 64` and KMP for longer patterns.

---

### Task 11 — Myers' bit-vector edit distance

**Problem.** Compute Levenshtein distance between `P` (length ≤ 64) and `T` using Myers' algorithm in `O(|T|)`.

**I/O spec.** Read `P`, `T`. Print the edit distance.

**Constraints.** `1 ≤ |P| ≤ 64`, `1 ≤ |T| ≤ 10^6`.

**Hint.** Maintain `VP` (init all-ones low `m` bits), `VN = 0`, `score = m`. Per char: `Eq = peq[c]; Xv = Eq|VN; Xh = (((Eq&VP)+VP)^VP)|Eq; HP = VN|~(Xh|VP); HN = VP&Xh;` update score by the top bit of `HP`/`HN`; shift and recompute `VP`, `VN`.

**Starter — Go.** See `senior.md` §8.2 for a full reference.

**Evaluation.** Matches a full `O(|P|·|T|)` DP on random strings.

---

### Task 12 — Bit-parallel LCS length

**Problem.** Compute LCS length of two strings with the bit-parallel recurrence (`|a| ≤ 64`).

**I/O spec.** Read `a`, `b`. Print LCS length.

**Constraints.** `1 ≤ |a| ≤ 64`, `1 ≤ |b| ≤ 10^6`.

**Hint.** Precompute `match[c]` (bits of positions in `a` equal to `c`). Maintain row `V = all ones` (low `m` bits); per char of `b`: `t = V & match[c]; V = ((V + t) | (V & ~match[c])) & full`. LCS = **popcount of the bits cleared in `V`** = `popcount(~V & full)` (the `1 → 0` transitions accumulate the LCS length). A common bug is writing `m - popcount(...)` — that undercounts; the answer is the count of cleared bits directly.

**Starter — Python.** See `interview.md` Challenge 4 for a full reference.

**Evaluation.** Matches the standard `O(|a|·|b|)` LCS DP.

---

### Task 13 — Bitset Boolean matrix power (exact-`k` reachability)

**Problem.** Given a directed graph and `k`, decide for queries `(i, j)` whether a walk of length exactly `k` exists, using bitset Boolean matrix multiply (`O(V³/64)`) and binary exponentiation.

**I/O spec.** Read `V`, edges, `k`, then queries `(i, j)`. Print `1`/`0` per query.

**Constraints.** `1 ≤ V ≤ 512`, `1 ≤ k ≤ 10^9`.

**Hint.** Represent each row as a bitset. Boolean multiply: `C[i] = OR of B[t] for t with A[i] bit t set`. Binary exponentiation: square the boolean matrix `log k` times, multiply in powers for set bits of `k`. The identity is the reflexive bitset (`I[i]` has only bit `i`).

**Starter — Go / Java / Python.** Combine the row-OR Boolean multiply (Task 8 style) with the binary-exponentiation skeleton (`R = I; while k>0 { if k&1 { R = mul(R,A) }; A = mul(A,A); k>>=1 }`).

**Evaluation.** Matches a scalar Boolean matrix power for small `V` and `k`; verify on a directed cycle where exact-`k` reachability is forced by `k mod V`.

---

### Task 14 — Subset partition into two equal halves

**Problem.** Given item weights, decide whether they can be partitioned into two subsets of equal sum (the classic "Partition" problem). Use the bitset shift-OR to compute reachable sums, then test bit `total/2`.

**I/O spec.** Read `n`, the weights. Print `YES` if a balanced partition exists, else `NO`.

**Constraints.** `1 ≤ n ≤ 2000`, total sum ≤ `4·10^6`.

**Hint.** If `total` is odd, immediately `NO`. Otherwise build `B` with `B |= B << w` and answer `(B >> (total/2)) & 1`.

**Starter — Python.**
```python
def can_partition(weights):
    total = sum(weights)
    if total % 2:
        return False
    B = 1
    for w in weights:
        B |= B << w
    return (B >> (total // 2)) & 1 == 1
```

**Starter — Go / Java.** Reuse the Task 3 cross-word `shiftLeftOr`; size the bitset to `total/2 + 1` (you only need to test the half-sum, so cap there).

**Evaluation.** Matches a scalar subset-sum DP testing `reach[total/2]`. This is the most common interview application of the bitset shift-OR — recognize Partition as subset-sum to `total/2`.

---

### Task 15 — Count reachable sums in a range

**Problem.** After computing the subset-sum bitset, report how many reachable sums lie in `[lo, hi]`.

**I/O spec.** Read `n`, the weights, then `lo hi`. Print the count.

**Constraints.** `1 ≤ n ≤ 2000`, total ≤ `10^6`.

**Hint.** `popcount(B & rangeMask)` where `rangeMask` has bits `[lo, hi]` set. In Python: `bin(B & (((1<<(hi+1))-1) ^ ((1<<lo)-1))).count("1")`.

**Starter — Python.**
```python
def reachable_in_range(weights, lo, hi):
    B = 1
    for w in weights:
        B |= B << w
    mask = ((1 << (hi + 1)) - 1) ^ ((1 << lo) - 1)
    return bin(B & mask).count("1")
```

**Evaluation.** Matches a scalar count over `reach[lo..hi]`. Demonstrates combining popcount with a range mask — the rank-style query.

---

## Self-Check Criteria

- Every solution validated against a **scalar oracle** (per-bool / per-cell version) on random small inputs.
- Cross-word shifts tested at the boundaries: `amt` a multiple of 64, `amt` spanning two words, `amt = 0`.
- Python implementations that mirror fixed-width languages **mask to 64 bits** each step (`& ((1<<64)-1)`).
- Java uses logical shift `>>>` for unsigned bit moves; never arithmetic `>>` on a `long` bitset word.
- Performance claims stated as **`/64` constant factor**, never as a Big-O class change.
- Bitset width sized to the real maximum (`sum(weights)` or the cap), not guessed.
- Top word masked to its valid bit count after any shift, so `popcount`/`ffs` never read stale high bits.
- `B |= B << w` written with OR-assign (not bare assign), so "skip the item" stays a reachable alternative.

### Difficulty Progression

| Tier | Tasks | Skill |
|------|-------|-------|
| Beginner | 1–5 | single-bit ops, the cross-word shift, popcount/ffs, set algebra |
| Intermediate | 6–9 | bounded subset-sum, Shift-Or, transitive closure, approximate Bitap |
| Advanced | 10–15 | multi-word Shift-Or, Myers, bit-parallel LCS, Boolean matrix power, Partition, range counts |

Work them in order: each tier reuses the cross-word shift and scalar-oracle discipline of the previous one. The single most important habit to build is **always diff against a scalar oracle** — it is faster than debugging a silent bit-corruption after the fact.
