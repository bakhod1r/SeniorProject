# Discrete Logarithm & Baby-Step Giant-Step (BSGS) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the BSGS / discrete-log logic and validate against the evaluation criteria.
> **Always verify `a^x ≡ b (mod m)` after solving, and test against a brute-force `O(m)` oracle on small inputs before trusting the BSGS result.**

---

## Beginner Tasks (5)

### Task 1 — Brute-force discrete log (the oracle)

**Problem.** Implement `brute_dlog(a, b, m)` that returns the smallest `x ≥ 0` with `a^x ≡ b (mod m)` by scanning `x = 0, 1, 2, …`, or `-1` if no solution is found within `m` steps. This is your `O(m)` correctness oracle for every later task.

**Input / Output spec.**
- Read `a`, `b`, `m`.
- Print the smallest `x`, or `-1`.

**Constraints.**
- `2 ≤ m ≤ 10^6`, `0 ≤ a, b < m`.

**Hint.** Maintain `cur = a^x mod m` incrementally (`cur = cur * a % m`), starting from `a^0 = 1`. Stop after `m` steps (the order divides `φ(m) < m`).

**Starter — Go.**
```go
package main

import "fmt"

func bruteDlog(a, b, m int64) int64 {
	a %= m
	b %= m
	cur := int64(1) % m // a^0
	for x := int64(0); x < m; x++ {
		// TODO: if cur == b return x; else cur = cur * a % m
		_ = cur
	}
	return -1
}

func main() {
	var a, b, m int64
	fmt.Scan(&a, &b, &m)
	fmt.Println(bruteDlog(a, b, m))
}
```

**Starter — Java.**
```java
import java.util.Scanner;

public class Task1 {
    static long bruteDlog(long a, long b, long m) {
        a %= m; b %= m;
        long cur = 1 % m;
        for (long x = 0; x < m; x++) {
            // TODO
        }
        return -1;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(bruteDlog(sc.nextLong(), sc.nextLong(), sc.nextLong()));
    }
}
```

**Starter — Python.**
```python
import sys


def brute_dlog(a, b, m):
    a %= m
    b %= m
    cur = 1 % m
    for x in range(m):
        # TODO
        pass
    return -1


def main():
    a, b, m = map(int, sys.stdin.read().split())
    print(brute_dlog(a, b, m))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns the smallest `x`, `0` when `b ≡ 1`, `-1` when unreachable.
- Incremental `cur` (no per-step `pow`).
- Matches hand calculation on `(2, 3, 13) → 4`.

---

### Task 2 — Plain BSGS (coprime base)

**Problem.** Implement BSGS for `a^x ≡ b (mod m)` assuming `gcd(a, m) = 1`. Return the smallest `x ≥ 0`, or `-1`. Use `n = ⌈√m⌉`, baby steps `b·a^j` in a hash map (Form A), giant steps `(a^n)^i`.

**Input / Output spec.**
- Read `a`, `b`, `m` (with `gcd(a, m) = 1`).
- Print the smallest `x`, or `-1`.

**Constraints.** `2 ≤ m ≤ 10^{12}`, `gcd(a, m) = 1`.

**Hint.** Compute `n` with integer sqrt (`isqrt`), not floating point. Store the smallest `j` per value (insert-if-absent). Take giant steps by repeated multiplication after computing `G = a^n` once. Handle `b ≡ 1 → 0`.

**Reference oracle (Python) — use this to validate.**
```python
def brute_dlog(a, b, m):
    a %= m; b %= m
    cur = 1 % m
    for x in range(m):
        if cur == b:
            return x
        cur = cur * a % m
    return -1
```

**Worked trace.** For `(2, 3, 13)`, `n = 4`. Baby steps `3·2^j`: `3, 6, 12, 11`. Giant factor `2^4 ≡ 3`; giant step `i=1` gives `3`, which is in the map at `j=0`, so `x = 1·4 − 0 = 4`. Verify `2^4 = 16 ≡ 3`.

**Starter — Python (fill the TODOs).**
```python
import math


def bsgs(a, b, m):
    a %= m; b %= m
    if b == 1 % m:
        return 0
    n = math.isqrt(m - 1) + 1
    table = {}
    cur = b
    for j in range(n):
        table.setdefault(cur, j)   # TODO keep smallest j
        cur = cur * a % m
    G = pow(a, n, m)
    gi = 1
    for i in range(1, n + 1):
        gi = gi * G % m            # TODO incremental giant step
        if gi in table:
            return i * n - table[gi]
    return -1
