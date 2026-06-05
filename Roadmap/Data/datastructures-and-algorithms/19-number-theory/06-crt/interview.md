# Chinese Remainder Theorem (CRT) — Interview Preparation

The Chinese Remainder Theorem is a favorite interview topic because it rewards one crisp insight — *"coprime moduli make residues independent, so a residue tuple uniquely identifies a number below the product"* — and then tests whether you can (a) construct the solution (formula or merge), (b) generalize to **non-coprime** moduli with the gcd consistency check, (c) recognize CRT behind number reconstruction, multi-mod computation, and RSA-CRT, and (d) avoid the classic traps (wrong-modulus inverse, overflow, missing no-solution case). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Two coprime congruences | constructive formula or merge | `O(log m)` |
| `n` coprime congruences | pairwise fold | `O(n log M)` |
| Non-coprime / arbitrary moduli | general merge + consistency check | `O(n log M)` |
| Solvable when non-coprime? | `aᵢ ≡ aⱼ (mod gcd(mᵢ, mⱼ))` | `O(log m)` per pair |
| Combined modulus | coprime: `∏ mᵢ`; general: `lcm` | — |
| Reconstruct number from residues | CRT / Garner | `O(n log M)` |
| Big-mod computation without overflow | multi-mod + CRT reconstruct | per-prime + `O(n²)` |
| RSA decryption speedup | RSA-CRT (mod p, mod q, combine) | ~4x faster |

Core merge (coprime):

```text
crt(a1, m1, a2, m2):           # gcd(m1, m2) = 1
    diff = ((a2 - a1) % m2 + m2) % m2
    t    = diff * inverse(m1, m2) % m2
    return (a1 + m1 * t) % (m1 * m2)
```

General merge (arbitrary moduli):

```text
merge(a1, m1, a2, m2):
    g, p, q = extgcd(m1, m2)
    if (a2 - a1) % g != 0:  return INCONSISTENT
    lcm = m1 / g * m2
    t   = (a2 - a1) / g * p % (m2 / g)
    return ((a1 + m1 * t) % lcm + lcm) % lcm,  lcm
```

Key facts:
- **Coprime ⇒ unique solution in `[0, M)`**, `M = ∏ mᵢ`.
- Inverse in the merge is taken **mod the second modulus**.
- Non-coprime solvable **iff** `gcd(m₁,m₂) ∣ (a₂ − a₁)`; combined modulus is the **lcm**.
- Reconstruction products can overflow → `mulmod` / big integers.

---

## Junior Questions (12 Q&A)

### J1. State the Chinese Remainder Theorem.
For pairwise-coprime moduli `m₁, …, mₙ`, the system `x ≡ aᵢ (mod mᵢ)` has a **unique** solution modulo `M = ∏ mᵢ`. Knowing the remainders pins down `x` exactly in `[0, M)`.

### J2. What does "pairwise coprime" mean, and why does it matter?
Every pair of moduli has `gcd = 1`. It guarantees the residues are independent, so a solution always exists and is unique mod the product. Without it, a solution may not exist.

### J3. Solve `x ≡ 2 (mod 3)`, `x ≡ 3 (mod 5)`.
`M = 15`. Either formula or merge gives `x = 8` (`8 mod 3 = 2`, `8 mod 5 = 3`). The full solution set is `8 + 15k`.

### J4. What is the constructive (Gauss) formula?
`x = Σ aᵢ Mᵢ yᵢ mod M`, where `Mᵢ = M/mᵢ` and `yᵢ = Mᵢ⁻¹ mod mᵢ`. Each term is `aᵢ` modulo `mᵢ` and `0` modulo every other modulus.

### J5. What is the merge (substitution) method?
Write `x = a₁ + m₁ t`, substitute into the second congruence to get `m₁ t ≡ a₂ − a₁ (mod m₂)`, solve `t ≡ (a₂−a₁)·m₁⁻¹ (mod m₂)`, and back-substitute. Result is one congruence mod `m₁ m₂`.

### J6. Why does the merge need a modular inverse, and of what?
To solve `m₁ t ≡ (a₂−a₁) (mod m₂)` for `t`, you multiply by `m₁⁻¹` computed **modulo `m₂`** (not `m₁`). The inverse exists because the moduli are coprime.

### J7. How many solutions does CRT give?
Infinitely many, but exactly **one** in `[0, M)`. All others are `x₀ + kM`. CRT returns the smallest non-negative representative.

### J8. What if there is only one congruence?
The answer is just `a₁ mod m₁`; there is nothing to combine.

