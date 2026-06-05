# Primitive Roots & Discrete Root — Interview Preparation

Primitive roots are a favourite number-theory interview topic because they reward a few crisp insights — *"the order of `a` divides `φ`"*, *"a primitive root has order exactly `φ` and generates every unit"*, *"test `g` with one power per prime factor of `φ`"*, and *"a primitive root linearizes `x^k ≡ a` into `kY ≡ A (mod φ)`"* — and then test whether you can (a) find a generator efficiently, (b) reason about existence (`m ∈ {1,2,4,p^k,2p^k}`), (c) count roots via `gcd(k, φ)`, and (d) connect it to NTT, Diffie-Hellman, and discrete logs. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Order of `a` mod `p` | divide `φ` by its prime factors | `O(ω(φ) log φ)` |
| Is `g` a primitive root? | `g^{(p−1)/q} ≢ 1` for each prime `q | (p−1)` | `O(ω(φ) log φ)` |
| Find a primitive root | try `g = 2, 3, …` with the test | `O(g₀ · ω(φ) log φ)` |
| Number of primitive roots | `φ(φ(m))` | `O(√φ)` |
| Does `m` have a primitive root? | `m ∈ {1, 2, 4, p^k, 2p^k}` | `O(√m)` |
| Does `x^k ≡ a` have a root? | `a^{(p−1)/gcd(k,p−1)} ≡ 1` | `O(log p)` |
| Number of `k`-th roots | `gcd(k, p−1)` (if solvable) | `O(log p)` |
| Solve `x^k ≡ a` (all roots) | primitive root + discrete log + linear congruence | `O(√p)` (BSGS) |

```text
order_test:    g is a primitive root mod p  ⇔  ∀ prime q|(p−1): g^((p−1)/q) ≠ 1
discrete root: x^k ≡ a (mod p)  ⇔  k·ind(x) ≡ ind(a) (mod p−1)   (a linear congruence)
solvable iff:  a^((p−1)/gcd(k,p−1)) ≡ 1 ;   #roots = gcd(k, p−1)
NTT root:      ω = g^((p−1)/N) is a primitive N-th root of unity when N | (p−1)
count:         #primitive roots = φ(φ(m)) ;  #elements of order d = φ(d)
```

Key facts:
- **Order divides `φ`** — never search exponents up to `φ`; test divisors.
- A primitive root exists **only** for `m ∈ {1, 2, 4, p^k, 2p^k}`.
- Finding a generator is **easy**; computing a discrete log is **hard** (the crypto assumption).
- The bottleneck of finding a generator is **factoring `p − 1`**.

---

## Junior Questions (12 Q&A)

### J1. What is the order of an element `a` mod `m`?
The smallest positive `e` with `a^e ≡ 1 (mod m)`. It is the length of `a`'s cycle of powers. It is only defined for units (`gcd(a, m) = 1`).

### J2. What is a primitive root?
A unit `g` whose order equals `φ(m)` — the maximum possible. Its powers `g^0, g^1, …, g^{φ(m)−1}` run through *every* unit, so `g` generates the whole multiplicative group.

### J3. Why does the order of `a` divide `φ(m)`?
By Euler's theorem `a^{φ(m)} ≡ 1`, and if `e = ord(a)`, dividing `φ(m)` by `e` with remainder shows the remainder's power is also `1`; minimality of `e` forces the remainder to be `0`. So `e | φ(m)`.

### J4. How do you test whether `g` is a primitive root mod a prime `p`?
Factor `p − 1` into its distinct primes. For each prime `q | (p − 1)`, check `g^{(p−1)/q} ≢ 1 (mod p)`. If all checks pass, `g` is a primitive root.

### J5. Why that test instead of computing the order directly?
If `g` were not a generator, its order would be a proper divisor of `p − 1`, which would divide `(p−1)/q` for some prime `q`, forcing `g^{(p−1)/q} ≡ 1`. So if none of those powers is `1`, the order must be the full `p − 1`.

### J6. How many primitive roots are there mod `m`?
`φ(φ(m))` of them, if any exist. For `m = 7`: `φ(7) = 6`, `φ(6) = 2`, so there are `2` primitive roots (`3` and `5`).