```

**Evaluation criteria.**
- `(2, 3, 13) → 4`, `(2, 1, 13) → 0`, `(3, 2, 5) → 3`.
- Matches `brute_dlog` for all small `(a, b, m)` with `gcd(a, m) = 1`.
- `O(√m)` time and space; `n` via integer `isqrt`, not floating point.

---

### Task 3 — Verify-after-solve wrapper

**Problem.** Wrap your BSGS in `solve_verified(a, b, m)` that asserts `a^x ≡ b (mod m)` whenever the returned `x ≠ -1`, raising/panicking on a soundness violation. This guards every later task.

**Input / Output spec.**
- Read `a`, `b`, `m`. Print `x` (verified) or `-1`.

**Constraints.** `2 ≤ m ≤ 10^{12}`, `gcd(a, m) = 1`.

**Hint.** The check is `pow(a, x, m) == b % m`. It is `O(log x)` — cheap insurance. Do **not** verify the `-1` case (there is nothing to verify).

**Worked check.** `solve_verified(2, 3, 13)` returns `4` and the assertion `pow(2, 4, 13) == 3` passes silently. If a bug returned `5`, the assertion would fire because `2^5 = 32 ≡ 6 ≠ 3`.

**Evaluation criteria.**
- Passes the verification for all solvable inputs.
- Never raises on correct outputs; raises if you deliberately inject a wrong `x`.
- `-1` path returns cleanly without verification.
- The verification cost is `O(log x)` — negligible next to the `O(√m)` solve.

---

### Task 4 — Detect "no solution"

**Problem.** Given `a, b, m` (`gcd(a, m) = 1`), determine whether `a^x ≡ b (mod m)` has any solution, printing `YES x` (smallest `x`) or `NO`.

**Input / Output spec.**
- Read `a`, `b`, `m`. Print `YES <x>` or `NO`.

**Constraints.** `2 ≤ m ≤ 10^{10}`.

**Hint.** Run all `n` giant steps; if none hits the baby map, the answer is `NO`. Solutions can only exist if `b` lies in the subgroup generated by `a`. Never loop past `n` giant steps.

**Worked check.** `4` mod `13` generates `{1, 3, 9}` only, so `4^x ≡ 2 (mod 13)` is `NO`. But `4^x ≡ 9 (mod 13)` is `YES 2` (`4^2 = 16 ≡ 3`... check: `4^1=4, 4^2=3, 4^3=12, ...` — verify against the oracle).

**Evaluation criteria.**
- Correctly reports `NO` for unreachable `b`.
- Matches the brute-force oracle on which `b` are reachable.
- Terminates after at most `n` giant steps (never an unbounded loop).
- For prime `m`, an optional `O(log m)` fast pre-check `b^d ≡ 1` (where `d = ord_m(a)`) can short-circuit many `NO` answers before the search.

---

### Task 5 — Block size and the meet-in-the-middle count

**Problem.** For a given `m`, print `n = ⌈√m⌉` and the total number of modular multiplications BSGS performs (baby steps + giant steps + the `a^n` setup), then compare it to `m` (the brute-force count). This makes the `√m` speedup concrete.

**Input / Output spec.**
- Read `m`. Print `n`, the BSGS multiply count (`≈ 2n + log₂ n`), and `m`.

**Constraints.** `2 ≤ m ≤ 10^{18}`.

**Hint.** Use integer sqrt for `n`. The baby phase does `n` multiplies, the giant phase up to `n`, and `a^n` setup `≈ log₂ n`. You do not need to actually solve a dlog — just count.

**Evaluation criteria.**
- `n = ⌈√m⌉` exactly (no floating-point off-by-one at perfect squares).
- Reported BSGS count is `Θ(√m)`; brute count is `m`.
- For `m = 10^{12}`: `n = 10^6`, BSGS ≈ `2×10^6`, brute `= 10^{12}` — a `~500,000×` reduction.
- The ratio `m / (2√m) = √m / 2` is the speedup factor; print it to make the meet-in-the-middle gain explicit.

---

## Intermediate Tasks (5)

### Task 6 — Form B (inverse-form) BSGS

**Problem.** Implement BSGS using the additive form `x = i·n + j`: baby steps `a^j`, giant steps `b·(a^{-n})^i`. Compute `a^{-n}` via extended Euclid (or Fermat when `m` is prime). Return the smallest `x` or `-1`.

**Constraints.** `2 ≤ m ≤ 10^{12}`, `gcd(a, m) = 1`.

**Hint.** `a^{-n} = (a^n)^{-1} mod m`. Multiply the running giant value by `a^{-n}` each step. Scan `i = 0, 1, …, n−1`. The first hit gives the smallest `x`.

**Evaluation criteria.**
- Produces the same answers as Task 2 (Form A) on all test inputs.
- Correctly computes `a^{-n}` (returns `-1`/error if `gcd(a, m) > 1`).
- Matches the brute-force oracle for small `m`.

---

### Task 7 — General modulus (peel gcd factors)

**Problem.** Solve `a^x ≡ b (mod m)` for an **arbitrary** `m` (possibly `gcd(a, m) > 1`). Return the smallest `x ≥ 0` or `-1`. Use the peeling reduction, then BSGS on the coprime core.

**Constraints.** `2 ≤ m ≤ 10^{12}`.

**Hint.** First test small `x = 0..⌈log₂ m⌉` directly (handles `b ≡ 1 → 0`). Then while `g = gcd(a, m) > 1`: if `g ∤ b` return `-1`; else divide `a, b, m` by `g`, fold the `(a/g)` factor into `b` via its inverse mod the reduced modulus, and add 1 to the answer offset. Finally BSGS the coprime instance and add the offset.

**Reference oracle (Python).**
```python
def brute_dlog(a, b, m):
    a %= m; b %= m
    cur = 1 % m
    for x in range(m):
        if cur == b:
            return x
        cur = cur * a % m
    return -1