### J9. What's the combined modulus when you merge two congruences?
For coprime moduli it is the product `m₁ m₂`; in general it is `lcm(m₁, m₂)`.

### J10. Why do we normalize residues?
`(a₂ − a₁)` can be negative, and `%` may return a negative remainder in some languages. Normalize into `[0, m)` so intermediate steps stay correct.

### J11. Give a real-world use of CRT.
Reconstructing a number from its residues (the soldier-counting puzzle), or splitting a big modular computation into small ones to avoid overflow, or speeding up RSA decryption.

### J12. What is the time complexity to solve `n` coprime congruences?
`O(n log M)`: `n − 1` merges, each one extended-Euclid inverse `O(log m)` plus constant arithmetic.

---

## Mid-Level Questions (10 Q&A)

### M1. How do you handle non-coprime moduli?
Use the general merge: solve `m₁ t ≡ a₂ − a₁ (mod m₂)` via `extgcd`. It is solvable iff `gcd(m₁, m₂) ∣ (a₂ − a₁)`. The combined modulus is the `lcm`. If unsolvable, the system has no solution.

### M2. State and justify the consistency condition.
`a₁ ≡ a₂ (mod gcd(m₁, m₂))`. Necessary: any solution is `≡ a₁` and `≡ a₂` modulo `g`, so `a₁ ≡ a₂ (mod g)`. Sufficient: `g ∣ (a₂−a₁)` makes the linear congruence in `t` solvable.

### M3. Give an inconsistent system and explain.
`x ≡ 1 (mod 4)`, `x ≡ 2 (mod 6)`. `g = gcd(4,6) = 2`; `1 mod 2 = 1` but `2 mod 2 = 0`, disagreement mod 2 → no solution.

### M4. Why prefer the pairwise fold over the symmetric formula?
The fold keeps the running modulus exactly the product so far and avoids forming the huge `Mᵢ = M/mᵢ` products (and the giant `aᵢ Mᵢ yᵢ` terms), giving the same answer with smaller intermediates and simpler code.

### M5. How does CRT enable multi-mod computation?
By the ring isomorphism `ℤ/Mℤ ≅ ∏ ℤ/mᵢℤ`, arithmetic mod `M` equals componentwise arithmetic on residues. Compute mod each small prime independently, then CRT the result tuple back. If `∏ pᵢ` exceeds the true result, the reconstruction is exact.

### M6. Where does overflow appear in CRT, and how do you fix it?
In `m₁·t`, in `lcm = m₁·m₂`, and in the symmetric formula's `aᵢ Mᵢ yᵢ`. Fixes: `mulmod` (128-bit or peasant), compute `lcm = m₁/g·m₂` (divide first), or big integers.

### M7. What is Garner's algorithm and why use it?
A mixed-radix reconstruction: `x = c₁ + c₂ m₁ + c₃ m₁ m₂ + …` with small digits `cᵢ < mᵢ`. Intermediates never overflow, and the per-modulus inverses are precomputed and reused — ideal for many reconstructions with fixed primes (multi-mod NTT).

### M8. Explain RSA-CRT.
Decrypt `c` by computing `m₁ = c^dp mod p`, `m₂ = c^dq mod q` (half-size operands), then combine via `m = m₂ + q·(qinv·(m₁−m₂) mod p)`. ~4x faster than `c^d mod n`.

### M9. Is pairwise-coprime the same as "the set has gcd 1"?
No. `{6, 10, 15}` has overall gcd 1 but is not pairwise coprime (`gcd(6,10)=2`). The clean formula needs **pairwise** coprimality; use the general merge otherwise.

### M10. How do you test a CRT implementation?
Cross-check against a brute-force scan over `[0, lcm)` on small systems, and assert the result satisfies every congruence and lies in `[0, lcm)`. Verify inconsistent systems are reported, not "solved".

---

## Senior Questions (8 Q&A)

### S1. How would you pick primes for a multi-mod NTT multiplication?
NTT-friendly primes (`c·2ᵏ+1`, e.g. `998244353`), enough of them that their product exceeds the maximum coefficient `~ n·B²`, each small enough that `mulmod` stays in 64 bits. Use the minimum count for the bound to reduce reconstruction work.

### S2. What is the fault attack on RSA-CRT and how do you defend?
A transient fault corrupting one of `m₁` or `m₂` yields a faulty `m'` with `gcd(m'−m, n) = p`, factoring `n`. Defense: verify `m^e ≡ c (mod n)` before releasing the signature, and use constant-time code.

