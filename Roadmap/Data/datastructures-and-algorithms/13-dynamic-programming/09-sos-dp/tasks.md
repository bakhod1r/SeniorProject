# Sum over Subsets DP (SOS DP) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the SOS / zeta / Möbius logic and validate against the evaluation criteria.
> **Always test against a brute-force `O(3^n)` submask oracle (and the `Möbius(zeta(A)) == A` round-trip) on small inputs before trusting the SOS result.**

---

## Beginner Tasks (5)

### Task 1 — Single bit relaxation pass

**Problem.** Implement `relaxBit(F, n, i)` that performs **one** SOS subset-zeta pass for bit `i`: for every mask with bit `i` set, do `F[mask] += F[mask ^ (1<<i)]`. This is the atomic step of SOS DP.

**Input / Output spec.**
- Read `n`, `i`, then `F` (`2^n` integers).
- Print `F` after the single pass, space-separated.

**Constraints.**
- `1 ≤ n ≤ 16`, `0 ≤ i < n`, entries fit in 64-bit.

**Hint.** Hoist `bit = 1 << i`. Only masks with `mask & bit != 0` change.

**Starter — Go.**
```go
package main

import "fmt"

func relaxBit(F []int64, n, i int) {
	// TODO: bit = 1<<i; for each mask with that bit set, F[mask] += F[mask^bit]
}

func main() {
	var n, i int
	fmt.Scan(&n, &i)
	F := make([]int64, 1<<n)
	for k := range F {
		fmt.Scan(&F[k])
	}
	relaxBit(F, n, i)
	for k, v := range F {
		if k > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static void relaxBit(long[] F, int n, int i) {
        // TODO
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), i = sc.nextInt();
        long[] F = new long[1 << n];
        for (int k = 0; k < F.length; k++) F[k] = sc.nextLong();
        relaxBit(F, n, i);
        StringBuilder sb = new StringBuilder();
        for (int k = 0; k < F.length; k++) {
            if (k > 0) sb.append(' ');
            sb.append(F[k]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys


def relax_bit(F, n, i):
    # TODO
    pass


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data)); i = int(next(data))
    F = [int(next(data)) for _ in range(1 << n)]
    relax_bit(F, n, i)
    print(" ".join(map(str, F)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Only masks with bit `i` set change.
- Matches a hand calculation on `n = 2`.
- `bit` hoisted out of the loop.

---

### Task 2 — Full subset-sum transform (zeta)

**Problem.** Given `n` and `A` of length `2^n`, output `F[mask] = Σ_{sub ⊆ mask} A[sub]` for all masks, mod `10^9 + 7`. Use the full SOS DP (sweep all `n` bits).

**Input / Output spec.**
- Read `n`, then `A`. Print `F` space-separated.

**Constraints.** `0 ≤ n ≤ 20`, entries in `[0, p)`.

**Hint.** Bit loop outer, mask loop inner; reduce mod `p` after each `+=`. Remember `F[0] = A[0]` and `F[full] = ΣA`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_subset_sum(A, n):
    MOD = 10**9 + 7
    F = [0] * (1 << n)
    for mask in range(1 << n):
        sub = mask
        while True:
            F[mask] = (F[mask] + A[sub]) % MOD
            if sub == 0:
                break
            sub = (sub - 1) & mask
    return F
```

**Evaluation criteria.**
- Matches `brute_subset_sum` for small `n`.
- `F[full mask] == Σ A (mod p)`.
- `O(n · 2^n)`.

---

### Task 3 — Superset-sum transform

**Problem.** Given `n` and `A`, output `G[mask] = Σ_{sup ⊇ mask} A[sup]` for all masks, mod `10^9 + 7`.

**Input / Output spec.**
- Read `n`, then `A`. Print `G` space-separated.

**Constraints.** `0 ≤ n ≤ 20`.

**Hint.** Masks with bit `i` *clear* absorb from `mask | (1<<i)`. Sanity: `G[0]` is the grand total; `G[full] = A[full]`.

**Worked check.** For `n=2, A=[1,2,3,4]`: `G = [10, 6, 7, 4]` (`G[0]=1+2+3+4`, `G[01]=A1+A3=2+4`, `G[10]=A2+A3=3+4`, `G[11]=A3=4`).

**Evaluation criteria.**
- `G[0] == Σ A`, `G[full] == A[full]`.
- Matches a brute-force superset enumeration for small `n`.

