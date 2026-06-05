# Garner's Algorithm (Mixed-Radix CRT Reconstruction) — Interview Preparation

Garner's algorithm is a favourite for number-theory and competitive-programming interviews because it rewards one crisp insight — *"write `x` in mixed-radix form `x = a_0 + a_1 p_0 + a_2 p_0 p_1 + …` and solve the digits one at a time mod each prime"* — and then tests whether you can (a) derive the digit recurrence from the prefix-product inverse, (b) keep everything overflow-free by staying in single-prime arithmetic, (c) connect it to multi-prime NTT (`13-ntt`) and RNS, and (d) distinguish it from the classic CRT formula (`05-crt`) it is equivalent to. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Reconstruct `x` from residues (pairwise-coprime) | Garner mixed-radix | `O(k²)` |
| Reconstruct only `x mod M` | Garner, assemble sum mod `M` | `O(k²)`, no big-int |
| Combine 3-prime NTT coefficient | Garner with precomputed inverses | `O(k²) = O(9)` per coeff |
| Big-integer add/multiply in parallel | RNS componentwise + Garner at exit | `O(k)` per op, `O(k²)` reconstruct |
| Existence of the solution | CRT (`05-crt`) | — |
| Non-coprime moduli | generalized CRT (gcd merge) | not plain Garner |

Core algorithm:

```text
garner(r[], p[]):
    for i = 0 .. k-1:
        partial = 0; prefix = 1                 # both mod p[i]
        for j = 0 .. i-1:
            partial = (partial + a[j]*prefix) mod p[i]
            prefix  = (prefix * p[j]) mod p[i]
        a[i] = (r[i] - partial) * inv(prefix, p[i]) mod p[i]
    x = 0; weight = 1
    for i = 0 .. k-1:
        x += a[i]*weight                        # big-int, or mod M
        weight *= p[i]
    return x            # O(k^2)
```

Key facts:
- Digit weight is the **prefix product** `W_i = p_0·…·p_{i-1}` (`W_0 = 1`).
- Each digit `a_i ∈ [0, p_i)`; the mixed-radix representation is **unique**.
- The digit solve uses only mod-`p_i` arithmetic — **no giant products**.
- The reconstructed `x ∈ [0, P)` with `P = ∏ p_i`; needs `P > v_max` or it wraps silently.
- For signed values, **center** into `[−P/2, P/2)`.

---

## Junior Questions (12 Q&A)

### J1. What problem does Garner's algorithm solve?
Given residues `x mod p_0, …, x mod p_{k-1}` for pairwise-coprime moduli, it reconstructs the unique `x ∈ [0, P)` where `P = ∏ p_i`. It is the *constructive* side of the Chinese Remainder Theorem: CRT says `x` exists; Garner computes it.

### J2. What is the mixed-radix representation?
Writing `x = a_0 + a_1 p_0 + a_2 (p_0 p_1) + … + a_{k-1}(p_0·…·p_{k-2})`. The weights are the prefix products; each digit `a_i` satisfies `0 ≤ a_i < p_i`. It is a positional numeral system where each position has its own base.

### J3. How do you find the first digit `a_0`?
Reduce `x = Σ a_i W_i` mod `p_0`. Every term except the first has the factor `p_0`, so `x ≡ a_0 (mod p_0)`. Since `x ≡ r_0`, we get `a_0 = r_0` — the first digit is just the first residue.

### J4. How do you find a general digit `a_i`?
`a_i = (r_i − partial)·(W_i)^{-1} mod p_i`, where `partial = Σ_{j<i} a_j W_j (mod p_i)` is the reconstruction so far reduced mod `p_i`, and `W_i = p_0·…·p_{i-1}` is the prefix product.

### J5. What is the "prefix-product inverse"?
The modular inverse of the prefix product `W_i = p_0·…·p_{i-1}` modulo `p_i`. Multiplying by it "divides out" the accumulated weight so the digit lands in `[0, p_i)`. It exists because `W_i` is coprime to `p_i`.

