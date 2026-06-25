# Fixed-Point & Arbitrary Precision — Interview Questions

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)

---

## Introduction

These questions probe whether a candidate can be trusted with money and with large numbers — two places where a plausible-looking implementation is silently wrong. The strong candidate never says "use a float for the price," distinguishes *scale* from *precision*, names the rounding mode they'd use *and why*, knows that a split must conserve the total, and understands that a bignum operation is not O(1). On the crypto side, they know that timing can leak a key. A weaker candidate reaches for `double`, rounds wherever convenient, and assumes arithmetic is free.

The questions progress from conceptual foundations, through language-specific surfaces (Java `BigDecimal`/`BigInteger`, Python `int`+`Decimal`, Go `math/big`, C++ `__int128`/GMP, Rust), to traps where the textbook answer is wrong, and finally to design scenarios that reveal whether the candidate has actually shipped a billing or crypto system.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [Python](#python)
  - [Go](#go)
  - [C++](#c)
  - [Rust](#rust)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)

---

## Conceptual

## Question 1

**Why can't a binary `double` represent 0.1 exactly?**

A `double` stores values as a binary fraction: a sum of powers of two (`1/2, 1/4, 1/8, …`) times a power of two. The only fractions representable exactly are dyadic — those with a denominator that's a power of 2. 0.1 = 1/10, and 10 has a factor of 5, so 0.1 is a *repeating* fraction in binary, just as 1/3 repeats in decimal. The hardware rounds it to the nearest representable double (~0.1000000000000000055…). The error is invisible until it accumulates or surfaces in equality (`0.1 + 0.2 != 0.3`). The general rule: a base-2 float represents exactly the fractions whose denominator is a power of two, and almost nothing else.

## Question 2

**What is fixed-point representation, and how does it differ from floating point?**

Fixed-point stores a fractional value as an *integer scaled by a fixed, implicit factor*. Money as cents: $1.23 is the integer 123, scale 100; the decimal point's position is fixed and lives in your conventions, not the data. Floating point stores a significand *and* a per-value exponent, so the point "floats" to give a huge dynamic range at the cost of exactness for most decimals. Fixed-point gives exact arithmetic and integer speed but a limited range and manual scale management; floating point gives range and convenience but rounding error. For money you want exactness → fixed-point (or a decimal type); for physics/science with wide dynamic range you usually want floating point.

## Question 3

**Explain Q-notation (`Qm.n`).**

`Qm.n` is a binary fixed-point format with `m` integer bits and `n` fraction bits; the stored integer represents `value = stored / 2^n`. `Q16.16` in a 32-bit word has scale `2^16 = 65536`, so 1.5 is stored as 98304. Addition/subtraction of same-format values is plain integer add/subtract. Multiplication produces a result at scale `2^(2n)`, so you divide (shift right by `n`) once to return to `Qm.n` — and the intermediate product needs double the bit width, which is the classic overflow trap. Q-notation is ubiquitous in DSP and embedded code on chips without an FPU.

## Question 4

**Why should you never use `float`/`double` for money?**

Because money is base-10 and binary floats can't represent most base-10 fractions exactly, so errors accumulate across transactions, ledgers stop balancing, equality checks fail, and rounding becomes nondeterministic. A sum of thousands of small amounts in `double` drifts by cents — an audit failure. Use integer minor units (cents) for exact addition, or a decimal type (`BigDecimal`/`Decimal`) for exact base-10 arithmetic with controlled rounding.

## Question 5

**What's the difference between scale and precision in a decimal type?**

Precision is the total number of significant digits; scale is the number of digits to the right of the decimal point. `1.230` has precision 4 and scale 3. A `BigDecimal` is internally an arbitrary-precision unscaled integer plus a scale: `1.23` is unscaled 123, scale 2. Operations follow scale rules — add/subtract take the max operand scale, multiply *adds* the scales, and divide may not terminate (forcing you to specify a target scale and rounding mode).

## Question 6

**Explain banker's rounding (round-half-to-even) and when you'd use it.**

Round-half-to-even rounds a tie (exactly .5) to the nearest *even* last digit: 2.5→2, 3.5→4, 0.125→0.12. Over many roundings, ties go up half the time and down half the time, so the cumulative bias is ~zero. Always-round-half-up systematically inflates sums, which over millions of line items becomes real money in one direction. That's why HALF_EVEN is the IEEE 754 default and common in finance/statistics. The caveat: some jurisdictions legally mandate HALF_UP for tax, so the "correct" mode is whatever your domain/regulator specifies — choose it explicitly.

## Question 7

**You split $100 three ways. What's the bug in `100/3` per person, and how do you fix it?**

`10000 cents / 3 = 3333` with remainder 1. Giving everyone 3333 distributes only 9999 cents — a cent vanishes; the parts don't sum to the whole. The fix is an allocation algorithm: floor each share, then hand out the leftover minor units one at a time (e.g., to the parties with the largest fractional remainders), so `sum(shares) == total` exactly. The invariant — parts sum to the whole — is sacred and must be tested.

## Question 8

**What is an arbitrary-precision integer (bignum), and how is it stored?**

A bignum is an integer with no fixed size limit, stored as an array of machine words (*limbs*) in radix `2^32` or `2^64`, plus a sign and length: `value = sign · Σ limbs[i]·B^i`. It grows automatically, so it never overflows — essential for cryptography, combinatorics, and exact arithmetic. The cost: operations are O(limbs), not O(1), and values are heap-allocated (often immutable), so naïve use can be slow.

## Question 9

**Walk through the multiplication algorithm ladder for bignums.**

Schoolbook (O(n²)) — multiply every limb by every limb; smallest constant factor, best for small n. Karatsuba (O(n^1.585)) — split in halves, compute the product with three half-multiplies instead of four. Toom-Cook (Toom-3 ≈ O(n^1.465)) — split into more parts, evaluate/interpolate. FFT-based (Schönhage–Strassen, O(n log n log log n); Harvey–van der Hoeven O(n log n)) — for enormous numbers. Each rung wins only above a crossover threshold, so production libraries cascade through them by operand size.

## Question 10

**Why is "bignums make arithmetic O(1)" a dangerous assumption? Give an example.**

Because bignum operations are O(limbs), not O(1), an algorithm that's O(n) under the O(1)-arithmetic assumption can become O(n²) when the numbers themselves grow to O(n) digits. Computing `n!` by `p *= i` in a loop: `p` grows to ~`n log n` bits, so each multiply is super-constant and the total is roughly O(n²) limb work, not O(n). Same with naive iterative Fibonacci (`F(n)` has ~n bits). The fix is to re-derive complexity assuming non-constant arithmetic and keep operands small (e.g., modular reduction).

## Question 11

**What's an arbitrary-precision rational, and what's its failure mode?**

A rational is an exact fraction `p/q` of two bignums kept coprime via GCD. It never rounds — ideal for exact geometry and computer algebra. The failure mode is denominator blow-up: adding many fractions or iterating a fraction-producing recurrence makes `p` and `q` grow without bound, and each operation carries a GCD, so an "exact, fast" loop can balloon into minutes. Use rationals only when exactness is required and denominators stay bounded.

## Question 12

**Is `BigDecimal`/`Decimal` the same as decimal floating point (IEEE 754 `decimal128`)?**

No. `BigDecimal`/`Decimal` are arbitrary-precision (unbounded digits) and software-implemented. IEEE 754-2008 decimal floating point (`decimal64`/`decimal128`) is *fixed-width* (16 or 34 significant digits) with a base-10 significand and exponent, sometimes hardware-accelerated (IBM POWER/z). Both represent decimal fractions exactly (no 0.1 problem), but decimal FP is bounded and can still round/overflow, while `BigDecimal` grows as needed and is slower.

## Question 13

**Why do cryptographic systems depend on bignums, and what's the constant-time concern?**

RSA, Diffie-Hellman, and ECC operate on integers of hundreds to thousands of bits — far beyond machine words — so they need arbitrary-precision modular arithmetic. The constant-time concern: if the running time, branch pattern, or memory access of an operation depends on secret key bits, an attacker can recover the key via timing (Kocher 1996; remote timing attacks shown practical in 2003). So crypto bignum code must avoid secret-dependent branches and table lookups and use constant-time selects — which is why you use vetted libraries, not generic `BigInteger`/`big.Int` ops, on secret paths.

## Question 14

**Where is fixed-point preferred over floating point besides money?**

Embedded/DSP on microcontrollers without a floating-point unit (audio filters, sensor math) use `Qm.n` for speed and determinism; deterministic game/simulation physics use integer or fixed-point coordinates so all peers compute bit-identical results (lockstep multiplayer can't tolerate float divergence across hardware); and any system needing reproducible, platform-independent arithmetic favors fixed-point because float results can vary with compiler/FPU settings.

---

## Language-Specific

### Java

## Question 15

**What's the bug in `new BigDecimal(0.1)` and how do you avoid it?**

`new BigDecimal(0.1)` takes the *double* 0.1 — which is already the imprecise binary approximation — and captures it exactly, yielding `0.1000000000000000055511151231257827021181583404541015625`. Use the **string** constructor `new BigDecimal("0.1")`, which is exactly 0.1, or `BigDecimal.valueOf(0.1)` (which routes through `Double.toString` and gives "0.1"). The rule: never construct a `BigDecimal` from a `double` literal.

## Question 16

**Why is `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` false?**

`BigDecimal.equals` compares *both* the unscaled value and the scale. "1.0" has scale 1, "1.00" has scale 2 — different scale, so not equal, even though the numeric values match. Use `compareTo(...) == 0` for value-only comparison. This bites when `BigDecimal` is a `HashMap`/`HashSet` key or in test assertions; normalize with `stripTrailingZeros()` or compare via `compareTo`.

## Question 17

**Why does `new BigDecimal("10").divide(new BigDecimal("3"))` throw?**

10/3 has a non-terminating decimal expansion (3.333…), and an unbounded `BigDecimal` can't store infinitely many digits, so `divide` with no scale/`MathContext` throws `ArithmeticException`. You must supply a target scale and `RoundingMode` (`divide(d, 4, RoundingMode.HALF_EVEN)`) or a `MathContext` limiting significant digits. Terminating divisions (10/2) don't throw.

## Question 18

**When do you use `BigInteger` vs `long` in Java?**

Use `long` when values fit in 64 bits (up to ~9.2×10¹⁸) and you want speed — but `long` overflows *silently* (wraps to negative). Use `BigInteger` when values can exceed 64 bits or overflow must be impossible: cryptographic keys, factorials, large combinatorics, exact accumulation. `BigInteger` is immutable and allocates per operation, so it's slower and GC-heavier — avoid it in hot loops where `long` (with overflow checks via `Math.addExact`) suffices.

### Python

## Question 19

**Why does Python's `int` never overflow, and what's the cost?**

CPython implements `int` as an arbitrary-precision bignum (small values are cached). It transparently grows across multiple "digits" (30-bit limbs) as needed, so `2**1000` is exact and there is no overflow. The cost: every int is a heap object with limb arithmetic — slower than a fixed machine int, no SIMD, and a numeric hot loop over large values can be far slower than expected. For performance you drop to `numpy` (fixed-width) or stay within machine-int ranges.

## Question 20

**`Decimal("0.1") + Decimal("0.2")` vs `Decimal(0.1) + Decimal(0.2)` — what's the difference?**

`Decimal("0.1")` parses the *string* and is exactly 0.1, so the sum is exactly `Decimal("0.3")`. `Decimal(0.1)` is constructed from the *float* 0.1, capturing its binary error (`0.1000000000000000055…`), so the sum is `0.3000000000000000166…`. Always construct `Decimal` from strings (or ints) for exact decimal values. Same lesson as Java's `BigDecimal`.

## Question 21

**How does Python's `decimal` context work, and what's `quantize`?**

`decimal` uses a thread-local context (`getcontext()`) holding precision (default 28 significant digits) and a default rounding mode. Operations round to the context precision. `quantize(exp, rounding=...)` rounds a `Decimal` to the number of decimal places implied by `exp` with an explicit mode — e.g., `tax.quantize(Decimal("0.01"), ROUND_HALF_EVEN)` to 2 places. Prefer `localcontext()` for scoped precision changes so you don't mutate global state. `Fraction` (from `fractions`) gives exact rationals when you need them.

### Go

## Question 22

**Compare `math/big.Int`, `big.Rat`, and `big.Float`.**

`big.Int` is an arbitrary-precision integer (limbs) — crypto, big combinatorics. `big.Rat` is an exact rational `p/q` of two `big.Int`s, kept in lowest terms — exact fractions, denominator blow-up risk. `big.Float` is arbitrary-precision *binary* floating point with a settable mantissa precision — **not** decimal-exact, so it still can't represent 0.1 exactly; use `big.Rat` or a decimal library for exact base-10. All three are mutable via receiver methods (`z.Add(x, y)` writes into z), which you exploit to avoid per-iteration allocation.

## Question 23

**How do you represent money in Go?**

Two common approaches: integer minor units (`int64` cents) for exact, fast arithmetic and simple DB mapping; or a decimal library like `shopspring/decimal` (or `cockroachdb/apd`) for flexible scale and controlled rounding (tax, FX). Avoid `float64` entirely and avoid `big.Float` (binary, not decimal). For a full domain model, a Money library (e.g., Rhymond `go-money`) pairs an `int64` amount with a currency and handles allocation. Use mutable `big` receivers if you need bignums in a loop to avoid allocation churn.

### C++

## Question 24

**What is `__int128` and when do you reach for it?**

`__int128` is a 128-bit integer supported by GCC/Clang on 64-bit targets (not standard C++ but widely available). The canonical use is the *wide intermediate* in fixed-point multiplication: multiplying two 64-bit `Q32.32` values needs 128 bits before the rescale, so `(__int128)a * b >> 32` avoids overflow. It's also handy for overflow-safe 64-bit multiply/add checks. For truly unbounded integers you move up to GMP or Boost.Multiprecision.

## Question 25

**What does GMP / Boost.Multiprecision give you, and how do they choose multiplication algorithms?**

GMP (`mpz_t` integers, `mpq_t` rationals, MPFR floats) and Boost.Multiprecision (`cpp_int`, `cpp_dec_float`, or GMP/MPFR backends) provide arbitrary-precision arithmetic. Internally they implement the full multiplication cascade — schoolbook, Karatsuba, Toom-Cook, and FFT (Schönhage–Strassen) — and switch by operand size using empirically tuned crossover thresholds, so you get near-optimal performance across the whole range without choosing the algorithm yourself.

### Rust

## Question 26

**How does Rust handle integer overflow, and what bignum/decimal crates exist?**

In debug builds Rust *panics* on integer overflow; in release builds it wraps (two's complement), but you opt into explicit behavior with `checked_add` (returns `Option`), `wrapping_add`, `saturating_add`, or `overflowing_add`. `i128`/`u128` are first-class for wide fixed-point intermediates. For arbitrary precision: `num-bigint` (`BigInt`/`BigUint`), `num-rational` (exact fractions), and `rust_decimal` / `bigdecimal` for decimal money. Rust's newtype pattern makes a strongly-typed `Money` wrapper natural and zero-cost.

## Question 27

**Why is a Rust newtype attractive for money?**

A newtype like `struct Money { minor: i64, currency: Currency }` makes illegal operations a *compile error*: you can't add `Money` to a bare `i64`, and you can implement `Add` only for same-currency values so cross-currency math doesn't compile. The wrapper is zero-cost at runtime, centralizes scale and rounding, and the type system enforces invariants that other languages enforce only by convention and review.

---

## Tricky / Trap Questions

## Question 28

**Is `int(19.99 * 100)` a safe way to convert dollars to cents?**

No. `19.99` as a double is slightly less than 19.99, so `19.99 * 100` is `1998.9999999999998`, and `int(...)` truncates to **1998**, not 1999 — you've lost a cent. The fixes: parse with a decimal type (`int(Decimal("19.99") * 100)` = 1999), or round explicitly (`round(19.99 * 100)`) — but the truly safe path is to never let the value pass through a float at all.

## Question 29

**A colleague stores money in a `double` and "rounds to 2 decimals before saving." Is that fine?**

No. Rounding to 2 decimals doesn't make the stored double exact — there's no double that equals exactly, say, 0.07, so you've rounded an inexact value to *another* inexact value. Errors still accumulate across arithmetic done before the round, and equality/sum invariants still fail. The boundary round is necessary but not sufficient; the underlying representation must be exact (integer minor units or a decimal type).

## Question 30

**Two threads both do `balance += amount` on a shared bignum/decimal balance. The arithmetic is exact. Is the result correct?**

Not necessarily — exact arithmetic doesn't prevent a *lost update*. `balance += amount` is read-modify-write; without synchronization or a transaction, two threads can read the same old balance and one write overwrites the other, losing money. Correctness here is a concurrency property (locking, atomic CAS, or a serialized DB transaction), orthogonal to the numeric exactness. This is why money correctness needs *both* exact types and proper isolation.

## Question 31

**You sum a list of line items and also "round the total." A customer says your invoice total is off by a cent. What happened?**

You almost certainly rounded each line item and summed the rounded values, while the customer (or another system) rounded the un-rounded sum — "sum of rounded" ≠ "round of sum." Both are defensible, but you must pick *one* boundary, document it, and apply it consistently across systems. The fix is to define where rounding happens (per line vs per invoice) and reconcile the two computations.

## Question 32

**Is `BigInteger`/`big.Int` modular exponentiation safe to use for RSA?**

Not on secret-dependent paths. `BigInteger.modPow` / `big.Int.Exp` are *not guaranteed constant-time*, so their timing can depend on the secret exponent, leaking key bits to a timing attacker. Use the platform's vetted crypto (`java.security`/`Cipher`, Go `crypto/rsa`, BoringSSL/libsodium), which implement constant-time modular arithmetic and blinding. Generic bignum ops are fine only for non-secret values.

## Question 33

**Your "exact" rational computation gets slower every iteration. Why?**

Denominator blow-up. Each rational operation produces `p/q` and reduces by GCD, but adding many fractions (or iterating a recurrence) makes `p` and `q` grow without bound, so every subsequent operation works on larger bignums and runs a larger GCD. The "exact, free" abstraction has a hidden super-linear cost. Either bound/periodically convert the fractions, or switch to fixed-scale decimals if you don't truly need exact rationals.

## Question 34

**In JavaScript, `JSON.parse` reads a 64-bit ID `9007199254740993` and it comes back as `9007199254740992`. Why, and what's the fix?**

JS `Number` is a `double`; integers above `2^53` (`9007199254740992`) can't all be represented, so the parser rounds to the nearest representable value — silently corrupting the ID. Fixes: transmit large integers as **strings** and parse to `BigInt`, or use a JSON parser that supports `BigInt`. Never round-trip 64-bit IDs or money through a plain JS `Number`.

## Question 35

**`Q16.16` multiply: `int32_t r = (a * b) >> 16;`. What's wrong?**

`a * b` is computed in `int32_t` and overflows *before* the shift for any non-trivial operands — you shift garbage. The true product needs up to 64 bits. Fix: widen the intermediate — `int32_t r = (int32_t)(((int64_t)a * b) >> 16);`. The "widen for the intermediate, then rescale" rule is the central fixed-point discipline; the bug hides because small-operand tests pass.

## Question 36

**JPY is stored in your system as `amount * 100` like every other currency. What breaks?**

JPY has no sub-yen minor unit (ISO 4217 exponent 0); multiplying by 100 invents a precision that doesn't exist and mismatches every JPY interface (display, settlement, gateways), and KWD/BHD (exponent 3) break the other way if you assume ×100. Money systems must use each currency's actual minor-unit scale from ISO 4217, not a hard-coded ×100.

---

## Design Scenarios

## Question 37

**Design the money representation for a payments platform handling many currencies, tax, and marketplace splits.**

Use an immutable **Money** value object: an exact amount (integer minor units for storage, or a fixed-scale decimal) plus an ISO 4217 currency code carrying that currency's exponent. Forbid cross-currency arithmetic by construction (type error). Keep full precision through tax/discount/FX calculations using a decimal type, and round **once** at a documented boundary (per line vs per invoice — pick and document) with a regulation-driven rounding mode stored as config. Every split (platform fee + seller payout) goes through an allocation function asserting `sum(parts) == total`, materializing the leftover into an explicit account. Treat FX as a posting with a high-precision rate, timestamp, and recorded rounding remainder. Persist into NUMERIC columns whose scale matches the calculation scale, and reconcile totals two ways to catch drift. The whole thing must be reproducible: any historical figure re-derivable from inputs + documented rules.

## Question 38

**A billing engine is accused of "salami slicing" — pennies disappearing across millions of invoices. How do you investigate and prevent it?**

Investigate: reconcile "sum of rounded line items" against "round of summed line items" and against ledger totals; look for any rounding step whose remainder isn't posted somewhere (truncation that drops fractions), and for repeated *intermediate* rounding that biases totals in one direction. Check whether splits use allocation (sum to whole) or independent rounding. Prevent: round exactly once at a documented boundary with an unbiased mode (HALF_EVEN); route every split through allocation with a conservation assertion; materialize *every* remainder into an explicit rounding/residual account (a homeless remainder is the fraud seam); add an automated reconciliation/alert on any cent-level divergence; and make every figure reproducible for audit. The defense against malicious skimming and honest rounding bugs is the same: conserve every fraction explicitly.

## Question 39

**Design a service that must compute exact results over very large integers (e.g., combinatorics or crypto) under latency SLAs. What are the performance levers?**

First, re-derive complexity assuming bignum ops are O(limbs), not O(1) — many "linear" loops are quadratic because the numbers grow. Keep operands small via modular reduction (Montgomery/Barrett) where the domain allows; choose closed-form or matrix-exponentiation forms (e.g., Fibonacci in O(log n) bignum ops) over naive accumulation. Minimize allocations: reuse mutable bignum buffers (Go receivers, in-place GMP). Lean on a tuned library's algorithm cascade rather than hand-rolling multiply. Profile the *actual* operand-size distribution, since library crossover thresholds may not match it. For crypto specifically, use constant-time vetted primitives (correctness/security, not just speed), and consider precomputation/caching for fixed moduli. Cap or avoid rationals to prevent denominator blow-up.

## Question 40

**You're reviewing crypto code that uses `BigInteger.modPow` directly with a secret exponent. What's your feedback and what do you require?**

Reject it for production secret-key operations. `modPow` is not guaranteed constant-time, so its execution time can depend on the secret exponent's bit pattern, enabling remote timing attacks to recover the key; secret-dependent branches and memory access add cache side channels. Require using a vetted, constant-time implementation (the platform crypto provider, BoringSSL/libsodium), with RSA blinding and constant-time comparisons (`crypto/subtle`-style) for any secret material. Generic bignum operations are acceptable only for public/non-secret values. Also require tests/CI that the secret paths route through the approved library, since "it works" tests won't catch a side channel.

---

## Cheat Sheet

- **Never** money in `float`/`double`. Use integer minor units or a decimal type built **from strings**.
- **Fixed-point** = integer × implicit scale; `Qm.n` scale is `2^n`; multiply needs a **wide intermediate**, then rescale.
- **Decimal** = unscaled bignum + scale. Scale = fractional digits; precision = significant digits. Divide needs an explicit scale + mode.
- **Rounding mode is policy:** HALF_EVEN (unbiased, default) vs HALF_UP (some regulators). Round **once**, at a documented boundary.
- **Allocation conserves the total:** floor + distribute leftover; `sum(parts) == total`. Materialize every remainder.
- **Bignum ops are O(limbs), not O(1).** Multiply cascade: schoolbook → Karatsuba → Toom → FFT. Watch loops going O(n²).
- **Rationals** are exact but denominators blow up. **`big.Float` is binary**, not decimal-exact.
- **Crypto bignums must be constant-time;** use vetted libraries, not generic `modPow`, on secret paths.
- Per-language: Java `BigDecimal`("…")/`BigInteger`; Python native bignum `int` + `Decimal`; Go `math/big` + `shopspring/decimal`; C++ `__int128`/GMP/Boost; Rust `i128`/`num-bigint`/`rust_decimal`. JS `Number` loses precision past `2^53` → `BigInt`.

---

## Further Reading

- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic*.
- Martin Fowler, *Money* pattern (PoEAA) and `allocate`.
- Brent & Zimmermann, *Modern Computer Arithmetic* (bignum algorithms).
- Kocher (1996) and Brumley–Boneh (2003) on timing attacks.
- ISO 4217 currency exponents; language docs for `BigDecimal`/`Decimal`/`math/big`/GMP/`num-bigint`.