```

**Evaluation criteria.**
- `(4, 8, 12)`, `(6, 0, 12)` and other non-coprime cases match the oracle.
- Returns `-1` when `g ∤ b` and `b ≢ 1`.
- Coprime inputs fall straight through to plain BSGS; cost stays `O(√m)`.

---

### Task 8 — Smallest x under collisions (stress test)

**Problem.** Construct inputs where the same baby-step value appears for two different `j`, and verify your BSGS returns the **smallest** `x`. Compare against the brute-force oracle, which always finds the minimum.

**Constraints.** `2 ≤ m ≤ 10^5` (small so brute force is fast), many random `(a, b)`.

**Hint.** A value repeats when `a^{j1} ≡ a^{j2}`, i.e. the order of `a` is `≤ √m`. Pick `a` with small order. The insert-if-absent policy must keep the smaller `j`; an overwrite policy will fail this test.

**Evaluation criteria.**
- For every random solvable input, BSGS's `x` equals the oracle's smallest `x`.
- An intentional overwrite (largest `j`) version is shown to fail (so the test has teeth).
- Documents *why* insert-if-absent gives minimality.

---

### Task 9 — Discrete log mod a prime via Fermat inverse

**Problem.** Specialize BSGS to a prime modulus `p`: compute the giant-step inverse with Fermat (`(a^n)^{-1} ≡ (a^n)^{p-2} mod p`) instead of extended Euclid. Return the smallest `x` or `-1`.

**Constraints.** `p` prime, `2 ≤ p ≤ 10^{12}`.

**Hint.** Fermat's little theorem: for prime `p` and `gcd(c, p) = 1`, `c^{-1} ≡ c^{p-2} (mod p)`. This avoids a separate extended-Euclid routine. The rest is identical to Form B.

**Evaluation criteria.**
- Matches Task 6 (extended-Euclid Form B) on prime moduli.
- `(2, 3, 13) → 4`, plus several larger primes verified by `a^x ≡ b`.
- Correctly returns `-1` for `b` outside `⟨a⟩` (when `a` is not a primitive root).

---

### Task 10 — Discrete root via discrete log

**Problem.** Solve `x^k ≡ b (mod p)` for `x`, given a prime `p`, a known primitive root `g`, and exponent `k`. Reduce to discrete log: `c = log_g b`, solve `k·y ≡ c (mod p−1)` for `y` (linear congruence, extended Euclid), recover `x = g^y`. Print one solution or `-1`.

**Constraints.** `p` prime, `2 ≤ p ≤ 10^9`, `g` a primitive root mod `p`.

**Hint.** Use BSGS for `c = log_g b`. The congruence `k·y ≡ c (mod p−1)` has solutions iff `gcd(k, p−1) ∣ c`; there are `gcd(k, p−1)` of them. Verify `x^k ≡ b (mod p)` at the end.

**Reference check (Python).**
```python
def brute_root(b, k, p):
    return [x for x in range(p) if pow(x, k, p) == b % p]
