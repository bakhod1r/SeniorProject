# Extended Euclidean Algorithm & Modular Inverse — Interview Preparation

The extended Euclidean algorithm and the modular inverse are favourite interview topics because they reward a single crisp insight — *"from `a·x + m·y = 1`, the Bezout `x` is `a⁻¹ mod m`"* — and then test whether you can (a) write extended Euclid correctly (recursive and iterative), (b) know *when* an inverse exists (`gcd = 1`) and detect when it does not, (c) choose between extended Euclid and Fermat, (d) compute all inverses `1..n` in `O(n)`, and (e) solve the general congruence `a·x ≡ b (mod m)` including its full solution set. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| `gcd(a, b)` with Bezout coefficients | extended Euclid → `(g, x, y)` | `O(log min(a,b))` |
| `a⁻¹ mod m` (any coprime `m`) | extended Euclid, take `x mod m` | `O(log m)` |
| `a⁻¹ mod p` (`p` prime) | Fermat `a^(p-2) mod p` | `O(log p)` |
| Does `a⁻¹ mod m` exist? | check `gcd(a, m) == 1` | `O(log m)` |
| All inverses `1..n` mod prime `p` | `inv[i] = -(p/i)·inv[p%i] % p` | `O(n)` |
| Solve `a·x ≡ b (mod m)` | extended Euclid, check `g | b` | `O(log m)` |
| RSA private exponent `d` | `e⁻¹ mod φ(n)`, extended Euclid | `O(log φ)` |

Inverse-method decision (the multiply changes; the skeleton does not):

```text
modulus prime, just need inverse        -> Fermat  a^(p-2)
modulus composite OR need Bezout coeffs -> extended Euclid
many inverses of 1..n mod a prime       -> O(n) table recurrence
arbitrary batch of inverses             -> Montgomery's one-inversion trick
```

Core algorithm:

```text
extgcd(a, b):
    if b == 0: return (a, 1, 0)
    (g, x1, y1) = extgcd(b, a mod b)
    return (g, y1, x1 - (a / b) * y1)     # floor division

modInverse(a, m):
    (g, x, _) = extgcd(a mod m, m)
    if g != 1: return NONE                # inverse exists iff gcd(a,m)=1
    return ((x mod m) + m) mod m          # normalize to [0, m)
```

Key facts:
- **Inverse exists iff `gcd(a, m) = 1`** (coprime). `0` is never invertible.
- From `a·x + m·y = 1`, the inverse is `x`, **not** `y`.
- Raw Bezout `x` is often **negative** → normalize into `[0, m)`.
- `a·x ≡ b (mod m)` is solvable **iff `gcd(a, m) | b`**, then has `gcd(a, m)` solutions.

---

## Junior Questions (12 Q&A)

### J1. What does the extended Euclidean algorithm return?
A triple `(g, x, y)` where `g = gcd(a, b)` and `x, y` satisfy Bezout's identity `a·x + b·y = g`. The ordinary gcd returns only `g`; the extended version also gives the coefficients.

### J2. What is a modular inverse?
The number `a⁻¹` with `a · a⁻¹ ≡ 1 (mod m)`. It is the "undo" of multiplication mod `m`: to divide by `a`, you multiply by `a⁻¹`.

### J3. When does a modular inverse exist?
Exactly when `gcd(a, m) = 1` — when `a` and `m` are coprime. If they share a factor greater than 1, no inverse exists.

### J4. How do you get the inverse from extended Euclid?
Run it on `(a, m)` to get `a·x + m·y = g`. If `g = 1`, reduce mod `m`: the `m·y` term vanishes, leaving `a·x ≡ 1`, so `x mod m` is the inverse.

### J5. Why must you normalize the result?
The Bezout `x` is often negative. The canonical inverse lives in `[0, m)`, so apply `((x % m) + m) % m` (a single `% m` may stay negative in Go/Java).