### J6. Why does Garner avoid huge intermediate numbers?
Because every digit is solved using arithmetic **mod a single prime `p_i`** — never mod the giant product `P`. The big number appears only in the final assembly `Σ a_i W_i`, and even that can be skipped if you only need `x mod M`.

### J7. What does "pairwise coprime" mean and why is it required?
Every pair `(p_i, p_j)` with `i≠j` has `gcd = 1`. It is required so the prefix-product inverse `(W_i)^{-1} mod p_i` exists; distinct primes are automatically pairwise coprime.

### J8. What is the time complexity?
`O(k²)` where `k` is the number of moduli, because digit `a_i` needs an `O(i)` partial sum and there are `k` digits. The big-integer assembly is an additional `O(k)` big-int operations.

### J9. How is Garner related to CRT?
CRT (`05-crt`) is the existence theorem — a unique `x` matching all residues exists. Garner is the algorithm that constructs that `x`. They are two sides of the same coin.

### J10. What range is the reconstructed `x` in?
`0 ≤ x < P` where `P = ∏ p_i`. If the true value you wanted is `≥ P`, Garner gives `x mod P`, which is wrong — a silent error. The product of primes must exceed the true value.

### J11. Can the moduli be non-prime?
Yes — Garner only needs **pairwise coprimality**, not primality. They are usually primes (e.g. NTT primes) because primes are trivially pairwise coprime and easy to choose.

### J12 (analysis). Why is the mixed-radix representation unique?
Just like base-10 digits are unique: there are exactly `P = ∏ p_i` digit tuples `(a_0,…,a_{k-1})` with `0 ≤ a_i < p_i`, and exactly `P` values in `[0, P)`, and the map between them is a bijection. So each `x` has exactly one digit tuple.

---

## Middle Questions (12 Q&A)

### M1. Derive the digit recurrence.
Reduce `x = Σ_m a_m W_m` mod `p_i`. Terms with `m > i` carry factor `W_{i+1} = W_i p_i ≡ 0`, so `r_i ≡ Σ_{m≤i} a_m W_m = partial + a_i W_i (mod p_i)`. Solve: `a_i = (r_i − partial)(W_i)^{-1} mod p_i`.

### M2. How do you reconstruct only `x mod M`?
Solve the digits normally (mod `p_i`), then assemble the sum `Σ a_i W_i` **mod `M`** instead of with big integers, maintaining the weight `W_i mod M` incrementally. All values stay machine-word sized.

### M3. Compare Garner with the classic CRT formula.
Classic: `x = (Σ r_i M_i y_i) mod P` with `M_i = P/p_i`. Same answer, but `M_i` is nearly as big as `P` (big-int intermediates) and a final reduction mod `P` is needed. Garner stays single-prime sized in the solve, needs no mod-`P` reduction, and is incremental.

### M4. What is a Residue Number System?
Representing a number as its residue tuple `(x mod p_0, …, x mod p_{k-1})`. Addition and multiplication are componentwise and carry-free (parallel). Garner is how you convert back to an integer when you need the magnitude.

### M5. Why is Garner the "exit" from RNS?
RNS cannot cheaply compare, detect overflow, take sign, or divide — all need the magnitude. Garner's mixed-radix digits are positional, so they restore ordering. You stay in RNS for the cheap parallel arithmetic and Garner-reconstruct only when magnitude is needed.

### M6. Why precompute the prefix-product inverses?
When the same primes are reused (NTT/RNS), `(W_i)^{-1} mod p_i` is constant. Precomputing the table once turns each reconstruction's inner loop into pure multiply-add, removing the `O(log p)` inverse cost per digit.

