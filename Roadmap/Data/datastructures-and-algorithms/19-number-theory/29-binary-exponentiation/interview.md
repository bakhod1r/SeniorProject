# Binary Exponentiation (Fast Power) — Interview Preparation

Binary exponentiation is a favourite interview topic because it rewards one crisp insight — *"compute `a^n` in `O(log n)` by squaring the base and multiplying it into the result at the set bits of `n`"* — and then probes whether you can (a) **derive and prove** the `O(log n)` bound, (b) keep it correct and overflow-free **modulo `m`**, (c) extend it to **modular inverse via Fermat**, **matrices**, and **any monoid**, and (d) reason about the **constant-time / side-channel** concern in cryptography. This file is a curated question bank by seniority plus end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|-----------|
| `a^n` (small result) | square-and-multiply | `O(log n)` mults |
| `a^n mod m`, small `m` | modular binary exp | `O(log n)` mults |
| `a^n mod m`, large `m` | + 128-bit / `mulmod` | `O(log n)` or `O(log n log m)` |
| `a^(-1) mod p`, `p` prime | Fermat: `a^(p-2)` | `O(log p)` |
| order-`k` recurrence | matrix fast power | `O(k³ log n)` |
| large-order recurrence | Kitamasa (poly) | `O(k² log n)` |
| secret-exponent crypto | Montgomery ladder | `O(log n)`, constant-time |
| RSA decrypt | CRT + fast power | ~4× over direct |

Core algorithm:

```text
powmod(a, n, m):
    a %= m
    r = 1 % m                 # identity; a^0
    while n > 0:
        if n & 1:  r = r * a % m
        a = a * a % m          # square the base
        n >>= 1
    return r                   # O(log n) multiplications
```

Key facts:
- **`a^0 = 1`** (identity); start `r = 1` (or `1 % m`).
- Exactly `⌊log₂ n⌋` squarings + `popcount(n)` multiplies.
- Reduce mod `m` after **every** multiply.
- Works for any **associative** op with an identity (monoid): numbers, matrices, polynomials.
- Secret exponent → use a **constant-time ladder**, never the data-dependent loop.

---

## Junior Questions (12 Q&A)

### J1. What problem does binary exponentiation solve?
Computing `a^n` (or `a^n mod m`) in `O(log n)` multiplications instead of the naive `O(n)`. For `n = 10^9` that is ~30 operations versus a billion.

### J2. State the core idea in one sentence.
Square the base to build the ladder `a^1, a^2, a^4, a^8, …`, and multiply into the running result only at the positions where `n` has a `1` bit.

### J3. Why does `a^n = Π a^(2^i)` over the set bits?
Because `n` written in binary is `Σ b_i 2^i`, and by the exponent law `a^(x+y) = a^x · a^y`, so `a^n = a^(Σ b_i 2^i) = Π_{b_i=1} a^(2^i)`.

### J4. What is `a^0`, and why does the loop handle it?
`a^0 = 1` (the empty product / identity). The loop starts `result = 1` and never runs when `n = 0`, so it returns `1` automatically.

### J5. Why start `result` at `1` and not `a`?
`1` is the multiplicative identity, the correct empty product before any bits are processed. Starting at `a` would give `a^(n+1)`.

### J6. What does `n & 1` test, and what does `n >> 1` do?
`n & 1` is the lowest bit of `n` (is it odd?). `n >> 1` drops that bit (integer-divides by 2). Together they iterate over `n`'s binary digits from the bottom.

### J7. Why take everything mod `m`?
`a^n` grows astronomically and overflows fixed-width integers fast. Reducing after each multiply keeps numbers below `m²` while giving the exact residue, because reduction is compatible with `+` and `·`.

### J8. How many multiplications for `a^16`? For `a^15`?
`16 = 10000₂`: one set bit → `4` squarings + `1` multiply (best case). `15 = 1111₂`: `3` squarings + `4` multiplies (worst case for 4-bit numbers).

### J9. Trace `3^5`.
`5 = 101₂`. `r=1, b=3`: bit1→`r=3, b=9`; bit0→`b=81`; bit1→`r=3·81=243`. `3^5 = 243` ✓.

### J10. What is the time complexity, precisely?
`Θ(log n)` multiplications; `⌊log₂ n⌋` squarings plus `popcount(n)` products. Space `O(1)` iteratively.

### J11. Why never use floating-point `pow` for this?
`double` loses precision past ~15 significant digits and cannot compute `mod m`. For exact integer or modular powers, use integer binary exponentiation.