### J7. Does every modulus have a primitive root?
No. Only `m ∈ {1, 2, 4, p^k, 2p^k}` for an odd prime `p`. For example `8`, `12`, `15`, `16` have none.

### J8. What is the index (discrete log)?
Given a primitive root `g`, every unit `a` is `g^x` for a unique `x`; that `x` is the index of `a`. Indices turn multiplication into addition: `ind(ab) = ind(a) + ind(b) (mod φ)`.

### J9. What is the discrete root problem?
Solving `x^k ≡ a (mod m)` — finding the modular `k`-th root(s) of `a`. With a primitive root it reduces to a linear congruence in the exponent.

### J10. How do you find a primitive root in practice?
Factor `p − 1`, then try `g = 2, 3, 4, …` with the test from J4. The smallest generator is almost always tiny, so this terminates quickly.

### J11. What is `φ(m)` for a prime `p`?
`φ(p) = p − 1` (every number `1..p−1` is coprime to `p`). A primitive root mod `p` therefore has order `p − 1`.

### J12 (analysis). Why is `2` not a primitive root mod `7` but `3` is?
`2^3 = 8 ≡ 1`, so `ord_7(2) = 3 ≠ 6`. But `3^6 ≡ 1` with no smaller exponent, so `ord_7(3) = 6 = φ(7)`, making `3` a generator.

---

## Middle Questions (12 Q&A)

### M1. Prove the order of `g^t` is `φ / gcd(t, φ)` for a generator `g`.
We need the least `e` with `g^{te} ≡ 1`, i.e. `φ | te`. With `d = gcd(t, φ)`, write `t = d t'`, `φ = d φ'`, `gcd(t', φ') = 1`. Then `φ | te ⟺ φ' | e`, so the least `e` is `φ' = φ/d`.

### M2. Why are there exactly `φ(φ(m))` primitive roots?
By M1, `g^t` is a generator iff `gcd(t, φ) = 1`. The number of such `t` in `[0, φ)` is `φ(φ)` by definition of the totient.

### M3. How do you solve `x^k ≡ a (mod p)` using a primitive root?
Write `x = g^Y`, `a = g^A` (with `A` the discrete log of `a`). Then `g^{kY} ≡ g^A`, so `kY ≡ A (mod p−1)` — a linear congruence. Solve for `Y` with extended Euclid; each `Y` gives a root `x = g^Y`.

### M4. When does `x^k ≡ a` have a solution, and how many?
Let `d = gcd(k, p−1)`. It is solvable iff `d | A`, equivalently `a^{(p−1)/d} ≡ 1`. When solvable there are exactly `d` solutions.

### M5. What is the existence test that avoids the discrete log?
`x^k ≡ a (mod p)` is solvable iff `a^{(p−1)/gcd(k, p−1)} ≡ 1 (mod p)`. This is one exponentiation — no generator or discrete log needed. The `k = 2` case is Euler's criterion.

### M6. How do you compute the order of an arbitrary element fast?
Start with `ord = φ`. For each distinct prime `q | φ`, while `q | ord` and `a^{ord/q} ≡ 1`, divide `ord` by `q`. The result is the order. This is `O(ω(φ) log φ)`, not `O(φ)`.

### M7. Why must you use the *distinct* prime factors of `φ` in the test?
The test power is `(p−1)/q` per distinct prime `q`. Repeating a prime (e.g. for `φ = 12 = 2²·3`, testing `q = 2` twice) is redundant; you only need `q ∈ {2, 3}`.

### M8. How does a primitive root relate to the discrete log?
The index map `a ↦ ind_g(a)` is a group isomorphism `(Z/mZ)* ≅ (Z/φZ, +)`. A primitive root is exactly what makes this isomorphism (and hence the discrete log) well-defined.

### M9. Why does NTT need a primitive root?
The NTT (sibling `13`) needs a primitive `N`-th root of unity `ω` for `N = 2^e`. If `N | (p−1)`, then `ω = g^{(p−1)/N}` (with `g` a primitive root) has order exactly `N`, providing the roots of unity the butterfly recursion uses.

### M10. What is the unique-root case?
When `gcd(k, p−1) = 1`, the map `x ↦ x^k` is a bijection, so every `a` has exactly one `k`-th root: `x = a^{k^{-1} mod (p−1)}`. No discrete log is needed.