---

### Task 4 — Möbius inverse round trip

**Problem.** Implement both `subsetZeta(A, n)` and `subsetMobius(F, n)` (subtract version), and verify that `subsetMobius(subsetZeta(A)) == A` for random `A`. Work mod `10^9 + 7` and normalize negative residues.

**Input / Output spec.**
- Read `n`, then `A`. Print `subsetMobius(subsetZeta(A))`; it must equal `A mod p`.

**Constraints.** `0 ≤ n ≤ 18`.

**Hint.** Zeta adds the bit-cleared neighbor; Möbius subtracts it. Normalize with `((x % p) + p) % p` after subtraction (Go/Java).

**Evaluation criteria.**
- The round trip reproduces `A` exactly (mod `p`).
- Negative residues are normalized.
- Both functions are `O(n · 2^n)`.

---

### Task 5 — Brute-force oracle and equality test

**Problem.** Implement `brute_subset_sum(A, n)` (the `O(3^n)` per-mask enumeration) and `sos(A, n)` (the `O(n·2^n)` DP), and assert they are equal for many random `A` and `n ≤ 8`.

**Input / Output spec.**
- For `n = 0..8`, generate random `A`, compute both, and print `OK` if equal for all, else the first mismatching mask.

**Constraints.** `0 ≤ n ≤ 8`.

**Hint.** Use the `(sub-1)&mask` submask enumeration for the oracle.

**Evaluation criteria.**
- Both methods agree on all tested inputs.
- The oracle correctly enumerates submasks (including `0`).
- Clear `OK` / mismatch report.

---

## Intermediate Tasks (5)

### Task 6 — OR-convolution

**Problem.** Given `n`, `A`, `B` of length `2^n`, compute `C[m] = Σ_{i | j = m} A[i]·B[j]` mod `10^9 + 7`. Use subset-zeta both, multiply pointwise, subset-Möbius.

**Constraints.** `0 ≤ n ≤ 18`, entries in `[0, p)`.

**Reference oracle (Python).**
```python
def brute_or_conv(A, B, n):
    MOD = 10**9 + 7
    C = [0] * (1 << n)
    for i in range(1 << n):
        for j in range(1 << n):
            C[i | j] = (C[i | j] + A[i] * B[j]) % MOD
    return C
```

**Hint.** `zeta(A ⊛_OR B) = zeta(A) · zeta(B)` pointwise; Möbius the product to recover `C`.

**Evaluation criteria.**
- Matches `brute_or_conv` for small `n`.
- One pair of forward transforms, one pointwise multiply, one inverse.
- `O(n · 2^n)`.

---

### Task 7 — AND-convolution

**Problem.** Given `n`, `A`, `B`, compute `C[m] = Σ_{i & j = m} A[i]·B[j]` mod `10^9 + 7`. Use the *superset* transform pair.

**Constraints.** `0 ≤ n ≤ 18`.

**Reference oracle (Python).**
```python
def brute_and_conv(A, B, n):
    MOD = 10**9 + 7
    C = [0] * (1 << n)
    for i in range(1 << n):
        for j in range(1 << n):
            C[i & j] = (C[i & j] + A[i] * B[j]) % MOD
    return C
```

**Hint.** Superset-zeta both, multiply pointwise, superset-Möbius. Because `i & j ⊇ m ⟺ i ⊇ m ∧ j ⊇ m`.

**Evaluation criteria.**
- Matches `brute_and_conv` for small `n`.
- Uses superset (not subset) transforms.
- `O(n · 2^n)`.

---

### Task 8 — XOR-convolution (Walsh-Hadamard)

**Problem.** Given `n`, `A`, `B`, compute `C[m] = Σ_{i ^ j = m} A[i]·B[j]`. Use the Walsh-Hadamard transform (exact integers — values may be negative).

**Constraints.** `0 ≤ n ≤ 16`, integer entries.

**Reference oracle (Python).**
```python
def brute_xor_conv(A, B, n):
    C = [0] * (1 << n)
    for i in range(1 << n):
        for j in range(1 << n):
            C[i ^ j] += A[i] * B[j]
    return C
```

**Hint.** Butterfly `(x, y) → (x+y, x-y)` per bit; forward both, multiply pointwise, apply WHT again, then divide every entry by `2^n`. (For modular versions, multiply by the modular inverse of `2^n`.)