```

**Evaluation criteria.**
- Returns an `x` with `x^k ≡ b (mod p)`, or `-1` when none exists.
- Matches `brute_root` membership for small `p`.
- Correctly reports "no solution" when `gcd(k, p−1) ∤ c`.

---

## Advanced Tasks (5)

### Task 11 — Pollard's rho for discrete log (O(1) space)

**Problem.** Implement Pollard's rho for discrete log in a cyclic group of known **prime** order `n`: solve `g^x ≡ h (mod p)`. Use a partitioned pseudo-random walk tracking `(α, β)` with `y = g^α h^β`, Floyd or Brent cycle detection, and the final linear-congruence extraction. Return `x` or `None`.

**Constraints.** `p` prime, group order `n` prime, `2 ≤ p ≤ 10^{12}`.

**Hint.** Three-way partition by `y mod 3`: multiply by `h`, square, or multiply by `g`, updating `(α, β)` mod `n` accordingly. On collision `g^{α1}h^{β1} = g^{α2}h^{β2}`, solve `α1−α2 ≡ x(β2−β1) (mod n)`. If `β2 ≡ β1`, restart with a different seed.

**Reference structure (Python).**
```python
def pollard_rho_dlog(g, h, p, n):
    def step(x, a, b):
        r = x % 3
        if r == 0:   return (x * x % p, 2 * a % n, 2 * b % n)
        if r == 1:   return (x * g % p, (a + 1) % n, b)
        return (x * h % p, a, (b + 1) % n)
    x1, a1, b1 = 1, 0, 0
    x2, a2, b2 = 1, 0, 0
    for _ in range(n):
        x1, a1, b1 = step(x1, a1, b1)               # tortoise
        x2, a2, b2 = step(*step(x2, a2, b2))        # hare (twice)
        if x1 == x2:
            r = (b1 - b2) % n
            if r == 0:
                return None                          # restart in practice
            x = (a2 - a1) * pow(r, -1, n) % n
            return x if pow(g, x, p) == h % p else None
    return None