### M11. How do you handle `x^k ≡ a` when `m` is composite?
Factor `m`, solve in each prime-power factor (which is cyclic for odd primes) via its primitive root, then recombine with CRT (sibling `05`). The total number of roots is the product of per-factor counts.

### M12 (analysis). What is the cost of finding a primitive root, and what dominates?
`O(g₀ · ω(φ) log φ)` for the test/search, where `g₀` (the smallest generator) is tiny. The dominant cost is **factoring `φ`**, which is `O(√φ)` by trial division or `O(φ^{1/4})` by Pollard-Rho.

---

## Senior Questions (10 Q&A)

### S1. How do you find a primitive root mod a large prime efficiently?
The search and test are cheap; the cost is factoring `p − 1`. If you control the prime, pick one with smooth/known `p − 1` (NTT prime `c·2^e + 1`, or safe prime `2q + 1`). Otherwise use Pollard-Rho + Miller-Rabin (siblings `09`, `08`) to factor `p − 1`, then test small `g`.

### S2. How do you pick an NTT-friendly prime and its root of unity?
Choose `p = c·2^e + 1` with `e` large enough for your transform length `N = 2^t ≤ 2^e`. Find any primitive root `g` (often `3`), then `ω = g^{(p−1)/N}` is a primitive `N`-th root of unity. Validate `ω^N ≡ 1` and `ω^{N/2} ≡ −1`. `998244353` (root `3`) is the standard.

### S3. When do primitive roots NOT exist, and what do you do?
Only `m ∈ {1,2,4,p^k,2p^k}` are cyclic. For other `m`, the unit group is a product of cyclic groups; CRT-decompose into prime-power factors, work per factor, recombine. The `2^a` factor (`a ≥ 3`) needs the explicit two-generator structure `⟨−1, 5⟩`.

### S4. How do you lift a generator from `p` to `p^k`?
A primitive root `g` mod `p` is also one mod `p^k` provided `g^{p-1} ≢ 1 (mod p²)`; if that rare condition fails, use `g + p`. For `2p^k`, take the odd member of `{g, g + p^k}`.

### S5. How do you make the discrete-root pipeline fast?
Use the existence fast path (`a^{(p−1)/d} ≡ 1`) when only solvability is needed. When you need roots, use Pohlig-Hellman for the discrete log if `p − 1` is smooth (which NTT/constructed primes guarantee). Factor `φ` once and reuse it.

### S6. Why is finding a generator easy but the discrete log hard?
Finding a generator is a polynomial test once `φ` is factored. Inverting `g^x` (the discrete log) has no known polynomial algorithm; best general is `O(√p)` (BSGS) and index calculus is subexponential. This asymmetry is the basis of Diffie-Hellman.

### S7. How do you avoid overflow when testing generators mod a 64-bit prime?
`g*g % p` overflows `int64` for `p > 2^31`. Use 128-bit intermediate products (`bits.Mul64` in Go, `Math.multiplyHigh`/`BigInteger` in Java, native in Python), or Montgomery multiplication (sibling `14`).

### S8. How would you verify a primitive-root / discrete-root implementation?
Re-substitute: every returned root `x` must satisfy `x^k ≡ a`. Assert the root count equals `gcd(k, φ)`. For generators, scan the full cycle on small `p` and confirm `φ` distinct values. Cross-check the existence form against actually finding a root.

### S9. What is the use of a primitive root in Diffie-Hellman?
DH works in a cyclic group `⟨g⟩` mod a prime `p`; `g` is a generator (of the whole group or a large prime-order subgroup). Both parties exponentiate `g`, and security rests on the discrete log being hard. You usually use a subgroup generator `g^{(p−1)/q}` of prime order `q`, not the full primitive root.

### S10 (analysis). Why does the spectral/closed-form approach not help find the smallest generator?
There is no closed form for the smallest primitive root; you must search. The smallest generator is conjectured `O(log^6 p)` (and tiny in practice), so iterating `g = 2, 3, …` with the prime-factor test is both correct and fast — no algebraic shortcut exists.

---

## Professional Questions (8 Q&A)