**Evaluation criteria.**
- Matches `brute_xor_conv` for small `n`.
- The inverse WHT divides by `2^n` exactly.
- `O(n · 2^n)`.

---

### Task 9 — Count supersets present (capability query)

**Problem.** Given `n`, an array of `m` masks (each `< 2^n`) representing users' capability sets, and `Q` query masks, answer for each query: how many users have *all* the capabilities in the query (and possibly more) — i.e. how many user masks are supersets of the query.

**Constraints.** `1 ≤ n ≤ 20`, `1 ≤ m, Q ≤ 2·10^5`.

**Hint.** Build `cnt[mask]` from the users, superset-zeta it once (`O(n·2^n)`), then each query is an `O(1)` read of `G[queryMask]`.

**Evaluation criteria.**
- Precompute done once; each query `O(1)`.
- Matches a brute-force "count users that are supersets" for small inputs.
- Handles duplicate user masks (the count accumulates).

---

### Task 10 — Inclusion-exclusion via Möbius

**Problem.** Given `n` and `g[mask]` = "number of objects satisfying at least the properties in `mask`" (`g = superset-zeta` of the exact counts), recover `f[mask]` = "number of objects satisfying exactly the properties in `mask`" using the superset Möbius. Then output `f[0]` = number of objects with none of the properties.

**Constraints.** `0 ≤ n ≤ 18`.

**Hint.** `f[mask] = Σ_{sup ⊇ mask} (-1)^{popcount(sup)-popcount(mask)} g[sup]`, computed by the superset-Möbius sweep (subtract the bit-set neighbor). Validate against direct signed inclusion-exclusion for small `n`.

**Evaluation criteria.**
- `f[0]` matches the classic IE count "none of the properties".
- The Möbius sweep reproduces the explicit `(-1)^{Δpopcount}` signed sum.
- `O(n · 2^n)`.

---

## Advanced Tasks (5)

### Task 11 — CRT-combined exact subset sum across two primes

**Problem.** Compute the exact `F[mask] = Σ_{sub ⊆ mask} A[sub]` when totals may exceed `10^9 + 7`. Run SOS under two coprime primes (`10^9+7`, `998244353`) and reconstruct each entry via CRT.

**Constraints.** `0 ≤ n ≤ 20`. Guarantee the true total fits below `p₁·p₂`.

**Hint.** Run the identical zeta twice (once per prime); apply the two-prime CRT per mask. The two runs are independent and parallelizable.

**Two-prime CRT (Python).**
```python
def crt2(r1, p1, r2, p2):
    inv = pow(p1, -1, p2)
    t = ((r2 - r1) * inv) % p2
    return r1 + p1 * t            # in [0, p1*p2)
```

**Evaluation criteria.**
- Recovers totals larger than a single prime for small `n` where the true sum is known.
- Both modular runs agree with `(true total) mod pᵢ`.
- CRT output equals the exact integer when it fits below `p₁·p₂`.

---

### Task 12 — Disjoint subset-sum convolution (popcount-ranked)

**Problem.** Given `n`, `A`, `B`, compute the **disjoint** convolution `C[m] = Σ_{i | j = m, i & j = 0} A[i]·B[j]` mod `10^9 + 7`. Use the popcount-ranked algorithm (`O(n^2 · 2^n)`).

**Constraints.** `0 ≤ n ≤ 18`.

**Reference oracle (Python).**
```python
def brute_subset_conv(A, B, n):
    MOD = 10**9 + 7
    C = [0] * (1 << n)
    for i in range(1 << n):
        for j in range(1 << n):
            if i & j == 0:
                C[i | j] = (C[i | j] + A[i] * B[j]) % MOD
    return C
```

**Hint.** Split into `n+1` rank slices by popcount, subset-zeta each rank, convolve ranks so `|i|+|j|` adds exactly, subset-Möbius each rank, then read rank `popcount(m)` at mask `m`. Disjointness `i&j=0` ⟺ `i|j=m ∧ |i|+|j|=|m|`.

**Evaluation criteria.**
- Matches `brute_subset_conv` for small `n`.
- Reads result rank `= popcount(m)` at each mask.
- `O(n^2 · 2^n)`.

---

### Task 13 — Min over submasks (one-way aggregation)

