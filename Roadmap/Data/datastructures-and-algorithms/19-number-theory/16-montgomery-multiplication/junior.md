# Montgomery Multiplication (and Barrett Reduction) — Junior Level

> **One-line summary:** The `%` operator (integer division) is the slow part of `(a * b) mod n` in hot loops. **Montgomery multiplication** represents numbers in a special "Montgomery form" so that reduction modulo `n` is done with cheap shifts and multiplies instead of a division. It pays off only when you do *many* modular multiplications and amortize the cost of converting in and out of the form.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Suppose you are computing something like `a^b mod n` with `b = 10^18`, or you are running a primality test (sibling `08-miller-rabin-primality`) that multiplies numbers modulo `n` millions of times. Every single step is a modular multiply: take `a * b`, then reduce it modulo `n`. The multiplication is fast. The *reduction* — the `mod n` part — is secretly the most expensive operation, because under the hood it requires an integer **division**, and division is one of the slowest arithmetic instructions a CPU has (often 10–40× slower than a multiply).

> **The key idea:** division is slow; multiplication and bit-shifting are fast. Montgomery multiplication trades the division for a couple of multiplies and a shift.

Here is the trick in one breath. Pick `R = 2^k` where `R > n` (so `R` is a power of two just above `n`). Instead of storing a number `x`, store its **Montgomery form** `x̄ = (x * R) mod n`. There is a special reduction step, called **REDC**, that takes a product and divides out one factor of `R` using only shifts and multiplies — *no division by `n`*. Because `R` is a power of two, "divide by `R`" is just "shift right by `k` bits", and "mod `R`" is just "keep the low `k` bits". Those are the cheapest operations on a computer.

The catch is that converting a normal number *into* Montgomery form and back *out* costs a little. So Montgomery only wins when you stay in Montgomery form for a long sequence of multiplications (like an entire modular exponentiation), converting once at the start and once at the end. If you only need one modular multiply, plain `(a*b) % n` is simpler and just as fast.

There is a sibling technique called **Barrett reduction** that achieves the same "no division by `n`" goal differently: it precomputes `floor(2^k / n)` once and then replaces each `mod n` with a couple of multiplies and shifts, *without* needing to convert numbers into a special form. We cover Barrett in [`middle.md`](./middle.md); this file focuses on the Montgomery idea and a tiny worked example.

This topic ties directly into fast modular exponentiation (sibling `02-modular-arithmetic`), the Miller-Rabin and Pollard-rho inner loops (siblings `08`, `09`), and number-theoretic transforms / NTT (sibling `13`), where the same `mulmod` runs in the innermost loop billions of times.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Modular arithmetic** — `(a + b) mod n`, `(a * b) mod n`, and why we reduce to keep numbers small. See sibling `02-modular-arithmetic`.
- **The `%` (modulo) operator** — and the fact that it is implemented with integer division.
- **Binary / powers of two** — `2^k`, why "divide by `2^k`" is a right shift, and "mod `2^k`" is a bitmask of the low `k` bits.
- **Binary exponentiation** — computing `a^b` in `O(log b)` multiplies; this is the canonical place Montgomery is used.
- **gcd and coprimality** — two numbers are coprime if `gcd = 1`. Montgomery needs `gcd(R, n) = 1`.
- **Big-O notation** — `O(1)`, `O(log b)`.

Optional but helpful:

