# Montgomery Multiplication (and Barrett Reduction) — Interview Preparation

Montgomery multiplication is a favorite interview topic because it rewards a single crisp insight — *"division is slow; work in Montgomery form `x·R mod n` so reduction is a shift, not a `÷ n`"* — and then tests whether you can (a) state the REDC algorithm and why its division is exact, (b) derive and compute `n' = -n^{-1} mod R`, (c) explain the odd-modulus restriction, (d) know when Montgomery beats plain `%` (amortized chains) and when Barrett is the better tool, and (e) wire it into a real hot loop like Miller-Rabin. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Answer | Cost |
|----------|--------|------|
| Why is `(a*b) % n` slow? | The `% n` hides an integer **division** (~20–90 cycles) | — |
| Montgomery form of `x` | `x̄ = (x·R) mod n`, `R = 2^k > n`, `gcd(R,n)=1` | — |
| REDC computes | `T·R^{-1} mod n` for `0 ≤ T < nR`, no `÷ n` | O(1), 2 mults + shift + 1 sub |
| Magic constant | `n' = (-n^{-1}) mod R`, so `n·n' ≡ -1 (mod R)` | precompute once |
| Montgomery multiply | `montMul(ā,b̄) = REDC(ā·b̄) = (ab)‾` | O(1) |
| Convert in | `x̄ = REDC(x·(R² mod n))` | O(1) |
| Convert out | `x = REDC(x̄)` | O(1) |
| Odd-modulus restriction | `R=2^k` so `gcd(R,n)=1 ⟺ n` odd | — |
| Barrett reduce | precompute `μ=⌊2^{2k}/n⌋`; `q=(x·μ)>>2k`; correct ≤2× | any modulus, no form |
| When Montgomery wins | many multiplies under fixed odd `n` (modpow, Miller-Rabin, NTT) | amortizes conversion |

Core algorithm:

```text
REDC(T):                    # 0 <= T < n*R
    m = (T mod R) * n' mod R     # low k bits — a mask
    t = (T + m*n) / R            # divide by R = shift right k bits (exact)
    if t >= n: t -= n            # one conditional subtraction
    return t                     # = T * R^{-1} mod n
```

Key facts:
- **Division by `R` is a shift; mod `R` is a mask.** That is the entire speedup.
- `n·n' ≡ -1 (mod R)` makes the low bits cancel so the `/R` is exact.
- Montgomery needs **odd** `n`; Barrett works for any `n`.
- Amortize: convert in once, multiply many times, convert out once.
- Addition is free in Montgomery form; only multiplication needs REDC.

---

## Junior Questions (12 Q&A)

### J1. Why is `(a * b) % n` considered slow?
The multiplication is cheap, but the `% n` requires an integer **division**, which on modern CPUs takes roughly 20–90 cycles (vs ~1–5 for a multiply or add) and pipelines poorly. In a loop that does nothing but modular multiplies, that division dominates the runtime.

### J2. What is Montgomery form?
The Montgomery representative of `x` is `x̄ = (x · R) mod n`, where `R = 2^k` is a power of two larger than `n` and coprime to `n`. We do arithmetic on these representatives so that reduction becomes a shift instead of a division.

### J3. Why choose `R` as a power of two?
Because dividing by `R = 2^k` is just a right shift by `k` bits, and taking a number mod `R` is just masking the low `k` bits. Both are among the cheapest CPU operations, replacing the expensive division.

### J4. What does REDC do?
Given `T` with `0 ≤ T < n·R`, REDC returns `T · R^{-1} mod n` using only multiplies, additions, a shift, and one conditional subtraction — never dividing by `n`.

### J5. What is `n'`?
The precomputed constant `n' = (-n^{-1}) mod R`. It satisfies `n·n' ≡ -1 (mod R)`, which is exactly what makes `T + m·n` divisible by `R` so the division by `R` in REDC is exact.

### J6. How do you multiply two numbers in Montgomery form?
Multiply them normally, then run REDC once: `REDC(ā·b̄) = (ab)‾`. The extra factor of `R` from the product is stripped by REDC, leaving the Montgomery form of `a·b`.

### J7. How do you convert in and out of Montgomery form?
In: `x̄ = x·R mod n`, computed as `REDC(x·(R² mod n))`. Out: `x = REDC(x̄)`, since `REDC(x̄) = x̄·R^{-1} = (xR)R^{-1} = x mod n`.