**Problem.** Given `n` and `A`, compute `M[mask] = min_{sub ⊆ mask} A[sub]` for all masks, using the SOS sweep with `min` instead of `+`. Document why this transform has **no** Möbius inverse.

**Constraints.** `0 ≤ n ≤ 20`.

**Hint.** Replace `F[mask] += F[mask^bit]` with `F[mask] = min(F[mask], F[mask^bit])`. The identity along each axis is `min(x, y)` — idempotent, hence not invertible.

**Evaluation criteria.**
- Matches a brute-force `min` over submasks for small `n`.
- `O(n · 2^n)`.
- A comment explains the non-invertibility (idempotent semiring, no additive inverse).

---

### Task 14 — Count pairs with submask relation

**Problem.** Given `n` and `m` integers (each `< 2^n`), count ordered pairs `(x, y)` with `x & y == x` (`x` is a submask of `y`), including `x == y`. Return the count.

**Constraints.** `1 ≤ n ≤ 20`, `1 ≤ m ≤ 5·10^5`.

**Hint.** Build `cnt[v]`, superset-zeta it to get `sup[v]` = number of array elements that are supersets of `v`; the answer is `Σ_x sup[x]` over array elements `x`. `O(n·2^n + m)`.

**Reference oracle (Python).**
```python
def brute_count_pairs(vals, n):
    return sum(1 for x in vals for y in vals if x & y == x)
```

**Evaluation criteria.**
- Matches `brute_count_pairs` for small inputs.
- Single superset-zeta precompute; linear pass over the array.
- Correctly counts `x == y` pairs (a mask is its own superset).

---

### Task 15 — Decide whether SOS is the right tool

**Problem.** You are given a problem statement and must decide whether SOS / a set transform applies. Implement `classify(n, relation, need)` (or write a short analysis) returning one of: `SUBSET_ZETA`, `SUPERSET_ZETA`, `MOBIUS_IE`, `OR_CONV`, `AND_CONV`, `XOR_CONV`, `SUBSET_SUM_CONV`, `TOO_LARGE`, or `WRONG_STRUCTURE`. Justify each.

**Constraints / cases to handle.**
- Aggregate over submasks, `n ≤ 22` → `SUBSET_ZETA`.
- Aggregate over supersets → `SUPERSET_ZETA`.
- Recover exact-property counts from at-least counts → `MOBIUS_IE`.
- `Σ_{i|j=m}` / `Σ_{i&j=m}` / `Σ_{i^j=m}` → `OR_CONV` / `AND_CONV` / `XOR_CONV`.
- Partition into disjoint pieces → `SUBSET_SUM_CONV`.
- `n ≥ 24` (memory blows up) → `TOO_LARGE`.
- Aggregate over a non-containment relation → `WRONG_STRUCTURE`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The traps: large `n` (memory `2^n`), and OR-convolution where the disjoint subset-sum convolution is actually needed.

**Evaluation criteria.**
- Correctly classifies all canonical cases.
- The `TOO_LARGE` branch cites the `2^n` memory wall.
- The `SUBSET_SUM_CONV` branch notes OR-conv over-counts overlapping pairs.

---

## Benchmark Task

### Task B — Naive `O(3^n)` vs SOS `O(n·2^n)` crossover

**Problem.** Empirically compare naive submask enumeration against SOS DP across `n`. Implement two workloads on a random length-`2^n` array (fixed seed):

- **(a) Naive:** for each mask, enumerate submasks via `(sub-1)&mask` — `O(3^n)`.
- **(b) SOS DP:** the bit sweep — `O(n·2^n)`.

Measure wall-clock time for `n ∈ {8, 10, 12, 14, 16, 18}` (use SOS for `n ≥ 18`; the naive method becomes infeasible). Report a table and confirm SOS dominates for all but the tiniest `n`.