```

**Evaluation criteria.**
- Uses `O(1)` extra space (no `√n` table).
- Returns an `x` verified by `g^x ≡ h (mod p)`.
- Matches BSGS on the same inputs (modulo the order, for prime-order groups).
- Handles the `r = 0` degenerate collision by restarting with a different seed.

---

### Task 12 — Pohlig-Hellman for smooth order

**Problem.** Solve `g^x ≡ h (mod p)` when the order `n` of `g` factors into small primes `n = ∏ p_i^{e_i}`. Solve each prime-power subproblem (digit-by-digit, each digit an `O(√p_i)` BSGS), combine via CRT. Return the smallest `x` in `[0, n)`.

**Constraints.** `p` prime, `n = p−1` smooth (largest prime factor `≤ 10^4`), `2 ≤ p ≤ 10^{12}`.

**Hint.** For each `p_i^{e_i}`: compute `g_i = g^{n/p_i^{e_i}}`, `h_i = h^{n/p_i^{e_i}}`, solve `x ≡ x_i (mod p_i^{e_i})` digit-by-digit using BSGS in the order-`p_i` subgroup. CRT-combine the `x_i`.

**Worked check.** For `p = 31`, `n = 30 = 2·3·5`: solve three sub-dlogs in groups of order 2, 3, 5 (each `O(√{p_i}) ≤ 3` steps), then CRT-combine the residues `x mod 2, x mod 3, x mod 5` into `x mod 30`. Compare the total work (`~3` tiny dlogs) against plain BSGS (`√30 ≈ 6` steps) — the gap widens dramatically as the largest prime factor stays small while `n` grows.

**Evaluation criteria.**
- Far faster than plain BSGS when `n` is smooth (measure both).
- Correct CRT recombination on the *exponent* residues (modulo `lcm` of subgroup orders), not the bases.
- Result verified by `g^x ≡ h (mod p)`.
- Falls back gracefully (or documents) when `n` has a large prime factor.

---

### Task 13 — Reusable baby map for many targets

**Problem.** Given a fixed base `a` and modulus `m`, answer `Q` queries each asking `log_a b_q (mod m)` for different `b_q`. Note that Form A's baby map `b·a^j` depends on `b`, but Form B's baby map `a^j` does **not** — exploit Form B so the baby map is built **once** and reused across all queries.

**Constraints.** `2 ≤ m ≤ 10^{12}`, `gcd(a, m) = 1`, `1 ≤ Q ≤ 10^5`.

**Hint.** Build `{a^j : j}` and `a^{-n}` once. Per query, only the giant phase (`b_q·(a^{-n})^i`) runs — `O(√m)` per query, but the `O(√m)` baby precompute is amortized over all `Q` queries.

**Evaluation criteria.**
- Baby map built exactly once, reused across all queries.
- Each query is `O(√m)` giant steps only.
- All answers verified by `a^x ≡ b_q (mod m)`; matches per-query independent BSGS.

---

### Task 14 — Overflow-safe BSGS for m near 2^63

**Problem.** Make BSGS correct for `m` up to `~9.2·10^{18}` (near `2^{63}`), where `cur * a` overflows signed 64-bit before reduction. Use 128-bit intermediates (`__int128` in C-like Go via `math/bits.Mul64`, `Math.multiplyHigh`/`BigInteger` in Java, native big ints in Python) or Montgomery multiplication.

**Constraints.** `2 ≤ m < 2^{63}`, `gcd(a, m) = 1`. (Memory: keep `m` small enough that `√m` entries fit — e.g. demonstrate correctness on moderately large `m`, then argue the overflow fix scales.)

**Hint.** In Go, `hi, lo := bits.Mul64(uint64(a), uint64(b))` then reduce the 128-bit `(hi, lo)` mod `m`. In Java, use `Math.multiplyHigh` or `BigInteger` for the product, or 128-bit via `Math.multiplyHigh` + manual reduction. In Python, arbitrary precision is automatic.

**Evaluation criteria.**
- No overflow: products are reduced correctly for `m` near `2^{63}`.
- Matches a `BigInteger`/Python reference on large moduli.
- Documents the multiplication strategy used per language.

---

### Task 15 — Classify the right algorithm

**Problem.** Given `(a, b, m, gcd(a,m), order_factorization, memory_budget)`, implement `classify(...)` returning one of: `BSGS`, `POLLARD_RHO`, `POHLIG_HELLMAN`, `GENERAL_MODULUS_PEEL`, `INFEASIBLE_CRYPTO`. Justify each decision against the constraints.

**Constraints / cases to handle.**
- `gcd(a,m)=1`, `√m` fits in memory, generic order → `BSGS`.
- `gcd(a,m)=1`, `√m` exceeds memory budget → `POLLARD_RHO`.
- order smooth (all prime factors small) → `POHLIG_HELLMAN`.
- `gcd(a,m)>1` → `GENERAL_MODULUS_PEEL` (then BSGS on the core).
- crypto-sized prime `m` (e.g. `m > 2^{256}`) → `INFEASIBLE_CRYPTO`.

**Hint.** Encode the decision rules from `middle.md`/`senior.md`/`professional.md`. The crypto case is the trap: `√m` is the generic bound and is infeasible for large `m` — that is the *point* of the cryptosystem, not a bug.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `INFEASIBLE_CRYPTO` branch explains the `√m` generic-attack bound and Shoup's lower bound.
- Justifications cite the right complexity (`O(√m)`, `O(√m)` space vs `O(1)`, `O(Σ e_i(log n + √p_i))`).

---

## Benchmark Task

### Task B — Brute force vs BSGS vs Pollard's rho crossover

**Problem.** Empirically compare the three discrete-log methods on random solvable inputs and find where each wins. For increasing `m`, measure wall-clock time and peak memory for:

- **(a) Brute force** — `O(m)` scan (only for small `m`).
- **(b) BSGS** — `O(√m)` time, `O(√m)` space.
- **(c) Pollard's rho** — `O(√m)` expected time, `O(1)` space (prime order).

Run on `m ∈ {10^4, 10^6, 10^8, 10^{10}, 10^{12}}` (brute only up to `10^6`). Report a table and identify the crossover where BSGS overtakes brute force, and where rho's memory advantage matters.

**Starter — Python.**
```python
import math
import random
import time