### J12. What happens for `m = 1`?
Every residue is `0 mod 1`. Initialize `result = 1 % m` so it correctly becomes `0`.

---

## Middle Questions (14 Q&A)

### M1. State and justify the loop invariant.
`result · base^n = a^N` (N = original exponent). It holds initially (`1 · a^N`), is preserved each iteration (moving a factor of `base` into `result` on odd `n`, squaring `base` while halving `n`), and at `n = 0` gives `result = a^N`.

### M2. Why does the algorithm generalize to matrices?
It uses only associativity and an identity — the **monoid** axioms. Matrix multiplication is associative with identity `I`, so `M^n` is computed by the same loop (scalar `*` → matrix multiply, `1` → `I`).

### M3. Is commutativity required?
No. Matrices do not commute, but powers of the *same* element always commute (`M^i M^j = M^{i+j} = M^j M^i`), which is all the algorithm needs.

### M4. When does `a*b % m` overflow, and how do you fix it?
When `m² ` exceeds your integer's max (`m > ~3·10^9` for `int64`). Fix with 128-bit intermediates (`__int128`, `math/bits`, `BigInteger`), Russian-peasant `mulmod` (`O(log m)` per multiply), or Montgomery multiplication.

### M5. Compute `7^(-1) mod 13`.
Fermat: `7^(13-2) = 7^11 mod 13`. Via fast power, `7^11 ≡ 2`. Check `7·2 = 14 ≡ 1` ✓.

### M6. When can you NOT use Fermat for the inverse?
When `m` is not prime. Use the extended Euclidean algorithm for any modulus coprime to `a`.

### M7. Right-to-left vs left-to-right — what differs?
Same number of operations and same result. RL (iterative) squares a moving base, `O(1)` space, no precomputation. LR (MSB-first) squares the result and multiplies by the fixed base — natural for window tables and the constant-time ladder.

### M8. Why is the recursive form `O(log n)` and not `O(n)`?
You compute `a^(n/2)` *once* and square it. Calling the recursion twice (`pow(n/2) * pow(n/2)`) would be `O(n)`.

### M9. How do you compute `a^(-n) mod p`?
`a^(-n) = (a^(-1))^n`. Compute the inverse via Fermat (`a^(p-2)`), then raise to `n` with fast power.

### M10. Give the exact multiplication count formula.
`⌊log₂ n⌋ + popcount(n) − 1` (discarding the unused final squaring). Best `log₂ n` (power of two), worst `2 log₂ n − 1` (all bits set), average `~1.5 log₂ n`.

### M11. How would you build fast Fibonacci from this?
`[[1,1],[1,0]]^n = [[F_{n+1},F_n],[F_n,F_{n-1}]]`. Power the `2×2` matrix with the same loop using matrix multiply → `F_n mod p` in `O(log n)`. (Topic `11-matrix-exponentiation`.)

### M12. Why use `pow(a, n, m)` in Python over a hand-rolled loop?
It is binary exponentiation implemented in optimized C — faster and bug-free. Hand-roll only for custom monoids (matrices) or to demonstrate the mechanism.

### M13. What is the cost of matrix fast power for a `k×k` matrix?
`O(k³ log n)`: `O(log n)` matrix multiplies, each `O(k³)` with schoolbook multiplication.

### M14. How do you handle a negative base in Go/Java?
`%` can return negative there; normalize with `((a % m) + m) % m` before and during the loop so all residues stay in `[0, m)`.

---

## Senior Questions (12 Q&A)

### S1. How is binary exponentiation the heart of RSA?
RSA is `c = m^e mod N` and `m = c^d mod N`, with `N, d` thousands of bits. Fast power makes these `O(log d)` modular multiplies; the naive loop is impossible.

### S2. What is the timing side-channel, and why does the basic loop have it?
The basic loop multiplies into `result` only on `1`-bits, so its runtime/power consumption depends on the secret exponent's bits. An attacker measuring time can recover the key bit by bit.

### S3. How do you make exponentiation constant-time?
Use the Montgomery powering ladder: maintain two registers, do exactly one multiply and one square per bit regardless of its value, and select via a masked `cswap` (no data-dependent branch). Add base/exponent blinding for power analysis.

### S4. What does Montgomery *multiplication* (not the ladder) buy you?
It replaces the expensive `% m` division in each modular multiply with shifts and multiplies (REDC) after a one-time transform — a large win inside a power loop with many multiplies under a fixed odd modulus.