### P1. Design a service that solves `x^k ≡ a (mod m)` for arbitrary `m`.
Factor `m` into prime powers. Validate cyclicity per factor; for odd `p^e` find a generator (lift from `p`), for `2^a` use the two-generator structure. In each factor solve `kY ≡ A (mod φ)` via discrete log + extended Euclid, enumerate `gcd(k, φ)` roots, then CRT-combine across factors (root count = product). Offer an existence-only fast path that skips the discrete log.

### P2. How do you handle the case where `p − 1` cannot be factored?
You cannot find a primitive root without factoring `p − 1`. If you control the prime, choose one with a published or smooth `p − 1`. If not, and `p − 1` has a large prime factor (e.g. a cryptographic safe prime), generator-finding for the *full* group is still feasible (the factorization `2q` is known), but the discrete log is intractable — which is the point for crypto.

### P3. Your modulus is `2^32`. Find a "generator". What do you tell the team?
`2^32` (a power of two ≥ 8) has **no** primitive root — `(Z/2^aZ)*` is not cyclic for `a ≥ 3`. The structure is `⟨−1⟩ × ⟨5⟩ ≅ Z/2Z × Z/2^{a-2}Z`. For full-period multiplicative sequences use this two-generator structure, or switch to an odd prime modulus.

### P4. How do you debug "the discrete root is wrong" in production?
Re-substitute each root into `x^k ≡ a (mod m)`; a failure isolates the bug to the linear-congruence or enumeration step. Check three suspects: used Fermat inverse mod the composite `p − 1` (must use extended Euclid), forgot to divide the congruence by `gcd(k, p−1)`, or generated only one `Y` instead of all `gcd` shifts. Assert the count equals `gcd(k, φ)`.

### P5. When is a primitive root the wrong tool for a square root?
For `k = 2` mod a prime, Tonelli-Shanks computes a square root in `O(log² p)` *without* factoring `p − 1` or finding a generator. The primitive-root method needs the factorization and a discrete log. Use Tonelli-Shanks for square roots specifically; reserve the generator method for general `k`.

### P6. How do you generate deterministic full-period test data?
Pick a prime `p` and a primitive root `g`; the sequence `x_{n+1} = g·x_n mod p` (a Lehmer generator) visits every nonzero residue exactly once per period of `p − 1`. This gives reproducible, exhaustive coverage of the residue space — useful for fuzzing and test fixtures.

### P7. How do automata/cryptography connect to this topic?
Cryptography: Diffie-Hellman, ElGamal, DSA all rely on a generator of a cyclic group and the hardness of the discrete log. NTT (signal/polynomial processing) needs a primitive root of a special prime to get roots of unity. Both reduce multiplicative structure to the index world a primitive root provides.

### P8 (analysis). Why is the existence form `a^{(p−1)/d} ≡ 1` equivalent to solvability?
Writing `a = g^A`, `d = gcd(k, p−1)`: `a^{(p−1)/d} = g^{A(p−1)/d} ≡ 1 ⟺ (p−1) | A(p−1)/d ⟺ d | A`, which is exactly the linear-congruence solvability condition `kY ≡ A (mod p−1)`. So the one exponentiation decides solvability without computing `A`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a brute-force modular search with a structured algorithm.
Look for a concrete story: computing an order or generator by iterating all exponents (`O(φ)`), profiling it as the bottleneck, then switching to the divisor-reduction / prime-factor test (`O(ω(φ) log φ)`), with a measured speedup and a correctness check against the old slow version on small inputs.

### B2. A teammate searched for a primitive root mod a power of two and the job hung. How do you handle it?
Explain calmly that `(Z/2^aZ)*` is not cyclic for `a ≥ 3`, so no primitive root exists and the search can never succeed. Add an existence gate (`m ∈ {1,2,4,p^k,2p^k}`) before any search. Suggest the two-generator structure or an odd prime modulus. Frame it as a teaching moment about the existence theorem.

### B3. Design a feature to pick an NTT modulus for a polynomial-multiplication library.
Choose a prime `p = c·2^e + 1` with `e` covering the max transform size, find a primitive root (usually `3`), derive `ω = g^{(p−1)/N}`, and validate `ω^N ≡ 1`, `ω^{N/2} ≡ −1`. Discuss multiple coprime NTT primes + CRT (sibling `15`) when coefficients exceed one prime, and `998244353` as the default. Mention overflow-safe modular multiply.