**Starter — Python.**
```python
import random
import time
from typing import List

MOD = 10**9 + 7


def gen_array(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(0, MOD - 1) for _ in range(1 << n)]


def naive_subset_sum(A, n):
    # TODO: per-mask (sub-1)&mask enumeration, O(3^n)
    return [0] * (1 << n)


def sos(A, n):
    # TODO: bit sweep, O(n * 2^n)
    return A[:]


def bench(fn, A, n) -> float:
    start = time.perf_counter()
    fn(A, n)
    return time.perf_counter() - start


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    print("n     naive_ms        sos_ms")
    for n in [8, 10, 12, 14, 16, 18]:
        A = gen_array(n, 42)
        rb = [bench(sos, A[:], n) for _ in range(3)]
        if n <= 16:
            ra = [bench(naive_subset_sum, A[:], n) for _ in range(3)]
            print(f"{n:<5d} {mean_ms(ra):<15.2f} {mean_ms(rb):<12.2f}")
        else:
            print(f"{n:<5d} {'(skipped)':<15} {mean_ms(rb):<12.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- SOS (b) dominates the naive method (a) for all but the smallest `n`; report the measured ratios.
- SOS completes `n = 18` in well under a second (compiled); naive is infeasible there.
- Report the mean across at least 3 runs and does not time array generation.
- Writeup: a short note comparing the measured ratio to the theoretical `(1.5)^n / n`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every task above ships with (or references) a slow `O(3^n)` oracle or brute-force convolution. Run it on small `n`, diff entrywise, and only then trust SOS on large `n`.
- **Pin the modulus as a named constant.** Use `MOD = 10^9 + 7`; never inline magic numbers.
- **Get the loop order right.** Bit loop **outer**, mask loop **inner** — required for in-place correctness.
- **Get the direction right.** Subset: set-bit mask pulls from `mask ^ bit`. Superset: clear-bit mask pulls from `mask | bit`. Zeta adds; Möbius subtracts.
- **Mind overflow and negatives.** In Go/Java promote to 64-bit for convolution products and normalize negative residues after Möbius with `((x % p) + p) % p`.
- **Watch the `2^n` memory wall.** SOS is feasible only for `n ≤ ~22`. If a task secretly needs larger `n`, the answer is "SOS is the wrong tool" (Task 15).
- **Use the round-trip test.** `Möbius(zeta(A)) == A` catches sign and direction bugs that uniform-data tests miss.

## Suggested Progression

Work the tasks roughly in this order to build the concepts incrementally:

1. **Tasks 1–2** establish the atomic bit relaxation and the full subset transform. Get these byte-for-byte correct against the oracle before anything else.
2. **Task 3** introduces the superset direction; **Task 4** the Möbius inverse. Together they cement "direction × sign = four operations".
3. **Task 5** is the validation discipline (oracle equality) you will reuse for every later task.
4. **Tasks 6–8** are the three classic convolutions (OR, AND, XOR). Notice how OR/AND reuse zeta/Möbius while XOR needs the Walsh-Hadamard butterfly.
5. **Tasks 9–10** are real applications: superset counting and inclusion-exclusion via Möbius.
6. **Tasks 11–14** are the advanced layer: CRT for exact large values, the disjoint subset-sum convolution, the non-invertible min-zeta, and submask-pair counting.
7. **Task 15** is the meta-skill: deciding whether SOS even applies — the most valuable judgment in practice.
8. **Task B** is the empirical payoff: see the `3^n → n·2^n` speedup with your own measurements.

## Self-Check Invariants for Every Task

Regardless of the specific task, these assertions should hold and are worth wiring into your tests:

- `zeta(A)[0] == A[0]` and `zeta(A)[full] == Σ A` (subset direction).
- `supersetZeta(A)[0] == Σ A` and `supersetZeta(A)[full] == A[full]`.
- `subsetMobius(subsetZeta(A)) == A` for any `A` (the round trip).
- A convolution result matches its `O(4^n)` brute-force oracle on small `n`.
- All three language implementations produce identical output on the same seeded input.
- The partial transform after `i+1` passes equals "sum over submasks differing only in bits `0..i`" (the invariant from the professional file) — assert this to localize which pass introduced a bug.
- The min-zeta (Task 13) is *not* invertible: confirm that two distinct inputs can map to the same `M`, so no Möbius exists for it.

## A Final Word on Discipline

The single highest-leverage habit across all of these tasks is to **write the brute-force oracle first** and keep it. SOS bugs (wrong direction, wrong sign, off-by-one in size, overflow) produce *plausible* numbers, not crashes, so they evade casual inspection. An oracle that recomputes the answer the slow, obviously-correct way for `n ≤ 8`, diffed entrywise against your fast version, catches essentially all of them in seconds. Pair it with the `Möbius(zeta(A)) == A` round-trip and a non-uniform test input, and you have a safety net strong enough to trust the fast path on `n = 20`.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
