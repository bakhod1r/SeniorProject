# Primitive Roots & Discrete Root — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the order / primitive-root / discrete-root logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs before trusting the fast version** — for orders, enumerate powers; for roots, enumerate `x = 0..p−1` and check `x^k ≡ a`.

---

## Beginner Tasks (5)

### Task 1 — Multiplicative order mod a prime

**Problem.** Implement `order(a, p)` returning the smallest `e > 0` with `a^e ≡ 1 (mod p)`, for a prime `p` and unit `a`. Use the divisor-reduction method (start at `p − 1`, divide out prime factors).

**Input / Output spec.**
- Read `p`, then `a`.
- Print the single integer `ord_p(a)`.

**Constraints.**
- `2 ≤ p ≤ 10^{12}` (prime), `1 ≤ a < p`.
- Use 64-bit modular exponentiation.

**Hint.** Factor `p − 1` into distinct primes once. Then `ord = p − 1`; for each prime `q`, while `q | ord` and `a^{ord/q} ≡ 1`, set `ord /= q`.

**Starter — Go.**
```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func order(a, p int64) int64 {
	// TODO: factor p-1, reduce ord by prime factors
	return 0
}

func main() {
	var p, a int64
	fmt.Scan(&p, &a)
	fmt.Println(order(a, p))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static long order(long a, long p) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long p = sc.nextLong(), a = sc.nextLong();
        System.out.println(order(a, p));
    }
}
```

**Starter — Python.**
```python
def order(a, p):
    # TODO: factor p-1, reduce ord by prime factors
    return 0


def main():
    import sys
    p, a = map(int, sys.stdin.read().split())
    print(order(a, p))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Matches a brute-force "enumerate powers until `1`" oracle for small `p`.
- `ord` always divides `p − 1`.
- `order(1, p) == 1`; `order(g, p) == p − 1` for any primitive root `g`.

---

### Task 2 — Test whether `g` is a primitive root

**Problem.** Implement `isPrimitiveRoot(g, p)` for a prime `p`, returning true iff `g^{(p−1)/q} ≢ 1 (mod p)` for every prime `q | (p−1)`.

**Input / Output spec.**
- Read `p`, then `g`. Print `true` or `false`.

**Constraints.** `2 ≤ p ≤ 10^{12}` (prime), `1 ≤ g < p`.

**Hint.** Reuse the distinct-prime factorization of `p − 1`. Do not compute the full order; one exponentiation per distinct prime suffices.

**Reference oracle (Python) — use this to validate.**
```python
def is_primitive_root_bruteforce(g, p):
    seen, cur = set(), 1
    for _ in range(p - 1):
        cur = cur * g % p
        seen.add(cur)
    return len(seen) == p - 1   # generated all p-1 units