### S5. How does CRT speed up RSA decryption?
Compute `c^(d mod (p-1)) mod p` and `c^(d mod (q-1)) mod q` on half-size operands, then recombine. Since modular multiply is `~O(b²)`, two half-size exponentiations cost ~`b³/4` vs `b³` — about 4× faster.

### S6. What are windowed and sliding-window exponentiation?
Process `w` bits per step using a precomputed table of small powers, reducing non-squaring multiplies from `~popcount(n)` to `~log n / w`. Sliding windows use only odd powers (smaller table, fewer multiplies). Standard in RSA libraries.

### S7. When do you abandon matrix fast power for a recurrence?
When the order `k` is large (hundreds); the `k³` matrix multiply dominates. Switch to Kitamasa, which fast-powers a polynomial `x^n mod χ(x)` for `O(k² log n)` (or `O(k log k log n)` with NTT).

### S8. How do you invert many values cheaply?
Batch inversion: prefix-multiply all values, take *one* Fermat inverse of the total product, then unwind backward — `n` inversions become 1 fast-power + `O(n)` multiplies.

### S9. What modulus pitfalls bite at scale?
`a*b` overflow for large `m`; negative residues from subtractive recurrences; using Fermat with a composite modulus; cache-timing leaks from secret-indexed window tables.

### S10. Why is `65537` the common RSA public exponent?
`65537 = 2^16 + 1` has only two set bits, so encryption is just 16 squarings + 1 multiply — fast and a near-optimal addition chain — while still being large enough to avoid small-exponent attacks.

### S11. How do you test a `powmod` you cannot brute-force?
Property tests: `powmod(a, x+y, m) == powmod(a,x,m)*powmod(a,y,m) % m`, `powmod(a, 0, m) == 1 % m`, and agreement with the naive loop on small `n`. For crypto, statistically verify runtime is uncorrelated with the exponent's Hamming weight.

### S12. What is the discrete-log connection?
Exponentiation `g^x mod p` is the easy direction; recovering `x` (discrete log) is believed hard. Diffie-Hellman and ElGamal security rest on this asymmetry, with fast power providing the easy direction.

---

## Professional Questions (8 Q&A)

### P1. Prove correctness from the binary representation.
`n = Σ b_i 2^i`; by exponent additivity `a^n = Π_{b_i=1} a^{2^i}`. The loop's `base` equals `a^{2^i}` at iteration `i` (by induction: squaring doubles the exponent), and it is multiplied into `result` exactly when `b_i = 1`. Hence `result = Π_{b_i=1} a^{2^i} = a^n`.

### P2. Give the loop-invariant termination argument.
Invariant `result · base^n = a^N`; measure `n` is a non-negative integer that strictly decreases (`⌊n/2⌋ < n`), so the loop terminates with `n = 0`, leaving `result = a^N`.

### P3. State the exact operation count and its range.
`T(n) = ⌊log₂ n⌋ + popcount(n) − 1`. Range `[log₂ n, 2 log₂ n − 1]`, average `~1.5 log₂ n` over `k`-bit exponents.

### P4. Is binary exponentiation optimal? Give a counterexample.
No. The minimum is the addition-chain length `ι(n)`. For `n = 15`, binary needs 7 multiplies but the chain `1→2→3→6→12→15` needs only 5.

### P5. State the addition-chain bounds.
`⌊log₂ n⌋ ≤ ι(n) ≤ ⌊log₂ n⌋ + popcount(n) − 1 ≤ 2⌊log₂ n⌋`. Lower bound: each step at most doubles the max exponent. Upper bound: binary exp is itself such a chain.

### P6. What is the asymptotic optimal and how is it approached?
`ι(n) = log₂ n (1 + o(1))`, approached by `m`-ary windows with `m = Θ(log n / log log n)`. Binary's `1.5 log n` average is asymptotically worse, motivating windows.

### P7. Why is modular exponentiation exact?
Reduction `x ↦ x mod m` is a ring homomorphism, so `a^n mod m = (a mod m)^n mod m`; reducing intermediates yields the same residue as computing over `ℤ` then reducing. `(ℤ_m, ·, 1)` is a monoid, so the general proof applies.

### P8. What is the hardness of finding optimal chains?
Per-`n` minimal chains are not known to be polynomial; computing a minimal chain for a *set* of targets is NP-complete (Downey–Leong–Sethi). The Scholz–Brauer conjecture (`ι(2^n−1) ≤ n−1+ι(n)`) remains open. So practice uses near-optimal heuristics (windows), not true optima.

---