### J6. What is Bezout's identity?
The fact that for any `a, b` not both zero, integers `x, y` exist with `a·x + b·y = gcd(a, b)`. The extended algorithm constructs them.

### J7. Can `0` have an inverse?
No. `gcd(0, m) = m ≠ 1` for `m > 1`, so `0` is never invertible. There is no `x` with `0·x ≡ 1`.

### J8. What is the inverse of `1`? Of `m-1`?
`1⁻¹ = 1` always. `(m-1)⁻¹ = m-1`, because `(m-1)² = m² - 2m + 1 ≡ 1 (mod m)` (i.e. `(-1)² = 1`).

### J9. What is the time complexity of extended Euclid?
`O(log min(a, b))` — the same fast, Fibonacci-bounded step count as the ordinary Euclidean algorithm, plus two coefficient updates per step.

### J10. Which coefficient is the inverse, `x` or `y`?
`x` — the coefficient multiplying `a` in `a·x + m·y = 1`. The `y` coefficient multiplies the modulus and is discarded for the inverse.

### J11. What's the base case of the recursion?
`extgcd(a, 0) = (a, 1, 0)`, because `a·1 + 0·0 = a = gcd(a, 0)`.

### J12 (analysis). Why is `gcd(a, m) = 1` necessary for an inverse?
If `gcd(a, m) = d > 1`, every product `a·x` is a multiple of `d`, so `a·x mod m` always lands on a multiple of `d`. Since `1` is not a multiple of `d` (and `m` is), `a·x ≡ 1` is impossible.

---

## Middle Questions (12 Q&A)

### M1. Derive the extended-Euclid coefficient update.
The recursive call on `(b, a mod b)` returns `(g, x₁, y₁)` with `b·x₁ + (a mod b)·y₁ = g`. Substituting `a mod b = a - (a/b)·b` gives `a·y₁ + b·(x₁ - (a/b)·y₁) = g`, so `x = y₁`, `y = x₁ - (a/b)·y₁`.

### M2. Extended Euclid vs Fermat for the inverse — which when?
Both are `O(log m)`. Fermat (`a^(p-2)`) requires a **prime** modulus and does not detect non-existence. Extended Euclid works for **any** coprime `m` and returns `g ≠ 1` when no inverse exists. Prime modulus + just an inverse → Fermat; otherwise extended Euclid.

### M3. How do you compute all inverses `1..n` mod a prime in `O(n)`?
Use `inv[1] = 1` and `inv[i] = -(p/i)·inv[p%i] % p`. Derived from `p = (p/i)·i + (p mod i) ≡ 0 (mod p)`, multiply by `i⁻¹(p mod i)⁻¹`. Each `inv[p%i]` is already known since `p%i < i`.

### M4. When is `a·x ≡ b (mod m)` solvable, and how many solutions?
Let `g = gcd(a, m)`. Solvable **iff `g | b`**. When solvable there are exactly `g` solutions mod `m`, spaced `m/g` apart. If `g = 1`, the unique solution is `a⁻¹·b mod m`.

### M5. Give the full solution set of a solvable congruence.
If `x₀` is a particular solution (`x₀ = x'·(b/g) mod (m/g)` from extended Euclid), the solutions are `x₀, x₀ + m/g, x₀ + 2m/g, …, x₀ + (g-1)·m/g`, all taken mod `m`.

### M6. Why is the inverse unique mod `m`?
If `a·x ≡ a·x' ≡ 1`, then `a(x - x') ≡ 0`; multiply by `a⁻¹` to get `x ≡ x' (mod m)`. So there is one canonical inverse in `[0, m)`.

### M7. How does Euler's theorem generalize Fermat?
For `gcd(a, m) = 1`, `a^(φ(m)) ≡ 1 (mod m)`, so `a⁻¹ = a^(φ(m)-1)`. Fermat is the prime case `φ(p) = p-1`. But Euler needs `φ(m)`, which requires factoring `m` — usually harder than extended Euclid.

