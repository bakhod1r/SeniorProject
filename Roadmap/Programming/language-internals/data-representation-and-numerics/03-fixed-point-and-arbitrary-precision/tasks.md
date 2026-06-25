# Fixed-Point & Arbitrary Precision — Hands-On Tasks

> **Topic:** [Fixed-Point & Arbitrary Precision](README.md)

---

## Introduction

This is a structured set of exercises that take you from "I know not to use a
float for money" to "I can build a conservation-correct allocator, a fixed-point
multiply that doesn't overflow, and reason about where a bignum loop goes
quadratic." Every task is small enough for one or two focused sessions, and they
build on one another.

How to use this file: read the task, write the code, **run it** (and *measure*
where the task says to), and only then check the hints. The self-check boxes are
for when you can explain the result to someone else — not when the code merely
compiles. Solutions are intentionally sparse; they appear only where the
canonical answer teaches more than your first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Related Topics](#related-topics)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a failure mode you'll
reuse for the rest of the file.

### Task 1: See the float lie

**Problem.** In three languages of your choice, print `0.1 + 0.2` with full
precision (e.g., `%.17f` in C, `repr` in Python). Then print whether
`0.1 + 0.2 == 0.3`. Then do the same with integer cents and confirm exactness.

**Hints (try without first).**
- The sum prints as `0.30000000000000004` and the equality is `false`.
- With cents: `10 + 20 == 30` is trivially true and exact.

**Self-check.**
- [ ] You can explain *why* 0.1 isn't exact in binary (denominator has a factor of 5).
- [ ] You can state the one-sentence rule about money and floats.

### Task 2: The truncation cent

**Problem.** Compute `int(19.99 * 100)` (or your language's cast). Predict the
result before running. Then write a *correct* dollars-to-cents converter and test
it on `"19.99"`, `"0.07"`, `"100.10"`, and `"-3.30"`.

**Hints.**
- `19.99 * 100` is `1998.9999999999998` as a double, so the cast gives `1998`.
- Parse with a decimal type, or round explicitly — but prefer never touching a float.

**Self-check.**
- [ ] Your converter returns 1999 for "19.99" and handles negatives.
- [ ] You can explain why truncation (not rounding) caused the lost cent.

### Task 3: Bignum or not?

**Problem.** In Python, Java, Go, JavaScript, and C (any subset of 3), compute
`2 ** 100` (or `pow(2,100)`). Record which languages give the exact 31-digit
answer out of the box and which overflow or need a special type.

**Hints.**
- Python: native `int`, exact. JS: needs `2n ** 100n`. Java: `BigInteger`. Go: `math/big`. C: overflows a 64-bit int.

**Self-check.**
- [ ] You can name each language's default integer overflow behavior.
- [ ] You know which languages make you opt into bignums explicitly.

---

## Core

These are the load-bearing skills: correct money arithmetic, rounding, and
fixed-point multiply.

### Task 4: A minimal Money type

**Problem.** Implement an immutable `Money` value holding integer minor units and
a currency code. Support `add`, `subtract`, `negate`, and a `parse(string,
currency)` that uses the currency's ISO 4217 scale (USD=2, JPY=0, KWD=3).
`add`/`subtract` must raise on currency mismatch.

**Constraints.**
- No floats anywhere.
- `parse("1000", "JPY")` stores minor=1000 (scale 0); `parse("1.234", "KWD")` stores 1234.

**Hints.**
- Store `minor: int` and look up the scale per currency.
- Parse via a decimal type, then scale to integer minor units.

**Self-check.**
- [ ] Adding USD to EUR raises, not silently coerces.
- [ ] JPY is not multiplied by 100.

### Task 5: Rounding modes head-to-head

**Problem.** Write a function `round_to(value, places, mode)` supporting HALF_UP
and HALF_EVEN, using your language's decimal type. Round each of `[0.5, 1.5, 2.5,
3.5, 2.45, 2.55]` to integers (and 2.45/2.55 to 1 place) under both modes and
tabulate the results.

**Hints.**
- HALF_UP: 0.5→1, 2.5→3. HALF_EVEN: 0.5→0, 2.5→2 (tie to even).
- 2.45/2.55 expose representation subtleties if you accidentally route through a float — use the decimal type's string constructor.

**Self-check.**
- [ ] Your table matches: HALF_EVEN sends ties to the even neighbor.
- [ ] You can explain why HALF_EVEN avoids cumulative upward bias.

### Task 6: The conserving allocator

**Problem.** Implement `allocate(total_minor, weights) -> list[int]` such that the
returned shares sum **exactly** to `total_minor`, distributing leftover units by
largest fractional remainder. Then prove the invariant with property tests.

**Constraints.**
- `allocate(10000, [1,1,1])` → `[3334, 3333, 3333]`.
- `allocate(10005, [1,1,1])` → sums to 10005.
- A weighted split `allocate(10000, [70, 30])` → `[7000, 3000]` and `allocate(10001, [70,30])` sums to 10001.

**Hints.**
- Floor each share, compute the leftover (`total - sum(floors)`), then add 1 to the shares with the largest remainders.

**Property to test:** for random totals and weight vectors,
`sum(allocate(t, w)) == t` always, and every share ≥ 0 for non-negative totals.

**Self-check.**
- [ ] No cent is ever created or lost, for any input.
- [ ] You can explain why independent rounding of each share fails this.

<details>
<summary>Sparse solution sketch</summary>

```python
def allocate(total, weights):
    s = sum(weights)
    floors = [(total * w) // s for w in weights]
    rema   = [(total * w) % s for w in weights]
    leftover = total - sum(floors)
    for i in sorted(range(len(weights)), key=lambda i: rema[i], reverse=True)[:leftover]:
        floors[i] += 1
    assert sum(floors) == total
    return floors
```
The invariant holds because `leftover` is exactly `total - sum(floors)` whole
units, and you distribute precisely that many single units.
</details>

### Task 7: Fixed-point Q16.16 with safe multiply

**Problem.** Implement a `Q16.16` fixed-point type (in C, C++, Rust, or Go) with
`from_double`, `to_double`, `add`, `mul`, and `div`. Multiply and divide must use
a **wide intermediate** so they don't overflow. Verify `mul(1.5, 2.0) == 3.0`,
`mul(0.1, 0.1) ≈ 0.01`, and that a naive 32-bit-only multiply overflows on large
operands.

**Hints.**
- Scale = `1 << 16`. `mul`: `(int64)(((int64)a * b) >> 16)`. `div`: `(int64)(((int64)a << 16) / b)`.
- Demonstrate the bug: compute `mul(200.0, 200.0)` with a 32-bit-only intermediate and watch it go wrong.

**Self-check.**
- [ ] You can point at the exact place the naive version overflows.
- [ ] You understand why multiply needs a divide-by-scale but add does not.

### Task 8: Tax and total — round once

**Problem.** Given a cart of decimal prices and quantities and a tax rate of
8.25%, compute the order total two ways: (a) round each line's tax then sum;
(b) sum pre-tax, apply tax to the sum, round once. Show the totals can differ by
a cent and decide which boundary you'd ship and why.

**Hints.**
- Keep full precision until the single rounding step in (b).
- The difference is the "sum of rounded ≠ round of sum" effect from the interview file.

**Self-check.**
- [ ] You can produce a cart where (a) and (b) differ.
- [ ] You can defend a chosen boundary to an imaginary auditor.

---

## Advanced

These push into performance and exactness traps.

### Task 9: Find the quadratic

**Problem.** Implement `factorial(n)` as a loop (`p *= i`). Time it for n =
20000, 40000, 80000 and plot/observe the growth. Explain why doubling n roughly
*quadruples* the time even though the loop only doubles.

**Hints.**
- `p` grows to ~`n·log2(n)` bits; each multiply is O(limbs), not O(1).
- Total work is roughly O(n²) limb operations.

**Self-check.**
- [ ] You measured super-linear growth and can attribute it to growing operands.
- [ ] You can name one algorithm whose textbook O(n) becomes O(n²) under bignums.

### Task 10: Fibonacci, fast and slow

**Problem.** Compute `F(n)` two ways for large n (e.g., n = 500000): (a) naive
iterative addition; (b) fast doubling (O(log n) bignum operations). Compare
timings and explain the gap in terms of operand size and operation count.

**Hints.**
- `F(n)` has ~`n·0.694` bits, so each addition in (a) is O(n) → (a) is ~O(n²).
- Fast doubling does O(log n) *multiplies* of n-bit numbers.

**Self-check.**
- [ ] (b) is dramatically faster and you can explain why despite multiplies being costlier than adds.
- [ ] You reused mutable bignum buffers (where the language allows) to cut allocation.

### Task 11: Karatsuba by hand

**Problem.** Implement Karatsuba multiplication for non-negative integers
(splitting on a bit boundary), with a native-multiply base case for small inputs.
Verify against your language's built-in big-int multiply on random large inputs,
and find the input size where your Karatsuba beats (or loses to) a schoolbook
implementation you also write.

**Hints.**
- `z1 = (a0+a1)(b0+b1) - z2 - z0` is the three-multiply trick.
- Below the crossover, schoolbook's smaller constant wins — that's why libraries cascade.

**Self-check.**
- [ ] Your Karatsuba matches the reference for thousands of random pairs.
- [ ] You located a crossover threshold empirically.

### Task 12: Rational blow-up

**Problem.** Sum the harmonic series `Σ 1/k` for k = 1..N using exact rationals.
For increasing N, record the bit-length of the denominator and the time per step.
Then explain the failure mode and propose a mitigation.

**Hints.**
- The denominator approaches `lcm(1..N)`, which grows super-linearly.
- Each addition runs a GCD on growing bignums.

**Self-check.**
- [ ] You observed denominator (and time) growth and can explain the GCD cost.
- [ ] You can state when rationals are the wrong default and what to use instead.

### Task 13: Constant-time comparison

**Problem.** Write two equality checks for secret byte tokens: a naive one that
returns early on the first mismatch, and a constant-time one (XOR-accumulate, or
your language's `subtle`-style helper). Argue (you don't need to mount the attack)
how the naive version's timing leaks information about the secret.

**Hints.**
- Early-exit compare reveals the length of the matching prefix via timing.
- Constant-time compares examine all bytes regardless of mismatches.

**Self-check.**
- [ ] You can explain what an attacker learns from the early-exit timing.
- [ ] You used a vetted constant-time primitive rather than `==`/`bytes.Equal` for the secret path.

---

## Capstone

### Task 14: A small but correct billing engine

**Problem.** Build a billing module that, given line items (decimal unit price ×
integer quantity), a tax rate, a multi-party split (e.g., platform fee + seller
payout), and a currency, produces: per-line amounts, tax, an order total, and the
split — all exact, all conserving, all reproducible.

**Requirements.**
- A `Money` type with currency + ISO 4217 scale; no floats anywhere.
- Rounding happens **once** at a documented boundary, with an explicitly chosen mode (state which and why).
- The split goes through your `allocate()`; assert `platform_fee + seller_payout == order_total`.
- Multi-currency aware: JPY (scale 0) and KWD (scale 3) must work, not just USD.
- Every materialized remainder is assigned somewhere explicit (a rounding/residual account).
- A reconciliation check: compute the total a second, independent way and assert agreement.

**Stretch goals.**
- Add an FX conversion step (high-precision rate, round result to target scale, record the remainder as a posting).
- Add a property test over random carts asserting conservation (sum of parts == charged total) for thousands of cases.
- Persist amounts to a `NUMERIC(_, scale)` store and confirm the DB doesn't silently re-round.

**Self-check.**
- [ ] For any random cart, debits equal credits and the split sums to the total.
- [ ] You can re-derive any historical figure from inputs + your documented rounding rules.
- [ ] Switching currency (USD→JPY→KWD) changes the scale correctly with no hard-coded ×100.
- [ ] You can point to where every rounding remainder goes — none disappear.

---

## Related Topics

- **Floating-Point (IEEE 754):** why binary floats round, and the dynamic-range trade-off fixed-point gives up — the sibling topic next door in this section.
- **Integer Representation & Overflow:** the wrap-around behavior that fixed-point and bignums respectively manage and avoid.
- **Shared-Memory Concurrency:** lost-update bugs on a money balance are a concurrency problem even when the arithmetic is exact.
- **Cryptography / number theory:** modular exponentiation, constant-time discipline, and the bignum algorithms underneath RSA/ECC.