```

**Evaluation criteria.**
- Matches the brute-force cycle oracle for small `p`.
- Returns `false` for `g = 1` (when `p > 2`) and for any non-generator.
- `O(ω(p−1) log p)` after factoring.

---

### Task 3 — Smallest primitive root

**Problem.** Given a prime `p`, output the smallest primitive root mod `p`.

**Input / Output spec.**
- Read `p`. Print the smallest `g` that is a primitive root.

**Constraints.** `2 ≤ p ≤ 10^{12}` (prime).

**Hint.** Factor `p − 1` once. Test `g = 2, 3, 4, …` with the Task 2 predicate; return the first that passes. Handle `p = 2 → 1`.

**Worked check.** `p = 7 → 3`, `p = 13 → 2`, `p = 41 → 6`, `p = 998244353 → 3`.

**Evaluation criteria.**
- Correct for the worked checks above.
- The returned `g` passes `isPrimitiveRoot` and has order `p − 1` by the brute-force oracle (small `p`).
- Terminates quickly (smallest generator is tiny).

---

### Task 4 — Count primitive roots

**Problem.** Given a modulus `m` that has a primitive root, output the number of primitive roots, which is `φ(φ(m))`. If `m` has no primitive root, output `0`.

**Input / Output spec.**
- Read `m`. Print the count.

**Constraints.** `1 ≤ m ≤ 10^{12}`.

**Hint.** First decide whether `m ∈ {1, 2, 4, p^k, 2p^k}` (else print `0`). Then compute `φ(m)` and `φ(φ(m))` with a totient routine.

**Worked check.** `m = 7 → φ(φ(7)) = φ(6) = 2`. `m = 13 → φ(12) = 4`. `m = 8 → 0` (no primitive root). `m = 9 → φ(φ(9)) = φ(6) = 2`.

**Evaluation criteria.**
- Correct for the worked checks.
- Returns `0` exactly for moduli with no primitive root.
- Matches a brute-force count of order-`φ(m)` elements for small `m`.

---

### Task 5 — Cycle of a primitive root

**Problem.** Given a prime `p` and a primitive root `g`, output the full cycle `g^0, g^1, …, g^{p−2} (mod p)` — a permutation of `1..p−1`.

**Input / Output spec.**
- Read `p`, then `g`. Print the `p − 1` powers space-separated.

**Constraints.** `2 ≤ p ≤ 10^5`, `g` is a primitive root.

**Hint.** Iterate `cur = 1`, multiplying by `g` mod `p` each step. The set of outputs must equal `{1, …, p−1}` exactly.

**Evaluation criteria.**
- Output is a permutation of `1..p−1` (all distinct, none missing).
- `g^0 = 1` and the cycle returns to `1` after exactly `p − 1` steps.
- Matches the index table `ind_g` built by inverting this cycle.

---

## Intermediate Tasks (5)

### Task 6 — Discrete logarithm via BSGS

**Problem.** Given a prime `p`, a primitive root `g`, and a unit `a`, compute `ind_g(a)` — the unique `x ∈ [0, p−1)` with `g^x ≡ a (mod p)` — using baby-step giant-step.

**Constraints.** `2 ≤ p ≤ 10^{12}` (prime).

**Hint.** Precompute `g^0, …, g^{⌈√p⌉}` in a hash map (baby steps), then take giant steps of size `√p` multiplying by `g^{−⌈√p⌉}`. `O(√p)` time and memory. See sibling `11-discrete-log-bsgs`.

**Reference oracle (Python).**
```python
def discrete_log_bruteforce(g, a, p):
    cur = 1
    for x in range(p - 1):
        if cur == a % p:
            return x
        cur = cur * g % p
    return -1
```

**Starter — Python (BSGS skeleton).**
```python
from math import isqrt


def discrete_log(g, a, p):
    n = isqrt(p) + 1
    # baby steps: store g^j -> j
    table = {}
    cur = 1
    for j in range(n):
        table.setdefault(cur, j)
        cur = cur * g % p
    # giant steps: multiply a by g^{-n} repeatedly
    factor = pow(g, p - 1 - n, p)   # g^{-n} mod p
    gamma = a % p
    for i in range(n):
        if gamma in table:
            return i * n + table[gamma]
        gamma = gamma * factor % p
    return -1  # not in the subgroup
```

**Evaluation criteria.**
- Matches the brute-force log for small `p`.
- `g^{ind_g(a)} ≡ a (mod p)` for the returned index.
- `O(√p)` — handles `p` up to `10^{12}`.

---

### Task 7 — Solve `x^k ≡ a (mod p)`

**Problem.** Given a prime `p`, exponent `k`, and target `a`, output all solutions `x` (sorted), or "none". Use a primitive root + discrete log + linear congruence.

**Constraints.** `2 ≤ p ≤ 10^9` (prime), `1 ≤ k`, `0 ≤ a < p`.

**Hint.** `x = g^Y`, `a = g^A`. Solve `kY ≡ A (mod p−1)`. Solvable iff `gcd(k, p−1) | A`; then there are `gcd(k, p−1)` solutions. Divide the congruence by `d = gcd` and take one modular inverse mod `(p−1)/d` (extended Euclid, not Fermat).

**Reference oracle (Python).**
```python
def solve_kth_root_bruteforce(k, a, p):
    return sorted(x for x in range(p) if pow(x, k, p) == a % p)
