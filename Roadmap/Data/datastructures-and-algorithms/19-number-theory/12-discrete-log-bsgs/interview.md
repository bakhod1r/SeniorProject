# Discrete Logarithm & Baby-Step Giant-Step (BSGS) — Interview Preparation

Discrete log is a favourite interview topic because it rewards a single crisp insight — *"rewrite `x = i·n − j` and meet in the middle"* — and then tests whether you can (a) make it `O(√m)` with a hash map of baby steps, (b) keep it correct with modular inverses and the smallest-`x` detail, (c) handle a non-coprime / general modulus, and (d) connect it to the bigger picture (meet-in-the-middle, primitive roots, Pollard's rho, and Diffie-Hellman hardness). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Solve `a^x ≡ b (mod m)`, `gcd(a,m)=1` | BSGS, `n = ⌈√m⌉` | `O(√m)` time/space |
| Smallest `x` | smallest-`j` map + increasing-`i` scan | `O(√m)` |
| General modulus `gcd(a,m)>1` | peel `gcd` factors, then BSGS | `O(√m)` |
| Memory-constrained / huge `m` | Pollard's rho for dlog | `O(√m)` time, `O(1)` space |
| Smooth group order | Pohlig-Hellman (BSGS per factor) | `O(Σ e_i(log n + √p_i))` |
| Discrete root `x^k ≡ b` | dlog + linear congruence | `O(√m)` |
| Crypto-size `m` (Diffie-Hellman) | **infeasible** — `√m ≈ 2^{1536}` | — |

The two decompositions (pick one, stay consistent):

```text
Form A (subtractive):  x = i·n − j,  1≤i≤n, 0≤j<n
    baby: store  b·a^j        giant: check (a^n)^i    (no inverse needed)

Form B (additive):     x = i·n + j,  0≤i<n, 0≤j<n
    baby: store  a^j          giant: check b·(a^{-n})^i   (needs a^{-n})
```

Core algorithm (Form A):

```text
BSGS(a, b, m):                  # gcd(a, m) = 1
    if b ≡ 1: return 0
    n = ceil(sqrt(m))
    map = {}; cur = b mod m
    for j in 0..n-1: map.setdefault(cur, j); cur = cur*a mod m
    G = a^n mod m; gi = 1
    for i in 1..n:
        gi = gi*G mod m
        if gi in map: return i*n - map[gi]     # smallest x via first hit
    return -1
```

Key facts:
- `n = ⌈√m⌉` blocks of size `√m` each → `O(√m)` total (meet-in-the-middle).
- **Always verify** `a^x ≡ b (mod m)` after solving.
- Solutions repeat with the **order** of `a`; report the smallest.
- No solution ⟹ return `-1` (never loop). `b ≡ 1 ⟹ x = 0`.

---

## Junior Questions (12 Q&A)

### J1. What is the discrete logarithm problem?
Find an exponent `x` with `a^x ≡ b (mod m)`. It is the modular analogue of an ordinary logarithm, but the values `a^1, a^2, …` jump around mod `m` in scrambled order, so there is no smooth function to invert and no binary search.

### J2. What is the naive way to solve it, and how slow is it?
Try `x = 0, 1, 2, …`, multiplying by `a` each step until `a^x ≡ b`. That is an `O(m)` scan — fine for tiny `m`, hopeless for `m = 10^{12}` or larger.

### J3. What does BSGS stand for and what does it achieve?
Baby-Step Giant-Step. It solves discrete log in `O(√m)` time and `O(√m)` space — a square-root speedup over the `O(m)` scan — via meet-in-the-middle.

### J4. What is the key rewrite in BSGS?
Pick `n = ⌈√m⌉`. Write `x = i·n − j` (Form A). Then `a^x ≡ b` becomes `(a^n)^i ≡ b·a^j`, isolating the unknown `i` on the left and `j` on the right so the two sides can "meet in the middle".

### J5. What are the baby steps?
The precomputed values `b·a^j (mod m)` for `j = 0, 1, …, n−1`, stored in a hash map keyed by the value with the value `j`. There are `√m` of them.

### J6. What are the giant steps?
The values `(a^n)^i (mod m)` for `i = 1, 2, …, n`, each a jump of `n` exponents. After each one, you look it up in the baby-step map; a match gives `x = i·n − j`.

### J7. Why is it `O(√m)` and not `O(m)`?
Two scans of length `√m` each (the `√m` baby steps and `√m` giant steps), not one scan of length `m`. The hash map makes each giant-step lookup `O(1)`, so total work is about `2√m`.

### J8. What data structure makes BSGS fast?
A hash map (dictionary). It stores the `√m` baby values and lets each giant-step check be `O(1)` average. Without it you would compare two lists of length `√m`, which is `m` comparisons — no faster than brute force.

### J9. What if no solution exists?
Some `(a, b, m)` have no `x` (e.g. `b` is not a power of `a` mod `m`). After all `n` giant steps with no map hit, BSGS returns a sentinel like `-1`. It never loops forever.

### J10. What is the answer when `b ≡ 1 (mod m)`?
`x = 0`, because `a^0 = 1`. This is a common edge case; handle it explicitly so you do not return the order of `a` instead of `0`.

### J11. Does BSGS need anything from `a` and `m`?
Plain BSGS assumes `gcd(a, m) = 1` (so `a` is invertible mod `m`, which the giant step relies on in Form B). For a composite `m` with `gcd(a, m) > 1`, you peel common factors first.

### J12 (analysis). What is the time and space complexity?
`O(√m)` time and `O(√m)` space. The space is the hash map of `√m` baby steps — and it is usually the binding constraint, since `√m` entries can be gigabytes for `m ≈ 10^{16}`.

---

## Middle Questions (12 Q&A)

### M1. Prove the rewrite `(a^n)^i ≡ b·a^j` is equivalent to `a^x ≡ b`.
Substitute `x = i·n − j`: `a^{i·n − j} ≡ b ⟺ a^{i·n} ≡ b·a^j` (multiply both sides by `a^j`) `⟺ (a^n)^i ≡ b·a^j`. The step uses `gcd(a, m) = 1` so `a^j` is invertible.

### M2. Why does every exponent `x` in `[1, m]` fit the form `i·n − j`?
With `n = ⌈√m⌉` we have `n² ≥ m`. Set `i = ⌈x/n⌉ ∈ [1, n]` and `j = i·n − x ∈ [0, n−1]`. So the `√m × √m` grid of `(i, j)` pairs covers all exponents — BSGS is exhaustive.

### M3. What are the two decompositions, and how do they differ?
Form A: `x = i·n − j`, baby `b·a^j`, giant `(a^n)^i` — **no inverse needed**. Form B: `x = i·n + j`, baby `a^j`, giant `b·(a^{-n})^i` — **needs `a^{-n}`** (hence `gcd(a,m)=1`). They give identical answers.

### M4. How do you compute the giant-step factor and take giant steps efficiently?
Compute `G = a^n mod m` once with fast exponentiation (`O(log n)`). Then take giant steps by repeated multiplication `gi = gi·G mod m`, not by re-exponentiating each `i` — that turns `O(log n)` per step into `O(1)`.

### M5. How do you return the smallest `x`?
Store the **smallest** `j` per baby value (insert-if-absent) and scan `i` upward. The first collision found gives the smallest `x`, because giant steps increase the coarse part monotonically.

### M6. How do you handle a general modulus with `gcd(a, m) = g > 1`?
Peel: if `g ∤ b` and `b ≢ 1`, no solution. Otherwise divide `a, b, m` by `g`, add `1` to the answer offset, and repeat until the base is coprime to the reduced modulus; then run ordinary BSGS and add back the offset.

### M7. How does BSGS relate to meet-in-the-middle?
It *is* meet-in-the-middle (sibling `15-divide-and-conquer/06`): split the exponent into a stored half (baby steps) and a streamed half (giant steps). Storing one half and looking up the other turns `√m × √m` into `O(√m)`.

### M8. What modular tools does BSGS rely on?
Modular exponentiation (`a^n mod m`), modular multiplication with reduction to avoid overflow, and — for Form B — the modular inverse `a^{-n}` via extended Euclid (sibling `06`) or Fermat's little theorem when `m` is prime.

### M9. How do you avoid overflow?
Reduce mod `m` after every multiply. In Go/Java, for `m` near `2^{63}`, the product `cur*a` overflows signed 64-bit; use 128-bit intermediates (`__int128`, `math/bits.Mul64`) or Montgomery/Barrett reduction.

### M10. Why is the answer not unique, and what is the period?
If `a^x ≡ b`, then `a^{x+d} ≡ b` too, where `d = ord_m(a)` (since `a^d ≡ 1`). So solutions form an arithmetic progression with period `d`; the smallest lies in `[0, d)`.

### M11. When is BSGS the wrong tool?
When `√m` entries do not fit in memory (use Pollard's rho, `O(1)` space), or when the group order is smooth (use Pohlig-Hellman), or when `m` is a crypto-sized prime (`√m` is infeasible — that is the point of the cryptosystem).

### M12 (analysis). What sets the practical ceiling on BSGS?
**Memory**, not time. `√m` modular multiplies for `m = 10^{16}` is ~`10^8` ops (about a second), but `10^8` hash entries is several GB. So BSGS tops out around `m ≈ 10^{14}` on a commodity machine; beyond that, Pollard's rho.

---

## Senior Questions (10 Q&A)

### S1. Compare BSGS and Pollard's rho for discrete log.
Both are `O(√m)` time. BSGS is deterministic but uses `O(√m)` memory; Pollard's rho is randomized (expected `O(√m)`) but uses `O(1)` memory via a pseudo-random walk plus cycle detection, solving a final linear congruence for `x`. Memory is the deciding factor.

### S2. How does Pollard's rho extract `x` from a collision?
The walk tracks each element as `g^α h^β`. A collision `g^{α1}h^{β1} = g^{α2}h^{β2}` gives `α1−α2 ≡ x(β2−β1) (mod n)`, so `x ≡ (α1−α2)(β2−β1)^{-1} (mod n)` when `n` is prime (else handle the gcd candidates).

### S3. What is the generic-group lower bound and why does it matter?
Shoup's theorem: any algorithm using only group operations needs `Ω(√n)` operations for discrete log in a prime-order-`n` group. So BSGS and rho are generically optimal — you cannot beat `√n` without exploiting the group's specific representation (which index calculus does for `ℤ_p^*`, but is believed impossible for good elliptic curves).

### S4. How does discrete-log hardness secure Diffie-Hellman?
DH publishes `g^a, g^b` over a large prime/curve group; the shared secret is `g^{ab}`. Recovering `a` from `g^a` is exactly discrete log. Since the best generic attack is `√(order)`, the order must have a large prime factor (≥256 bits for 128-bit security); prime fields also face index calculus, so they need ~3072-bit `p`.

### S5. How do you guarantee the smallest `x` under hash collisions?
Two `j` can collide on the same baby value only if `a^{j1} ≡ a^{j2}`. Use insert-if-absent so the map keeps the smaller `j`, and break on the first giant-step hit (scanning `i` upward). Overwriting with the larger `j` is the classic bug that returns a valid but non-minimal `x`.

### S6. When does Pohlig-Hellman beat BSGS?
When the order `n = ∏ p_i^{e_i}` is smooth (small prime factors). Pohlig-Hellman solves per prime power (digit-by-digit, each digit an `O(√p_i)` dlog) and combines via CRT, costing `O(Σ e_i(log n + √p_i)) ≪ √n`. BSGS is the per-factor primitive it calls.

### S7. How do you reduce BSGS memory at the wall?
Use a sorted array of `(value, j)` with binary-search lookups (smaller per-entry overhead, `+log` factor), or a primitive-keyed flat hash map. Optionally skew the block size `n` to trade fewer baby entries for more giant steps. Above the budget, switch to rho.

### S8. How is the discrete-root problem `x^k ≡ b` related?
With a primitive root `g`, set `x = g^y, b = g^c` (two discrete logs). Then `x^k ≡ b ⟺ ky ≡ c (mod φ(m))`, a linear congruence solved by extended Euclid; recover `x = g^y`. So discrete root = discrete log + linear congruence (sibling `12`).

### S9. How do you verify and test a BSGS implementation?
After solving, assert `a^x ≡ b (mod m)` (cheap, `O(log x)`). Keep a brute-force oracle for small `m` and compare the *smallest* `x`. Property-test: `b ≡ 1 → 0`, unsolvable `→ -1`, random solvable inputs verify, and `gcd(a,m)>1` exercises the peel.

### S10 (analysis). Why is discrete log "hard" if BSGS is only `O(√m)`?
`√m = 2^{(log₂ m)/2}` is **exponential in the bit length** of `m`. For crypto-sized `m ≈ 2^{3072}`, `√m ≈ 2^{1536}` operations is utterly infeasible. The same algorithm that cracks a textbook exercise cannot dent a real key — the gap is the entire reason discrete log is both a teaching example and a security foundation.

---

## Professional Questions (8 Q&A)

### P1. Design a service that answers discrete-log queries over a fixed modulus.
For small `m`, each query is one `O(√m)` BSGS. Add a gcd pre-check (coprime fast path vs general-modulus peel), a post-solve verification (`a^x ≡ b`) gating every non-`-1` result, and a memory-budget guard that routes to Pollard's rho when `√m` exceeds a cap. Cache nothing per query unless many queries share `(a, m)` and differ only in `b` — then the baby map for a fixed base can be reused.

### P2. The modulus is `~10^{16}` and BSGS OOMs. What do you do?
`√m ≈ 10^8` map entries is several GB. Switch to Pollard's rho (same `O(√m)` time, `O(1)` space), or shrink the BSGS memory constant with a sorted-array + binary-search map. If the order is known and smooth, Pohlig-Hellman is far better. Never disk-back the BSGS map — the random access destroys locality.

### P3. How do you handle a composite modulus correctly?
Peel `g = gcd(a, m)` factors: if `g ∤ b` and `b ≢ 1`, return `-1`; else divide `a, b, m` by `g`, add 1 to the answer per peel, recurse until coprime, then BSGS. Test small `x = 0..O(log m)` directly first to catch `b ≡ 1 → 0` and the peel's exponent shifts. Cost stays `O(√m)`.

### P4. How do you debug "the discrete log answer is wrong"?
First, verify: does `a^x ≡ b (mod m)` hold? If not, it is a soundness bug (overflow, wrong giant factor). If it holds but is not minimal, it is the overwrite-vs-insert-if-absent bug or a downward `i` scan. Run the brute-force oracle on the same small input and diff the *smallest* `x`. Check `n = ⌈√m⌉` (integer sqrt, not floating).

### P5. When would you choose elliptic-curve over prime-field Diffie-Hellman?
EC groups have no known sub-exponential attack, so only generic `√n` applies; a 256-bit curve gives ~128-bit security. Prime fields face index calculus (`L_p[1/3]`), needing ~3072-bit `p` for the same security. EC wins on key size, bandwidth, and speed — at the cost of more delicate parameter selection.

### P6. How do you parallelize a batch of discrete-log queries?
Independent queries distribute trivially across workers. Within Pollard's rho, run several walks with different starting points in parallel (the "parallel rho" / distinguished-points method gives near-linear speedup). For BSGS, the baby and giant phases are each parallelizable over their `√m` range, with a shared concurrent map for baby steps.

### P7. How do automata-free combinatorics or crypto protocols use discrete log?
Beyond DH: ElGamal encryption and signatures, DSA, Schnorr signatures, and many zero-knowledge proofs all rest on discrete-log hardness. The protocol publishes `g^x` and relies on the eavesdropper being unable to invert it. BSGS/rho define the *generic* attack cost that sets the parameter sizes.

### P8 (analysis). Why must the subgroup order be a large prime in a DH group?
If the order `n` is smooth, Pohlig-Hellman reduces discrete log to `√(largest prime factor)` — potentially trivial. A large prime subgroup order (via a safe prime `p = 2q+1`, subgroup of order `q`) forces any generic attack back up to `√q`. Implementations must also *validate* received public keys lie in the prime-order subgroup to prevent small-subgroup attacks.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an `O(n)` search with a `√n` or logarithmic algorithm.
Look for a concrete story: a search/counting task where the linear scan dominated a profile, the insight that the problem decomposed into two halves (meet-in-the-middle / BSGS-style), the measured speedup, and the correctness check against the old slow version. Strong answers mention the memory trade and the verification step.

### B2. A teammate's discrete-log code returns a valid but non-smallest `x`, failing a grader. How do you help?
Explain calmly that solutions repeat with the order of `a`, so "valid" and "smallest" differ. Point to the likely cause: an overwrite map policy or a downward `i` scan. Suggest insert-if-absent (smallest `j`) and breaking on the first hit, and propose a brute-force oracle to assert minimality. Teaching moment, not blame.

### B3. Design a feature that needs to break a small toy discrete-log puzzle for a CTF / educational tool.
Confirm the modulus size; if `m ≤ 10^{14}`, BSGS with verification is ideal. Handle no-solution (`-1`) and `b ≡ 1` cases, validate inputs, and cap memory. Mention that for "real" crypto sizes this is infeasible by design — a good chance to explain *why* the puzzle is small.

### B4. How would you explain BSGS to a junior engineer?
Start with the tunnel analogy: two diggers from opposite ends meet in the middle, each doing half the work. `A` is "store every landmark in the first `√m` blocks"; giant steps are "drive `√m` blocks at a time and check your landmark list". Lead with the two gotchas: it needs `gcd(a,m)=1` (or a peel) and you must verify the answer. Mentor with pitfalls first.

### B5. Your discrete-log job is consuming too much memory at scale. How do you investigate?
The baby map holds `√m` entries (`~16–64` bytes each). Check whether `m` grew past your memory budget; if so, route to Pollard's rho (`O(1)` space). Confirm you are not duplicating the map per request, and consider a sorted-array map to cut per-entry overhead. Profile allocations; the fix is usually the rho fallback plus a memory guard.

---

## Coding Challenges

### Challenge 1: Solve `a^x ≡ b (mod m)` with BSGS (smallest x)

**Problem.** Given `a, b, m` with `gcd(a, m) = 1`, return the smallest `x ≥ 0` with `a^x ≡ b (mod m)`, or `-1` if none.

**Example.**
```text
a=2, b=3, m=13  ->  4    (2^4 = 16 ≡ 3)
a=2, b=1, m=13  ->  0     (2^0 = 1)
a=3, b=2, m=5   ->  3     (3^3 = 27 ≡ 2)
```

**Constraints.** `2 ≤ m ≤ 10^{12}`, `gcd(a, m) = 1`.

**Optimal.** BSGS, `O(√m)`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func modpow(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func bsgs(a, b, m int64) int64 {
	a %= m
	b %= m
	if b == 1%m {
		return 0
	}
	n := int64(math.Ceil(math.Sqrt(float64(m))))
	table := make(map[int64]int64, n)
	cur := b
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % m
	}
	G := modpow(a, n, m)
	gi := int64(1)
	for i := int64(1); i <= n; i++ {
		gi = gi * G % m
		if j, ok := table[gi]; ok {
			if x := i*n - j; x >= 0 {
				return x
			}
		}
	}
	return -1
}

func main() {
	fmt.Println(bsgs(2, 3, 13)) // 4
	fmt.Println(bsgs(2, 1, 13)) // 0
	fmt.Println(bsgs(3, 2, 5))  // 3
}
```

**Java.**
```java
import java.util.HashMap;
import java.util.Map;

public class BsgsSolve {
    static long modpow(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long bsgs(long a, long b, long m) {
        a %= m; b %= m;
        if (b == 1 % m) return 0;
        long n = (long) Math.ceil(Math.sqrt((double) m));
        Map<Long, Long> table = new HashMap<>();
        long cur = b;
        for (long j = 0; j < n; j++) {
            table.putIfAbsent(cur, j);
            cur = cur * a % m;
        }
        long G = modpow(a, n, m);
        long gi = 1;
        for (long i = 1; i <= n; i++) {
            gi = gi * G % m;
            Long j = table.get(gi);
            if (j != null) {
                long x = i * n - j;
                if (x >= 0) return x;
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(bsgs(2, 3, 13)); // 4
        System.out.println(bsgs(2, 1, 13)); // 0
        System.out.println(bsgs(3, 2, 5));  // 3
    }
}
```

**Python.**
```python
import math


def bsgs(a, b, m):
    a %= m
    b %= m
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
            x = i * n - table[gi]
            if x >= 0:
                return x
    return -1


if __name__ == "__main__":
    print(bsgs(2, 3, 13))  # 4
    print(bsgs(2, 1, 13))  # 0
    print(bsgs(3, 2, 5))   # 3
```

---

### Challenge 2: Discrete Log Modulo a Prime (Form B with inverse)

**Problem.** Given a prime `p`, base `a`, target `b`, return the smallest `x ≥ 0` with `a^x ≡ b (mod p)` using the additive form `x = i·n + j` and the inverse `a^{-n}` (computed by Fermat: `a^{-n} ≡ a^{(p-1) - n}`... or `pow(a^n, p-2, p)`).

**Example.**
```text
a=2, b=3, p=13  ->  4
a=5, b=3, p=23  ->  some x with 5^x ≡ 3 (mod 23)
```

**Constraints.** `p` prime, `2 ≤ p ≤ 10^{12}`.

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func modpow(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

// discrete log mod prime p using Form B; inverse via Fermat.
func dlogPrime(a, b, p int64) int64 {
	a %= p
	b %= p
	n := int64(math.Ceil(math.Sqrt(float64(p))))
	table := make(map[int64]int64, n)
	cur := int64(1) // a^0
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % p
	}
	an := modpow(a, n, p)
	factor := modpow(an, p-2, p) // (a^n)^{-1} mod prime p
	gi := b % p
	for i := int64(0); i < n; i++ {
		if j, ok := table[gi]; ok {
			return i*n + j
		}
		gi = gi * factor % p
	}
	return -1
}

func main() {
	fmt.Println(dlogPrime(2, 3, 13)) // 4
	fmt.Println(dlogPrime(5, 3, 23)) // valid x
}
```

**Java.**
```java
import java.util.HashMap;
import java.util.Map;

public class DlogPrime {
    static long modpow(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long dlogPrime(long a, long b, long p) {
        a %= p; b %= p;
        long n = (long) Math.ceil(Math.sqrt((double) p));
        Map<Long, Long> table = new HashMap<>();
        long cur = 1;
        for (long j = 0; j < n; j++) {
            table.putIfAbsent(cur, j);
            cur = cur * a % p;
        }
        long an = modpow(a, n, p);
        long factor = modpow(an, p - 2, p); // Fermat inverse
        long gi = b % p;
        for (long i = 0; i < n; i++) {
            Long j = table.get(gi);
            if (j != null) return i * n + j;
            gi = gi * factor % p;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(dlogPrime(2, 3, 13)); // 4
        System.out.println(dlogPrime(5, 3, 23));
    }
}
```

**Python.**
```python
import math


def dlog_prime(a, b, p):
    a %= p
    b %= p
    n = math.isqrt(p - 1) + 1
    table = {}
    cur = 1
    for j in range(n):
        table.setdefault(cur, j)
        cur = cur * a % p
    factor = pow(pow(a, n, p), p - 2, p)  # Fermat inverse of a^n
    gi = b % p
    for i in range(n):
        if gi in table:
            return i * n + table[gi]
        gi = gi * factor % p
    return -1


if __name__ == "__main__":
    print(dlog_prime(2, 3, 13))  # 4
    print(dlog_prime(5, 3, 23))
```

---

### Challenge 3: General Modulus Discrete Log (gcd(a, m) may be > 1)

**Problem.** Solve `a^x ≡ b (mod m)` for the smallest `x ≥ 0` for an **arbitrary** modulus `m` (possibly composite, possibly `gcd(a, m) > 1`). Return `-1` if no solution.

**Approach.** Test small `x` directly (covers `b ≡ 1 → 0`); peel `g = gcd(a, m)` factors (return `-1` if `g ∤ b`), adding 1 to the answer per peel; then BSGS on the coprime core.

**Python.**
```python
import math


def bsgs_coprime(a, b, m):
    a %= m
    b %= m
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
            x = i * n - table[gi]
            if x >= 0:
                return x
    return -1


def discrete_log(a, b, m):
    a %= m
    b %= m
    # 1) try small x directly
    k, e = 1 % m, 0
    while e <= 64:
        if k == b % m:
            return e
        k = k * a % m
        e += 1
    # 2) peel gcd factors
    add = 0
    cur_a, cur_b, cur_m = a, b, m
    while True:
        g = math.gcd(cur_a, cur_m)
        if g == 1:
            break
        if cur_b % g != 0:
            return -1
        cur_b //= g
        cur_m //= g
        cur_a_div = (cur_a // g) % cur_m
        # fold the (a/g) factor into b via its inverse mod the reduced modulus
        if math.gcd(cur_a_div, cur_m) == 1 and cur_m > 1:
            cur_b = cur_b * pow(cur_a_div, -1, cur_m) % cur_m
        add += 1
        if cur_m == 1:
            return add  # everything ≡ 0
    sub = bsgs_coprime(cur_a % cur_m, cur_b % cur_m, cur_m)
    return -1 if sub == -1 else sub + add


if __name__ == "__main__":
    print(discrete_log(2, 3, 13))  # 4
    print(discrete_log(4, 8, 12))  # general modulus
```

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func modpow(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func modinv(a, m int64) int64 {
	old_r, r := ((a%m)+m)%m, m
	old_s, s := int64(1), int64(0)
	for r != 0 {
		q := old_r / r
		old_r, r = r, old_r-q*r
		old_s, s = s, old_s-q*s
	}
	if old_r != 1 {
		return -1
	}
	return ((old_s % m) + m) % m
}

func bsgsCoprime(a, b, m int64) int64 {
	a %= m
	b %= m
	n := int64(math.Ceil(math.Sqrt(float64(m))))
	table := make(map[int64]int64, n)
	cur := b
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % m
	}
	G := modpow(a, n, m)
	gi := int64(1)
	for i := int64(1); i <= n; i++ {
		gi = gi * G % m
		if j, ok := table[gi]; ok {
			if x := i*n - j; x >= 0 {
				return x
			}
		}
	}
	return -1
}

func discreteLog(a, b, m int64) int64 {
	a %= m
	b %= m
	k, e := int64(1)%m, int64(0)
	for e <= 64 {
		if k == b%m {
			return e
		}
		k = k * a % m
		e++
	}
	add := int64(0)
	for {
		g := gcd(a, m)
		if g == 1 {
			break
		}
		if b%g != 0 {
			return -1
		}
		b /= g
		m /= g
		ad := (a / g) % m
		if m > 1 && gcd(ad, m) == 1 {
			b = b * modinv(ad, m) % m
		}
		add++
		if m == 1 {
			return add
		}
	}
	sub := bsgsCoprime(((a%m)+m)%m, ((b%m)+m)%m, m)
	if sub == -1 {
		return -1
	}
	return sub + add
}

func main() {
	fmt.Println(discreteLog(2, 3, 13)) // 4
	fmt.Println(discreteLog(4, 8, 12)) // general
}
```

**Java.**
```java
import java.util.HashMap;
import java.util.Map;

public class GeneralDlog {
    static long gcd(long a, long b) { while (b != 0) { long t = a % b; a = b; b = t; } return a; }

    static long modpow(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long modinv(long a, long m) {
        long oldR = ((a % m) + m) % m, r = m, oldS = 1, s = 0;
        while (r != 0) {
            long q = oldR / r;
            long tr = oldR - q * r; oldR = r; r = tr;
            long ts = oldS - q * s; oldS = s; s = ts;
        }
        if (oldR != 1) return -1;
        return ((oldS % m) + m) % m;
    }

    static long bsgsCoprime(long a, long b, long m) {
        a %= m; b %= m;
        long n = (long) Math.ceil(Math.sqrt((double) m));
        Map<Long, Long> table = new HashMap<>();
        long cur = b;
        for (long j = 0; j < n; j++) { table.putIfAbsent(cur, j); cur = cur * a % m; }
        long G = modpow(a, n, m), gi = 1;
        for (long i = 1; i <= n; i++) {
            gi = gi * G % m;
            Long j = table.get(gi);
            if (j != null) { long x = i * n - j; if (x >= 0) return x; }
        }
        return -1;
    }

    static long discreteLog(long a, long b, long m) {
        a %= m; b %= m;
        long k = 1 % m;
        for (long e = 0; e <= 64; e++) {
            if (k == b % m) return e;
            k = k * a % m;
        }
        long add = 0;
        while (true) {
            long g = gcd(a, m);
            if (g == 1) break;
            if (b % g != 0) return -1;
            b /= g; m /= g;
            long ad = (a / g) % m;
            if (m > 1 && gcd(ad, m) == 1) b = b * modinv(ad, m) % m;
            add++;
            if (m == 1) return add;
        }
        long sub = bsgsCoprime(((a % m) + m) % m, ((b % m) + m) % m, m);
        return sub == -1 ? -1 : sub + add;
    }

    public static void main(String[] args) {
        System.out.println(discreteLog(2, 3, 13)); // 4
        System.out.println(discreteLog(4, 8, 12)); // general
    }
}
```

---

### Challenge 4: Smallest x and No-Solution Detection (with verification)

**Problem.** Implement a discrete-log solver that (a) returns the **smallest** `x`, (b) returns `-1` when no solution exists, and (c) **verifies** every non-`-1` answer satisfies `a^x ≡ b (mod m)`. Demonstrate on solvable and unsolvable inputs.

**Python.**
```python
import math


def bsgs(a, b, m):
    a %= m
    b %= m
    if b == 1 % m:
        return 0
    n = math.isqrt(m - 1) + 1
    table = {}
    cur = b
    for j in range(n):
        table.setdefault(cur, j)  # smallest j -> smallest x
        cur = cur * a % m
    G = pow(a, n, m)
    gi = 1
    for i in range(1, n + 1):
        gi = gi * G % m
        if gi in table:           # first hit -> smallest x
            x = i * n - table[gi]
            if x >= 0:
                return x
    return -1


def solve_verified(a, b, m):
    x = bsgs(a, b, m)
    if x != -1:
        assert pow(a, x, m) == b % m, "soundness bug!"
    return x


if __name__ == "__main__":
    print(solve_verified(2, 3, 13))   # 4  (solvable, verified)
    print(solve_verified(2, 1, 13))   # 0  (b ≡ 1)
    # 4 generates only {1, 3, 9} mod 13, so 2 is unreachable:
    print(solve_verified(4, 2, 13))   # -1 (no solution)
```

**Go.**
```go
package main

import (
	"fmt"
	"math"
)

func modpow(a, e, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	r := int64(1)
	for e > 0 {
		if e&1 == 1 {
			r = r * a % m
		}
		a = a * a % m
		e >>= 1
	}
	return r
}

func bsgs(a, b, m int64) int64 {
	a %= m
	b %= m
	if b == 1%m {
		return 0
	}
	n := int64(math.Ceil(math.Sqrt(float64(m))))
	table := make(map[int64]int64, n)
	cur := b
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * a % m
	}
	G := modpow(a, n, m)
	gi := int64(1)
	for i := int64(1); i <= n; i++ {
		gi = gi * G % m
		if j, ok := table[gi]; ok {
			if x := i*n - j; x >= 0 {
				return x
			}
		}
	}
	return -1
}

func solveVerified(a, b, m int64) int64 {
	x := bsgs(a, b, m)
	if x != -1 && modpow(a, x, m) != ((b%m)+m)%m {
		panic("soundness bug!")
	}
	return x
}

func main() {
	fmt.Println(solveVerified(2, 3, 13)) // 4
	fmt.Println(solveVerified(2, 1, 13)) // 0
	fmt.Println(solveVerified(4, 2, 13)) // -1
}
```

**Java.**
```java
import java.util.HashMap;
import java.util.Map;

public class SmallestNoSolution {
    static long modpow(long a, long e, long m) {
        a %= m; if (a < 0) a += m;
        long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % m;
            a = a * a % m;
            e >>= 1;
        }
        return r;
    }

    static long bsgs(long a, long b, long m) {
        a %= m; b %= m;
        if (b == 1 % m) return 0;
        long n = (long) Math.ceil(Math.sqrt((double) m));
        Map<Long, Long> table = new HashMap<>();
        long cur = b;
        for (long j = 0; j < n; j++) { table.putIfAbsent(cur, j); cur = cur * a % m; }
        long G = modpow(a, n, m), gi = 1;
        for (long i = 1; i <= n; i++) {
            gi = gi * G % m;
            Long j = table.get(gi);
            if (j != null) { long x = i * n - j; if (x >= 0) return x; }
        }
        return -1;
    }

    static long solveVerified(long a, long b, long m) {
        long x = bsgs(a, b, m);
        if (x != -1 && modpow(a, x, m) != (((b % m) + m) % m))
            throw new IllegalStateException("soundness bug!");
        return x;
    }

    public static void main(String[] args) {
        System.out.println(solveVerified(2, 3, 13)); // 4
        System.out.println(solveVerified(2, 1, 13)); // 0
        System.out.println(solveVerified(4, 2, 13)); // -1
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Rewrite `x = i·n − j` with `n = ⌈√m⌉`, store baby steps `b·a^j` in a hash map, take giant steps `(a^n)^i`, and a collision gives `x` in `O(√m)`."*
- Immediately flag the gotchas: **needs `gcd(a,m)=1`** (or a peel), **return the smallest `x`** (insert-if-absent + increasing `i`), **`b ≡ 1 → 0`**, and **`-1` for no solution**.
- Always **verify** `a^x ≡ b (mod m)` — it is `O(log x)` and catches almost every bug.
- For memory-bound or huge `m`, mention **Pollard's rho** (`O(√m)` time, `O(1)` space); for smooth order, **Pohlig-Hellman**.
- Close the loop to the big picture: BSGS is the **generic** attack that sets the `√(order)` security level behind **Diffie-Hellman**, and discrete root reduces to discrete log via a **linear congruence**.
