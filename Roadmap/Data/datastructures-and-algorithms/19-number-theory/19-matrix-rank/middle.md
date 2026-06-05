# Matrix Rank — Middle Level

> **Focus:** The same "row-reduce and count pivots" skeleton works over three different fields — the **reals** (with a tolerance), **Z/pZ** (exact, modular inverse), and **GF(2)** (XOR, bitset-fast). On top of rank sit the **rank-nullity theorem**, the **Rouché-Capelli** solvability rule, and **counting solutions of a GF(2) system as `2^(n−rank)`**.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Three Fields: Reals vs Z/pZ vs GF(2)](#three-fields-reals-vs-zpz-vs-gf2)
4. [Rank-Nullity Theorem](#rank-nullity-theorem)
5. [Solvability via Rank (Rouché-Capelli)](#solvability-via-rank-rouché-capelli)
6. [Counting Solutions Over GF(2)](#counting-solutions-over-gf2)
7. [Code Examples](#code-examples)
8. [Comparison with Alternatives](#comparison-with-alternatives)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was a single fact: rank = number of nonzero pivots after row reduction. At middle level you start asking the engineering questions that decide whether your rank computation is *correct* and what you can *do* with the rank once you have it:

- Over the **reals**, when do I declare a pivot "zero"? How does the tolerance interact with rounding?
- Over **Z/pZ**, how do I divide (there is no `1/x` — I need the modular inverse)?
- Over **GF(2)**, how do bitsets make rank computation ~64× faster, and why is GF(2) rank the *same thing* as the size of an XOR basis?
- Given the rank, can I **decide whether a linear system has a solution** — and how many?
- For a GF(2) system, why is the number of solutions exactly **`2^(n − rank)`**?

These are the questions that turn "I can compute a number" into "I can use rank to answer real problems about independence, span, and solvability."

The good news: the elimination *code* barely changes across all of this. What changes is the **field arithmetic** (two small details) and the **interpretation** of the rank you get back. Master those and one routine serves every variant.

---

## Deeper Concepts

### Rank, restated three ways

For an `m × n` matrix `A`, the following are all equal — this is the central fact:

```
rank(A) = number of independent rows
        = number of independent columns      (row rank = column rank)
        = number of nonzero pivots in REF
        = dimension of the row space
        = dimension of the column space
```

The proof that row rank equals column rank lives in [`professional.md`](./professional.md). Practically, this means you may reduce by rows (the usual way) and trust the pivot count regardless.

### Pivots and free columns

After reduction, columns split into two kinds:

- **Pivot columns** — each holds a pivot; there are exactly `rank` of them.
- **Free columns** — no pivot; there are `n − rank` of them.

This split is the engine behind everything below: the free columns correspond to **free variables** when you solve a system, and their count `n − rank` is the **nullity**. Hold onto that number.

### The "what is zero" question is the whole game

The elimination skeleton is identical across fields. The *only* thing that changes is:

1. how you **test for zero** (exact equality vs `|x| < eps`), and
2. how you **divide** (real division vs modular inverse vs nothing-needed in GF(2)).

Get those two right for your field and the rank is correct.

---

## Three Fields: Reals vs Z/pZ vs GF(2)

### Over the Reals (tolerance)

You compare `|value| < eps` to decide an entry is zero. Two failure directions:

- **`eps` too small** → rounding noise (like `3e-16`) is mistaken for a real pivot → rank reported **too high**.
- **`eps` too large** → a genuine but small pivot is zeroed out → rank reported **too low**.

Best practice: use **partial pivoting** (pick the largest-magnitude candidate as the pivot) so pivots stay as large as possible, and scale `eps` by the matrix's magnitude. The honest truth: over noisy real data, rank is *ambiguous*, and the principled tool is the **numerical rank from the SVD** (count singular values above a threshold) — see senior level.

### Over Z/pZ (exact, modular inverse)

Pick a prime `p`. Reduce every entry mod `p`. "Zero" means exactly `0`. The subtlety is **division**: to eliminate, you scale the pivot row by `1/pivot`, but `1/pivot` mod `p` is the **modular inverse** `pivot^(p−2) mod p` (Fermat) or via the extended Euclidean algorithm (sibling `06-extended-euclidean-modular-inverse`). With that, elimination is *exact* — no rounding, ever. This is the right choice when you need a provably correct rank.

> **Caveat:** the rank can depend on `p`. A matrix may be full rank over the rationals but rank-deficient mod a particular `p` if `p` divides the determinant of a sub-block. For a "generic" rank, use a large random prime (or two) — see senior level.

### Over GF(2) = Z/2Z (XOR, bitset-fast)

The smallest field: values are 0 and 1, addition is **XOR**, multiplication is **AND**, and division is trivial (the only nonzero element is 1, whose inverse is 1). Elimination becomes: find a row with a 1 in the current column, then **XOR** it into every other row that also has a 1 there. No inverses, no tolerance — the cleanest case.

The killer optimization: pack each row into machine words (a **bitset**). XOR-ing two rows is then a word-parallel XOR processing 64 bits per instruction, giving an `O(n² m / 64)` algorithm — about 64× faster than bit-at-a-time. This is the standard way to compute rank of large GF(2) systems (think thousands of variables in cryptography and coding theory).

### A note on the bitset speedup

Packing 64 bits per word means one XOR instruction does the work of 64 single-bit XORs. For a `1000 × 1000` GF(2) matrix this turns ~`10⁹` bit operations into ~`1.6×10⁷` word operations — the difference between a noticeable pause and an instant result. In Python you get this for free: a row stored as one big integer XORs in a single `^` regardless of width, so `cur ^ b` already processes the whole row at once. In Go/Java you allocate `uint64[]` per row and XOR word by word.

### GF(2) rank = XOR-basis size

Here is the connection to sibling `18-bit-manipulation`. An **XOR basis** (a.k.a. linear basis) is built by inserting numbers one at a time, reducing each by the current basis vectors (XOR-ing out leading bits), and keeping it if anything survives. The **number of vectors kept is exactly the GF(2) rank** of the matrix whose rows are those numbers. So:

```
size of XOR basis of a set of vectors  ==  rank over GF(2) of the matrix of those vectors
```

The XOR-basis insertion *is* GF(2) Gaussian elimination, just streamed one row at a time and stored compactly as integers.

---

## Rank-Nullity Theorem

The single most useful identity built on rank:

> **rank(A) + nullity(A) = n**, where `n` is the **number of columns** and **nullity** is the dimension of the null space (the space of vectors `x` with `A x = 0`).

In pivot language: `n` columns split into `rank` pivot columns and `n − rank` free columns, and each free column gives one independent solution direction of `A x = 0`. So:

```
nullity = n − rank          (number of free variables)
```

Why it matters:

- It tells you **how many free parameters** a homogeneous system `A x = 0` has: `n − rank`.
- Over GF(2) it directly gives the **solution count** of a system (next section): each free variable doubles the count.
- It is the bridge from "how independent are my columns" to "how big is the solution set."

A worked instance: a `3 × 4` matrix of rank 2 has nullity `4 − 2 = 2` — the homogeneous system has a 2-dimensional solution space (two free variables). Note nullity counts against **columns** (`n`), never rows — a common slip.

### Worked rank-nullity check

Take

```
A = [ 1  2  0  1 ]
    [ 0  0  1  1 ]
```

This is already in row-echelon form with pivots in columns 0 and 2, so `rank = 2`. Columns 1 and 3 are free, so `nullity = 4 − 2 = 2`. Solving `A x = 0`: `x₀ = −2x₁ − x₃` and `x₂ = −x₃`, with `x₁, x₃` free. Setting `(x₁, x₃) = (1, 0)` gives `(−2, 1, 0, 0)`; setting `(0, 1)` gives `(−1, 0, −1, 1)`. Two independent null-space vectors, matching `nullity = 2`, and `rank + nullity = 2 + 2 = 4 = n` ✓. This pick-a-free-variable, back-solve, verify `A w = 0` recipe is exactly how you both *construct* the null space and *test* a rank implementation.

### Why nullity uses columns, not rows

The map `A : F^n → F^m` sends the `n`-dimensional input space to the `m`-dimensional output space. The null space (vectors killed to zero) lives in the **input** space `F^n`, so its dimension is bounded by `n`, and rank + nullity balances against `n`. A matrix with 2 rows and 5 columns can have nullity up to `5 − rank`, never bounded by 2. Remembering "nullity lives in the domain `F^n`" is the cure for the off-by-dimension slip.

---

## Solvability via Rank (Rouché-Capelli)

To decide whether `A x = b` has a solution, compare two ranks: the rank of `A` and the rank of the **augmented matrix** `[A | b]` (the matrix `A` with `b` glued on as an extra column). This is the **Rouché-Capelli theorem** (full proof in [`professional.md`](./professional.md), and the elimination engine is sibling `17-gaussian-elimination`):

| Condition | Meaning |
|-----------|---------|
| `rank(A) < rank([A | b])` | **No solution** (inconsistent). Gluing `b` on raised the rank, so `b` is *not* in the column space of `A`. |
| `rank(A) == rank([A | b]) == n` | **Exactly one solution** (`n` = number of unknowns; no free variables). |
| `rank(A) == rank([A | b]) < n` | **Infinitely many** (over an infinite field) / **`field^(n−rank)`** (over a finite field) — there are `n − rank` free variables. |

The intuition: `rank([A | b]) > rank(A)` means appending `b` created a brand-new pivot in the last column — a "0 = 1" contradiction row in echelon form — so the system is inconsistent. If no new pivot appears, `b` is a combination of `A`'s columns and a solution exists; the number of free variables (`n − rank`) then decides "one" vs "many."

This is the practical payoff of rank: **one rank comparison tells you everything about solvability.**

---

## Counting Solutions Over GF(2)

Over a **finite** field the "infinitely many" case becomes a precise count. Over **GF(2)** specifically, if the system `A x = b` (with `n` unknowns) is consistent — that is, `rank(A) == rank([A | b])` — then the number of solutions is exactly:

```
number of solutions = 2^(n − rank(A))
```

Why? After reduction there are `rank` pivot variables, each *determined* by the free variables, and `n − rank` **free variables**, each of which can independently be 0 or 1. With `n − rank` independent binary choices, the total is `2^(n − rank)`. (The proof is in [`professional.md`](./professional.md); it is rank-nullity applied over GF(2): nullity `= n − rank`, and a GF(2) space of dimension `d` has exactly `2^d` elements.)

Special cases:

- If `rank(A) < rank([A | b])` → **0 solutions** (inconsistent).
- If `rank == n` and consistent → `2^0 = 1` **unique** solution.
- If `rank < n` and consistent → `2^(n − rank)` solutions, e.g. rank 5 with 8 unknowns → `2^3 = 8` solutions.

Over a general finite field GF(q) the same argument gives `q^(n − rank)` solutions; GF(2) is the `q = 2` case, the one that shows up in XOR puzzles ("Lights Out", linear cryptanalysis, error-correcting codes).

### Worked GF(2) solution count

System over GF(2), `n = 3` unknowns:

```
x₀ ⊕ x₁      = 1
       x₁ ⊕ x₂ = 0
```

`A = [[1,1,0],[0,1,1]]`, `b = (1, 0)`. Row-reducing the augmented `[A|b]`: both rows have pivots (columns 0 and 1), `rank(A) = 2 = rank([A|b])`, so it is **consistent**. Number of solutions `= 2^(n − rank) = 2^(3 − 2) = 2`. Check by hand: `x₂` free; `x₂ = 0 ⇒ x₁ = 0 ⇒ x₀ = 1` giving `(1,0,0)`; `x₂ = 1 ⇒ x₁ = 1 ⇒ x₀ = 0` giving `(0,1,1)`. Exactly 2 — the formula and enumeration agree. A consistency failure (say change `b` so a `0 = 1` row appears) would give `rank([A|b]) = 3 > 2` and **0** solutions.

### Sanity rule: counts are 0 or a power of q

Over GF(q), the solution count is always either `0` (inconsistent) or `q^d` for some `d = n − rank`. So over GF(2) a valid count is `0, 1, 2, 4, 8, …` — never `3` or `5`. If your solver ever reports a non-power-of-2 count over GF(2), there is a bug. This is one of the cheapest correctness checks available and follows directly from the null-space-coset structure.

---

## Code Examples

### Rank over Z/pZ (exact, with modular inverse)

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func power(a, e, mod int64) int64 {
	res := int64(1)
	a %= mod
	for e > 0 {
		if e&1 == 1 {
			res = res * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return res
}

func inv(a, mod int64) int64 { return power(a, mod-2, mod) } // Fermat inverse

func rankModP(mat [][]int64, mod int64) int {
	m := len(mat)
	if m == 0 {
		return 0
	}
	n := len(mat[0])
	rowPivot := 0
	for col := 0; col < n && rowPivot < m; col++ {
		sel := -1
		for r := rowPivot; r < m; r++ {
			if mat[r][col]%mod != 0 {
				sel = r
				break
			}
		}
		if sel == -1 {
			continue // no pivot in this column
		}
		mat[rowPivot], mat[sel] = mat[sel], mat[rowPivot]
		pivInv := inv(mat[rowPivot][col], mod)
		for r := 0; r < m; r++ {
			if r == rowPivot || mat[r][col]%mod == 0 {
				continue
			}
			factor := mat[r][col] * pivInv % mod
			for c := col; c < n; c++ {
				mat[r][c] = ((mat[r][c]-factor*mat[rowPivot][c])%mod + mod) % mod
			}
		}
		rowPivot++
	}
	return rowPivot
}

func main() {
	A := [][]int64{{1, 2, 3}, {2, 4, 6}, {0, 1, 1}}
	fmt.Println("rank mod p =", rankModP(A, MOD)) // 2
}
```

#### Java

```java
public class RankModP {
    static final long MOD = 1_000_000_007L;

    static long power(long a, long e, long mod) {
        long res = 1; a %= mod;
        while (e > 0) {
            if ((e & 1) == 1) res = res * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return res;
    }

    static long inv(long a, long mod) { return power(a, mod - 2, mod); }

    static int rankModP(long[][] mat, long mod) {
        int m = mat.length;
        if (m == 0) return 0;
        int n = mat[0].length, rowPivot = 0;
        for (int col = 0; col < n && rowPivot < m; col++) {
            int sel = -1;
            for (int r = rowPivot; r < m; r++)
                if (mat[r][col] % mod != 0) { sel = r; break; }
            if (sel == -1) continue;
            long[] tmp = mat[rowPivot]; mat[rowPivot] = mat[sel]; mat[sel] = tmp;
            long pivInv = inv(mat[rowPivot][col], mod);
            for (int r = 0; r < m; r++) {
                if (r == rowPivot || mat[r][col] % mod == 0) continue;
                long factor = mat[r][col] * pivInv % mod;
                for (int c = col; c < n; c++)
                    mat[r][c] = ((mat[r][c] - factor * mat[rowPivot][c]) % mod + mod) % mod;
            }
            rowPivot++;
        }
        return rowPivot;
    }

    public static void main(String[] args) {
        long[][] A = {{1, 2, 3}, {2, 4, 6}, {0, 1, 1}};
        System.out.println("rank mod p = " + rankModP(A, MOD)); // 2
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def rank_mod_p(mat, mod=MOD):
    mat = [row[:] for row in mat]
    m = len(mat)
    if m == 0:
        return 0
    n = len(mat[0])
    row_pivot = 0
    for col in range(n):
        if row_pivot >= m:
            break
        sel = next((r for r in range(row_pivot, m) if mat[r][col] % mod), None)
        if sel is None:
            continue
        mat[row_pivot], mat[sel] = mat[sel], mat[row_pivot]
        piv_inv = pow(mat[row_pivot][col], mod - 2, mod)  # Fermat inverse
        for r in range(m):
            if r == row_pivot or mat[r][col] % mod == 0:
                continue
            factor = mat[r][col] * piv_inv % mod
            for c in range(col, n):
                mat[r][c] = (mat[r][c] - factor * mat[row_pivot][c]) % mod
        row_pivot += 1
    return row_pivot


if __name__ == "__main__":
    A = [[1, 2, 3], [2, 4, 6], [0, 1, 1]]
    print("rank mod p =", rank_mod_p(A))  # 2
```

### Rank over GF(2) with bitsets (XOR-basis style)

Each row is stored as an integer; bit `c` of the integer is the GF(2) entry in column `c`. Elimination XORs rows. The basis size equals the GF(2) rank.

#### Python

```python
def gf2_rank(rows):
    """rows: list of ints, each int is one row's bits. Returns rank over GF(2)."""
    basis = []                      # each entry has a distinct leading bit
    for r in rows:
        cur = r
        for b in basis:
            cur = min(cur, cur ^ b) # reduce by XOR-ing out higher leading bits
        if cur:
            basis.append(cur)
            basis.sort(reverse=True)  # keep leading bits ordered (optional)
    return len(basis)               # rank == XOR-basis size


if __name__ == "__main__":
    # rows 0b110, 0b011, 0b101 -> 0b101 = 0b110 ^ 0b011, so rank is 2
    print(gf2_rank([0b110, 0b011, 0b101]))  # 2
```

#### Go

```go
package main

import "fmt"

// gf2Rank returns the GF(2) rank of rows given as bitmasks.
func gf2Rank(rows []uint64) int {
	var basis []uint64
	for _, r := range rows {
		cur := r
		for _, b := range basis {
			if cur^b < cur {
				cur ^= b
			}
		}
		if cur != 0 {
			basis = append(basis, cur)
		}
	}
	return len(basis)
}

func main() {
	fmt.Println(gf2Rank([]uint64{0b110, 0b011, 0b101})) // 2
}
```

#### Java

```java
import java.util.*;

public class GF2Rank {
    static int gf2Rank(long[] rows) {
        List<Long> basis = new ArrayList<>();
        for (long r : rows) {
            long cur = r;
            for (long b : basis)
                if ((cur ^ b) < cur) cur ^= b;
            if (cur != 0) basis.add(cur);
        }
        return basis.size();
    }

    public static void main(String[] args) {
        System.out.println(gf2Rank(new long[]{0b110, 0b011, 0b101})); // 2
    }
}
```

---

## Comparison with Alternatives

### Rank over different fields

| Field | Zero test | Division | Speed | Exact? | Use when |
|-------|-----------|----------|-------|--------|----------|
| Reals (float) | `|x| < eps` | real `/` | `O(n³)` | No (tolerance) | numeric data, geometry |
| Z/pZ | `x % p == 0` | modular inverse | `O(n³)` × inverse cost | Yes (mod p) | exact rank, competitive programming |
| GF(2) plain | `x == 0` | none | `O(n³)` | Yes | small XOR systems |
| GF(2) bitset | `x == 0` | none | `O(n³ / 64)` | Yes | large XOR/coding/crypto systems |
| SVD (numerical rank) | `σ > threshold` | — | `O(n³)` (bigger constant) | No (robust) | noisy real data, ML |

### Rank vs determinant for invertibility

| Need | Tool | Why |
|------|------|-----|
| Is a square matrix invertible? | rank `== n`, or det `≠ 0` | equivalent; rank also works for non-square |
| How independent are non-square rows? | rank | determinant is undefined for non-square |
| Solvability of `A x = b` | rank vs rank of `[A|b]` (Rouché-Capelli) | determinant alone cannot detect inconsistency |
| Count GF(2) solutions | `2^(n − rank)` | rank-nullity over a finite field |

Rank is strictly more general than the determinant: the determinant only tells you *full rank vs not* for square matrices, whereas rank gives the exact dimension for any shape.

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Float rank unstable | Tiny pivot divided into, amplifying rounding. | Partial pivoting; scale `eps` to matrix norm. |
| Wrong rank mod p | Divided by pivot instead of multiplying by its inverse. | Use modular inverse (Fermat or extended Euclid). |
| Rank depends on prime | `p` divides a minor's determinant. | Use a large random prime; recompute with a second prime. |
| Augmented rank confusion | Compared rank of `A` to itself, not to `[A|b]`. | Build `[A|b]` explicitly and compare the two ranks. |
| GF(2) overflow with arrays | Used `int` per cell wastefully. | Pack rows into `uint64` words (bitset). |
| Off-by-one in solution count | Counted against rows instead of columns. | `2^(n − rank)` uses `n` = number of unknowns (columns). |

---

## Performance Analysis

| `n` (square) | reals/Z/pZ `O(n³)` | GF(2) bitset `O(n³ / 64)` |
|--------------|--------------------|----------------------------|
| 100 | 1 M ops | ~16 K word-ops — instant |
| 500 | 125 M ops | ~2 M word-ops — instant |
| 1000 | 1 G ops — ~seconds | ~16 M word-ops — instant |
| 5000 | 125 G ops — slow | ~2 G word-ops — seconds |
| 10000 (GF(2)) | infeasible bit-at-a-time | ~16 G word-ops — feasible with bitsets |

The dominant cost everywhere is the cubic elimination. The single biggest practical win is the **GF(2) bitset** trick, which divides the constant by the machine word size (64), turning otherwise-infeasible large XOR systems into routine computations. Over Z/pZ, caching the pivot's modular inverse once per row (instead of recomputing per cell) is the main constant-factor saver.

```python
import time, random

def bench_gf2(n):
    rows = [random.getrandbits(n) for _ in range(n)]
    start = time.perf_counter()
    _ = gf2_rank(rows)
    return time.perf_counter() - start
# n=2000 finishes in a fraction of a second with Python big-int XOR (implicit bitset).
```

Python big integers act as arbitrary-width bitsets, so `cur ^ b` already processes the whole row at once — a free bitset in disguise.

---

## Best Practices

- **Pick the field deliberately:** exact answer → Z/pZ or GF(2); numeric data → reals with tolerance (or SVD for robustness).
- **Over reals, always partial-pivot** and name your `eps`; never compare floats with `==`.
- **Over Z/pZ, divide via modular inverse**, and cache the pivot inverse once per pivot row.
- **Over GF(2), use bitsets** (or Python big ints); the XOR-basis insertion *is* the elimination.
- **For solvability, compare `rank(A)` to `rank([A|b])`** — that single comparison is Rouché-Capelli.
- **For GF(2) solution counts, use `2^(n − rank)`** after confirming consistency; remember `n` is the number of unknowns.
- **Test against a brute-force oracle** (enumerate all `2^n` GF(2) assignments for small `n`) to validate the count formula.
- **Use the power-of-2 sanity rule** over GF(2): any solution count must be `0` or `2^k`; a stray non-power flags a bug instantly.
- **Copy the matrix before reducing** if the caller still needs the original — elimination is destructive and in-place.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - Each **pivot** discovered as the matrix row-reduces, and the **running pivot counter** that becomes the rank.
> - **Dependent rows collapsing to zero** (skipped, not counted).
> - An editable matrix so you can construct rank-deficient cases and watch a row vanish.

---

## Summary

The "row-reduce and count pivots" skeleton is field-agnostic; only two details change per field: **how you test for zero** (`|x| < eps` over reals, `== 0` exactly over Z/pZ and GF(2)) and **how you divide** (real `/`, modular inverse mod `p`, or nothing in GF(2)). GF(2) is special: it is XOR/AND arithmetic, bitsets make it ~64× faster, and its rank is exactly the size of an **XOR basis** (sibling `18`). On top of rank sit three load-bearing results: **rank-nullity** (`rank + nullity = n`, so nullity `= n − rank` free variables); **Rouché-Capelli** (`A x = b` is solvable iff `rank(A) == rank([A|b])`, unique iff that common rank equals `n`); and the GF(2) **solution count `2^(n − rank)`** for a consistent system. Together they turn one cheap number — the rank — into complete answers about independence, span dimension, and solvability.