### B4. How would you explain primitive roots to a junior engineer?
Use the clock analogy: a primitive root is a "stride" whose repeated steps land on *every* hour mark before returning to 12, while a non-generator only hits a few marks. Then show the payoff — once you have such a stride, "multiply" becomes "add stride counts," which turns `x^k ≡ a` into a simple linear equation. Lead with the two gotchas: not every modulus has one, and the discrete log is hard.

### B5. Your discrete-root service is slow under load. How do you investigate?
Profile the stages: factoring `φ` and the discrete log dominate. Confirm `φ` is factored once and cached, not per request. Add the existence fast path so solvability-only queries skip the discrete log. If `p − 1` is smooth, switch the log to Pohlig-Hellman. Verify modular multiply is not falling back to bignum unnecessarily.

---

## Coding Challenges

### Challenge 1: Multiplicative Order

**Problem.** Given a prime `p` and a unit `a` (`1 ≤ a < p`), return `ord_p(a)`, the smallest `e > 0` with `a^e ≡ 1 (mod p)`.

**Example.**
```text
p = 7, a = 2  ->  3   (2^3 = 8 ≡ 1)
p = 7, a = 3  ->  6   (3 is a primitive root)
```

**Constraints.** `2 ≤ p ≤ 10^{12}` (prime), `1 ≤ a < p`.

**Approach.** Factor `p − 1`. Start `ord = p − 1`; for each distinct prime `q | (p−1)`, divide `ord` by `q` while `a^{ord/q} ≡ 1`. `O(ω(p−1) log p)` after factoring.

**Go.**
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

func distinctPrimes(n int64) []int64 {
	var fs []int64
	for d := int64(2); d*d <= n; d++ {
		if n%d == 0 {
			fs = append(fs, d)
			for n%d == 0 {
				n /= d
			}
		}
	}
	if n > 1 {
		fs = append(fs, n)
	}
	return fs
}

func order(a, p int64) int64 {
	ord := p - 1
	for _, q := range distinctPrimes(p - 1) {
		for ord%q == 0 && power(a, ord/q, p) == 1 {
			ord /= q
		}
	}
	return ord
}

func main() {
	fmt.Println(order(2, 7)) // 3
	fmt.Println(order(3, 7)) // 6
}
```

**Java.**
```java
public class Order {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static java.util.List<Long> distinctPrimes(long n) {
        java.util.List<Long> fs = new java.util.ArrayList<>();
        for (long d = 2; d * d <= n; d++)
            if (n % d == 0) { fs.add(d); while (n % d == 0) n /= d; }
        if (n > 1) fs.add(n);
        return fs;
    }

    static long order(long a, long p) {
        long ord = p - 1;
        for (long q : distinctPrimes(p - 1))
            while (ord % q == 0 && power(a, ord / q, p) == 1) ord /= q;
        return ord;
    }

    public static void main(String[] args) {
        System.out.println(order(2, 7)); // 3
        System.out.println(order(3, 7)); // 6
    }
}
```

**Python.**
```python
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