### M7. How does Garner combine multi-prime NTT results?
You computed a convolution mod several NTT-friendly primes (because one prime's modulus was too small for the true coefficients). Each output coefficient is known mod each prime; Garner reconstructs the true coefficient (or its value mod the answer modulus `M`) from those residues.

### M8. How do you avoid overflow in the inner multiply?
`a[j]*prefix` is a product of two values `< p_i`. If `p_i < 2^{31}` it fits in 64-bit before reduction. For larger primes use 128-bit multiply or Montgomery/Barrett reduction (`14-montgomery-multiplication`).

### M9. What if the moduli are not coprime?
Plain Garner fails — the prefix-product inverse doesn't exist. Use the generalized CRT merge: combine pairs via extended Euclid, checking `r_i ≡ r_j (mod gcd(p_i,p_j))` for consistency. This reduces to Garner when all gcds are 1.

### M10. How do you reconstruct a signed value?
Garner gives `x ∈ [0, P)`. If the true value can be negative, center it: if `2x ≥ P`, return `x − P`, mapping into `[−P/2, P/2)`. Requires `P > 2·max|value|`.

### M11. Is Garner incremental?
Yes. Adding a new coprime modulus appends one digit `a_k` without changing earlier digits, since the recurrence for index `k` only depends on `r_k`, the existing digits, and the existing product. This is the Newton-interpolation property; the classic CRT formula is not incremental.

### M12 (analysis). What determines how many primes you need?
The product `∏ p_i` must exceed the maximum value to represent. For a convolution `c = Σ a_i b_{t-i}` with `n` terms and values `≤ V`, the max coefficient is `≤ n·V²`; pick the smallest `k` primes whose product exceeds that (or `2nV²` for signed).

---

## Senior Questions (10 Q&A)

### S1. Walk through a three-prime NTT combine end to end.
Run NTT under `q_0, q_1, q_2` (NTT-friendly, product exceeds max coefficient). Per coefficient you get `(c_0,c_1,c_2)`. Precompute `inv01 = q_0^{-1} mod q_1` and `inv012 = (q_0 q_1)^{-1} mod q_2`. Garner: `a_0=c_0`, `a_1=(c_1−a_0)inv01 mod q_1`, `a_2=((c_2−(a_0+a_1 q_0)) ) inv012 mod q_2`, then `x = a_0+a_1 q_0 + a_2 q_0 q_1`, assembled mod the answer modulus `M`.

### S2. How do you pick the primes for multi-prime NTT?
NTT-friendly (`q = c·2^m+1` with large `m`), pairwise coprime (distinct primes), product exceeding the proven max coefficient, and word-size friendly (`q < 2^{31}` so products fit in 64-bit). A standard triple: `998244353, 1004535809, 985661441` (product `≈ 2^{89.6}`).

### S3. What is the most dangerous Garner bug in production?
Insufficient prime product: if `∏ p_i ≤ v_max`, Garner silently returns `v mod P` — a smaller wrong value, no exception. Mitigation: prove the max-value bound and assert `∏ p_i > v_max` at startup.

### S4. How would you verify a Garner implementation you cannot brute-force?
Round-trip: `to_rns(garner(r)) == r` and `garner(to_rns(x)) == x` for random `x ∈ [0,P)`. RNS-homomorphism: `garner(rns_mul(A,B)) == (A·B) mod P`. Cross-check against the classic CRT formula. The round-trip catches inverse, weight, and sign bugs.

### S5. When is Garner faster asymptotically beaten?
For very large `k`, a product/remainder tree with fast multiplication does CRT reconstruction in `O(M(B) log k)` bit operations, beating `O(k²)`. For the small `k` of NTT (2–4 primes), plain Garner's tiny constant wins.

### S6. How does Garner interact with Montgomery multiplication?
In RNS Montgomery pipelines each residue stays in Montgomery form to make per-multiply reduction cheap (`14-montgomery-multiplication`). Garner's inner multiply becomes a Montgomery multiply; you must keep representations consistent (or precompute inverses in Montgomery form), or you get a value off by the Montgomery factor `R`.

### S7. Why is RNS comparison hard, and how does Garner help?
The CRT isomorphism `ℤ_P ≅ ∏ℤ_{p_i}` is order-destroying — residue tuples carry no magnitude. Garner's mixed-radix digits are positional (each weight exceeds the sum of all lower contributions), so comparing two values reduces to reverse-lexicographic comparison of their digit vectors.

### S8. What are the main performance levers?
Precompute the prefix-product inverses (fixed primes); reduce residues up front; keep `p < 2^{31}` for 64-bit-safe products; assemble mod `M` to avoid big integers when the exact value isn't needed; combine many coefficients with the same precomputed table.

### S9. How do you base-extend an RNS number without full reconstruction?
Compute Garner digits `a_i`, then evaluate `Σ a_i (W_i mod p_new) mod p_new` in `O(k)`. This yields `x mod p_new` (a new channel) without forming the big integer — used to add precision when an RNS product threatens to exceed the current product `P`.

### S10 (analysis). Prove the prefix-product inverse always exists.
`W_i = ∏_{j<i} p_j`. Each `p_j` (`j<i`) is coprime to `p_i` by pairwise coprimality, and a product of numbers coprime to `p_i` is coprime to `p_i`, so `gcd(W_i, p_i)=1`, hence `W_i` is invertible mod `p_i`.

---

## Professional Questions (8 Q&A)

### P1. Design a service that multiplies large polynomials with big coefficients.
Use multi-prime NTT: pick enough NTT-friendly primes that their product exceeds `n·V²` (the max coefficient bound). Run NTT-based convolution under each prime in parallel, then Garner-combine each output coefficient with precomputed inverses, assembling mod the answer modulus `M`. Validate with a round-trip and a small-case brute-force convolution.

### P2. How do you handle a value that may exceed the prime product?
You cannot recover it exactly — Garner returns it mod `P`. Either add more primes so `P > v_max` (proving the bound), or accept the reduced value if `x mod P` is actually what's wanted. The bound check must be explicit; silent wraparound is the failure.

### P3. Your RNS multiply loop is slow because of reconstruction. What's wrong?
Likely reconstructing (Garner) *inside* the arithmetic loop — e.g. to compare, then continuing in RNS — which destroys the parallel carry-free speedup. Stay in residue space; reconstruct or base-extend only at genuine exit points.

### P4. How do you debug "the reconstructed number is wrong"?
Round-trip test on the exact inputs: does `to_rns(result)` reproduce the input residues? Check the usual suspects: un-reduced residues (`r_i ≥ p_i`), wrong prefix-product weight, negative remainder not normalized, insufficient prime product (wraparound), and forgotten signedness (off by `P`).

### P5. When is Garner the wrong tool?
When you only ever needed the residues (don't reconstruct), when a single machine-word modulus already suffices (no need for multiple primes), or when the moduli are not coprime (use generalized CRT merge). Reconstructing prematurely throws away RNS parallelism.

### P6. How do you parallelize multi-prime NTT + Garner?
The NTT under each prime is independent — run them on separate workers/cores. The Garner combine is per-coefficient and independent across coefficients, so it parallelizes trivially with a shared read-only inverse table. The only serial part is within one coefficient's `O(k²)` digit solve (tiny for small `k`).

### P7. How do automata/cryptography use RNS + Garner?
RSA/ECC use RNS Montgomery multiplication to parallelize modular exponentiation across residue channels, reconstructing (Garner / mixed-radix) only at output. Big-integer libraries use RNS to replace carry chains with parallel lanes. In both, Garner is the conversion-out step.

### P8 (analysis). Why is Garner equivalent to Newton interpolation?
Garner builds the mixed-radix digits incrementally from lower digits — exactly Newton's divided-difference form, where each new node adds one coefficient without disturbing earlier ones. The classic CRT formula is the Lagrange form (each term independent but globally weighted). The Newton/Lagrange duality mirrors the Garner/classic-CRT duality, explaining Garner's incrementality and small operands.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you avoided overflow by changing representation.
Look for a concrete story: a computation whose intermediates overflowed 64-bit, the insight to split it across coprime word-sized primes (RNS), doing the arithmetic in residue lanes, and Garner-reconstructing at the end — with the bound `∏ p_i > v_max` proven and a round-trip test added.

### B2. A teammate's multi-prime NTT gives wrong coefficients for large inputs. How do you help?
Suspect insufficient prime product: the true coefficient exceeded `∏ q_i`, so Garner returned it mod the product. Walk them through bounding the max coefficient (`n·V²`) and adding a prime so the product covers it. Frame it as the silent-wraparound trap, not a coding error.

### B3. Design a feature that does exact arithmetic on numbers too big for 64-bit, with high throughput.
RNS: represent each number as residues mod several word-sized coprime primes, do all adds/multiplies componentwise (parallel, carry-free), and Garner-reconstruct only on output or when comparison/sign is needed. Discuss prime choice, the comparison blind spot, and reconstruction cost.

### B4. How would you explain Garner to a junior engineer?
Use the clock analogy: reading time as "2 days, 3 hours, 15 minutes" is mixed-radix — each unit has its own base. Garner finds those "digits" one at a time from remainders, using a small inverse to convert, never forming the giant total until the end. Lead with the two gotchas: pairwise-coprime moduli and the product must exceed the true value.

### B5. Your RNS service uses too much memory reconstructing. How do you investigate?
Check whether you build big integers when only `x mod M` is needed (assemble mod `M` instead, no big-int). Confirm the inverse table is shared, not rebuilt per call. Confirm you reconstruct only at exit, not inside arithmetic loops. The fix is usually mod-`M` assembly plus a shared precomputed table.

---

## Coding Challenges

### Challenge 1: Garner Reconstruct from Residues

**Problem.** Given pairwise-coprime moduli `p[]` and residues `r[]`, return the unique `x ∈ [0, ∏p)` with `x ≡ r_i (mod p_i)`.

**Example.**
```text
p = [3,5,7], r = [2,3,2]  ->  23
p = [2,3,5,7], r = [1,2,3,2]  ->  23  (23 mod 2 = 1, mod 3 = 2, mod 5 = 3, mod 7 = 2)
```

**Constraints.** `1 ≤ k ≤ 20`, moduli pairwise coprime, products may exceed 64-bit (use big integers in assembly).

**Optimal.** Garner, `O(k²)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

func garner(r, p []int64) *big.Int {
	k := len(p)
	a := make([]int64, k)
	for i := 0; i < k; i++ {
		var partial, prefix int64 = 0, 1
		for j := 0; j < i; j++ {
			partial = (partial + a[j]*prefix) % p[i]
			prefix = (prefix * p[j]) % p[i]
		}
		diff := ((r[i]-partial)%p[i] + p[i]) % p[i]
		a[i] = (diff * modInv(prefix, p[i])) % p[i]
	}
	x, w := big.NewInt(0), big.NewInt(1)
	for i := 0; i < k; i++ {
		x.Add(x, new(big.Int).Mul(big.NewInt(a[i]), w))
		w.Mul(w, big.NewInt(p[i]))
	}
	return x
}

func main() {
	fmt.Println(garner([]int64{2, 3, 2}, []int64{3, 5, 7}))      // 23
	fmt.Println(garner([]int64{1, 2, 3, 2}, []int64{2, 3, 5, 7})) // 23
}
```

**Java.**
```java
import java.math.BigInteger;

public class GarnerReconstruct {
    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    static BigInteger garner(long[] r, long[] p) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + a[j] * prefix) % p[i];
                prefix = (prefix * p[j]) % p[i];
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = (diff * modInv(prefix, p[i])) % p[i];
        }
        BigInteger x = BigInteger.ZERO, w = BigInteger.ONE;
        for (int i = 0; i < k; i++) {
            x = x.add(BigInteger.valueOf(a[i]).multiply(w));
            w = w.multiply(BigInteger.valueOf(p[i]));
        }
        return x;
    }

    public static void main(String[] args) {
        System.out.println(garner(new long[]{2, 3, 2}, new long[]{3, 5, 7}));        // 23
        System.out.println(garner(new long[]{1, 2, 3, 2}, new long[]{2, 3, 5, 7})); // 23
    }
}
```

**Python.**
```python
def garner(r, p):
    k = len(p)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % p[i]
            prefix = (prefix * p[j]) % p[i]
        diff = (r[i] - partial) % p[i]
        a[i] = (diff * pow(prefix, -1, p[i])) % p[i]
    x, w = 0, 1
    for i in range(k):
        x += a[i] * w
        w *= p[i]
    return x


if __name__ == "__main__":
    print(garner([2, 3, 2], [3, 5, 7]))        # 23
    print(garner([1, 2, 3, 2], [2, 3, 5, 7]))  # 23
```

---

### Challenge 2: Reconstruct x mod M (no big integers)

**Problem.** Given residues `r[]`, pairwise-coprime moduli `p[]`, and a target modulus `M`, return `x mod M` where `x` is the unique CRT solution. Do not use big integers.

**Example.**
```text
p=[3,5,7], r=[2,3,2], M=10 -> 3   (x=23, 23 mod 10 = 3)
```

**Optimal.** Garner with mod-`M` assembly, `O(k²)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

func garnerModM(r, p []int64, M int64) int64 {
	k := len(p)
	a := make([]int64, k)
	for i := 0; i < k; i++ {
		var partial, prefix int64 = 0, 1
		for j := 0; j < i; j++ {
			partial = (partial + a[j]*prefix) % p[i]
			prefix = (prefix * p[j]) % p[i]
		}
		diff := ((r[i]-partial)%p[i] + p[i]) % p[i]
		a[i] = (diff * modInv(prefix, p[i])) % p[i]
	}
	var x, w int64 = 0, 1
	for i := 0; i < k; i++ {
		x = (x + a[i]%M*w) % M
		w = (w * (p[i] % M)) % M
	}
	return x
}

func main() {
	fmt.Println(garnerModM([]int64{2, 3, 2}, []int64{3, 5, 7}, 10)) // 3
}
```

**Java.**
```java
import java.math.BigInteger;

public class GarnerModM {
    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    static long garnerModM(long[] r, long[] p, long M) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + a[j] * prefix) % p[i];
                prefix = (prefix * p[j]) % p[i];
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = (diff * modInv(prefix, p[i])) % p[i];
        }
        long x = 0, w = 1;
        for (int i = 0; i < k; i++) {
            x = (x + a[i] % M * w) % M;
            w = (w * (p[i] % M)) % M;
        }
        return x;
    }

    public static void main(String[] args) {
        System.out.println(garnerModM(new long[]{2, 3, 2}, new long[]{3, 5, 7}, 10)); // 3
    }
}
```

**Python.**
```python
def garner_mod_m(r, p, M):
    k = len(p)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % p[i]
            prefix = (prefix * p[j]) % p[i]
        diff = (r[i] - partial) % p[i]
        a[i] = (diff * pow(prefix, -1, p[i])) % p[i]
    x, w = 0, 1
    for i in range(k):
        x = (x + a[i] * w) % M
        w = (w * p[i]) % M
    return x


if __name__ == "__main__":
    print(garner_mod_m([2, 3, 2], [3, 5, 7], 10))  # 3
```

---

### Challenge 3: Three-Prime NTT Coefficient Combine

**Problem.** Given a coefficient's residues `(c0, c1, c2)` under three fixed NTT-friendly primes `(q0, q1, q2)`, and an answer modulus `M`, return the true coefficient reduced mod `M`. Use precomputed prefix-product inverses.

**Example.**
```text
q = [998244353, 1004535809, 985661441], (c0,c1,c2)=(23,23,23), M=10^9+7 -> 23
```

**Optimal.** Garner with `k=3`, inverses precomputed once.

**Python.**
```python
class Combine3:
    def __init__(self, q0, q1, q2):
        self.q0, self.q1, self.q2 = q0, q1, q2
        self.inv01 = pow(q0 % q1, -1, q1)
        self.inv012 = pow((q0 % q2) * (q1 % q2) % q2, -1, q2)

    def combine(self, c0, c1, c2, M):
        a0 = c0 % self.q0
        a1 = ((c1 - a0) * self.inv01) % self.q1
        partial = (a0 + a1 * self.q0) % self.q2
        a2 = ((c2 - partial) * self.inv012) % self.q2
        x = a0 % M
        x = (x + a1 % M * (self.q0 % M)) % M
        x = (x + a2 % M * ((self.q0 % M) * (self.q1 % M) % M)) % M
        return x


if __name__ == "__main__":
    c = Combine3(998244353, 1004535809, 985661441)
    print(c.combine(23, 23, 23, 1_000_000_007))  # 23
```

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

type Combine3 struct {
	q0, q1, q2     int64
	inv01, inv012  int64
}

func newCombine3(q0, q1, q2 int64) *Combine3 {
	return &Combine3{q0, q1, q2,
		modInv(q0%q1, q1),
		modInv((q0%q2)*(q1%q2)%q2, q2)}
}

func (c *Combine3) combine(c0, c1, c2, M int64) int64 {
	a0 := c0 % c.q0
	a1 := ((c1-a0)%c.q1 + c.q1) % c.q1 * c.inv01 % c.q1
	partial := (a0 + a1*(c.q0%c.q2)) % c.q2
	a2 := ((c2-partial)%c.q2 + c.q2) % c.q2 * c.inv012 % c.q2
	x := a0 % M
	x = (x + a1%M*(c.q0%M)) % M
	x = (x + a2%M*((c.q0%M)*(c.q1%M)%M)) % M
	return x
}

func main() {
	c := newCombine3(998244353, 1004535809, 985661441)
	fmt.Println(c.combine(23, 23, 23, 1_000_000_007)) // 23
}
```

**Java.**
```java
import java.math.BigInteger;

public class Combine3 {
    long q0, q1, q2, inv01, inv012;

    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    Combine3(long q0, long q1, long q2) {
        this.q0 = q0; this.q1 = q1; this.q2 = q2;
        inv01 = modInv(q0 % q1, q1);
        inv012 = modInv((q0 % q2) * (q1 % q2) % q2, q2);
    }

    long combine(long c0, long c1, long c2, long M) {
        long a0 = c0 % q0;
        long a1 = (((c1 - a0) % q1 + q1) % q1) * inv01 % q1;
        long partial = (a0 + a1 * (q0 % q2)) % q2;
        long a2 = (((c2 - partial) % q2 + q2) % q2) * inv012 % q2;
        long x = a0 % M;
        x = (x + a1 % M * (q0 % M)) % M;
        x = (x + a2 % M * ((q0 % M) * (q1 % M) % M)) % M;
        return x;
    }

    public static void main(String[] args) {
        Combine3 c = new Combine3(998244353L, 1004535809L, 985661441L);
        System.out.println(c.combine(23, 23, 23, 1_000_000_007L)); // 23
    }
}
```

---

### Challenge 4: RNS Add and Multiply with Reconstruction

**Problem.** Implement an RNS over fixed primes: convert integers to residue tuples, add/multiply componentwise, and Garner-reconstruct the result. Verify against direct arithmetic mod `P`.

**Approach.** Componentwise `O(k)` ops; Garner `O(k²)` only at the end.

**Python.**
```python
from math import prod


def to_rns(x, p):
    return [x % pi for pi in p]


def rns_add(a, b, p):
    return [(a[i] + b[i]) % p[i] for i in range(len(p))]


def rns_mul(a, b, p):
    return [(a[i] * b[i]) % p[i] for i in range(len(p))]


def garner(r, p):
    k = len(p)
    a = [0] * k
    for i in range(k):
        partial, prefix = 0, 1
        for j in range(i):
            partial = (partial + a[j] * prefix) % p[i]
            prefix = (prefix * p[j]) % p[i]
        a[i] = ((r[i] - partial) % p[i] * pow(prefix, -1, p[i])) % p[i]
    x, w = 0, 1
    for i in range(k):
        x += a[i] * w
        w *= p[i]
    return x


if __name__ == "__main__":
    p = [3, 5, 7]
    P = prod(p)
    A, B = 40, 17
    ra, rb = to_rns(A, p), to_rns(B, p)
    assert garner(rns_add(ra, rb, p), p) == (A + B) % P
    assert garner(rns_mul(ra, rb, p), p) == (A * B) % P
    print("RNS add/mul reconstructed correctly")
```

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

func toRNS(x int64, p []int64) []int64 {
	r := make([]int64, len(p))
	for i := range p {
		r[i] = ((x % p[i]) + p[i]) % p[i]
	}
	return r
}

func rnsMul(a, b, p []int64) []int64 {
	c := make([]int64, len(p))
	for i := range p {
		c[i] = a[i] * b[i] % p[i]
	}
	return c
}

func modInv(a, m int64) int64 {
	return new(big.Int).ModInverse(big.NewInt(((a%m)+m)%m), big.NewInt(m)).Int64()
}

func garner(r, p []int64) int64 {
	k := len(p)
	a := make([]int64, k)
	for i := 0; i < k; i++ {
		var partial, prefix int64 = 0, 1
		for j := 0; j < i; j++ {
			partial = (partial + a[j]*prefix) % p[i]
			prefix = (prefix * p[j]) % p[i]
		}
		diff := ((r[i]-partial)%p[i] + p[i]) % p[i]
		a[i] = (diff * modInv(prefix, p[i])) % p[i]
	}
	var x, w int64 = 0, 1
	for i := 0; i < k; i++ {
		x += a[i] * w
		w *= p[i]
	}
	return x
}

func main() {
	p := []int64{3, 5, 7}
	A, B := int64(40), int64(17)
	got := garner(rnsMul(toRNS(A, p), toRNS(B, p), p), p)
	fmt.Println(got, (A*B)%(3*5*7)) // 50 50  (680 mod 105 = 50)
}
```

**Java.**
```java
import java.math.BigInteger;

public class RnsDemo {
    static long[] toRNS(long x, long[] p) {
        long[] r = new long[p.length];
        for (int i = 0; i < p.length; i++) r[i] = ((x % p[i]) + p[i]) % p[i];
        return r;
    }

    static long[] rnsMul(long[] a, long[] b, long[] p) {
        long[] c = new long[p.length];
        for (int i = 0; i < p.length; i++) c[i] = a[i] * b[i] % p[i];
        return c;
    }

    static long modInv(long a, long m) {
        return BigInteger.valueOf(((a % m) + m) % m)
                .modInverse(BigInteger.valueOf(m)).longValue();
    }

    static long garner(long[] r, long[] p) {
        int k = p.length;
        long[] a = new long[k];
        for (int i = 0; i < k; i++) {
            long partial = 0, prefix = 1;
            for (int j = 0; j < i; j++) {
                partial = (partial + a[j] * prefix) % p[i];
                prefix = (prefix * p[j]) % p[i];
            }
            long diff = ((r[i] - partial) % p[i] + p[i]) % p[i];
            a[i] = (diff * modInv(prefix, p[i])) % p[i];
        }
        long x = 0, w = 1;
        for (int i = 0; i < k; i++) { x += a[i] * w; w *= p[i]; }
        return x;
    }

    public static void main(String[] args) {
        long[] p = {3, 5, 7};
        long A = 40, B = 17;
        long got = garner(rnsMul(toRNS(A, p), toRNS(B, p), p), p);
        System.out.println(got + " " + (A * B) % (3 * 5 * 7));
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"Garner writes `x` in mixed-radix `x = a_0 + a_1 p_0 + a_2 p_0 p_1 + …` and solves each digit mod `p_i` with a prefix-product inverse — `O(k²)`, no giant products."*
- Immediately flag the two gotchas: **pairwise-coprime moduli** and **the product `∏ p_i` must exceed the true value** (else silent wraparound).
- If asked for the value mod another modulus `M`, mention assembling the mixed-radix sum **mod `M`** to avoid big integers.
- Connect it to **multi-prime NTT** (`13-ntt`) and **RNS** — that's where Garner earns its keep, with precomputed inverses.
- Distinguish it from the **classic CRT formula** (`05-crt`): same answer, but Garner stays small and is incremental (Newton vs Lagrange).
- Offer to verify with a **round-trip** test: `garner(to_rns(x)) == x`.