### M8. How do you avoid overflow computing an inverse for a 64-bit modulus?
The `q*s` coefficient product can reach `~m²`. Use 128-bit intermediates (`__int128`, `Math.multiplyHigh`, or big integers), or use a language with arbitrary precision (Python). Also use `mulmod` for the post-inversion multiply.

### M9. What does the iterative extended Euclid maintain?
The invariant `r = s·a + t·b` for the running remainder `r` and coefficient pair `(s, t)`, updated identically by the Euclidean step. When `r = 0`, the previous row holds `(g, x, y)`.

### M10. How do you compute factorial inverses for binomial coefficients?
Compute `fact[i]` forward, invert `fact[n]` **once**, then sweep backward `invfact[i-1] = invfact[i]·i`. This gives all factorial inverses in `O(n)` with a single inversion — used for `C(n, k) = fact[n]·invfact[k]·invfact[n-k]`.

### M11. Why can't the `O(n)` table use a composite modulus?
The recurrence multiplies by `(p mod i)⁻¹`, which must exist for every `i ≤ n`. That needs `gcd(i, m) = 1` for all `i ≤ n`, guaranteed by `m` prime and `m > n`. A composite `m` has some non-invertible `i`.

### M12 (analysis). What is the worst case for the number of Euclidean steps?
Consecutive Fibonacci numbers. If the algorithm takes `k` steps, then `b ≥ F_{k+1}`, so `k = O(log_φ b)` — Lamé's theorem. This bounds extended Euclid at `O(log min(a, b))`.

---

## Senior Questions (10 Q&A)

### S1. How would you compute the RSA private exponent?
`d = e⁻¹ mod φ(n)`, where `φ(n) = (p-1)(q-1)` is composite. Since the modulus is composite, use extended Euclid (or a library `modInverse`), not Fermat. Validate with `e·d ≡ 1 (mod φ(n))`. CRT-RSA also needs `qinv = q⁻¹ mod p`.

### S2. When does extended Euclid leak information, and how do you fix it?
Its iteration count and branches depend on the operand values, leaking timing about secret inputs (e.g., ECDSA nonce inverse). For secret operands, use a constant-time inverse: Fermat-exponentiation with a fixed ladder (prime modulus) or the Bernstein-Yang "safegcd" (general modulus).

### S3. How do you invert many arbitrary elements cheaply?
Montgomery's batch trick: form running products `prefix[i]`, do **one** inversion of the total product, then walk backward computing each `a_i⁻¹` with two multiplications. This turns `n` inversions into one inversion plus `O(n)` mults — inversion is far costlier than multiplication.

### S4. How do you handle a modulus that may not be coprime to `a`?
The inverse function must return a typed failure (`None`/`Optional`/`error`), never an in-band sentinel like `0` (a valid residue). For the *congruence* `a·x ≡ b`, fall through to the general solver: if `gcd(a,m) | b`, return all `g` solutions; otherwise no solution.

### S5. Extended Euclid vs library inverse in production?
Prefer the library (`big.Int.ModInverse`, `BigInteger.modInverse`, `pow(a, -1, m)`): it is tested, handles signs/existence, and uses half-GCD internally for big integers. Hand-roll only when you need the Bezout *coefficients* or a constant-time guarantee the library lacks.

### S6. How do you make the inverse-table trick work and why is it `O(n)`?
Because each `inv[i]` depends only on `inv[p % i]` with `p % i < i`, every dependency is already computed in the increasing-`i` pass — one multiply and one negate per index, `O(n)` total, versus `O(n log p)` for `n` separate inversions.

### S7. How do you verify an inverse you cannot easily recompute by hand?
Assert `(a * inv) % m == 1` — the definitive, cheap test. Add property tests: Bezout `a·x + m·y == g`, sign `0 ≤ inv < m`, cross-check Fermat against extended Euclid for prime moduli, and plug congruence solutions back into `a·x ≡ b`.