def gen_instance(m):
    a = random.randrange(2, m)
    while math.gcd(a, m) != 1:
        a = random.randrange(2, m)
    x = random.randrange(0, m)
    b = pow(a, x, m)
    return a, b, m


def brute_dlog(a, b, m):
    a %= m; b %= m
    cur = 1 % m
    for x in range(m):
        if cur == b:
            return x
        cur = cur * a % m
    return -1


def bsgs(a, b, m):
    a %= m; b %= m
    if b == 1 % m:
        return 0
    n = math.isqrt(m - 1) + 1
    table = {}
    cur = b
    for j in range(n):
        table.setdefault(cur, j)
        cur = cur * a % m
    G = pow(a, n, m)
    gi = 1
    for i in range(1, n + 1):
        gi = gi * G % m
        if gi in table:
            return i * n - table[gi]
    return -1


def bench(fn, a, b, m):
    t = time.perf_counter()
    fn(a, b, m)
    return time.perf_counter() - t


def main():
    for m in [10**4, 10**6, 10**8, 10**10, 10**12]:
        a, b, _ = gen_instance(m)
        tb = bench(bsgs, a, b, m)
        if m <= 10**6:
            tr = bench(brute_dlog, a, b, m)
            print(f"m={m:<14d} brute={tr*1000:8.2f}ms  bsgs={tb*1000:8.2f}ms")
        else:
            print(f"m={m:<14d} brute=(skipped)      bsgs={tb*1000:8.2f}ms")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same instances across Go, Java, and Python.
- Brute force (a) wins for tiny `m`; BSGS (b) overtakes it quickly (around `m ≈ √m`, i.e. very small `m`). Report the crossover.
- BSGS completes for `m = 10^{12}` in well under a second; brute force is infeasible there.
- Pollard's rho (c) uses constant memory; demonstrate its peak memory stays flat while BSGS's grows like `√m`.
- Report includes the mean across at least 3 runs and does not time instance generation.
- Writeup: a short note on the measured crossover and the memory contrast between BSGS and rho.

---

## General Guidance for All Tasks

- **Always verify against `a^x ≡ b (mod m)`.** After any non-`-1` result, assert `pow(a, x, m) == b % m`. It is `O(log x)` and catches almost every bug.
- **Keep a brute-force oracle.** For `m ≤ 10^6`, the `O(m)` scan finds the true smallest `x`; diff against it.
- **Use integer sqrt for `n = ⌈√m⌉`.** Floating-point `sqrt` rounds down at perfect squares and misses the last block. Use `isqrt`.
- **Insert-if-absent for baby steps.** Keep the smallest `j` per value, scan `i` upward, break on the first hit — this gives the smallest `x`. Overwriting is the classic minimality bug.
- **Handle `b ≡ 1 → 0` and no-solution `→ -1` explicitly.** Never loop past `n` giant steps.
- **Mind overflow.** In Go/Java reduce after every multiply; for `m` near `2^{63}` use 128-bit intermediates.
- **Check `gcd(a, m)`.** Coprime → plain BSGS; otherwise the general-modulus peel.
- **Choose the right algorithm.** BSGS for moderate `m`; Pollard's rho when memory-bound; Pohlig-Hellman when the order is smooth; recognize crypto-sized `m` as infeasible by design.
- **Compute giant steps incrementally.** Build `a^n` (and `a^{-n}`) once, then advance by a single multiply per step. Calling `pow` inside the loop inflates each phase from `O(√m)` to `O(√m log m)` — a common timeout cause.
- **Reuse the baby table across targets (Form B).** Since Form B's baby steps `a^j` do not depend on `b`, a fixed base/modulus lets you build the table once and amortize it over many queries (Task 13).

- **Print the speedup.** When benchmarking, report `m / (2√m) = √m / 2` so the meet-in-the-middle gain is explicit, and contrast BSGS's `√m` memory against Pollard's rho's `O(1)`.
- **Distinguish the two forms.** Form A (`b·a^j` / `(a^n)^i`) needs no inverse; Form B (`a^j` / `b·(a^{-n})^i`) needs `a^{-n}` but allows a reusable baby table. Choose deliberately per task.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