### J8. Why does Montgomery require an odd modulus?
`R = 2^k`, and `n'` exists only when `gcd(R, n) = 1`. For a power-of-two `R`, that holds exactly when `n` is odd. An even `n` shares the factor 2 with `R`, so `n^{-1} mod R` does not exist.

### J9. When is Montgomery actually faster than plain `%`?
Only when you do **many** modular multiplications under a fixed modulus, so the one-time conversion cost is amortized. For a single multiply, plain `(a*b) % n` is simpler and faster.

### J10. What is the conditional subtraction in REDC for?
REDC's intermediate result lands in `[0, 2n)`. A single `if t >= n: t -= n` brings it back into `[0, n)`. Skipping it lets values drift above `n` and corrupts later multiplies.

### J11. Is the answer exact, or approximate?
Exact. Montgomery only changes the *representation* of numbers; no precision is lost. (Contrast with floating-point reciprocal tricks, which can round.)

### J12 (analysis). What is the Montgomery form of 1, and why does it matter?
It is `R mod n`, not `1`. It is the multiplicative identity in Montgomery form, so an accumulator (e.g. in modpow) must be initialized with `to_mont(1) = R mod n`, not literal `1`.

---

## Middle Questions (12 Q&A)

### M1. Walk through REDC and explain why `T + m·n` is divisible by `R`.
`m ≡ T·n' (mod R)`, and `n·n' ≡ -1 (mod R)`, so `T + m·n ≡ T + T·n'·n ≡ T(1 + n·n') ≡ T·0 ≡ 0 (mod R)`. Hence `R` divides `T + m·n` and the `/R` is an exact shift.

### M2. Why does `REDC(T) ≡ T·R^{-1} (mod n)`?
Modulo `n`, the added `m·n ≡ 0`, so `t·R = T + m·n ≡ T (mod n)`. Multiplying by `R^{-1}` gives `t ≡ T·R^{-1} (mod n)`.

### M3. How do you compute `n'`?
Two ways. Newton/Hensel iteration `inv ← inv·(2 - n·inv)` mod `2^k`, starting from `inv = n` (correct mod 8), doubling correct bits each step — 5 iterations for 64 bits. Or the extended Euclidean algorithm solving `n·x + R·y = 1`. Then `n' = -inv mod R`.

### M4. Why does the Newton iteration converge so fast?
It is quadratically convergent: if `inv ≡ n^{-1} (mod 2^m)` then `inv·(2 - n·inv) ≡ n^{-1} (mod 2^{2m})`. Each step doubles the number of correct low bits (3 → 6 → 12 → 24 → 48 → 96).

### M5. How is Montgomery used in modular exponentiation?
Convert the base into Montgomery form once, initialize the accumulator to `to_mont(1)`, run the binary-exponentiation squarings/multiplies using Montgomery multiplies, then convert the final result out. The two conversions are amortized over `O(log b)` cheap multiplies.

### M6. What is Barrett reduction and how does it differ from Montgomery?
Barrett reduces `x mod n` without any special form: precompute `μ = ⌊2^{2k}/n⌋`, estimate the quotient as `q = (x·μ) >> 2k`, compute `r = x - q·n`, and correct with at most two subtractions. Unlike Montgomery, it works for any modulus and needs no conversion, but costs two multiplies per reduce.

