# Garner's Algorithm (Mixed-Radix CRT Reconstruction) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Garner / mixed-radix reconstruction logic and validate against the evaluation criteria.
> **Always test against a brute-force CRT oracle on small inputs, or a round-trip `garner(to_rns(x)) == x`, before trusting the reconstruction.**

---

## Beginner Tasks (5)

### Task 1 — Modular inverse helper

**Problem.** Implement `modInverse(a, m)` returning `a^{-1} mod m` for `gcd(a, m) = 1`, using the extended Euclidean algorithm (do not rely on a library inverse). This is the building block every Garner step needs.

**Input / Output spec.**
- Read two integers `a`, `m`.
- Print `a^{-1} mod m` in `[0, m)`.

**Constraints.**
- `1 ≤ a < m ≤ 10^9`, `gcd(a, m) = 1`.

**Hint.** Extended Euclid returns `g, x, y` with `a·x + m·y = g`. When `g = 1`, the inverse is `((x % m) + m) % m`.

**Starter — Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x, y := extgcd(b, a%b)
	return g, y, x - (a/b)*y
}

func modInverse(a, m int64) int64 {
	// TODO: use extgcd; normalize into [0, m)
	return 0
}

func main() {
	var a, m int64
	fmt.Scan(&a, &m)
	fmt.Println(modInverse(a, m))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static long modInverse(long a, long m) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(modInverse(sc.nextLong(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y


def mod_inverse(a, m):
    # TODO
    return 0


if __name__ == "__main__":
    a, m = map(int, input().split())
    print(mod_inverse(a, m))
```

**Evaluation criteria.**
- `modInverse(3, 5) = 2`, `modInverse(2, 7) = 4`.
- Result is always in `[0, m)`.
- Uses extended Euclid (no brute-force search).

---

### Task 2 — Two-modulus CRT merge

**Problem.** Given two congruences `x ≡ r0 (mod p0)` and `x ≡ r1 (mod p1)` with `gcd(p0, p1) = 1`, return the unique `x ∈ [0, p0·p1)`. This is Garner with `k = 2`.

**Input / Output spec.**
- Read `r0, p0, r1, p1`.
- Print `x`.

**Constraints.** `0 ≤ r0 < p0`, `0 ≤ r1 < p1`, `p0·p1` fits in 64-bit.

**Hint.** `a0 = r0`; `a1 = (r1 − a0)·(p0)^{-1} mod p1`; `x = a0 + a1·p0`.

**Worked check.** `r0=2, p0=3, r1=3, p1=5` → `a0=2`, `a1=(3−2)·inv(3,5)=1·2=2`, `x=2+2·3=8`. Indeed `8 mod 3 = 2`, `8 mod 5 = 3`.

**Evaluation criteria.**
- Matches a brute-force scan over `[0, p0·p1)` for small inputs.
- `x` is in `[0, p0·p1)`.
- Correct use of the modular inverse of `p0` mod `p1`.

---

### Task 3 — Full Garner reconstruction into a big integer

**Problem.** Given pairwise-coprime moduli `p[]` and residues `r[]`, return the unique `x` as a big integer (the product may exceed 64-bit).

**Input / Output spec.**
- Read `k`, then `k` moduli, then `k` residues.
- Print `x`.

**Constraints.** `1 ≤ k ≤ 20`, moduli pairwise coprime, each `< 10^9`.

**Hint.** Solve the mixed-radix digits with the inner partial/prefix loop, then assemble `x = Σ a_i W_i` using your language's big-integer type.

**Reference oracle (Python) — use this to validate.**
```python
from math import prod

def brute_crt(r, p):
    P = prod(p)
    for x in range(min(P, 2_000_000)):
        if all(x % p[i] == r[i] for i in range(len(p))):
            return x
    return None  # only for small P
```

**Evaluation criteria.**
- `garner([2,3,2], [3,5,7]) = 23`.
- Matches `brute_crt` for small products.
- `k = 1` returns `r[0]`.

---

### Task 4 — Reconstruct x mod M without big integers

**Problem.** Given residues `r[]`, pairwise-coprime moduli `p[]`, and a target modulus `M`, return `x mod M` using only machine-word arithmetic (no big integers).

**Input / Output spec.**
- Read `M`, `k`, then moduli, then residues.
- Print `x mod M`.

**Constraints.** `1 ≤ k ≤ 30`, moduli `< 2^{31}`, `M < 2^{31}`.

**Hint.** Solve digits as usual (mod `p_i`), then accumulate the sum `Σ a_i (W_i mod M)` mod `M`, updating the weight `W_i mod M` incrementally.

**Worked check.** `r=[2,3,2], p=[3,5,7], M=10` → `x = 23`, so output `3`.

**Evaluation criteria.**
- Equals `garner(r, p) mod M` (cross-check against Task 3).
- No big integers used.
- Correct incremental weight `W_i mod M`.

---

### Task 5 — Convert an integer to and from residues (round trip)

**Problem.** Implement `to_rns(x, p)` (residue tuple) and verify `garner(to_rns(x, p), p) == x` for all `x ∈ [0, P)` on small primes. This is the fundamental correctness identity.

**Input / Output spec.**
- Read `k`, the moduli, and an integer `x` (with `0 ≤ x < ∏ p`).
- Print the residue tuple, then the reconstructed value (should equal `x`).

**Constraints.** `1 ≤ k ≤ 6`, product `≤ 10^6` (so an exhaustive round-trip test is feasible).

**Hint.** `to_rns(x, p) = [x % pi for pi in p]`. Loop `x` over `[0, P)` and assert the round trip.

**Evaluation criteria.**
- Round trip holds for every `x ∈ [0, P)` on the test primes.
- `to_rns` produces residues in `[0, p_i)`.
- Demonstrates the bijection between `[0, P)` and residue tuples.

---

## Intermediate Tasks (5)

### Task 6 — Garner with precomputed prefix-product inverses

**Problem.** For a *fixed* set of pairwise-coprime primes, precompute the table `invW[i] = (p_0·…·p_{i-1})^{-1} mod p_i`, then reconstruct many residue tuples reusing the table (no inverse calls in the hot loop).

**Constraints.** `1 ≤ k ≤ 30`, up to `10^5` reconstructions with the same primes.

**Hint.** Build `invW` once in the constructor. The per-reconstruction digit loop becomes pure multiply-add mod `p_i`.

**Evaluation criteria.**
- Inverse table built exactly once, reused across all reconstructions.
- Each reconstruction matches plain Garner (Task 3).
- No `modInverse` call inside the per-reconstruction loop.

---

### Task 7 — Three-prime NTT coefficient combine

**Problem.** Given three fixed NTT-friendly primes `q0, q1, q2` and a coefficient's residues `(c0, c1, c2)`, return the true coefficient mod a given `M`. Use precomputed inverses.

**Constraints.** `q = [998244353, 1004535809, 985661441]`, `0 ≤ c_i < q_i`, `M < 2^{31}`. The true coefficient is `< q0·q1·q2`.

**Hint.** `a0=c0`; `a1=(c1−a0)·inv(q0,q1) mod q1`; `a2=(c2−(a0+a1 q0))·inv(q0 q1, q2) mod q2`; `x = a0 + a1 q0 + a2 q0 q1`, assembled mod `M`.

**Reference oracle (Python).**
```python
from math import prod

def brute_combine(c, q, M):
    Q = prod(q)
    for x in range(0, min(Q, 5_000_000)):
        if all(x % q[i] == c[i] for i in range(3)):
            return x % M
    return None  # small ranges only
```

**Evaluation criteria.**
- For a known coefficient `v < Q`, `combine(to_rns(v,q)) == v mod M`.
- Inverses precomputed once, not per coefficient.
- Matches `brute_combine` on small synthetic values.

---

### Task 8 — RNS add and multiply with reconstruction

**Problem.** Implement an RNS over fixed primes: `to_rns`, `rns_add`, `rns_mul`, and reconstruction. Verify `garner(rns_op(A, B)) == (A op B) mod P` for `op ∈ {+, ×}`.

**Constraints.** `1 ≤ k ≤ 8`, primes `< 2^{31}`, `A, B < P`.

**Hint.** Add/multiply componentwise mod `p_i`. Reconstruct only at the end with Garner.

**Reference oracle (Python).**
```python
from math import prod

def check_rns(A, B, p):
    P = prod(p)
    ra = [A % pi for pi in p]
    rb = [B % pi for pi in p]
    add = [(ra[i] + rb[i]) % p[i] for i in range(len(p))]
    mul = [(ra[i] * rb[i]) % p[i] for i in range(len(p))]
    return garner(add, p) == (A + B) % P and garner(mul, p) == (A * B) % P
```

**Evaluation criteria.**
- Componentwise ops give the same reconstructed result as direct arithmetic mod `P`.
- Reconstruction happens once, at the end.
- Holds for random `A, B < P`.

---

### Task 9 — Signed (centered) reconstruction

**Problem.** Reconstruct a value that may be negative: given residues of some `v ∈ [−P/2, P/2)`, return `v` (not `v mod P`). Center the Garner output.

**Constraints.** `1 ≤ k ≤ 20`, `P = ∏ p_i > 2·max|v|`.

**Hint.** Compute `x = garner(r, p) ∈ [0, P)`, then if `2x ≥ P` return `x − P`. Test with `to_rns(v % P, p)` for negative `v`.

**Worked check.** `p=[3,5,7]`, `v=−4` → residues `(−4 mod 3, −4 mod 5, −4 mod 7) = (2, 1, 3)`; Garner gives `101`; `2·101 ≥ 105`, so `101 − 105 = −4`. ✓

**Evaluation criteria.**
- Recovers negative values exactly when `P > 2·max|v|`.
- Output is in `[−P/2, P/2)`.
- Round trip: `garner_signed(to_rns(v % P, p), p) == v`.

---

### Task 10 — Detect insufficient prime product (overflow guard)

**Problem.** Implement `garner_checked(r, p, v_max)` that reconstructs `x` but raises/returns an error if `∏ p_i ≤ v_max` (so the result would wrap). This guards the most dangerous Garner bug.

**Constraints.** `1 ≤ k ≤ 30`, `v_max` up to `10^{30}` (use big integers for the product check).

**Hint.** Compute the product `P = ∏ p_i` (big integer) once and compare with `v_max` before trusting the result. The reconstruction itself is standard Garner.

**Evaluation criteria.**
- Returns/raises an error when `P ≤ v_max`.
- Returns the correct `x` when `P > v_max`.
- The product check uses big integers to avoid its own overflow.

---

## Advanced Tasks (5)

### Task 11 — Multi-prime polynomial convolution combine

**Problem.** Given two integer polynomials, compute their product's coefficients modulo a problem modulus `M`, where individual coefficients may exceed any single 32-bit prime. Compute the convolution under three NTT-friendly primes (you may use a provided NTT or a direct `O(n²)` convolution mod each prime for correctness), then Garner-combine each coefficient mod `M`.

**Constraints.** Polynomial degree `≤ 1000` (so direct convolution is acceptable), coefficients `≤ 10^9`, `M < 2^{31}`.

**Hint.** Max coefficient `≤ n·V²`; the product `q0·q1·q2 ≈ 2^{89.6}` covers it. Combine each output coefficient with precomputed inverses (Task 7). Assemble mod `M`.

**Evaluation criteria.**
- Matches a big-integer reference convolution reduced mod `M`.
- The three single-prime convolutions agree with the big-int convolution mod each prime.
- Combine uses precomputed inverses; assembly is mod `M` (no big integers in the combine).

---

### Task 12 — Base extension (add a channel without reconstructing)

**Problem.** Given an RNS number in residues over `(p_0, …, p_{k-1})`, compute its residue modulo a *new* coprime prime `p_new` **without** forming the full integer. Use Garner's mixed-radix digits.

**Constraints.** `1 ≤ k ≤ 30`, all primes `< 2^{31}`.

**Hint.** Solve the digits `a_i` (mod the existing primes), then evaluate `Σ_i a_i (W_i mod p_new) mod p_new`, maintaining `W_i mod p_new` incrementally.

**Evaluation criteria.**
- The computed `x mod p_new` equals `garner(r, p) mod p_new` (cross-check via full reconstruction).
- The full big integer is never materialized.
- Works for `p_new` larger or smaller than the existing primes.

---

### Task 13 — Compare two RNS numbers via mixed-radix digits

**Problem.** Given two values by their residue tuples over the same primes, decide whether `x_a < x_b` **without** reconstructing either full integer beyond their mixed-radix digit vectors. Use reverse-lexicographic comparison of the Garner digits.

**Constraints.** `1 ≤ k ≤ 30`, primes `< 2^{31}`.

**Hint.** Compute digit vectors `a` and `b` (Garner). Compare from the highest-weight digit `a_{k-1}` vs `b_{k-1}` down to `a_0`; the first difference decides. This works because each weight exceeds the sum of all lower contributions.

**Evaluation criteria.**
- Matches the result of comparing the fully reconstructed integers.
- Comparison uses only the digit vectors (reverse-lex), not the assembled integer.
- Correct on random pairs, including equal values.

---

### Task 14 — Garner vs classic CRT formula cross-check

**Problem.** Implement both Garner and the classic CRT formula `x = (Σ r_i M_i y_i) mod P` (with `M_i = P/p_i`, `y_i = (M_i)^{-1} mod p_i`), and assert they produce the same `x` on random inputs. Report which uses larger intermediates.

**Constraints.** `1 ≤ k ≤ 15`, primes `< 10^6` (so `P` fits in big integers comfortably).

**Hint.** The classic formula needs `M_i = P/p_i` (big integers) and a final reduction mod `P`; Garner stays single-prime in the digit solve. Log the maximum intermediate magnitude of each.

**Evaluation criteria.**
- Both methods produce identical `x` on every random test.
- Reports that the classic formula's intermediates (`M_i ≈ P`) dwarf Garner's (`< p_i²`).
- Demonstrates Garner needs no final reduction mod `P`.

---

### Task 15 — Decide when Garner / CRT is the right tool

**Problem.** Implement `classify(scenario)` (or a short analysis) that, given a scenario, returns one of: `GARNER` (reconstruct from residues, coprime moduli), `GARNER_MOD_M` (only `x mod M` needed), `STAY_RNS` (no reconstruction needed yet), `GENERALIZED_CRT` (non-coprime moduli), or `SINGLE_MODULUS` (one prime already suffices — don't use multiple). Justify each.

**Constraints / cases to handle.**
- Residues over coprime primes, want the big integer → `GARNER`.
- Want only the answer mod `10^9+7` → `GARNER_MOD_M`.
- Mid-pipeline RNS arithmetic, magnitude not yet needed → `STAY_RNS`.
- Moduli share a factor → `GENERALIZED_CRT`.
- The true value already fits under one 64-bit prime → `SINGLE_MODULUS`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The traps: reconstructing too early (kills RNS parallelism) and assuming non-coprime moduli work with plain Garner.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `GENERALIZED_CRT` branch explicitly notes the prefix-product inverse fails for non-coprime moduli.
- Justification cites the right cost (`O(k²)` Garner, `O(k)` per RNS op).

---

## Benchmark Task

### Task B — Reconstruction cost: per-call inverse vs precomputed table

**Problem.** Empirically measure the speedup of precomputing the prefix-product inverses when reconstructing many residue tuples over a fixed set of primes. Implement two variants:

- **(a) Per-call inverses:** compute `(W_i)^{-1} mod p_i` inside every reconstruction.
- **(b) Precomputed table:** build `invW[]` once, reuse across all reconstructions.

Measure wall-clock time for `k ∈ {3, 8, 16, 32}` primes over `N = 100000` random residue tuples each. Report a table and the speedup factor.

**Starter — Python.**
```python
import random
import time
from typing import List


def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y


def mod_inverse(a, m):
    g, x, _ = extgcd(a % m, m)
    return (x % m + m) % m


def gen_primes(k: int) -> List[int]:
    pool = [998244353, 1004535809, 985661441, 1000000007, 999999937,
            469762049, 167772161, 754974721, 1000000009, 998244389,
            1000000021, 1000000033, 1000000087, 1000000093, 1000000097,
            1000000103, 1000000123, 1000000181, 1000000207, 1000000223,
            1000000241, 1000000271, 1000000289, 1000000297, 1000000321,
            1000000349, 1000000363, 1000000403, 1000000409, 1000000411,
            1000000427, 1000000433][:k]
    return pool


def garner_percall(r, p):
    # TODO: compute (W_i)^{-1} inside the loop every call
    return 0


def garner_precomp(r, p, invW):
    # TODO: use the precomputed invW table; no inverse calls
    return 0


def bench(k: int, N: int) -> None:
    p = gen_primes(k)
    rng = random.Random(1)
    tuples = [[rng.randrange(pi) for pi in p] for _ in range(N)]

    t0 = time.perf_counter()
    for r in tuples:
        garner_percall(r, p)
    a_ms = (time.perf_counter() - t0) * 1000.0

    # precompute invW once
    invW = []
    for i in range(k):
        prefix = 1
        for j in range(i):
            prefix = (prefix * p[j]) % p[i]
        invW.append(mod_inverse(prefix, p[i]))

    t0 = time.perf_counter()
    for r in tuples:
        garner_precomp(r, p, invW)
    b_ms = (time.perf_counter() - t0) * 1000.0

    print(f"k={k:<3d} per-call={a_ms:8.1f}ms  precomp={b_ms:8.1f}ms  "
          f"speedup={a_ms / max(b_ms, 1e-9):.2f}x")


def main() -> None:
    for k in [3, 8, 16, 32]:
        bench(k, 100_000)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same residue tuples across Go, Java, and Python.
- Both variants produce identical reconstructions (correctness before timing).
- Precomputed table (b) is faster than per-call (a); report the speedup, which grows with `k`.
- Report includes the mean across at least 3 runs and does not time tuple generation.
- Writeup: a short note on why the speedup grows with `k` (the `O(k)` per-digit inverse cost removed from the hot loop).

---

## Stretch Tasks (2)

### Task S1 — Constant-time centered reconstruction

**Problem.** Implement a **branchless, constant-time** Garner reconstruction with centered (signed) recovery, suitable for use on secret values. The centered-recovery step `if 2x ≥ P: x −= P` must not be a data-dependent branch.

**Constraints.** `1 ≤ k ≤ 8`, primes `< 2^{31}`, `P` fits in a big integer; recovery must avoid value-dependent control flow.

**Hint.** Compute both candidates `x` and `x − P`, then select with a constant-time mask derived from the comparison (`mask = −(2x ≥ P)`), combining as `result = x − (P & mask)`. Avoid early-exit on zero digits.

**Evaluation criteria.**
- Output matches the ordinary centered reconstruction on all test values.
- No data-dependent branch in the recovery (verify by inspection / a timing-invariance argument).
- Correctly recovers negative values in `[−P/2, P/2)`.

---

### Task S2 — Product/remainder tree CRT for large k

**Problem.** For a large number of primes `k`, implement CRT reconstruction via a balanced **product/remainder tree** and compare its running time against plain `O(k²)` Garner. Both must produce the same `x`.

**Constraints.** `k` up to a few hundred small primes; product is a big integer.

**Hint.** Build a product tree (leaves = primes, nodes = subtree products). Combine two children via a two-modulus CRT merge using their subtree products. The recursion is `T(k) = 2T(k/2) + O(merge)`.

**Evaluation criteria.**
- Tree result equals plain Garner for all random inputs.
- Tree is faster than `O(k²)` Garner for large `k`; report the crossover.
- Uses big-integer fast multiplication where available.

---

## General Guidance for All Tasks

- **Always validate first.** Use the brute-force CRT oracle for small products, or the round-trip `garner(to_rns(x)) == x`, before trusting the reconstruction on large inputs.
- **Reduce residues on entry.** `r_i ← ((r_i % p_i) + p_i) % p_i` so the first digit is correct.
- **Assert pairwise coprimality.** The prefix-product inverse fails silently otherwise; check `gcd(p_i, p_j) = 1`.
- **Prove the product bound.** `∏ p_i` must exceed the true value (or `2·max|v|` for signed); otherwise Garner wraps silently (Task 10).
- **Choose the assembly.** Big integer only when the exact value is needed; otherwise assemble mod `M` (Task 4) and stay in machine words.
- **Mind overflow.** With primes `< 2^{31}`, products fit in 64-bit before reduction; for larger primes use 128-bit/big-int multiply.
- **Stay in RNS when you can.** Reconstruct only at genuine exit points (output, comparison, sign); reconstructing mid-pipeline kills the parallel speedup.
- **Precompute inverses for fixed primes.** Tasks 6, 7, 11, and the benchmark all benefit from building the prefix-product inverse table once and reusing it across reconstructions.
- **Use the right integer type.** Python big-ints are automatic; in Go/Java use `BigInteger`/`math/big` for the exact assembly and watch the `a[j]*prefix` product width in the digit solve.

### Suggested Order

1. **Beginner (1–5):** build the inverse helper, the two-modulus merge, then full Garner; verify with the round-trip and brute-force oracle. These establish the core recurrence and the all-important normalization habits.
2. **Intermediate (6–10):** add precomputed inverses, the NTT combine, RNS arithmetic, signed recovery, and the overflow guard. These are the production-shaped variants you will actually reach for.
3. **Advanced (11–15):** the convolution combine, base extension, mixed-radix comparison, the classic-formula cross-check, and the tool-selection classifier. These connect Garner to NTT, RNS, and the broader CRT landscape.
4. **Stretch (S1–S2):** constant-time recovery and the fast-CRT tree — the cryptographic and large-`k` frontiers.

### Common Cross-Cutting Tests

Every task that reconstructs a value should pass:

- **Round trip:** `garner(to_rns(x, p), p) == x` for random `x ∈ [0, ∏p)`.
- **Residue match:** `to_rns(garner(r, p), p) == r` for random residue tuples.
- **Oracle agreement:** matches a brute-force CRT scan for small products.
- **Mod-`M` consistency:** `garner_mod_m(r, p, M) == garner(r, p) mod M`.

Wire these as shared helpers; most defects (inverse, weight, sign, normalization) surface on at least one of them.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