```

**Evaluation criteria.**
- Matches the brute-force root finder for small `p`.
- Returns exactly `gcd(k, p−1)` roots when solvable, none otherwise.
- Each returned `x` satisfies `x^k ≡ a (mod p)` (re-substitution check).

---

### Task 8 — `k`-th power residue test (no discrete log)

**Problem.** Given a prime `p`, exponent `k`, and `a`, decide whether `x^k ≡ a (mod p)` has any solution, using *only* the existence form `a^{(p−1)/gcd(k,p−1)} ≡ 1` — no discrete log, no generator.

**Constraints.** `2 ≤ p ≤ 10^{18}` (prime), `1 ≤ k`, `0 ≤ a < p`.

**Hint.** `d = gcd(k, p−1)`; solvable iff `a^{(p−1)/d} ≡ 1 (mod p)`. Handle `a = 0` (solvable, root `0`). The `k = 2` case is Euler's criterion for quadratic residues.

**Reference oracle (Python).**
```python
def is_kth_residue_bruteforce(k, a, p):
    return any(pow(x, k, p) == a % p for x in range(p))
```

**Starter — Python.**
```python
from math import gcd


def is_kth_residue(k, a, p):
    a %= p
    if a == 0:
        return True            # x = 0 is a root
    d = gcd(k, p - 1)
    return pow(a, (p - 1) // d, p) == 1
```

**Evaluation criteria.**
- Matches the brute-force test for small `p`.
- One exponentiation — works for `p` up to `10^{18}` with overflow-safe `mulmod`.
- For `k = 2`, agrees with the quadratic-residue (Euler) criterion.

---

### Task 9 — NTT root of unity

**Problem.** Given an NTT-friendly prime `p` (with `p − 1` divisible by a large power of two), a primitive root `g`, and a transform length `N = 2^t` dividing `p − 1`, output a primitive `N`-th root of unity `ω = g^{(p−1)/N} (mod p)` and verify it.

**Constraints.** `p ∈ {998244353, 469762049, 167772161}`, `N` a power of two, `N | (p−1)`.

**Hint.** `ω = power(g, (p−1)/N, p)`. Assert `ω^N ≡ 1` and `ω^{N/2} ≡ p − 1` (i.e. `≡ −1`) — the latter confirms `ω` is *primitive*, not a lower-order root. See sibling `13-ntt`.

**Worked check.** `p = 998244353`, `g = 3`, `N = 2^{23}`: `ω = 3^{(p−1)/2^{23}} = 3^{119}`; `ω^{2^{23}} ≡ 1` and `ω^{2^{22}} ≡ −1`.

**Starter — Python.**
```python
def ntt_root(p, g, N):
    assert (p - 1) % N == 0, "N must divide p-1"
    w = pow(g, (p - 1) // N, p)
    assert pow(w, N, p) == 1, "w^N must be 1"
    assert pow(w, N // 2, p) == p - 1, "w^(N/2) must be -1 (primitivity)"
    return w


if __name__ == "__main__":
    print(ntt_root(998244353, 3, 1 << 23))  # a primitive 2^23-th root
```

**Starter — Go.**
```go
package main

import "fmt"

func power(a, e, mod int64) int64 {
	a %= mod
	var r int64 = 1
	for e > 0 {
		if e&1 == 1 {
			r = r * a % mod
		}
		a = a * a % mod
		e >>= 1
	}
	return r
}

func nttRoot(p, g, N int64) int64 {
	if (p-1)%N != 0 {
		panic("N must divide p-1")
	}
	w := power(g, (p-1)/N, p)
	if power(w, N, p) != 1 || power(w, N/2, p) != p-1 {
		panic("w is not a primitive N-th root")
	}
	return w
}

func main() {
	fmt.Println(nttRoot(998244353, 3, 1<<23))
}
```

**Evaluation criteria.**
- `ω^N ≡ 1` and `ω^{N/2} ≡ −1` both hold.
- Rejects an `N` that does not divide `p − 1`.
- The order of `ω` is exactly `N` (verify by the order routine on the small-`N` case).

---

### Task 10 — Number of `k`-th roots (count, not enumerate)

**Problem.** Given a prime `p`, exponent `k`, and `a`, output the *number* of solutions to `x^k ≡ a (mod p)` without enumerating them: `gcd(k, p−1)` if `a^{(p−1)/gcd(k,p−1)} ≡ 1`, else `0` (and `1` for `a = 0`).

**Constraints.** `2 ≤ p ≤ 10^{18}` (prime), `1 ≤ k`, `0 ≤ a < p`.

**Hint.** Combine Task 8's existence test with `d = gcd(k, p−1)` as the count. Also report the number of distinct `k`-th power residues, which is `(p−1)/d`.

**Evaluation criteria.**
- Matches the size of the brute-force root list for small `p`.
- Returns `0` exactly for non-residues.
- Reports `(p−1)/gcd(k,p−1)` distinct residues when asked.

---

## Advanced Tasks (5)

### Task 11 — Solve `x^k ≡ a (mod m)` for composite `m` via CRT

**Problem.** Solve `x^k ≡ a (mod m)` for a composite `m`, by factoring `m` into prime powers, solving in each (cyclic) factor via its primitive root, and recombining with CRT. Output all solutions sorted, or "none".

**Constraints.** `2 ≤ m ≤ 10^{12}`, `m` a product of small prime powers with `m ∈ {p^k, 2p^k}` factors handled, `1 ≤ k`, `0 ≤ a < m`.

**Hint.** Per prime power `p^e`: find a generator (lift from `p`), solve `kY ≡ A (mod φ(p^e))`. The total solution set is the Cartesian product of per-factor solution sets, recombined by CRT (sibling `05`). Total count = product of per-factor counts.

**Evaluation criteria.**
- Matches a brute-force `x = 0..m−1` root finder for small `m`.
- Correct count (product of per-factor counts), including `0` when any factor is unsolvable.
- Handles the `2^a` (`a ≥ 3`) factor via the two-generator structure or per-factor enumeration.

---

### Task 12 — Generator of a prime-order subgroup (Diffie-Hellman style)

**Problem.** Given a safe prime `p = 2q + 1` (with `q` prime), output a generator `h` of the order-`q` subgroup of `Z/pZ*` (used in Diffie-Hellman). `h` has order exactly `q`.

**Constraints.** `p` a safe prime up to `10^{18}`; `q = (p−1)/2` is prime.

**Hint.** Take any non-trivial `g₀` and set `h = g₀^{(p−1)/q} = g₀^2 (mod p)`; ensure `h ≠ 1`. Verify `h^q ≡ 1` and `h ≢ 1` (so the order is exactly the prime `q`). Note you do *not* need the full primitive root — a subgroup generator suffices.

**Evaluation criteria.**
- `h^q ≡ 1 (mod p)` and `h ≠ 1`, so `ord_p(h) = q`.
- The subgroup `{h^0, …, h^{q−1}}` has exactly `q` distinct elements (small-`p` check).
- Documents why a subgroup generator (not a full primitive root) is what DH uses.

---

### Task 13 — Index table and multiplication-as-addition

**Problem.** Given a prime `p` (small) and a primitive root `g`, build the index table `ind_g(a)` for all units `a`, then verify that `ind_g(a·b) ≡ ind_g(a) + ind_g(b) (mod p−1)` and `ind_g(a^k) ≡ k·ind_g(a)` for random `a, b, k`.

**Constraints.** `2 ≤ p ≤ 10^5`, `g` a primitive root.

**Hint.** Walk `g^0, g^1, …, g^{p−2}` to fill the table in `O(p)`. The two identities are the logarithm laws transplanted into modular arithmetic; they confirm the index map is a group isomorphism `(Z/pZ)* ≅ (Z/(p−1)Z, +)`.

**Evaluation criteria.**
- The table is a bijection between units and `{0, …, p−2}`.
- Both index identities hold for many random `a, b, k`.
- A multiplication done via index addition matches direct modular multiplication.

---

### Task 14 — Detect whether a modulus has a primitive root

**Problem.** Implement `hasPrimitiveRoot(m)` returning true iff `m ∈ {1, 2, 4, p^k, 2p^k}` for an odd prime `p`. Then, when true, also output the smallest primitive root (lifting from `p` to `p^k` and `2p^k` as needed).

**Constraints.** `1 ≤ m ≤ 10^{12}`.

**Hint.** Handle `1, 2, 4` directly. Strip a factor of `2` (only one allowed); the remainder must be an odd prime power `p^k`. For the generator: find `g` mod `p`, fix with `g + p` if `g^{p-1} ≡ 1 (mod p²)`, and pick the odd representative for the `2p^k` case.

**Degree sanity check.** `8, 12, 15, 16, 24` → no primitive root. `9, 25, 14, 49, 2·11=22` → has one.

**Evaluation criteria.**
- Correctly classifies all the sanity-check moduli.
- When a primitive root exists, the returned `g` has order `φ(m)` (verified by the order routine).
- The lifting conditions (`mod p²` test, odd representative) are implemented and exercised.

---

### Task 15 — Decide the right tool for a modular-root problem

**Problem.** You are given a problem statement and must decide the correct method. Implement `classify(p_or_m, k, query)` returning one of: `UNIQUE_ROOT` (`gcd(k, φ) = 1`), `GENERAL_DISCRETE_ROOT` (primitive root + discrete log), `TONELLI_SHANKS` (`k = 2`, square root, no `φ` factoring), `CRT_SPLIT` (composite/non-cyclic `m`), or `NO_PRIMITIVE_ROOT` (cyclicity fails and not reducible). Justify each.

**Constraints / cases to handle.**
- `gcd(k, p−1) = 1` → `UNIQUE_ROOT` (`x = a^{k^{-1} mod (p−1)}`).
- `k = 2`, prime `p` → `TONELLI_SHANKS` (avoids factoring `p − 1`).
- general `k`, prime `p`, `gcd(k, p−1) > 1` → `GENERAL_DISCRETE_ROOT`.
- composite `m` with a primitive root per factor → `CRT_SPLIT`.
- `m = 2^a` (`a ≥ 3`) treated as a single cyclic group → `NO_PRIMITIVE_ROOT`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The trap is treating a power of two (or other non-cyclic `m`) as if it had a generator.

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `UNIQUE_ROOT` branch computes `k^{-1} mod (p−1)` and returns the single root.
- Justification references the right complexity (`O(log p)`, `O(√p)`, `O(log² p)` for Tonelli-Shanks).

---

## Benchmark Task

### Task B — Smallest-generator search cost vs prime size

**Problem.** Empirically measure how the cost of finding the smallest primitive root scales, separating the two phases: (a) factoring `p − 1`, and (b) the small-`g` search/test. Run on a fixed set of primes spanning several magnitudes.

**Starter — Python.**
```python
import time
from math import gcd


def distinct_primes(n):
    fs, d = [], 2
    while d * d <= n:
        if n % d == 0:
            fs.append(d)
            while n % d == 0:
                n //= d
        d += 1
    if n > 1:
        fs.append(n)
    return fs


def primitive_root_timed(p):
    t0 = time.perf_counter()
    primes = distinct_primes(p - 1)        # phase (a): factor p-1
    t1 = time.perf_counter()
    phi = p - 1
    g = -1
    for cand in range(2, p):               # phase (b): search/test
        if all(pow(cand, phi // q, p) != 1 for q in primes):
            g = cand
            break
    t2 = time.perf_counter()
    return g, (t1 - t0) * 1000, (t2 - t1) * 1000


def main():
    primes = [101, 7919, 999983, 1000000007, 998244353]
    print("p              g     factor_ms     search_ms")
    for p in primes:
        g, fa, se = primitive_root_timed(p)
        print(f"{p:<14d} {g:<5d} {fa:<13.3f} {se:.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same primes produce the same generators across Go, Java, and Python.
- The report shows **factoring `p − 1` dominates**, while the search/test phase stays small regardless of `p`.
- The smallest generator `g` is tiny (single/double digit) for all test primes — confirming the search terminates fast.
- For `998244353` (smooth `p − 1`), factoring is fast and `g = 3`; contrast with a prime whose `p − 1` has a large prime factor.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** For orders, enumerate powers; for roots, enumerate `x = 0..p−1`. Run on small `p`, diff, and only then trust the fast version.
- **Factor `φ` (or `p − 1`) once** and reuse the distinct primes across every order/generator computation; never refactor inside a loop.
- **Use the existence form** `a^{(p−1)/gcd(k,p−1)} ≡ 1` when you only need *whether* a root exists — it skips the costly discrete log.
- **Divide the linear congruence by `d = gcd(k, p−1)` first**, then take one inverse mod `(p−1)/d` via **extended Euclid** — never Fermat (the exponent ring is not a field).
- **Mind overflow.** In Go/Java cast to 64-bit before multiplying, then reduce; for `p > 2^31` use 128-bit products or Montgomery (sibling `14`).
- **Gate on existence.** Only `m ∈ {1, 2, 4, p^k, 2p^k}` has a primitive root; never search mod a power of two `≥ 8` or other non-cyclic modulus.
- **Re-substitute to verify roots.** Every returned `x` must satisfy `x^k ≡ a (mod m)`, and the count must equal `gcd(k, φ)` (product across CRT factors).

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same inputs.