### S8. Why is Fermat sometimes preferred even though both are `O(log m)`?
Fermat is a single fast-power call — minimal, branch-poor code that reuses an existing `modpow`, and (with a fixed ladder) constant-time. Extended Euclid has data-dependent branches and the sign-normalization step. For a fixed prime modulus, Fermat is often the cleaner, more side-channel-friendly choice.

### S9. How do you solve `a·x ≡ b (mod m)` when `gcd(a, m) > 1`?
Compute `g = gcd(a, m)`. If `g ∤ b`, no solution. Else reduce: `(a/g)·x ≡ (b/g) (mod m/g)`, where now `gcd(a/g, m/g) = 1`, solve by inverse for `x₀`, then the `g` solutions are `x₀ + t·(m/g)` mod `m` for `t = 0..g-1`.

### S10 (analysis). Why does Euler-based inversion rarely beat extended Euclid?
`a⁻¹ = a^(φ(m)-1)` needs `φ(m)`, and computing `φ(m)` requires factoring `m`. Factoring is believed hard (the basis of RSA security), so for a general `m` it is far more expensive than the `O(log m)` extended Euclid that needs no factorization.

---

## Professional Questions (8 Q&A)

### P1. Design a combinatorics service computing `C(n, k) mod p` for many queries.
Precompute `fact[0..N]` and `invfact[0..N]` once: factorials forward, invert `fact[N]` a single time (Fermat or extended Euclid), sweep backward for `invfact`. Each query is then `O(1)`: `fact[n]·invfact[k]·invfact[n-k] mod p`. The single inversion amortizes across all queries.

### P2. How do you reconstruct an exact rational from its value mod `m`?
Rational reconstruction: run extended Euclid on `(m, r)` and stop when the remainder drops below `√(m/2)`; the running coefficients yield numerator and denominator of `p/q ≡ r (mod m)`. This recovers exact fractions from modular images in exact linear algebra.

### P3. Your inverse routine works for small moduli but fails for `m ≈ 10^18`. Diagnose.
Almost certainly overflow in the `q*s` coefficient product or the post-inversion multiply, both of which can reach `~m²`. Switch to 128-bit intermediates or a big-integer inverse. Confirm with the `(a*inv) % m == 1` check, which will fail only for large `m`.

### P4. How do you build a constant-time modular inverse for a cryptographic field?
For a fixed prime modulus (curve order), use Fermat `a^(p-2)` with a constant-time `modpow` (fixed square-and-multiply, no early exit, no data-dependent branches). For general moduli, implement Bernstein-Yang safegcd with constant-time conditional swaps and a fixed iteration count.

### P5. When is the *congruence* solvable but the *inverse* nonexistent?
Whenever `1 < gcd(a, m) = g` and `g | b`. Example: `6·x ≡ 8 (mod 10)`: `gcd(6, 10) = 2` so `6` has no inverse, yet `2 | 8` gives two solutions `{3, 8}`. Conflating "no inverse" with "no solution" is a correctness bug.

### P6. How do CRT and modular inverses interact?
CRT reconstruction `x ≡ Σ r_i·(M/m_i)·((M/m_i)⁻¹ mod m_i) (mod M)` needs one modular inverse per coprime modulus, each computed by extended Euclid. The inverses exist because pairwise coprimality gives `gcd(M/m_i, m_i) = 1`. This is the everyday use of inverses inside CRT (sibling `08`).

### P7. How does this connect to linear Diophantine equations?
`a·x + b·y = c` is solvable **iff `gcd(a, b) | c`**, and the base solution comes from scaling extended Euclid's Bezout coefficients by `c/gcd`. The general solution adds multiples of `(b/g, -a/g)`. The modular inverse is the special case `b = m`, `c = 1`, `g = 1` (sibling `07`).