### M7. When would you pick Barrett over Montgomery?
When the modulus may be even (Montgomery can't handle it), when you reduce occasional independent products and don't want to track a special form, or in mixed workloads where values flow in and out of non-Montgomery computations.

### M8. How many conditional subtractions does each method need?
REDC: at most one (its intermediate is in `[0, 2n)`). Barrett: at most two (its quotient estimate can be 2 below the true quotient). This is a small structural advantage for Montgomery in branch-free code.

### M9. Addition in Montgomery form — does it need REDC?
No. `(x+y)·R ≡ xR + yR (mod n)`, so Montgomery forms add directly with a normal modular addition. Only multiplication routes through REDC. This matters for NTT butterflies, which mix adds and one multiply.

### M10. Why is `R = 2^64` (the word size) a popular choice?
Then "mod R" is the low 64-bit half and "÷ R" is the high 64-bit half of a 128-bit product — both free. You read the right register half instead of doing any explicit shift or mask.

### M11. What overflow concern arises in a 64-bit Montgomery multiply?
The product `a·b` of two 64-bit values is 128 bits. You must compute the full 128-bit product (`bits.Mul64`, `Math.multiplyHigh`, `__int128`) and feed both halves into REDC; a 64-bit product silently overflows.

### M12 (analysis). Roughly how many multiplies until Montgomery breaks even?
The conversions cost ≈ 2 REDCs (≈ 4 multiplies), and each multiply saves `D - 2M` cycles (`D` = division cost, `M` = multiply cost). With `D ≈ 20–80`, `M ≈ 3`, break-even is just a handful of multiplies — so any modpow or inner loop wins easily.

---

## Senior Questions (10 Q&A)

### S1. How do you implement a deterministic Miller-Rabin for 64-bit `n` with Montgomery?
Candidates are odd, so Montgomery applies. Build the context once for `n`, use a fixed witness set (`{2,3,5,...,37}` is deterministic below `2^64`), and run the whole witness loop in Montgomery form. The inner loop is `mulmod`-bound, exactly where Montgomery's saved divisions pay off.

### S2. How do you make the conditional subtraction constant-time for crypto?
Replace the branch with a masked subtract: compute `t2 = t - n`, derive a mask from the borrow (all-ones if `t < n`), and select `t` or `t2` without branching. A secret-dependent branch leaks via timing/branch prediction.

### S3. What is a redundant Montgomery representation and why use it?
Allowing representatives in `[0, 2n)` instead of `[0, n)` lets you skip the conditional subtraction in the inner loop entirely (given `4n ≤ R`), normalizing once at the end. This removes the only branch from hot loops like NTT butterflies.

### S4. When does plain `%` rival Montgomery even on long chains?
When the modulus is a **compile-time constant**: modern compilers strength-reduce `% const` into a multiply-shift (essentially Barrett baked in). Then plain `%` is fast and Montgomery's edge shrinks to conversion-free chains. Hand-rolled reducers matter most for *runtime* moduli reused many times.

### S5. How do you handle an even modulus if you must use Montgomery-style speed?
You can't use Montgomery directly. Either use Barrett, or split `n = 2^e · m` with `m` odd: do Montgomery mod `m`, trivial masking mod `2^e`, and recombine via CRT (sibling `05-crt`). Usually Barrett is simpler.

### S6. Montgomery vs Barrett in an NTT — which and why?
Both are used. Whole-transform Montgomery converts all coefficients in once and runs every butterfly in Montgomery form (conversions are `O(n)` vs `O(n log n)` butterflies). Barrett avoids form-tracking when coefficients flow through other computations. For a fixed prime, Montgomery is common; for flexibility, Barrett.

### S7. How do you verify a `mulmod` implementation that runs billions of times?
Cross-check against plain `(a*b) % n` on hundreds of thousands of random `(a,b,n)` triples; assert `out(in(x)) == x`, `n·n' ≡ -1 (mod R)`, and Fermat KATs (`2^{n-1} ≡ 1 mod n` for prime `n`). Assert oddness at construction. Fuzz boundaries (`a=b=n-1`, `n` near `2^63`).

### S8. What integer width do you pick for which modulus size?
`n < 2^31`: 32-bit Montgomery, products in `uint64`. `n < 2^63`: 64-bit Montgomery, `R = 2^64`, 128-bit products. `n ≥ 2^64`: multi-limb CIOS Montgomery (crypto-library territory). Watch the carry-out in the conditional subtract for `n` near `2^64`.

### S9. Why is Montgomery a constant-factor optimization, not an algorithmic one?
Reducing an `O(1)`-word value is `Θ(1)` either way. Montgomery and Barrett don't change any algorithm's asymptotic complexity; they shrink the constant by removing the hardware division. They are implementation techniques.

### S10 (analysis). Prove REDC needs at most one subtraction.
`T < n·R` and `m < R`, so `T + m·n < n·R + R·n = 2nR`, hence `t = (T+m·n)/R < 2n`. Since `t ≥ 0`, `t ∈ [0, 2n)`, so exactly one subtraction of `n` (when `t ≥ n`) lands it in `[0, n)`.

---

## Professional Questions (8 Q&A)

### P1. Design a fast modular-arithmetic library API. What do you expose?
A context built per modulus (asserts oddness for the Montgomery path), holding `n`, `n'`, `R² mod n`. Methods: `into`, `outof`, `mul`, `pow`. Internally branchless subtract for constant-time mode. A Barrett fallback for even/arbitrary moduli. A debug mode that cross-checks every result against `%`. Document which values are in Montgomery form.

### P2. How do you decide Montgomery vs Barrett vs plain `%` for a given workload?
Ask: how many multiplies per modulus (amortization), is `n` odd, is `n` a compile-time constant (compiler strength-reduces `%`), is constant-time needed, and does the value flow through non-Montgomery code? Long chain + odd + runtime modulus → Montgomery; even/arbitrary or conversion-averse → Barrett; one-off or constant modulus → plain `%`.

### P3. Your "optimized" Montgomery code is slower than `% n`. What happened?
Likely you rebuilt the constants (`n'`, `R²`) per call instead of once per modulus, or you used Montgomery for a single multiply (no amortization), or the modulus was a compile-time constant the compiler already strength-reduced. Profile; reuse the context; reserve Montgomery for long chains under runtime moduli.

### P4. How do you debug "the modpow result is wrong" with Montgomery?
Run plain `modpow` on the same inputs and diff. Check the usual suspects: even modulus (Montgomery invalid), missing conditional subtraction, `n^{-1}` vs `-n^{-1}` sign error, accumulator initialized to `1` instead of `to_mont(1)`, and a 64-bit product overflow (missing high half). Verify `n·n' ≡ -1 (mod R)`.

### P5. Explain the CIOS multi-precision Montgomery variant at a high level.
For `n ≥ 2^64`, operands are limb arrays in base `2^w`. CIOS interleaves: each outer step adds `a_i·b` to the accumulator, then picks `q_i` so the lowest limb cancels (the multi-limb echo of REDC's low-bit cancellation) and shifts down a limb. After `ℓ` steps the accumulator is `a·b·R^{-1} mod n`. It uses `2ℓ²+ℓ` word multiplies and is the algorithm inside RSA/ECC libraries.

### P6. Why does Montgomery improve side-channel resistance, not just speed?
Hardware division latency can depend on operands, leaking secrets via timing; Montgomery replaces it with fixed-latency multiplies/shifts. Combined with a branchless conditional subtraction (or a redundant representation), the whole `mulmod` is constant-time — which is why crypto libraries use it for RSA/ECC.

### P7. How does Montgomery interact with Pollard-rho?
Pollard-rho (sibling `09`) iterates `x ← x² + c (mod n)` thousands of times; `x² mod n` is the bottleneck `mulmod`. Keep `x` and `c` in Montgomery form across the whole walk (addition is free in the form), and batch products before a single gcd (Brent). The composite candidates are odd in practice, so Montgomery applies.

### P8 (analysis). Derive Barrett's error bound.
With `μ = ⌊2^{2k}/n⌋ = 2^{2k}/n - δ`, `0 ≤ δ < 1`, the estimate `x·μ/2^{2k} = x/n - xδ/2^{2k}`. For `x < n²` and `n < 2^k`, `xδ/2^{2k} < 1`, so `x/n - 1 < x·μ/2^{2k} ≤ x/n`. Taking floors (and one more lost unit), `⌊x/n⌋ - 2 ≤ q ≤ ⌊x/n⌋`, giving `r = x - q·n ∈ [0, 3n)` — at most two corrections.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you optimized a hot numeric loop.
Look for a concrete story: a modpow/primality/NTT loop where a profile showed `%` (division) dominating, the insight to switch to Montgomery/Barrett, the amortization reasoning, and the measured speedup. Strong answers mention cross-checking against the old `%`-based version and asserting the odd-modulus precondition.

### B2. A teammate used Montgomery on an even modulus and shipped wrong results. How do you handle it?
Explain the odd-modulus restriction calmly: `R = 2^k` shares a factor with even `n`, so `n^{-1} mod R` (hence `n'`) doesn't exist — it's algebra, not a bug to patch. The fix is Barrett (or CRT-split). Add an oddness assertion so it fails loudly next time. Frame it as a teaching moment.

### B3. Design a service computing many `a^b mod n` for a fixed odd `n`.
Build the Montgomery context once at startup. Each request converts its base in, runs `O(log b)` cheap multiplies, converts out. Discuss reusing the context (never rebuild per request), constant-time mode if `n`/`b` are secret, and a Barrett fallback if `n` can be even.

### B4. How would you explain Montgomery to a junior engineer?
Use the currency analogy: converting money at the airport isn't worth it for one purchase, but if you'll transact hundreds of times, convert once and spend cheaply, then convert back. `R` is the "round-number base" where dividing is just dropping trailing zeros. Lead with the two gotchas: odd modulus only, and never skip the conditional subtraction.

### B5. Your number-theory job's CPU is pinned on division. How do you investigate?
Profile to confirm `%`/division dominates. Check the modulus: odd → Montgomery; even/arbitrary → Barrett; compile-time constant → let the compiler strength-reduce. Verify constants are built once. Estimate the amortization (multiplies per modulus). Cross-check the new reducer against `%` before rollout.

---

## Coding Challenges

### Challenge 1: Implement REDC + Montgomery modpow

**Problem.** Build a Montgomery context for an odd modulus `n < 2^63` with `R = 2^64`, implement REDC, Montgomery multiply, conversions, and `modpow(base, exp) = base^exp mod n`.

**Example.**
```text
n = 1_000_000_007, modpow(2, 10) -> 1024
n = 13,           modpow(7, 2)  -> 10
```

**Optimal.** `O(log exp)` Montgomery multiplies, each O(1) with no division by `n`.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

type Mont struct{ n, nInv, r2 uint64 }

func newMont(n uint64) Mont {
	if n&1 == 0 {
		panic("modulus must be odd")
	}
	inv := n
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv
	}
	r := (-n) % n // 2^64 mod n
	r2 := r
	for i := 0; i < 64; i++ {
		r2 = (r2 << 1) % n
	}
	return Mont{n, -inv, r2}
}

func (m Mont) redc(hi, lo uint64) uint64 {
	mm := lo * m.nInv
	mnHi, mnLo := bits.Mul64(mm, m.n)
	_, c := bits.Add64(lo, mnLo, 0)
	res, c2 := bits.Add64(hi, mnHi, c)
	if c2 != 0 || res >= m.n {
		res -= m.n
	}
	return res
}

func (m Mont) mul(a, b uint64) uint64 { hi, lo := bits.Mul64(a, b); return m.redc(hi, lo) }
func (m Mont) in(x uint64) uint64     { return m.mul(x, m.r2) }
func (m Mont) out(x uint64) uint64    { return m.redc(0, x) }

func (m Mont) pow(base, exp uint64) uint64 {
	res, b := m.in(1), m.in(base%m.n)
	for exp > 0 {
		if exp&1 == 1 {
			res = m.mul(res, b)
		}
		b = m.mul(b, b)
		exp >>= 1
	}
	return m.out(res)
}

func main() {
	m := newMont(1_000_000_007)
	fmt.Println(m.pow(2, 10)) // 1024
	fmt.Println(newMont(13).pow(7, 2)) // 10
}
```

**Java.**
```java
public class MontModpow {
    final long n, nInv, r2;

    MontModpow(long n) {
        if ((n & 1) == 0) throw new IllegalArgumentException("modulus must be odd");
        this.n = n;
        long inv = n;
        for (int i = 0; i < 5; i++) inv *= 2 - n * inv;
        this.nInv = -inv;
        long r = Long.remainderUnsigned(-n, n);
        for (int i = 0; i < 64; i++) r = Long.remainderUnsigned(r << 1, n);
        this.r2 = r;
    }

    long redc(long hi, long lo) {
        long mm = lo * nInv;
        long mnHi = Math.multiplyHigh(mm, n), mnLo = mm * n;
        long sumLo = lo + mnLo;
        long carry = (Long.compareUnsigned(sumLo, lo) < 0) ? 1 : 0;
        long res = hi + mnHi + carry;
        if (Long.compareUnsigned(res, n) >= 0) res -= n;
        return res;
    }

    long mul(long a, long b) { return redc(Math.multiplyHigh(a, b), a * b); }
    long in(long x)  { return mul(x, r2); }
    long out(long x) { return redc(0, x); }

    long pow(long base, long exp) {
        long res = in(1), b = in(Long.remainderUnsigned(base, n));
        while (exp > 0) {
            if ((exp & 1) == 1) res = mul(res, b);
            b = mul(b, b);
            exp >>= 1;
        }
        return out(res);
    }

    public static void main(String[] args) {
        System.out.println(new MontModpow(1_000_000_007L).pow(2, 10)); // 1024
        System.out.println(new MontModpow(13).pow(7, 2));              // 10
    }
}
```

**Python.**
```python
class Mont:
    def __init__(self, n, k=64):
        assert n % 2 == 1, "modulus must be odd"
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n

    def redc(self, t):
        m = ((t & self.mask) * self.np) & self.mask
        u = (t + m * self.n) >> self.k
        return u - self.n if u >= self.n else u

    def mul(self, a, b): return self.redc(a * b)
    def into(self, x):   return self.mul(x % self.n, self.r2)
    def outof(self, x):  return self.redc(x)

    def pow(self, base, exp):
        res, b = self.into(1), self.into(base)
        while exp > 0:
            if exp & 1:
                res = self.mul(res, b)
            b = self.mul(b, b)
            exp >>= 1
        return self.outof(res)


if __name__ == "__main__":
    print(Mont(1_000_000_007).pow(2, 10))  # 1024
    print(Mont(13).pow(7, 2))              # 10
```

---

### Challenge 2: Barrett Reduction

**Problem.** Implement Barrett reduction for an arbitrary modulus `n` (even allowed): precompute `μ = ⌊2^{2k}/n⌋` and reduce products `x < n²` with multiplies/shifts and at most two corrections. Provide a `mul(a, b) = (a*b) mod n`.

**Example.**
```text
n = 1_000_000_006 (even), mul(999999, 1000000) -> (999999*1000000) mod n
```

**Optimal.** O(1) per reduce, no division by `n` in the hot path.

**Go.**
```go
package main

import (
	"fmt"
	"math/big"
)

// 64-bit-safe Barrett via big.Int for clarity of the bound; production uses 128-bit ints.
type Barrett struct {
	n  uint64
	k  uint
	mu *big.Int
	N  *big.Int
}

func newBarrett(n uint64) Barrett {
	k := uint(2*bitLen(n) + 1)
	N := new(big.Int).SetUint64(n)
	mu := new(big.Int).Lsh(big.NewInt(1), k) // 2^k
	mu.Div(mu, N)                              // floor(2^k / n)
	return Barrett{n: n, k: k, mu: mu, N: N}
}

func bitLen(x uint64) int {
	c := 0
	for x > 0 {
		c++
		x >>= 1
	}
	return c
}

func (b Barrett) reduce(x *big.Int) uint64 {
	q := new(big.Int).Mul(x, b.mu)
	q.Rsh(q, b.k)
	r := new(big.Int).Sub(x, q.Mul(q, b.N))
	for r.Cmp(b.N) >= 0 {
		r.Sub(r, b.N)
	}
	return r.Uint64()
}

func (b Barrett) mul(a, c uint64) uint64 {
	x := new(big.Int).Mul(new(big.Int).SetUint64(a), new(big.Int).SetUint64(c))
	return b.reduce(x)
}

func main() {
	b := newBarrett(1_000_000_006) // even modulus: Barrett handles it
	fmt.Println(b.mul(999999, 1000000))
}
```

**Java.**
```java
import java.math.BigInteger;

public class Barrett {
    final BigInteger N, MU;
    final int k;

    Barrett(long n) {
        this.N = BigInteger.valueOf(n);
        this.k = 2 * N.bitLength() + 1;
        this.MU = BigInteger.ONE.shiftLeft(k).divide(N); // floor(2^k / n)
    }

    long reduce(BigInteger x) {            // x < n^2
        BigInteger q = x.multiply(MU).shiftRight(k);
        BigInteger r = x.subtract(q.multiply(N));
        while (r.compareTo(N) >= 0) r = r.subtract(N);
        return r.longValue();
    }

    long mul(long a, long b) {
        return reduce(BigInteger.valueOf(a).multiply(BigInteger.valueOf(b)));
    }

    public static void main(String[] args) {
        Barrett b = new Barrett(1_000_000_006L); // even modulus
        System.out.println(b.mul(999999, 1000000));
    }
}
```

**Python.**
```python
class Barrett:
    def __init__(self, n):
        self.n = n
        self.k = 2 * n.bit_length() + 1
        self.mu = (1 << self.k) // n   # floor(2^k / n)

    def reduce(self, x):               # x < n^2
        q = (x * self.mu) >> self.k
        r = x - q * self.n
        while r >= self.n:
            r -= self.n
        return r

    def mul(self, a, b):
        return self.reduce(a * b)


if __name__ == "__main__":
    b = Barrett(1_000_000_006)         # even modulus, no problem
    print(b.mul(999999, 1000000) == (999999 * 1000000) % 1_000_000_006)  # True
```

---

### Challenge 3: Montgomery-based Miller-Rabin

**Problem.** Decide whether `n < 2^64` is prime using deterministic Miller-Rabin with witnesses `{2,3,5,7,11,13,17,19,23,29,31,37}`, running the witness loop in Montgomery form (since `n` is odd).

**Example.**
```text
isPrime(1_000_000_007) -> true
isPrime(1_000_000_011) -> false
```

**Optimal.** A handful of modpows, each `O(log n)` Montgomery multiplies.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

type Mont struct{ n, nInv, r2 uint64 }

func newMont(n uint64) Mont {
	inv := n
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv
	}
	r := (-n) % n
	r2 := r
	for i := 0; i < 64; i++ {
		r2 = (r2 << 1) % n
	}
	return Mont{n, -inv, r2}
}
func (m Mont) redc(hi, lo uint64) uint64 {
	mm := lo * m.nInv
	mnHi, mnLo := bits.Mul64(mm, m.n)
	_, c := bits.Add64(lo, mnLo, 0)
	res, c2 := bits.Add64(hi, mnHi, c)
	if c2 != 0 || res >= m.n {
		res -= m.n
	}
	return res
}
func (m Mont) mul(a, b uint64) uint64 { hi, lo := bits.Mul64(a, b); return m.redc(hi, lo) }
func (m Mont) in(x uint64) uint64     { return m.mul(x%m.n, m.r2) }
func (m Mont) powMont(base, exp uint64) uint64 { // returns Montgomery form
	res, b := m.in(1), m.in(base)
	for exp > 0 {
		if exp&1 == 1 {
			res = m.mul(res, b)
		}
		b = m.mul(b, b)
		exp >>= 1
	}
	return res
}

func isPrime(n uint64) bool {
	if n < 2 {
		return false
	}
	for _, p := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		if n == p {
			return true
		}
		if n%p == 0 {
			return false
		}
	}
	m := newMont(n)
	d, s := n-1, 0
	for d&1 == 0 {
		d >>= 1
		s++
	}
	one, minus1 := m.in(1), m.in(n-1)
	for _, a := range []uint64{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} {
		x := m.powMont(a, d)
		if x == one || x == minus1 {
			continue
		}
		composite := true
		for i := 0; i < s-1; i++ {
			x = m.mul(x, x)
			if x == minus1 {
				composite = false
				break
			}
		}
		if composite {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(isPrime(1_000_000_007)) // true
	fmt.Println(isPrime(1_000_000_011)) // false
}
```

**Java.**
```java
public class MillerRabinMont {
    static final long[] W = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37};
    final long n, nInv, r2;

    MillerRabinMont(long n) {
        this.n = n;
        long inv = n;
        for (int i = 0; i < 5; i++) inv *= 2 - n * inv;
        this.nInv = -inv;
        long r = Long.remainderUnsigned(-n, n);
        for (int i = 0; i < 64; i++) r = Long.remainderUnsigned(r << 1, n);
        this.r2 = r;
    }
    long redc(long hi, long lo) {
        long mm = lo * nInv, mnHi = Math.multiplyHigh(mm, n), mnLo = mm * n;
        long sumLo = lo + mnLo, carry = (Long.compareUnsigned(sumLo, lo) < 0) ? 1 : 0;
        long res = hi + mnHi + carry;
        if (Long.compareUnsigned(res, n) >= 0) res -= n;
        return res;
    }
    long mul(long a, long b) { return redc(Math.multiplyHigh(a, b), a * b); }
    long in(long x) { return mul(Long.remainderUnsigned(x, n), r2); }
    long powMont(long base, long exp) {
        long res = in(1), b = in(base);
        while (exp > 0) {
            if ((exp & 1) == 1) res = mul(res, b);
            b = mul(b, b);
            exp >>= 1;
        }
        return res;
    }

    static boolean isPrime(long n) {
        if (n < 2) return false;
        for (long p : W) { if (n == p) return true; if (n % p == 0) return false; }
        MillerRabinMont m = new MillerRabinMont(n);
        long d = n - 1; int s = 0;
        while ((d & 1) == 0) { d >>= 1; s++; }
        long one = m.in(1), minus1 = m.in(n - 1);
        for (long a : W) {
            long x = m.powMont(a, d);
            if (x == one || x == minus1) continue;
            boolean composite = true;
            for (int i = 0; i < s - 1; i++) {
                x = m.mul(x, x);
                if (x == minus1) { composite = false; break; }
            }
            if (composite) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isPrime(1_000_000_007L)); // true
        System.out.println(isPrime(1_000_000_011L)); // false
    }
}
```

**Python.**
```python
class Mont:
    def __init__(self, n, k=64):
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n
    def redc(self, t):
        m = ((t & self.mask) * self.np) & self.mask
        u = (t + m * self.n) >> self.k
        return u - self.n if u >= self.n else u
    def mul(self, a, b): return self.redc(a * b)
    def into(self, x):   return self.mul(x % self.n, self.r2)
    def pow_mont(self, base, exp):
        res, b = self.into(1), self.into(base)
        while exp > 0:
            if exp & 1:
                res = self.mul(res, b)
            b = self.mul(b, b)
            exp >>= 1
        return res


W = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)


def is_prime(n):
    if n < 2:
        return False
    for p in W:
        if n == p:
            return True
        if n % p == 0:
            return False
    m = Mont(n)
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    one, minus1 = m.into(1), m.into(n - 1)
    for a in W:
        x = m.pow_mont(a, d)
        if x == one or x == minus1:
            continue
        composite = True
        for _ in range(s - 1):
            x = m.mul(x, x)
            if x == minus1:
                composite = False
                break
        if composite:
            return False
    return True


if __name__ == "__main__":
    print(is_prime(1_000_000_007))  # True
    print(is_prime(1_000_000_011))  # False
```

---

### Challenge 4: Benchmark Montgomery vs Plain `%`

**Problem.** Empirically compare Montgomery `modpow` against plain `modpow` (using `(a*b) % n`) for a fixed odd modulus across a range of exponent sizes. Report timings and confirm both agree.

**Approach.** Build the Montgomery context once. Time `iters` repetitions of each `modpow` for several exponents, and assert equality of results. The Montgomery version should win as the exponent (and thus the multiply count) grows, since each multiply avoids a division.

**Python.**
```python
import time


class Mont:
    def __init__(self, n, k=64):
        self.n, self.k = n, k
        self.R, self.mask = 1 << k, (1 << k) - 1
        self.np = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n
    def redc(self, t):
        m = ((t & self.mask) * self.np) & self.mask
        u = (t + m * self.n) >> self.k
        return u - self.n if u >= self.n else u
    def mul(self, a, b): return self.redc(a * b)
    def into(self, x):   return self.mul(x % self.n, self.r2)
    def outof(self, x):  return self.redc(x)
    def pow(self, base, exp):
        res, b = self.into(1), self.into(base)
        while exp > 0:
            if exp & 1:
                res = self.mul(res, b)
            b = self.mul(b, b)
            exp >>= 1
        return self.outof(res)


def plain_pow(base, exp, n):
    res, b = 1, base % n
    while exp > 0:
        if exp & 1:
            res = (res * b) % n
        b = (b * b) % n
        exp >>= 1
    return res


def main():
    n = 1_000_000_007
    m = Mont(n)
    print("exp_bits   plain_ms   mont_ms   match")
    for bits_ in (16, 32, 48, 60):
        exp = (1 << bits_) - 1
        # correctness
        match = m.pow(3, exp) == plain_pow(3, exp, n)
        iters = 2000
        t0 = time.perf_counter()
        for _ in range(iters):
            plain_pow(3, exp, n)
        tp = (time.perf_counter() - t0) * 1000 / iters
        t0 = time.perf_counter()
        for _ in range(iters):
            m.pow(3, exp)
        tm = (time.perf_counter() - t0) * 1000 / iters
        print(f"{bits_:<10d} {tp:<10.4f} {tm:<9.4f} {match}")


if __name__ == "__main__":
    main()
```

(In CPython the built-in big-int `%` is C-level, so this benchmark shows *shape* rather than the raw hardware win; in Go/Java/C the per-multiply Montgomery edge over hardware division is concrete. The key deliverable is the correctness match plus the growing relative cost of division as the exponent grows.)

---

## Final Tips

- Lead with the one-liner: *"Division is slow; work in Montgomery form so reduction is a shift, and REDC does `T·R^{-1} mod n` with no `÷ n`."*
- Immediately flag the two gotchas: **odd modulus only** and **never skip the conditional subtraction**.
- Know the amortization argument cold: convert in once, multiply many, convert out once — break-even is a handful of multiplies.
- If the modulus might be even or you want no special form, reach for **Barrett** (precompute `⌊2^{2k}/n⌋`).
- Mention the real homes: **modpow, Miller-Rabin (08), Pollard-rho (09), NTT (13)**, and crypto (constant-time).
- Always offer to verify against plain `(a*b) % n` on random inputs.