- A glance at the **extended Euclidean algorithm** / modular inverse (sibling `06-extended-euclidean-modular-inverse`), used to compute the magic constant `n'`.
- Familiarity with **64-bit overflow** and why intermediate products of two 64-bit numbers need 128 bits.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Modular reduction** | Computing `x mod n`. The expensive step we want to avoid doing with division. |
| **`R` (the radix)** | A power of two, `R = 2^k`, chosen so `R > n`. Reducing mod `R` and dividing by `R` are cheap (mask / shift). |
| **Montgomery form** | The representative `x̄ = (x · R) mod n` of a number `x`. We compute *inside* this form. |
| **REDC (Montgomery reduction)** | The core routine: given `T < n·R`, returns `T · R^{-1} mod n` using only multiplies and shifts. |
| **`n'` (n-prime)** | The precomputed constant `n' = (-n^{-1}) mod R`. It makes the low bits cancel so the result is divisible by `R`. |
| **`R^{-1} mod n`** | The modular inverse of `R` modulo `n`; exists because `gcd(R, n) = 1`. REDC effectively multiplies by it. |
| **Coprime** | `gcd(R, n) = 1`. Required so that `R^{-1} mod n` and `n^{-1} mod R` exist. Forces `n` to be **odd** (since `R` is a power of two). |
| **Barrett reduction** | Alternative fast reduction: precompute `m = floor(2^k / n)`, then estimate the quotient by a multiply + shift. No special number form. |
| **`mulmod`** | Shorthand for "modular multiplication": `(a · b) mod n`. The operation we are accelerating. |
| **Amortize** | Spread a one-time setup cost (conversion) over many operations so the per-operation cost drops. |

---

## Core Concepts

### 1. Why `%` is slow

On modern CPUs, addition and multiplication of 64-bit integers take roughly 1–5 cycles. Integer **division** (and the `%` that uses it) takes roughly 20–90 cycles, and the hardware cannot pipeline divisions well, so they stall the processor. In a tight loop that does nothing but modular multiplies — exactly what modular exponentiation and Miller-Rabin do — the `%` dominates the runtime.

```
(a * b) mod n      <-- the "* b" is cheap; the "mod n" hides a division (slow)
```

Montgomery and Barrett both attack this one slow instruction. They replace "divide by `n`" with operations the CPU loves: multiply, shift, and mask.

### 2. Montgomery form: `x̄ = x·R mod n`

Choose `R = 2^k` with `R > n` and `gcd(R, n) = 1`. Because `R` is a power of two, `gcd(R, n) = 1` holds **exactly when `n` is odd**. This is the famous "Montgomery needs an odd modulus" restriction.

Now represent each number `x` not by itself but by `x̄ = (x · R) mod n`. This mapping is a bijection on `{0, 1, …, n-1}`: every residue has a unique Montgomery form and vice versa.

### 3. REDC: dividing by `R` without dividing

The heart of the method is **REDC** (REDuCe). Given an integer `T` with `0 ≤ T < n·R`, REDC returns `(T · R^{-1}) mod n` using only cheap operations:

```
REDC(T):
    m = ((T mod R) * n') mod R        # mod R = keep low k bits (cheap)
    t = (T + m * n) / R               # / R = shift right by k bits (cheap)
    if t >= n: t = t - n              # one conditional subtraction
    return t
```

The magic constant `n' = (-n^{-1}) mod R` is chosen precisely so that `T + m·n` is divisible by `R` — so the division by `R` is exact (a clean shift, no remainder). The proof is in [`professional.md`](./professional.md); for now, trust that REDC outputs `T · R^{-1} mod n`.

### 4. Multiplying in Montgomery form

If `ā = a·R mod n` and `b̄ = b·R mod n`, then their plain product is `ā·b̄ = a·b·R² mod n` — it has *two* factors of `R`, one too many. Apply REDC once to strip a factor of `R`:

```
REDC(ā · b̄) = (a·b·R²) · R^{-1} mod n = (a·b)·R mod n = (a·b)‾
```

So `REDC(ā · b̄)` is exactly the Montgomery form of `a·b`. **Montgomery multiplication = ordinary multiply, then one REDC.** No division by `n` anywhere.

### 5. Converting in and out of Montgomery form

- **Into the form:** `x̄ = (x · R) mod n`. The cheap way to compute this without a division is `REDC(x · (R² mod n))`, where `R² mod n` is precomputed once.
- **Out of the form:** `x = REDC(x̄)`, because `REDC(x̄) = (x·R)·R^{-1} mod n = x`.

You convert *once* on the way in and *once* on the way out, and do all the multiplies in between in Montgomery form.

### 6. Why it only wins when amortized

Each conversion costs about one REDC. If you do a single modular multiply, you pay: convert `a`, convert `b`, multiply+REDC, convert back — more work than one plain `%`. But in a modular exponentiation with hundreds of multiplications, you convert the base once, run all the squarings/multiplications cheaply, and convert the result back once. The two conversions are negligible against the hundreds of fast multiplies. **Amortization is the whole point.**