### P8 (analysis). Why is the modular inverse `O(log m)` and not `O(m)`?
Extended Euclid's step count is `O(log min(a, m))` by Lamé's theorem (worst case Fibonacci), and each step is a constant number of arithmetic operations. So one inverse is logarithmic — exponentially faster than scanning `0..m-1` for a number satisfying `a·x ≡ 1`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time a sign or overflow bug corrupted a numeric pipeline.
Look for a concrete story: a modular-arithmetic system where a negative Bezout `x` or an overflowing `a*inv` product produced subtly wrong results; the diagnosis via the `(a*inv) % m == 1` invariant; and the fix (double-mod normalization, 128-bit products). Strong answers mention adding the invariant as a permanent assertion.

### B2. A teammate used Fermat's `a^(m-2)` on a composite modulus and shipped wrong answers. How do you respond?
Explain calmly that Fermat requires a *prime* modulus; on a composite `m` the result is meaningless. Show the fix (extended Euclid / library inverse for general `m`) and a counterexample. Frame it as a teaching moment, and suggest a guard precondition asserting the modulus is prime before any Fermat call.

### B3. Design a feature that computes binomial coefficients mod a prime at scale.
Precompute factorials and inverse factorials with a single inversion and a backward sweep; each `C(n, k)` is then `O(1)`. Discuss the prime-modulus requirement, the `O(n)` precompute, memory for the tables, and the validation `C(n, 0) = C(n, n) = 1`. Mention Lucas' theorem if `n` can exceed the modulus.

### B4. How would you explain the modular inverse to a junior engineer?
Use the "clock arithmetic undo" picture: multiplying by `a` scrambles positions on a clock of size `m`; the inverse `a⁻¹` unscrambles them. Then give the existence rule (`gcd(a, m) = 1`) and the derivation from Bezout. Lead with the two pitfalls: it exists only when coprime, and you must normalize the sign.

### B5. Your crypto service's inverse computation is leaking timing. How do you investigate?
Confirm the operand is secret and that plain extended Euclid (variable iteration count) is on that path. Measure runtime variance against operand values. Fix by switching to a constant-time inverse: Fermat with a fixed-ladder `modpow` for the prime field, or safegcd for general moduli. Add a timing-invariance test to CI.

---

## Coding Challenges

### Challenge 1: Modular Inverse via Extended Euclid

**Problem.** Given `a` and `m`, return `a⁻¹ mod m` in `[0, m)`, or `-1` (None) if no inverse exists.

**Example.**
```text
a = 3,  m = 11  ->  4    (3·4 = 12 ≡ 1)
a = 4,  m = 6   ->  -1   (gcd(4,6)=2, no inverse)
```

**Constraints.** `0 ≤ a < m ≤ 10^9`.

**Optimal.** Extended Euclid, `O(log m)`.

**Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func modInverse(a, m int64) int64 {
	a = ((a % m) + m) % m
	g, x, _ := extgcd(a, m)
	if g != 1 {
		return -1 // no inverse
	}
	return ((x % m) + m) % m
}

func main() {
	fmt.Println(modInverse(3, 11)) // 4
	fmt.Println(modInverse(4, 6))  // -1
	fmt.Println(modInverse(10, 17)) // 12  (10·12=120=119+1)
}
```

**Java.**
```java
public class ModInverseChallenge {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static long modInverse(long a, long m) {
        a = ((a % m) + m) % m;
        long[] r = extgcd(a, m);
        if (r[0] != 1) return -1;
        return ((r[1] % m) + m) % m;
    }

    public static void main(String[] args) {
        System.out.println(modInverse(3, 11));  // 4
        System.out.println(modInverse(4, 6));   // -1
        System.out.println(modInverse(10, 17)); // 12
    }
}
```

**Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def mod_inverse(a, m):
    a %= m
    g, x, _ = extgcd(a, m)
    if g != 1:
        return -1
    return x % m


if __name__ == "__main__":
    print(mod_inverse(3, 11))   # 4
    print(mod_inverse(4, 6))    # -1
    print(mod_inverse(10, 17))  # 12
```