## Behavioral / Design Prompts

- *"Walk me through how you'd implement RSA decryption efficiently and securely."* Expect: CRT split, per-prime fast power, Montgomery multiplication, constant-time ladder for the secret exponent, blinding.
- *"You need `C(n, k) mod p` for many queries."* Expect: precompute factorials, one Fermat inverse of the top factorial, backward pass for inverse factorials — fast power used once.
- *"Compute the `10^18`-th Fibonacci number mod a prime."* Expect: `2×2` matrix fast power, `O(log n)`.
- *"Your modular power gives wrong answers for a large modulus."* Expect: diagnose `a*b` overflow, switch to 128-bit/`mulmod`.

---

## Coding Challenge 1 — Modular Exponentiation

> Implement `powmod(a, n, m)` computing `a^n mod m` in `O(log n)`, handling `n = 0`, `m = 1`, and reducing the base first. Assume `m ≤ 10^9 + 7`.

#### Go

```go
package main

import "fmt"

func powmod(a, n, m int64) int64 {
	a %= m
	if a < 0 {
		a += m
	}
	result := int64(1) % m
	for n > 0 {
		if n&1 == 1 {
			result = result * a % m
		}
		a = a * a % m
		n >>= 1
	}
	return result
}

func main() {
	fmt.Println(powmod(3, 13, 1_000_000_007)) // 1594323
	fmt.Println(powmod(2, 0, 7))              // 1
	fmt.Println(powmod(5, 100, 1))            // 0
}
```

#### Java

```java
public class PowMod {
    static long powmod(long a, long n, long m) {
        a %= m;
        if (a < 0) a += m;
        long result = 1 % m;
        while (n > 0) {
            if ((n & 1) == 1) result = result * a % m;
            a = a * a % m;
            n >>= 1;
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println(powmod(3, 13, 1_000_000_007L)); // 1594323
        System.out.println(powmod(2, 0, 7));               // 1
        System.out.println(powmod(5, 100, 1));             // 0
    }
}
```

#### Python

```python
def powmod(a, n, m):
    a %= m
    result = 1 % m
    while n > 0:
        if n & 1:
            result = result * a % m
        a = a * a % m
        n >>= 1
    return result


if __name__ == "__main__":
    print(powmod(3, 13, 1_000_000_007))  # 1594323
    print(powmod(2, 0, 7))               # 1
    print(powmod(5, 100, 1))             # 0
    assert powmod(3, 13, 1_000_000_007) == pow(3, 13, 1_000_000_007)
```

---

## Coding Challenge 2 — Modular Inverse via Fermat

> Given a prime `p` and `a` with `gcd(a, p) = 1`, return `a^(-1) mod p` using fast power. Then use it to compute `C(n, k) mod p`.

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func powmod(a, n int64) int64 {
	a %= MOD
	r := int64(1)
	for n > 0 {
		if n&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		n >>= 1
	}
	return r
}

func inv(a int64) int64 { return powmod(a, MOD-2) } // Fermat

func binom(n, k int64) int64 {
	if k < 0 || k > n {
		return 0
	}
	num, den := int64(1), int64(1)
	for i := int64(0); i < k; i++ {
		num = num * ((n - i) % MOD) % MOD
		den = den * ((i + 1) % MOD) % MOD
	}
	return num * inv(den) % MOD
}

func main() {
	fmt.Println(inv(7))        // inverse of 7 mod 1e9+7
	fmt.Println(binom(10, 3))  // 120
}
```

#### Java

```java
public class FermatInverse {
    static final long MOD = 1_000_000_007L;

    static long powmod(long a, long n) {
        a %= MOD;
        long r = 1;
        while (n > 0) {
            if ((n & 1) == 1) r = r * a % MOD;
            a = a * a % MOD;
            n >>= 1;
        }
        return r;
    }

    static long inv(long a) { return powmod(a, MOD - 2); }

    static long binom(long n, long k) {
        if (k < 0 || k > n) return 0;
        long num = 1, den = 1;
        for (long i = 0; i < k; i++) {
            num = num * ((n - i) % MOD) % MOD;
            den = den * ((i + 1) % MOD) % MOD;
        }
        return num * inv(den) % MOD;
    }