---

## Big-O Summary

| Operation | Time | Notes |
|-----------|------|-------|
| Plain `(a*b) % n` | O(1) but with a slow **division** | Constant operations, large constant factor. |
| One REDC | O(1) with **2 multiplies + shift + 1 subtract** | No division by `n`; division by `R` is a shift. |
| One Montgomery multiply | O(1) (multiply + REDC) | Same asymptotics, smaller constant in hot loops. |
| Convert into Montgomery form | O(1) (one REDC with `R² mod n`) | Paid once per input. |
| Convert out of Montgomery form | O(1) (one REDC) | Paid once per output. |
| Precompute `n'` | O(log n) or O(k) once | Newton iteration or extended Euclid; done a single time. |
| Modular exponentiation `a^b mod n` (Montgomery) | O(log b) multiplies | Each multiply is a cheap Montgomery multiply. |

The asymptotics are identical to plain modular arithmetic — Montgomery and Barrett are **constant-factor** optimizations. The win is the *size* of the constant, not the growth rate.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Montgomery form | Converting prices into a different currency at the airport. Doing one purchase isn't worth it, but if you'll make hundreds of purchases on the trip, convert once and spend cheaply. |
| The conversion cost | The exchange-counter fee. Acceptable only if you transact a lot before converting back. |
| `R = 2^k` | Working in a "round-number" base where dividing is just dropping trailing zeros — like dividing by 1000 in decimal by erasing three digits. |
| REDC's shift instead of division | Cutting a cake into 8 equal pieces by folding (powers of two) instead of measuring with a ruler (true division). |
| `n'` (the magic constant) | A pre-cut stencil that makes the "low bits" line up perfectly so the fold is exact every time. |
| Barrett reduction | Keeping a cheat-sheet of `floor(2^k / n)` so you can estimate the quotient instantly instead of long division. |

Where the analogy breaks: currency conversion loses a little value each way; Montgomery is *exact* — no precision is lost, only the representation changes.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Removes the slow division from every inner-loop `mulmod`. | Only worth it when many multiplications amortize the conversion cost. |
| Division by `R` is a shift; mod `R` is a mask — the cheapest CPU ops. | Requires an **odd** modulus (so `gcd(R, n) = 1`). |
| Constant-time-friendly: no data-dependent division latency (good for crypto). | Numbers live in a confusing "Montgomery form"; off-by-one bugs are easy. |
| Composes perfectly with binary exponentiation, Miller-Rabin, Pollard-rho, NTT. | Needs the precomputed constants `n'` and `R² mod n`. |
| Exact — no rounding, unlike floating-point tricks. | More code and more cognitive load than `(a*b) % n`. |

**When to use:** long modular-exponentiation chains, primality testing, factorization inner loops, NTT, crypto — anywhere the same modulus is reused for a huge number of multiplications and the modulus is odd.

**When NOT to use:** a single (or few) modular multiplies, an even modulus, or when readability matters more than the constant-factor speedup. Barrett is the go-to alternative when you cannot meet the odd-modulus restriction.

---

## Step-by-Step Walkthrough

Let us pick a tiny, fully hand-computable example. Take `n = 13` (odd ✓). Choose `R = 16 = 2^4` (a power of two, `R > n` ✓, and `gcd(16, 13) = 1` ✓). So `k = 4`, and "mod R" means "keep the low 4 bits", "÷ R" means "shift right 4 bits".

**Step 1 — compute `n'` (done once).** We need `n' = (-n^{-1}) mod R = (-13^{-1}) mod 16`. First find `13^{-1} mod 16`: we need `13·x ≡ 1 (mod 16)`. Trying `x = 5`: `13·5 = 65 = 64 + 1 ≡ 1 (mod 16)` ✓. So `13^{-1} ≡ 5`, and `n' = (-5) mod 16 = 11`.