def order(a, p):
    ord_ = p - 1
    for q in distinct_primes(p - 1):
        while ord_ % q == 0 and pow(a, ord_ // q, p) == 1:
            ord_ //= q
    return ord_


if __name__ == "__main__":
    print(order(2, 7))  # 3
    print(order(3, 7))  # 6
```

---

### Challenge 2: Find a Primitive Root

**Problem.** Given a prime `p`, return the smallest primitive root mod `p`.

**Example.**
```text
p = 7   ->  3
p = 13  ->  2
p = 998244353  ->  3
```

**Constraints.** `2 ≤ p ≤ 10^{12}` (prime).

**Approach.** Factor `p − 1` once. Test `g = 2, 3, …`: `g` is a generator iff `g^{(p−1)/q} ≢ 1` for every prime `q | (p−1)`.

**Go.**
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

func distinctPrimes(n int64) []int64 {
	var fs []int64
	for d := int64(2); d*d <= n; d++ {
		if n%d == 0 {
			fs = append(fs, d)
			for n%d == 0 {
				n /= d
			}
		}
	}
	if n > 1 {
		fs = append(fs, n)
	}
	return fs
}

func primitiveRoot(p int64) int64 {
	if p == 2 {
		return 1
	}
	phi := p - 1
	primes := distinctPrimes(phi)
	for g := int64(2); g < p; g++ {
		ok := true
		for _, q := range primes {
			if power(g, phi/q, p) == 1 {
				ok = false
				break
			}
		}
		if ok {
			return g
		}
	}
	return -1
}

func main() {
	fmt.Println(primitiveRoot(7))         // 3
	fmt.Println(primitiveRoot(13))        // 2
	fmt.Println(primitiveRoot(998244353)) // 3
}
```

**Java.**
```java
public class FindRoot {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }

    static java.util.List<Long> distinctPrimes(long n) {
        java.util.List<Long> fs = new java.util.ArrayList<>();
        for (long d = 2; d * d <= n; d++)
            if (n % d == 0) { fs.add(d); while (n % d == 0) n /= d; }
        if (n > 1) fs.add(n);
        return fs;
    }

    static long primitiveRoot(long p) {
        if (p == 2) return 1;
        long phi = p - 1;
        var primes = distinctPrimes(phi);
        for (long g = 2; g < p; g++) {
            boolean ok = true;
            for (long q : primes) if (power(g, phi / q, p) == 1) { ok = false; break; }
            if (ok) return g;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(primitiveRoot(7));          // 3
        System.out.println(primitiveRoot(13));         // 2
        System.out.println(primitiveRoot(998244353L)); // 3
    }
}
```

**Python.**
```python
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


def primitive_root(p):
    if p == 2:
        return 1
    phi = p - 1
    primes = distinct_primes(phi)
    for g in range(2, p):
        if all(pow(g, phi // q, p) != 1 for q in primes):
            return g
    return -1


if __name__ == "__main__":
    print(primitive_root(7))          # 3
    print(primitive_root(13))         # 2
    print(primitive_root(998244353))  # 3
```

---

### Challenge 3: Solve `x^k ≡ a (mod p)`

**Problem.** Given a prime `p`, exponent `k`, and target `a`, return all solutions `x` to `x^k ≡ a (mod p)`, sorted. Return an empty list if none.

**Example.**
```text
p = 13, k = 3, a = 5  ->  [7, 8, 11]   (three cube roots)
p = 13, k = 3, a = 2  ->  []           (2 is not a cube mod 13)
p = 13, k = 2, a = 4  ->  [2, 11]      (square roots of 4)
```

**Constraints.** `2 ≤ p ≤ 10^9` (prime), `1 ≤ k`, `0 ≤ a < p`.

**Approach.** Find a primitive root `g`, compute `A = ind_g(a)` by BSGS, solve `kY ≡ A (mod p−1)` (solvable iff `gcd(k, p−1) | A`), and emit `gcd(k, p−1)` roots `g^Y`.

**Python.**
```python
from math import gcd, isqrt


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


def primitive_root(p):
    if p == 2:
        return 1
    phi = p - 1
    primes = distinct_primes(phi)
    for g in range(2, p):
        if all(pow(g, phi // q, p) != 1 for q in primes):
            return g
    return -1


def discrete_log(g, a, p):
    n = isqrt(p) + 1
    table, cur = {}, 1
    for j in range(n):
        table.setdefault(cur, j)
        cur = cur * g % p
    factor = pow(g, p - 1 - n, p)
    gamma = a % p
    for i in range(n):
        if gamma in table:
            return i * n + table[gamma]
        gamma = gamma * factor % p
    return -1


def solve_kth_root(k, a, p):
    a %= p
    if a == 0:
        return [0]
    g = primitive_root(p)
    A = discrete_log(g, a, p)
    phi = p - 1
    d = gcd(k, phi)
    if A % d != 0:
        return []
    k2, A2, phi2 = k // d, A // d, phi // d
    Y0 = (A2 % phi2) * pow(k2 % phi2, -1, phi2) % phi2
    return sorted({pow(g, (Y0 + i * phi2) % phi, p) for i in range(d)})


if __name__ == "__main__":
    print(solve_kth_root(3, 5, 13))  # [7, 8, 11]
    print(solve_kth_root(3, 2, 13))  # []
    print(solve_kth_root(2, 4, 13))  # [2, 11]
```

**Go.**
```go
package main

import (
	"fmt"
	"math"
	"sort"
)

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

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func invMod(a, m int64) int64 {
	a = ((a % m) + m) % m
	_, x, _ := extgcd(a, m)
	return ((x % m) + m) % m
}

func distinctPrimes(n int64) []int64 {
	var fs []int64
	for d := int64(2); d*d <= n; d++ {
		if n%d == 0 {
			fs = append(fs, d)
			for n%d == 0 {
				n /= d
			}
		}
	}
	if n > 1 {
		fs = append(fs, n)
	}
	return fs
}

func primitiveRoot(p int64) int64 {
	if p == 2 {
		return 1
	}
	phi := p - 1
	primes := distinctPrimes(phi)
	for g := int64(2); g < p; g++ {
		ok := true
		for _, q := range primes {
			if power(g, phi/q, p) == 1 {
				ok = false
				break
			}
		}
		if ok {
			return g
		}
	}
	return -1
}

func discreteLog(g, a, p int64) int64 {
	n := int64(math.Sqrt(float64(p))) + 1
	table := map[int64]int64{}
	var cur int64 = 1
	for j := int64(0); j < n; j++ {
		if _, ok := table[cur]; !ok {
			table[cur] = j
		}
		cur = cur * g % p
	}
	factor := power(g, p-1-n, p)
	gamma := a % p
	for i := int64(0); i < n; i++ {
		if j, ok := table[gamma]; ok {
			return i*n + j
		}
		gamma = gamma * factor % p
	}
	return -1
}

func solveKthRoot(k, a, p int64) []int64 {
	a %= p
	if a == 0 {
		return []int64{0}
	}
	g := primitiveRoot(p)
	A := discreteLog(g, a, p)
	phi := p - 1
	d := gcd(k, phi)
	if A%d != 0 {
		return nil
	}
	k2, A2, phi2 := k/d, A/d, phi/d
	Y0 := (A2 % phi2) * invMod(k2, phi2) % phi2
	set := map[int64]bool{}
	for i := int64(0); i < d; i++ {
		set[power(g, (Y0+i*phi2)%phi, p)] = true
	}
	var out []int64
	for v := range set {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func main() {
	fmt.Println(solveKthRoot(3, 5, 13)) // [7 8 11]
	fmt.Println(solveKthRoot(3, 2, 13)) // []
	fmt.Println(solveKthRoot(2, 4, 13)) // [2 11]
}
```

**Java.**
```java
import java.util.*;

public class DiscreteRoot {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long inv(long a, long m) {
        a = ((a % m) + m) % m;
        return ((extgcd(a, m)[1] % m) + m) % m;
    }
    static List<Long> distinctPrimes(long n) {
        List<Long> fs = new ArrayList<>();
        for (long d = 2; d * d <= n; d++)
            if (n % d == 0) { fs.add(d); while (n % d == 0) n /= d; }
        if (n > 1) fs.add(n);
        return fs;
    }
    static long primitiveRoot(long p) {
        if (p == 2) return 1;
        long phi = p - 1;
        var primes = distinctPrimes(phi);
        for (long g = 2; g < p; g++) {
            boolean ok = true;
            for (long q : primes) if (power(g, phi / q, p) == 1) { ok = false; break; }
            if (ok) return g;
        }
        return -1;
    }
    static long discreteLog(long g, long a, long p) {
        long n = (long) Math.sqrt(p) + 1;
        Map<Long, Long> table = new HashMap<>();
        long cur = 1;
        for (long j = 0; j < n; j++) { table.putIfAbsent(cur, j); cur = cur * g % p; }
        long factor = power(g, p - 1 - n, p), gamma = a % p;
        for (long i = 0; i < n; i++) {
            Long j = table.get(gamma);
            if (j != null) return i * n + j;
            gamma = gamma * factor % p;
        }
        return -1;
    }
    static List<Long> solveKthRoot(long k, long a, long p) {
        a %= p;
        if (a == 0) return List.of(0L);
        long g = primitiveRoot(p), A = discreteLog(g, a, p), phi = p - 1, d = gcd(k, phi);
        if (A % d != 0) return List.of();
        long k2 = k / d, A2 = A / d, phi2 = phi / d;
        long Y0 = (A2 % phi2) * inv(k2, phi2) % phi2;
        TreeSet<Long> set = new TreeSet<>();
        for (long i = 0; i < d; i++) set.add(power(g, (Y0 + i * phi2) % phi, p));
        return new ArrayList<>(set);
    }
    public static void main(String[] args) {
        System.out.println(solveKthRoot(3, 5, 13)); // [7, 8, 11]
        System.out.println(solveKthRoot(3, 2, 13)); // []
        System.out.println(solveKthRoot(2, 4, 13)); // [2, 11]
    }
}
```

---

### Challenge 4: Count `k`-th Roots

**Problem.** Given a prime `p`, exponent `k`, and `a`, return how many `x` satisfy `x^k ≡ a (mod p)` — *without* enumerating them. Use the existence form `a^{(p−1)/d} ≡ 1` (`d = gcd(k, p−1)`): the count is `d` if it holds, else `0`.

**Example.**
```text
p = 13, k = 3, a = 5  ->  3
p = 13, k = 3, a = 2  ->  0
p = 13, k = 2, a = 4  ->  2
```

**Constraints.** `2 ≤ p ≤ 10^{18}` (prime), `1 ≤ k`, `0 ≤ a < p`. One exponentiation — no discrete log.

**Go.**
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

func gcd(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func countKthRoots(k, a, p int64) int64 {
	a %= p
	if a == 0 {
		return 1 // only x = 0
	}
	d := gcd(k, p-1)
	if power(a, (p-1)/d, p) == 1 {
		return d
	}
	return 0
}

func main() {
	fmt.Println(countKthRoots(3, 5, 13)) // 3
	fmt.Println(countKthRoots(3, 2, 13)) // 0
	fmt.Println(countKthRoots(2, 4, 13)) // 2
}
```

**Java.**
```java
public class CountRoots {
    static long power(long a, long e, long mod) {
        a %= mod; long r = 1;
        while (e > 0) {
            if ((e & 1) == 1) r = r * a % mod;
            a = a * a % mod;
            e >>= 1;
        }
        return r;
    }
    static long gcd(long a, long b) { return b == 0 ? a : gcd(b, a % b); }

    static long countKthRoots(long k, long a, long p) {
        a %= p;
        if (a == 0) return 1;
        long d = gcd(k, p - 1);
        return power(a, (p - 1) / d, p) == 1 ? d : 0;
    }

    public static void main(String[] args) {
        System.out.println(countKthRoots(3, 5, 13)); // 3
        System.out.println(countKthRoots(3, 2, 13)); // 0
        System.out.println(countKthRoots(2, 4, 13)); // 2
    }
}
```

**Python.**
```python
from math import gcd


def count_kth_roots(k, a, p):
    a %= p
    if a == 0:
        return 1  # only x = 0
    d = gcd(k, p - 1)
    return d if pow(a, (p - 1) // d, p) == 1 else 0


if __name__ == "__main__":
    print(count_kth_roots(3, 5, 13))  # 3
    print(count_kth_roots(3, 2, 13))  # 0
    print(count_kth_roots(2, 4, 13))  # 2
```

---

## Final Tips

- Lead with the one-liner: *"the order divides `φ`; a primitive root has order exactly `φ` and generates every unit; test it with one power per prime factor of `φ`."*
- Immediately flag the two gotchas: **primitive roots exist only for `m ∈ {1,2,4,p^k,2p^k}`**, and **finding a generator is easy but the discrete log is hard**.
- For `x^k ≡ a`, reach for the **index trick**: it becomes the linear congruence `kY ≡ A (mod φ)`, with `gcd(k, φ)` roots when `a^{(p−1)/gcd(k,φ)} ≡ 1`.
- For solvability-only questions, mention the **existence fast path** that skips the discrete log entirely.
- Connect to **NTT** (`ω = g^{(p−1)/N}`) and **Diffie-Hellman** (subgroup generator) to show you know where this is used.
- Always offer to verify by **re-substitution** (`x^k ≡ a`) and by the **root count** `gcd(k, φ)`.