    public static void main(String[] args) {
        System.out.println(inv(7));
        System.out.println(binom(10, 3)); // 120
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def inv(a):
    return pow(a, MOD - 2, MOD)  # Fermat


def binom(n, k):
    if k < 0 or k > n:
        return 0
    num = den = 1
    for i in range(k):
        num = num * ((n - i) % MOD) % MOD
        den = den * ((i + 1) % MOD) % MOD
    return num * inv(den) % MOD


if __name__ == "__main__":
    print(inv(7))
    print(binom(10, 3))  # 120
```

---

## Coding Challenge 3 — Fast Fibonacci via Matrix Power

> Return `F_n mod p` for `n` up to `10^18` by powering the `2×2` matrix `[[1,1],[1,0]]`.

#### Go

```go
package main

import "fmt"

const MOD = 1_000_000_007

func mul(a, b [2][2]int64) [2][2]int64 {
	var c [2][2]int64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			for t := 0; t < 2; t++ {
				c[i][j] = (c[i][j] + a[i][t]*b[t][j]) % MOD
			}
		}
	}
	return c
}

func fib(n int64) int64 {
	res := [2][2]int64{{1, 0}, {0, 1}} // identity
	base := [2][2]int64{{1, 1}, {1, 0}}
	for n > 0 {
		if n&1 == 1 {
			res = mul(res, base)
		}
		base = mul(base, base)
		n >>= 1
	}
	return res[0][1] // F_n
}

func main() {
	fmt.Println(fib(10))                 // 55
	fmt.Println(fib(1_000_000_000_000))  // instant
}
```

#### Java

```java
public class FibMatrix {
    static final long MOD = 1_000_000_007L;

    static long[][] mul(long[][] a, long[][] b) {
        long[][] c = new long[2][2];
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
                for (int t = 0; t < 2; t++)
                    c[i][j] = (c[i][j] + a[i][t] * b[t][j]) % MOD;
        return c;
    }

    static long fib(long n) {
        long[][] res = {{1, 0}, {0, 1}};
        long[][] base = {{1, 1}, {1, 0}};
        while (n > 0) {
            if ((n & 1) == 1) res = mul(res, base);
            base = mul(base, base);
            n >>= 1;
        }
        return res[0][1];
    }

    public static void main(String[] args) {
        System.out.println(fib(10));                  // 55
        System.out.println(fib(1_000_000_000_000L));  // instant
    }
}
```

#### Python

```python
MOD = 1_000_000_007


def mul(a, b):
    return [[sum(a[i][t] * b[t][j] for t in range(2)) % MOD
             for j in range(2)] for i in range(2)]


def fib(n):
    res = [[1, 0], [0, 1]]    # identity
    base = [[1, 1], [1, 0]]
    while n > 0:
        if n & 1:
            res = mul(res, base)
        base = mul(base, base)
        n >>= 1
    return res[0][1]


if __name__ == "__main__":
    print(fib(10))                # 55
    print(fib(1_000_000_000_000)) # instant
```

---

## Coding Challenge 4 — Large-Modulus Power (overflow-safe)

> Compute `a^n mod m` where `m` can be up to `10^18`, so `a*b` overflows 64-bit before reduction. Use a 128-bit / safe `mulmod`.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

func mulmod(a, b, m uint64) uint64 {
	hi, lo := bits.Mul64(a, b)
	_, rem := bits.Div64(hi%m, lo, m)
	return rem
}

func powmod(a, n, m uint64) uint64 {
	a %= m
	r := uint64(1) % m
	for n > 0 {
		if n&1 == 1 {
			r = mulmod(r, a, m)
		}
		a = mulmod(a, a, m)
		n >>= 1
	}
	return r
}

func main() {
	fmt.Println(powmod(123456789, 987654321, 1_000_000_000_000003))
}
```

#### Java

```java
import java.math.BigInteger;

public class BigModPow {
    static long mulmod(long a, long b, long m) {
        return BigInteger.valueOf(a).multiply(BigInteger.valueOf(b))
                .mod(BigInteger.valueOf(m)).longValue();
    }

    static long powmod(long a, long n, long m) {
        a %= m;
        long r = 1 % m;
        while (n > 0) {
            if ((n & 1) == 1) r = mulmod(r, a, m);
            a = mulmod(a, a, m);
            n >>= 1;
        }
        return r;
    }

    public static void main(String[] args) {
        System.out.println(powmod(123456789L, 987654321L, 1_000_000_000_000003L));
    }
}
```

#### Python

```python
def powmod(a, n, m):
    # Python ints are unbounded, so a*a never overflows.
    return pow(a, n, m)


if __name__ == "__main__":
    print(powmod(123456789, 987654321, 1_000_000_000_000003))
```

---

Next step: [tasks.md](./tasks.md) — graded practice problems in all three languages.