### S3. How do you reconstruct when `M` exceeds 64 bits?
Garner with big-integer final assembly, or full big-integer CRT. Keep all intermediate digits small (Garner) and assemble — or reduce mod a target — only at the end to avoid precision loss.

### S4. Why is RNS bad at comparison and division?
Componentwise residues carry no positional magnitude, so comparing or dividing requires reconstructing the actual value (the CRT step), which defeats the parallelism. RNS shines for carry-free `+, −, ×`.

### S5. How does redundant CRT detect errors?
Add extra coprime moduli. A corrupted residue makes the reconstruction inconsistent with the redundant modulus, localizing the fault — the basis of Redundant Residue Number Systems.

### S6. Order independence of merges?
For a solvable system the final residue class is order-independent (it's the unique class mod `lcm`). But accumulated overflow/rounding can differ, so keep arithmetic exact; track which pair fails for inconsistent systems.

### S7. Complexity of the fold vs symmetric formula?
Fold: `O(n log² M)` bit-ops, smallest intermediates. Symmetric: same asymptotics but forms huge `Mᵢ` products with larger constants. Garner reconstruction: `O(n²)` digit steps with precomputed inverses.

### S8. When would CRT be the wrong tool?
A single congruence, or a system that is provably inconsistent with no fallback, or when a direct big-integer computation is simple and fast enough that the multi-mod machinery is needless complexity.

### S9. How does CRT relate to Euler's totient being multiplicative?
The ring isomorphism `ℤ/Mℤ ≅ ∏ ℤ/mᵢℤ` restricts to a group isomorphism on units, so `|（ℤ/mnℤ)^×| = |(ℤ/mℤ)^×|·|(ℤ/nℤ)^×|` for coprime `m, n`, i.e. `φ(mn) = φ(m)φ(n)`. CRT is the structural reason totient is multiplicative.

### S10. Why can RSA-CRT reduce the exponent to `d mod (p−1)`?
By Fermat, the unit group mod `p` has order `p−1`, so exponents only matter mod `p−1`. CRT then glues the mod-`p` and mod-`q` results back to mod `n = pq`. The correctness is "Fermat per component, CRT to combine".

### S11. How would you reconstruct an `N`-bit integer from hundreds of small-prime residues efficiently?
The naive fold is `O(n²)`; use a product-tree / remainder-tree so each level does one big multiply and there are `O(log n)` levels, giving quasi-linear `O(M(N) log n)`. This is what computer-algebra systems use for modular GCD and determinant reconstruction.

---

## Behavioral Prompts

- **"Describe a time you split a hard computation into independent parts."** Multi-mod CRT is a perfect story: independent per-prime computations, then a reconciliation step. Emphasize the overflow bound that made it correct.
- **"Tell me about a subtle correctness bug you fixed."** The wrong-modulus inverse (taking `m₁⁻¹ mod m₁` instead of `mod m₂`) or a missing consistency check are classic, relatable CRT bugs.
- **"How do you make code robust to malformed input?"** Non-coprime, inconsistent moduli from data: detect with the gcd check, return a typed "no solution", bound input size against DoS.
- **"How do you verify something you can't brute-force?"** Property tests: the reconstructed `x` must satisfy every congruence; cross-check against a big-integer reference; redundant-modulus checks.

---

## Coding Challenge 1 — Solve a Coprime CRT System

**Problem.** Given `n` pairwise-coprime moduli and residues, return the unique `x` in `[0, M)`.

### Go
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
func inv(a, m int64) int64 { _, x, _ := extgcd(((a%m)+m)%m, m); return ((x % m) + m) % m }

func crtCoprime(res, mod []int64) int64 {
	a, m := int64(0), int64(1)
	for i := range res {
		mi, ai := mod[i], ((res[i]%mod[i])+mod[i])%mod[i]
		diff := (((ai - a) % mi) + mi) % mi
		t := (diff * inv(m, mi)) % mi
		a = (a + m*t)
		m *= mi
		a = ((a % m) + m) % m
	}
	return a
}

func main() {
	fmt.Println(crtCoprime([]int64{2, 3, 2}, []int64{3, 5, 7})) // 23
}
```

### Java
```java
public class CrtCoprime {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long inv(long a, long m) { long x = eg(((a % m) + m) % m, m)[1]; return ((x % m) + m) % m; }

    static long crt(long[] res, long[] mod) {
        long a = 0, m = 1;
        for (int i = 0; i < res.length; i++) {
            long mi = mod[i], ai = ((res[i] % mi) + mi) % mi;
            long diff = (((ai - a) % mi) + mi) % mi;
            long t = (diff * inv(m, mi)) % mi;
            a += m * t; m *= mi; a = ((a % m) + m) % m;
        }
        return a;
    }
    public static void main(String[] a) {
        System.out.println(crt(new long[]{2, 3, 2}, new long[]{3, 5, 7})); // 23
    }
}
```

### Python
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x1, y1 = extgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1

def inv(a, m):
    return extgcd(a % m, m)[1] % m

def crt_coprime(res, mod):
    a, m = 0, 1
    for ai, mi in zip(res, mod):
        ai %= mi
        diff = (ai - a) % mi
        t = diff * inv(m, mi) % mi
        a = (a + m * t) % (m * mi)
        m *= mi
    return a

if __name__ == "__main__":
    print(crt_coprime([2, 3, 2], [3, 5, 7]))  # 23
```

---

## Coding Challenge 2 — Generalized CRT with Consistency Check

**Problem.** Moduli may share factors. Return the smallest non-negative solution and the combined `lcm`, or report "no solution".

### Go
```go
package main

import "fmt"

func eg(a, b int64) (int64, int64, int64) {
	if b == 0 {
		return a, 1, 0
	}
	g, x, y := eg(b, a%b)
	return g, y, x - (a/b)*y
}

func crtGeneral(res, mod []int64) (int64, int64, bool) {
	a, m := int64(0), int64(1)
	for i := range res {
		g, p, _ := eg(m, mod[i])
		c := res[i] - a
		if c%g != 0 {
			return 0, 0, false
		}
		lcm := m / g * mod[i]
		md := mod[i] / g
		t := (((c/g)%md)*(p%md))%md
		t = ((t % md) + md) % md
		a = ((a+m*t)%lcm + lcm) % lcm
		m = lcm
	}
	return a, m, true
}

func main() {
	fmt.Println(crtGeneral([]int64{2, 8}, []int64{6, 12})) // 8 12 true
	fmt.Println(crtGeneral([]int64{1, 2}, []int64{4, 6}))  // 0 0 false
}
```

### Java
```java
public class CrtGeneral {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    // returns {a, m, ok}
    static long[] crt(long[] res, long[] mod) {
        long a = 0, m = 1;
        for (int i = 0; i < res.length; i++) {
            long[] e = eg(m, mod[i]);
            long g = e[0], p = e[1], c = res[i] - a;
            if (c % g != 0) return new long[]{0, 0, 0};
            long lcm = m / g * mod[i], md = mod[i] / g;
            long t = (((c / g) % md) * (p % md)) % md;
            t = ((t % md) + md) % md;
            a = ((a + m * t) % lcm + lcm) % lcm; m = lcm;
        }
        return new long[]{a, m, 1};
    }
    public static void main(String[] x) {
        long[] r = crt(new long[]{2, 8}, new long[]{6, 12});
        System.out.println(r[0] + " " + r[1] + " ok=" + r[2]); // 8 12 ok=1
        System.out.println("ok=" + crt(new long[]{1, 2}, new long[]{4, 6})[2]); // ok=0
    }
}
```

### Python
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def crt_general(res, mod):
    a, m = 0, 1
    for ri, mi in zip(res, mod):
        g, p, _ = extgcd(m, mi)
        c = ri - a
        if c % g != 0:
            return None
        lcm = m // g * mi
        md = mi // g
        t = (c // g) * p % md
        a = (a + m * t) % lcm
        m = lcm
    return a, m

if __name__ == "__main__":
    print(crt_general([2, 8], [6, 12]))  # (8, 12)
    print(crt_general([1, 2], [4, 6]))   # None
```

---

## Coding Challenge 3 — Reconstruct a Number from Residues

**Problem.** A hidden value `X < ∏ pᵢ` is known only by its residues mod several coprime primes. Recover `X`.

### Go
```go
package main

import "fmt"

func eg(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x, y := eg(b, a%b)
	return g, y, x - (a/b)*y
}
func reconstruct(res, primes []int64) int64 {
	a, m := int64(0), int64(1)
	for i := range res {
		mi := primes[i]
		_, p, _ := eg(m%mi, mi)
		diff := (((res[i]-a)%mi)+mi)%mi
		t := (diff * ((p%mi)+mi)%mi) % mi
		a = (a + m*t); m *= mi; a = ((a%m)+m)%m
	}
	return a
}
func main() {
	fmt.Println(reconstruct([]int64{1, 2, 6}, []int64{5, 7, 11})) // 226
}
```

### Java
```java
public class Reconstruct {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long reconstruct(long[] res, long[] primes) {
        long a = 0, m = 1;
        for (int i = 0; i < res.length; i++) {
            long mi = primes[i];
            long p = eg(m % mi, mi)[1];
            long diff = (((res[i] - a) % mi) + mi) % mi;
            long t = (diff * (((p % mi) + mi) % mi)) % mi;
            a += m * t; m *= mi; a = ((a % m) + m) % m;
        }
        return a;
    }
    public static void main(String[] x) {
        System.out.println(reconstruct(new long[]{1, 2, 6}, new long[]{5, 7, 11})); // 226
    }
}
```

### Python
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def reconstruct(res, primes):
    a, m = 0, 1
    for ri, mi in zip(res, primes):
        inv_m = extgcd(m % mi, mi)[1] % mi
        diff = (ri - a) % mi
        t = diff * inv_m % mi
        a = (a + m * t) % (m * mi)
        m *= mi
    return a

if __name__ == "__main__":
    print(reconstruct([1, 2, 6], [5, 7, 11]))  # 226
```

---

## Coding Challenge 4 — Smallest x With Given Remainders

**Problem.** Find the smallest **positive** `x` satisfying `x ≡ aᵢ (mod mᵢ)` (coprime moduli). The CRT representative `x₀` may be `0`; if so, return `M`.

### Go
```go
package main

import "fmt"

func eg(a, b int64) (int64, int64, int64) {
	if b == 0 { return a, 1, 0 }
	g, x, y := eg(b, a%b); return g, y, x - (a/b)*y
}
func smallestPositive(res, mod []int64) int64 {
	a, m := int64(0), int64(1)
	for i := range res {
		mi := mod[i]
		_, p, _ := eg(m%mi, mi)
		diff := (((res[i]-a)%mi)+mi)%mi
		t := (diff*(((p%mi)+mi)%mi))%mi
		a = (a+m*t); m *= mi; a = ((a%m)+m)%m
	}
	if a == 0 { return m } // smallest POSITIVE
	return a
}
func main() {
	fmt.Println(smallestPositive([]int64{0, 0}, []int64{3, 4})) // 12
	fmt.Println(smallestPositive([]int64{2, 3}, []int64{3, 5})) // 8
}
```

### Java
```java
public class SmallestX {
    static long[] eg(long a, long b) {
        if (b == 0) return new long[]{a, 1, 0};
        long[] r = eg(b, a % b);
        return new long[]{r[0], r[2], r[1] - (a / b) * r[2]};
    }
    static long smallest(long[] res, long[] mod) {
        long a = 0, m = 1;
        for (int i = 0; i < res.length; i++) {
            long mi = mod[i], p = eg(m % mi, mi)[1];
            long diff = (((res[i] - a) % mi) + mi) % mi;
            long t = (diff * (((p % mi) + mi) % mi)) % mi;
            a += m * t; m *= mi; a = ((a % m) + m) % m;
        }
        return a == 0 ? m : a;
    }
    public static void main(String[] x) {
        System.out.println(smallest(new long[]{0, 0}, new long[]{3, 4})); // 12
        System.out.println(smallest(new long[]{2, 3}, new long[]{3, 5})); // 8
    }
}
```

### Python
```python
def extgcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = extgcd(b, a % b)
    return g, y, x - (a // b) * y

def smallest_positive(res, mod):
    a, m = 0, 1
    for ri, mi in zip(res, mod):
        inv_m = extgcd(m % mi, mi)[1] % mi
        diff = (ri - a) % mi
        t = diff * inv_m % mi
        a = (a + m * t) % (m * mi)
        m *= mi
    return m if a == 0 else a

if __name__ == "__main__":
    print(smallest_positive([0, 0], [3, 4]))  # 12
    print(smallest_positive([2, 3], [3, 5]))  # 8
```

---

## Closing Tips

- Lead with the insight (independence of coprime residues), then derive the merge — interviewers want to see the *why*, not a memorized formula.
- Always mention the **non-coprime / consistency** generalization; it separates strong candidates.
- Call out **overflow** in the reconstruction unprompted; it shows production awareness.
- Connect CRT to a real system — multi-mod NTT or RSA-CRT — to demonstrate breadth.
- Validate against a brute-force oracle; never claim correctness without it.