---

### Challenge 2: Solve a Linear Congruence (all solutions)

**Problem.** Given `a, b, m`, return all `x ∈ [0, m)` with `a·x ≡ b (mod m)`, sorted. Empty if none.

**Example.**
```text
a=6, b=8, m=10  ->  [3, 8]    (gcd=2 divides 8 -> 2 solutions)
a=6, b=7, m=10  ->  []        (gcd=2 does not divide 7)
```

**Optimal.** Extended Euclid, `O(log m)`.

**Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x1, y1 := extgcd(b, a%b)
	return g, y1, x1 - (a/b)*y1
}

func solve(a, b, m int64) []int64 {
	a = ((a % m) + m) % m
	b = ((b % m) + m) % m
	g, x, _ := extgcd(a, m)
	if b%g != 0 {
		return nil
	}
	step := m / g
	x0 := ((x*(b/g))%step + step) % step
	res := make([]int64, 0, g)
	for t := int64(0); t < g; t++ {
		res = append(res, (x0+t*step)%m)
	}
	return res
}

func main() {
	fmt.Println(solve(6, 8, 10)) // [3 8]
	fmt.Println(solve(6, 7, 10)) // []
}
```

**Java.**
```java
import java.util.*;

public class SolveCongruence {
    static long[] extgcd(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = extgcd(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }

    static List<Long> solve(long a, long b, long m) {
        a = ((a % m) + m) % m;
        b = ((b % m) + m) % m;
        long[] r = extgcd(a, m);
        long g = r[0], x = r[1];
        List<Long> res = new ArrayList<>();
        if (b % g != 0) return res;
        long step = m / g;
        long x0 = ((x * (b / g)) % step + step) % step;
        for (long t = 0; t < g; t++) res.add((x0 + t * step) % m);
        Collections.sort(res);
        return res;
    }

    public static void main(String[] args) {
        System.out.println(solve(6, 8, 10)); // [3, 8]
        System.out.println(solve(6, 7, 10)); // []
    }
}
```

**Python.**
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1


def solve(a, b, m):
    a %= m
    b %= m
    g, x, _ = extgcd(a, m)
    if b % g != 0:
        return []
    step = m // g
    x0 = (x * (b // g)) % step
    return sorted((x0 + t * step) % m for t in range(g))


if __name__ == "__main__":
    print(solve(6, 8, 10))  # [3, 8]
    print(solve(6, 7, 10))  # []
```

---

### Challenge 3: Inverses of 1..n mod a prime in O(n)

**Problem.** Given `n` and a prime `p` with `p > n`, return `inv[1..n]` where `inv[i] = i⁻¹ mod p`, in `O(n)`.

**Example.**
```text
n=10, p=11  ->  [1, 6, 4, 3, 9, 2, 8, 7, 5, 10]
```

**Optimal.** The recurrence `inv[i] = -(p/i)·inv[p%i] % p`, `O(n)`.

**Go.**
```go
package main

import "fmt"

func inverseTable(n int, p int64) []int64 {
	inv := make([]int64, n+1)
	if n >= 1 {
		inv[1] = 1
	}
	for i := int64(2); i <= int64(n); i++ {
		inv[i] = (p - (p/i)*inv[p%i]%p) % p
	}
	return inv
}

func main() {
	t := inverseTable(10, 11)
	fmt.Println(t[1:]) // [1 6 4 3 9 2 8 7 5 10]
	// verify
	for i := int64(1); i <= 10; i++ {
		if i*t[i]%11 != 1 {
			panic("wrong")
		}
	}
}
```

**Java.**
```java
public class InverseTable {
    static long[] inverseTable(int n, long p) {
        long[] inv = new long[n + 1];
        if (n >= 1) inv[1] = 1;
        for (int i = 2; i <= n; i++) {
            inv[i] = (p - (p / i) * inv[(int) (p % i)] % p) % p;
        }
        return inv;
    }

    public static void main(String[] args) {
        long[] t = inverseTable(10, 11);
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= 10; i++) {
            sb.append(t[i]).append(i < 10 ? " " : "");
            if (i * t[i] % 11 != 1) throw new AssertionError("wrong");
        }
        System.out.println(sb); // 1 6 4 3 9 2 8 7 5 10
    }
}
```

**Python.**
```python
def inverse_table(n, p):
    inv = [0] * (n + 1)
    if n >= 1:
        inv[1] = 1
    for i in range(2, n + 1):
        inv[i] = (-(p // i) * inv[p % i]) % p
    return inv


if __name__ == "__main__":
    t = inverse_table(10, 11)
    print(t[1:])  # [1, 6, 4, 3, 9, 2, 8, 7, 5, 10]
    assert all(i * t[i] % 11 == 1 for i in range(1, 11))
```

---

### Challenge 4: Extended Euclid Coefficients

**Problem.** Given `a, b`, return `(g, x, y)` with `a·x + b·y = g = gcd(a, b)`. Verify the Bezout identity.

**Example.**
```text
a=240, b=46  ->  g=2, x=-9, y=47   (240·(-9) + 46·47 = 2)
```

**Optimal.** Extended Euclid, `O(log min(a, b))`.

**Go.**
```go
package main

import "fmt"

func extgcd(a, b int64) (int64, int64, int64) {
	old_r, r := a, b
	old_s, s := int64(1), int64(0)
	old_t, t := int64(0), int64(1)
	for r != 0 {
		q := old_r / r
		old_r, r = r, old_r-q*r
		old_s, s = s, old_s-q*s
		old_t, t = t, old_t-q*t
	}
	return old_r, old_s, old_t
}

func main() {
	g, x, y := extgcd(240, 46)
	fmt.Printf("g=%d x=%d y=%d  check=%d\n", g, x, y, 240*x+46*y) // g=2 x=-9 y=47 check=2
}
```

**Java.**
```java
public class ExtGcdCoeffs {
    static long[] extgcd(long a, long b) {
        long oldR = a, r = b, oldS = 1, s = 0, oldT = 0, t = 1;
        while (r != 0) {
            long q = oldR / r;
            long tmp;
            tmp = oldR - q * r; oldR = r; r = tmp;
            tmp = oldS - q * s; oldS = s; s = tmp;
            tmp = oldT - q * t; oldT = t; t = tmp;
        }
        return new long[]{oldR, oldS, oldT};
    }

    public static void main(String[] args) {
        long[] res = extgcd(240, 46);
        System.out.printf("g=%d x=%d y=%d check=%d%n",
            res[0], res[1], res[2], 240 * res[1] + 46 * res[2]);
    }
}
```

**Python.**
```python
def extgcd(a, b):
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t


if __name__ == "__main__":
    g, x, y = extgcd(240, 46)
    print(f"g={g} x={x} y={y} check={240 * x + 46 * y}")  # g=2 x=-9 y=47 check=2
```

---

## Final Tips

- Lead with the one-liner: *"Extended Euclid gives `a·x + m·y = 1`; the inverse is `x mod m`, and it exists iff `gcd(a, m) = 1`."*
- Immediately flag the two gotchas: **inverse exists only when coprime** and **normalize the negative Bezout `x`**.
- For a prime modulus and just an inverse, mention **Fermat `a^(p-2)`** as the clean alternative.
- For inverses of `1..n` mod a prime, reach for the **`O(n)` table** instead of repeated calls.
- For the general congruence, state the rule: solvable **iff `gcd(a, m) | b`**, with `gcd(a, m)` solutions.
- Always offer to verify with `(a * inv) % m == 1`.