Sanity check: `n·n' mod R = 13·11 mod 16 = 143 mod 16 = 143 - 128 = 15 ≡ -1 (mod 16)` ✓. (That's the defining property: `n·n' ≡ -1 (mod R)`.)

**Step 2 — convert `a = 7` into Montgomery form.** `ā = a·R mod n = 7·16 mod 13 = 112 mod 13 = 112 - 104 = 8`. So `7̄ = 8`.

**Step 3 — convert `b = 9` into Montgomery form.** `b̄ = 9·16 mod 13 = 144 mod 13 = 144 - 143 = 1`. So `9̄ = 1`.

**Step 4 — Montgomery-multiply them.** Compute `T = ā · b̄ = 8 · 1 = 8`. Now run REDC(8):

```
m = (T mod R) · n' mod R = (8 mod 16)·11 mod 16 = 88 mod 16 = 88 - 80 = 8
t = (T + m·n) / R        = (8 + 8·13) / 16 = (8 + 104)/16 = 112/16 = 7
7 < 13, so no subtraction.   REDC(8) = 7
```

So `REDC(ā·b̄) = 7`, which should be the Montgomery form of `a·b mod n = 7·9 mod 13 = 63 mod 13 = 63 - 52 = 11`. Let's verify: Montgomery form of 11 is `11·16 mod 13 = 176 mod 13 = 176 - 169 = 7` ✓. The product in Montgomery form is `7`, exactly as REDC produced.

**Step 5 — convert the result out.** `REDC(7)`:

```
m = 7·11 mod 16 = 77 mod 16 = 77 - 64 = 13
t = (7 + 13·13) / 16 = (7 + 169)/16 = 176/16 = 11
11 < 13, no subtraction.   REDC(7) = 11
```

And `7·9 mod 13 = 11` ✓. The whole pipeline — convert in, multiply with REDC, convert out — produced the correct answer using **only multiplies, additions, masks, and shifts**. Not a single division by `n` occurred.

---

## Code Examples

### Example: Montgomery multiplication and modular exponentiation (64-bit modulus)

These implement `n'` via a small Newton iteration, a `montMul` (multiply + REDC), conversion helpers, and a `modpow` that stays in Montgomery form.

#### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

// Montgomery context for an odd modulus n < 2^63, with R = 2^64.
type Mont struct {
	n    uint64 // odd modulus
	nInv uint64 // -n^{-1} mod 2^64
	r2   uint64 // R^2 mod n
}

func newMont(n uint64) Mont {
	// nInv = -n^{-1} mod 2^64 via Newton's iteration (doubles correct bits).
	inv := n // n is its own inverse mod 8 to start
	for i := 0; i < 5; i++ {
		inv *= 2 - n*inv // Newton step: refines n^{-1} mod 2^64
	}
	nInv := -inv // -n^{-1} mod 2^64 (two's complement negation)
	// r2 = (2^64)^2 mod n, computed by doubling 2^64 mod n.
	r := (-n) % n // 2^64 mod n
	r2 := r
	for i := 0; i < 64; i++ {
		r2 <<= 1
		if r2 >= n || r2 < (r2-r2) { // careful: emulate mod via subtraction below
		}
		r2 %= n
	}
	return Mont{n: n, nInv: nInv, r2: r2}
}

// REDC on the 128-bit value (hi, lo): returns (hi:lo) * R^{-1} mod n.
func (m Mont) redc(hi, lo uint64) uint64 {
	mm := lo * m.nInv                  // (T mod R) * n' mod R  (low 64 bits)
	h2, l2 := bits.Mul64(mm, m.n)      // m * n  (128-bit)
	_, carry := bits.Add64(lo, l2, 0)  // low part cancels to 0; capture carry
	res, c2 := bits.Add64(hi, h2, carry)
	if c2 != 0 || res >= m.n {         // conditional subtract
		res -= m.n
	}
	return res
}

func (m Mont) mul(a, b uint64) uint64 { // a,b in Montgomery form
	hi, lo := bits.Mul64(a, b)
	return m.redc(hi, lo)
}

func (m Mont) toMont(x uint64) uint64 { return m.mul(x, m.r2) } // x*R mod n
func (m Mont) fromMont(x uint64) uint64 { return m.redc(0, x) } // x*R^{-1} mod n

func (m Mont) pow(base, exp uint64) uint64 {
	result := m.toMont(1) // 1 in Montgomery form
	b := m.toMont(base)
	for exp > 0 {
		if exp&1 == 1 {
			result = m.mul(result, b)
		}
		b = m.mul(b, b)
		exp >>= 1
	}
	return m.fromMont(result)
}

func main() {
	m := newMont(13)
	fmt.Println(m.pow(7, 2)) // 7^2 mod 13 = 49 mod 13 = 10
	fmt.Println(m.pow(2, 10)) // 1024 mod 13 = 9
}
```

#### Java

```java
public class Montgomery {
    final long n;       // odd modulus
    final long nInv;    // -n^{-1} mod 2^64
    final long r2;      // R^2 mod n, R = 2^64

    Montgomery(long n) {
        this.n = n;
        long inv = n;                       // correct mod 8
        for (int i = 0; i < 5; i++) inv *= 2 - n * inv; // Newton iteration
        this.nInv = -inv;                   // -n^{-1} mod 2^64
        long r = Long.remainderUnsigned(-n, n); // 2^64 mod n
        long t = r;
        for (int i = 0; i < 64; i++) {      // r2 = 2^128 mod n by doubling
            t <<= 1;
            t = Long.remainderUnsigned(t, n);
            // guard against the high bit by reducing each step
        }
        this.r2 = t;
    }

    long redc(long hi, long lo) {
        long mm = lo * nInv;                            // (T mod R)*n' mod R
        long mnHi = Math.multiplyHigh(mm, n);           // high 64 of m*n
        long mnLo = mm * n;                             // low 64 of m*n
        long sumLo = lo + mnLo;                         // becomes 0
        long carry = (Long.compareUnsigned(sumLo, lo) < 0) ? 1 : 0;
        long res = hi + mnHi + carry;
        if (Long.compareUnsigned(res, n) >= 0) res -= n; // conditional subtract
        return res;
    }

    long mul(long a, long b) {
        long hi = Math.multiplyHigh(a, b);
        long lo = a * b;
        return redc(hi, lo);
    }

    long toMont(long x)   { return mul(x, r2); }
    long fromMont(long x) { return redc(0, x); }

    long pow(long base, long exp) {
        long result = toMont(1);
        long b = toMont(base);
        while (exp > 0) {
            if ((exp & 1) == 1) result = mul(result, b);
            b = mul(b, b);
            exp >>= 1;
        }
        return fromMont(result);
    }

    public static void main(String[] args) {
        Montgomery m = new Montgomery(13);
        System.out.println(m.pow(7, 2));  // 10
        System.out.println(m.pow(2, 10)); // 9
    }
}
```

#### Python

```python
# Python has arbitrary-precision ints, so Montgomery is educational here
# (no hardware 64-bit overflow to manage). R is a chosen power of two.

class Mont:
    def __init__(self, n, k=64):
        assert n % 2 == 1, "modulus must be odd"
        self.n = n
        self.k = k
        self.R = 1 << k
        self.mask = self.R - 1
        # n' = (-n^{-1}) mod R
        self.n_prime = (-pow(n, -1, self.R)) % self.R
        self.r2 = (self.R * self.R) % n  # R^2 mod n

    def redc(self, t):
        m = ((t & self.mask) * self.n_prime) & self.mask  # (t mod R)*n' mod R
        u = (t + m * self.n) >> self.k                     # exact divide by R
        if u >= self.n:
            u -= self.n
        return u

    def mul(self, a, b):          # a, b in Montgomery form
        return self.redc(a * b)

    def to_mont(self, x):
        return self.mul(x, self.r2)   # x*R mod n

    def from_mont(self, x):
        return self.redc(x)           # x*R^{-1} mod n

    def pow(self, base, exp):
        result = self.to_mont(1)
        b = self.to_mont(base)
        while exp > 0:
            if exp & 1:
                result = self.mul(result, b)
            b = self.mul(b, b)
            exp >>= 1
        return self.from_mont(result)


if __name__ == "__main__":
    m = Mont(13)
    print(m.pow(7, 2))   # 10
    print(m.pow(2, 10))  # 9
```

**What it does:** sets up the Montgomery constants for modulus `n`, then computes modular exponentials entirely in Montgomery form, converting in/out only at the boundaries.
**Run:** `go run main.go` | `javac Montgomery.java && java Montgomery` | `python mont.py`

---

## Coding Patterns

### Pattern 1: Plain mulmod (the oracle you test against)

**Intent:** Before trusting Montgomery, compute the answer the obvious slow way and check they agree.

```python
def mulmod(a, b, n):
    return (a * b) % n   # the slow division-based reference

def modpow_plain(a, b, n):
    result = 1
    a %= n
    while b > 0:
        if b & 1:
            result = (result * a) % n
        a = (a * a) % n
        b >>= 1
    return result
```

Montgomery's `pow` must equal `modpow_plain` for all inputs. This oracle catches almost every bug.

### Pattern 2: Convert once, compute many

**Intent:** The amortization rule in code form — convert at the boundaries only.

```python
am = ctx.to_mont(a)        # convert IN once
acc = ctx.to_mont(1)
for _ in range(many_times): # all multiplies cheap, stay in Montgomery form
    acc = ctx.mul(acc, am)
answer = ctx.from_mont(acc) # convert OUT once
```

### Pattern 3: The conditional subtraction

**Intent:** REDC's output can be in `[0, 2n)`; one subtract brings it into `[0, n)`.

```mermaid
graph TD
    A[product a*b in Mont form] --> B[m = low_k(product) * n' mod R]
    B --> C[t = product + m*n]
    C --> D[t = t >> k  : exact divide by R]
    D --> E{t >= n ?}
    E -->|yes| F[t = t - n]
    E -->|no| G[keep t]
    F --> H[result in 0..n-1]
    G --> H
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong answers for even `n` | Montgomery requires `gcd(R, n) = 1`; impossible for even `n`. | Assert `n` is odd; use Barrett (sibling middle) for even moduli. |
| Off-by-`n` result | Forgot the conditional subtraction after REDC. | Always do `if t >= n: t -= n`. |
| Garbage from forgetting conversion | Used a raw number where a Montgomery-form one was expected (or vice versa). | Convert in/out exactly at the boundaries; never mix forms. |
| Overflow in `a*b` | Two 64-bit values multiply to 128 bits. | Use a 128-bit product (`bits.Mul64`, `Math.multiplyHigh`, `__int128`). |
| `n'` is wrong | Computed `n^{-1}` instead of `-n^{-1}`, or wrong modulus `R`. | `n' = (-n^{-1}) mod R`; verify `n·n' ≡ -1 (mod R)`. |
| `1` looks wrong | Forgot that the Montgomery form of 1 is `R mod n`, not `1`. | Initialize accumulators with `to_mont(1)`. |

---

## Performance Tips

- **Reuse the context.** Compute `n'` and `R² mod n` once per modulus, never per multiply.
- **Pick `R = 2^word`.** Using the machine word size (`2^32` or `2^64`) makes "mod R" and "÷ R" free (they're just which half of the register you read).
- **Avoid branches in the subtract** for constant-time crypto: use a masked subtraction instead of an `if`.
- **Stay in Montgomery form** across the *entire* exponentiation; only convert at the two ends.
- **Don't use Montgomery for one-off multiplies** — the conversions cost more than a single `%`.

---

## Best Practices

- Always validate against the plain `(a*b) % n` oracle (Pattern 1) on random inputs before trusting Montgomery.
- Assert the modulus is **odd** at construction time; fail loudly otherwise.
- Verify the constant once: `n·n' ≡ -1 (mod R)` and `to_mont(from_mont(x)) == x`.
- Keep conversion strictly at the boundaries; document which variables hold Montgomery-form values.
- If you cannot guarantee an odd modulus, reach for **Barrett reduction** instead (see `middle.md`).

---

## Edge Cases & Pitfalls

- **Even modulus** — Montgomery simply does not apply; `gcd(2^k, even) ≠ 1`. Use Barrett.
- **`n = 1`** — every residue is 0; handle as a trivial special case.
- **Montgomery form of 1** — it is `R mod n`, *not* 1. The identity for multiplication in Montgomery form is `to_mont(1)`.
- **`R` not greater than `n`** — `R` must exceed `n` for REDC's range guarantees; using the word size (`2^64`) handles all `n < 2^64`.
- **Result in `[n, 2n)`** — REDC can land one `n` too high; the conditional subtraction fixes it. Never skip it.
- **Single multiply** — converting in and out for one `mulmod` is *slower* than plain `%`. Montgomery is for chains.

---

## Common Mistakes

1. **Using Montgomery on an even modulus** — silently wrong; the inverse `n^{-1} mod R` does not exist.
2. **Skipping the conditional subtraction** — results drift above `n` and corrupt later multiplies.
3. **Mixing forms** — passing a normal number where a Montgomery-form number is expected. Track every variable's form.
4. **Computing `n^{-1}` instead of `-n^{-1}`** — the sign matters; `n'` must satisfy `n·n' ≡ -1 (mod R)`.
5. **Initializing the accumulator with `1` instead of `to_mont(1)`** — the multiplicative identity in Montgomery form is `R mod n`.
6. **Forgetting the 128-bit product** — `a*b` overflows 64 bits; you must keep the high half.
7. **Using Montgomery for a single multiply** — pays the conversion cost with nothing to amortize it against.

---

## Cheat Sheet

| Quantity | Formula |
|----------|---------|
| Radix | `R = 2^k`, `R > n`, `gcd(R, n) = 1` (so `n` odd) |
| Montgomery form | `x̄ = (x · R) mod n` |
| Magic constant | `n' = (-n^{-1}) mod R`, satisfying `n·n' ≡ -1 (mod R)` |
| REDC output | `REDC(T) = (T · R^{-1}) mod n`, for `0 ≤ T < n·R` |
| Montgomery multiply | `REDC(ā · b̄) = (a·b)‾` |
| Convert in | `x̄ = REDC(x · (R² mod n))` |
| Convert out | `x = REDC(x̄)` |
| Identity (×) | `to_mont(1) = R mod n` |

Core algorithm:

```
REDC(T):                       # 0 <= T < n*R
    m = (T mod R) * n' mod R    # low k bits only — cheap
    t = (T + m*n) / R           # divide by R = shift right k bits — cheap, exact
    if t >= n: t -= n           # conditional subtraction
    return t                    # = T * R^{-1} mod n, no division by n
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - A number shown in normal form and its Montgomery form `x·R mod n`
> - The REDC steps: `m = (T mod R)·n' mod R`, then `t = (T + m·n)/R`, then the conditional subtract
> - How the low `k` bits cancel so the division by `R` is exact (a clean shift)
> - Editable `n`, `R`, and inputs, with Step / Run / Reset controls

---

## Summary

The `%` operator is slow because it hides an integer division, and division is one of the most expensive CPU instructions. Montgomery multiplication sidesteps it by working in **Montgomery form** `x̄ = x·R mod n` with `R = 2^k`, where reducing modulo `R` is a bitmask and dividing by `R` is a shift. The **REDC** routine — using the precomputed `n' = (-n^{-1}) mod R` — turns a product back into Montgomery form with only multiplies and shifts, never dividing by `n`. A Montgomery multiply is just "multiply, then REDC". Because you must convert in and out of the form, the technique pays off only when **many** multiplications amortize the conversion — exactly the situation in modular exponentiation, Miller-Rabin, Pollard-rho, and NTT. The two non-negotiable rules: the modulus must be **odd**, and never skip the **conditional subtraction**. Barrett reduction (next file) is the alternative when you cannot meet the odd-modulus restriction.

---

## Further Reading

- Peter Montgomery, "Modular multiplication without trial division" (1985) — the original paper.
- Sibling topic `02-modular-arithmetic` — modular exponentiation, the canonical home of Montgomery.
- Sibling topic `06-extended-euclidean-modular-inverse` — computing `n^{-1}` for `n'`.
- Sibling topics `08-miller-rabin-primality` and `09-pollard-rho` — hot loops where Montgomery shines.
- Sibling topic `13-ntt` — number-theoretic transform inner loops.
- cp-algorithms.com — "Montgomery Multiplication" and "Barrett reduction".
- *Handbook of Applied Cryptography* (Menezes, van Oorschot, Vanstone), §14.3.2 — Montgomery reduction.
