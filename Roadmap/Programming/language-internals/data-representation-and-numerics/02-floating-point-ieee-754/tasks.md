# Floating-Point (IEEE 754) — Hands-On Tasks

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** Build intuition by *making the bugs happen* and then fixing them — bit inspection, rounding, cancellation, summation, comparison, money, and reproducibility.

---

## How to use this file

Work top to bottom; difficulty rises. Each task has:
- a clear **goal** and **self-check boxes** (`[ ]`) you tick when your output matches,
- a **Hint** (collapsed in your head — try first),
- a **Solution sketch** (sparse — the idea, not full code, except where the exact bits matter).

Use any language with IEEE 754 doubles (all of C, Java, Python, Go, Rust, JS qualify). Where a task needs the *exact stored value*, print with 17 significant digits (`%.17g`, `f"{x:.17f}"`, `strconv.FormatFloat(x,'g',17,64)`).

---

## Tier 1 — See the approximation (Junior)

### Task 1.1 — Reproduce `0.1 + 0.2`

**Goal:** Print `0.1 + 0.2` and confirm it isn't `0.3`.

- [ ] `0.1 + 0.2` prints `0.30000000000000004`
- [ ] `0.1 + 0.2 == 0.3` prints `false`
- [ ] `0.1` printed with 17 digits shows it's stored as `0.10000000000000001`

**Hint:** Use your language's 17-digit format specifier to reveal the true stored value.

**Solution sketch:** `print(0.1 + 0.2)`; `print(0.1 + 0.2 == 0.3)`; `print(f"{0.1:.17f}")`. All IEEE 754 languages give the same answer.

---

### Task 1.2 — Which fractions are exact?

**Goal:** For each of `0.5, 0.25, 0.75, 0.1, 0.2, 0.3, 0.125, 0.7`, decide (by reasoning, then by printing 17 digits) whether it's exactly representable.

- [ ] You predicted exactness from the rule "denominator (in lowest terms) is a power of 2" *before* running
- [ ] `0.5, 0.25, 0.75, 0.125` print exactly; `0.1, 0.2, 0.3, 0.7` show extra digits

**Hint:** `0.75 = 3/4`, denominator 4 = 2². `0.7 = 7/10`, denominator 10 — not a power of 2.

**Solution sketch:** Loop and print each with 17 digits. The power-of-2-denominator ones round-trip cleanly.

---

### Task 1.3 — The NaN and Infinity tour

**Goal:** Produce `NaN`, `+Inf`, `-Inf` and verify their quirks.

- [ ] `0.0/0.0` (computed from variables) is NaN; `1.0/0.0` is `+Inf`; `-1.0/0.0` is `-Inf`
- [ ] `NaN == NaN` is `false`; your `isnan()` helper returns `true`
- [ ] `Inf + 1 == Inf`; `1 / Inf == 0`; `Inf - Inf` is NaN

**Hint:** In Go, division of *constant* zeros won't compile — use variables or `math.Inf`/`math.NaN`. In Python, `0.0/0.0` raises; use `float('nan')`, `float('inf')`.

**Solution sketch:** Build the values from variables, then run each comparison. Confirm `x != x` matches your library's `isnan`.

---

### Task 1.4 — The money-as-float bug

**Goal:** Show that summing `0.10` ten times as a double does not give `1.0`, then fix it with integer cents.

- [ ] Summing `0.10` ten times prints something like `0.9999999999999999`
- [ ] Summing integer cents (`10` ten times) and dividing by 100 prints exactly `1.0`

**Hint:** The fix is to do *all* arithmetic in integers and convert to dollars only for display.

**Solution sketch:** `total = sum(0.10 for _ in range(10))` vs `cents = 10*10; dollars = cents/100`.

---

### Task 1.5 — Replace `==` with a tolerance

**Goal:** Write a `close(a, b, eps=1e-9)` helper and use it to make `0.1 + 0.2` "equal" `0.3`.

- [ ] `0.1 + 0.2 == 0.3` is `false` but `close(0.1 + 0.2, 0.3)` is `true`
- [ ] You can articulate *why* `eps = 1e-9` is fine here but wrong for comparing two billion-sized numbers

**Hint:** `abs(a - b) < eps`. The "why wrong for big numbers" answer is in Tier 3.

**Solution sketch:** `def close(a, b, eps=1e-9): return abs(a-b) < eps`.

---

## Tier 2 — Quantify the grid (Middle)

### Task 2.1 — Inspect the bits of a double

**Goal:** Decompose `1.0, 0.5, 2.0, 0.1, -0.1` into sign, exponent (biased and unbiased), and fraction.

- [ ] `1.0` → sign 0, raw exponent 1023 (unbiased 0), fraction 0
- [ ] `2.0` → raw exponent 1024 (unbiased 1)
- [ ] `0.5` → raw exponent 1022 (unbiased −1)
- [ ] `0.1` shows a repeating fraction pattern in the bits

**Hint:** Reinterpret the double's 8 bytes as a `uint64` (`struct.unpack('>Q', struct.pack('>d', x))` in Python; `memcpy` in C; `math.Float64bits` in Go), then mask: sign = bit 63, exponent = bits 52–62, fraction = bits 0–51.

**Solution sketch:** `bits = float64_to_uint64(x); sign = bits >> 63; exp = (bits >> 52) & 0x7FF; frac = bits & ((1<<52)-1)`. Print `exp` and `exp - 1023`.

---

### Task 2.2 — Machine epsilon and ULP

**Goal:** Compute machine epsilon empirically, and observe ULP growth.

- [ ] You find ε ≈ `2.22e-16` by halving until `1.0 + eps == 1.0`
- [ ] `ulp(1.0)`, `ulp(1e6)`, `ulp(1e16)` differ by powers of 2 (the last is `2.0`)
- [ ] `1.0 + eps != 1.0` but `1.0 + eps/2 == 1.0`

**Hint:** To find ε: start at `1.0`, keep halving a candidate while `1.0 + candidate != 1.0`; the last value that still changed `1.0` is ε. For ULP, use `math.ulp` (Python/Go have it) or `nextafter(x, inf) - x`.

**Solution sketch:** Loop halving; compare to `sys.float_info.epsilon`. `math.ulp(1e16)` is `2.0` because adjacent doubles there are 2 apart.

---

### Task 2.3 — The 2^53 integer ceiling

**Goal:** Find the smallest positive integer `N` such that `N` and `N+1` are not both representable as a double.

- [ ] `2**53 + 1 == 2**53` is `true`
- [ ] `2**53` is the boundary; below it, all integers are exact
- [ ] (JS bonus) `Number.MAX_SAFE_INTEGER === 2**53 - 1`

**Hint:** At `2^53` the ULP becomes `2.0`, so odd integers there can't be stored.

**Solution sketch:** Print `2**53 + 1 == 2**53`. Explain via ULP at that magnitude.

---

### Task 2.4 — Round half to even

**Goal:** Demonstrate banker's rounding and contrast it with "round half up."

- [ ] `round(0.5) == 0`, `round(1.5) == 2`, `round(2.5) == 2`, `round(3.5) == 4` (ties-to-even)
- [ ] Summing many rounded ties shows ties-to-even has ~zero bias while round-half-up drifts up
- [ ] You can state *why* the IEEE default is ties-to-even (Vancouver / bias)

**Hint:** Generate many values of the form `k + 0.5` and round both ways; compare the sums of rounding errors.

**Solution sketch:** Round `0.5..n.5` ties-to-even (built-in `round` in Python 3) vs `math.floor(x + 0.5)` (half-up). The half-up sum drifts positive.

---

### Task 2.5 — Catastrophic cancellation in the quadratic formula

**Goal:** Solve `x² + 1e8·x + 1 = 0` with the naive and stable formulas; compare to the true roots (`≈ -1e-8` and `≈ -1e8`).

- [ ] The naive `(-b + sqrt(b²-4ac))/(2a)` gives a wrong small root (lost digits)
- [ ] The stable form (choose the sign that *adds* magnitudes, then use `c/q` for the other root) gives `≈ -1e-8`
- [ ] You can point to the exact subtraction that cancelled

**Hint:** `-b + sqrt(b² - 4ac)` ≈ `-1e8 + 1e8` — the leading digits cancel. Compute `q = -(b + sign(b)*sqrt(disc))/2`, then roots are `q/a` and `c/q`.

**Solution sketch:** Implement both; print both roots; verify the stable small root against `-1e-8`.

---

### Task 2.6 — Non-associativity and order-dependent sums

**Goal:** Show that summing a list in different orders gives different results.

- [ ] `(1e16 + 1.0) - 1e16` is `0.0` (the `1.0` was absorbed)
- [ ] Summing `[1.0, 1e16, 1.0, -1e16]` left-to-right vs smallest-magnitude-first differs
- [ ] You can explain absorption as "the small value is below one ULP of the running total"

**Hint:** Sort by absolute value ascending before summing to preserve small contributions.

**Solution sketch:** `sum(xs)` vs `sum(sorted(xs, key=abs))`. The sorted order keeps the two `1.0`s.

---

### Task 2.7 — Kahan summation

**Goal:** Implement Kahan (compensated) summation and beat naive `sum` on a large input.

- [ ] Naive `sum([0.1] * 10_000_000)` drifts from `1_000_000.0`
- [ ] Your Kahan sum is much closer (often exact to display precision)
- [ ] (Bonus) Compare against your language's `fsum`/pairwise sum

**Hint:** Keep a `comp` (compensation) variable: `y = x - comp; t = total + y; comp = (t - total) - y; total = t`.

**Solution sketch:** Implement the four-line loop above. Print naive vs Kahan vs `math.fsum`.

---

### Task 2.8 — A correct `isclose`

**Goal:** Write a comparison that works near zero *and* at huge magnitudes.

- [ ] `isclose(0.1 + 0.2, 0.3)` is `true`
- [ ] `isclose(1e-18, 0.0)` is `false` with only relative tolerance, `true` once you add an absolute tolerance
- [ ] `isclose(1e20, 1e20 + 1)` is `true` (1 is below one ULP there) — relative tolerance handles it

**Hint:** Combined form: `abs(a-b) <= max(rel_tol * max(|a|,|b|), abs_tol)`.

**Solution sketch:** Implement the combined tolerance; test all three cases above.

---

## Tier 3 — The machine beneath (Senior)

### Task 3.1 — FMA changes the answer

**Goal:** Find inputs where `fma(a, b, c)` differs from `a*b + c`.

- [ ] With `a = 1 + 2^-27`, `b = 1 - 2^-27`, `c = -1`: separate gives `0.0`, fused gives `-2^-54`
- [ ] `fma(a, b, -(a*b))` extracts the *exact* rounding error of `a*b` (verify `a*b == p + e` exactly with the bits)
- [ ] You can explain it as "one rounding vs two"

**Hint:** Use your language's `fma` (`math.fma` in newer Python/Go, `std::fma` in C++, `f64::mul_add` in Rust). Confirm hardware FMA, or the difference may not appear under software emulation.

**Solution sketch:** Compute `sep = a*b - 1.0` and `fused = fma(a, b, -1.0)`. Print both with 20 digits.

---

### Task 3.2 — Observe `-ffast-math` breaking a NaN check (C/C++)

**Goal:** Compile a NaN-detection loop with and without `-ffast-math` (or `-ffinite-math-only`) and show it stops working.

- [ ] Without the flag, `for (...) if (v[i] != v[i]) return 1;` detects a planted NaN
- [ ] With `-ffinite-math-only`, the compiler folds `v[i] != v[i]` to `false` and the NaN slips through
- [ ] (Bonus) Inspect the assembly diff to see the check disappear

**Hint:** Plant a NaN in the array (e.g., `0.0/0.0` from a volatile zero so the compiler can't constant-fold it away).

**Solution sketch:** Two builds, same source; diff the output and the `objdump`.

---

### Task 3.3 — Kahan deleted by reassociation (C/C++)

**Goal:** Show that `-fassociative-math` (part of `-ffast-math`) optimizes Kahan's compensation to zero, restoring the drift.

- [ ] Kahan sum at `-O2` is accurate
- [ ] Kahan sum at `-O2 -ffast-math` drifts like a naive sum (compensation eliminated)
- [ ] Marking `comp`/`t` `volatile` restores correctness even under fast-math

**Hint:** The compiler proves `(t - sum) - y == 0` algebraically. `volatile` forbids that reasoning.

**Solution sketch:** Same Kahan function, two builds; observe drift returns; add `volatile` and watch it fix.

---

### Task 3.4 — x87 double rounding (32-bit x86, optional)

**Goal:** On a target using x87 (`-m32 -mfpmath=387`), reproduce a value that compares unequal to itself after a store.

- [ ] `volatile double x = 0.1 + 0.2; double y = 0.1 + 0.2; (x == y)` can be `false` under x87
- [ ] On x86-64 SSE2 (default) it's always `true`
- [ ] You can explain it via `FLT_EVAL_METHOD` (2 vs 0)

**Hint:** The `volatile` forces a 64-bit memory store; the non-volatile `y` may stay in an 80-bit register.

**Solution sketch:** If you can't build 32-bit x87, read your platform's `FLT_EVAL_METHOD` and explain what *would* happen. (Most modern setups are `0` and clean.)

---

### Task 3.5 — Quiet vs signaling NaN bits

**Goal:** Construct a quiet NaN with a custom payload; inspect the quiet bit.

- [ ] Your qNaN has exponent all-ones, top fraction bit = 1, and your payload in the low bits
- [ ] `isnan` returns true; the value is still NaN after `+ 1.0`
- [ ] (Discussion) Explain why producing a *persistent* signaling NaN is hard (loads often quiet it)

**Hint:** Build the `uint64`: `(0x7FF << 52) | (1 << 51) | payload`, then reinterpret as a double.

**Solution sketch:** Pack the bits, unpack as double, run `isnan`, add `1.0`, confirm still NaN.

---

### Task 3.6 — Decimal floating point for `0.1`

**Goal:** Show that a decimal type represents `0.1` exactly while binary does not.

- [ ] `Decimal('0.1') + Decimal('0.2') == Decimal('0.3')` is `true`
- [ ] `Decimal(0.1)` (from the *float*) captures the binary error — `0.1000000000000000055...`; `Decimal('0.1')` (from the *string*) is exact
- [ ] You can explain the base-10 significand

**Hint:** Always construct decimals from strings, never from binary floats.

**Solution sketch:** Compare string-constructed vs float-constructed `Decimal`. Use `BigDecimal` in Java, `decimal.Decimal` in Python.

---

### Task 3.7 — Shortest round-trip vs `%.17g`

**Goal:** Compare your language's default float printing against forced 17-digit printing.

- [ ] Default printing of `0.1` shows `0.1` (shortest round-trip)
- [ ] `%.17g` of `0.1` shows `0.10000000000000001`
- [ ] Both, when parsed back, give the *same* double; the default is just shorter

**Hint:** The default printers in Python `repr`, Go `%v`, Rust `{}`, modern JS use Grisu/Ryū-style shortest round-trip; C `printf("%g")` does not.

**Solution sketch:** Print `0.1` and `0.1 + 0.2` both ways; round-trip each string back to a double and assert bit-equality.

---

## Tier 4 — Production discipline (Professional)

### Task 4.1 — Reproduce the Vancouver Stock Exchange drift

**Goal:** Simulate an index updated ~3000×/day for ~600 days, with truncation vs round-to-nearest, and measure the divergence.

- [ ] Truncation produces a steadily *declining* index (systematic downward bias)
- [ ] Round-to-nearest stays near the true value
- [ ] The gap is large (the real incident: ~520 vs ~1098)

**Hint:** Each "update" multiplies by a near-1 factor and re-quantizes to 3 decimals; truncate (`floor`) vs round.

**Solution sketch:** Loop `3000 * 600` times applying a tiny random walk and `trunc(x*1000)/1000` vs `round(x*1000)/1000`. Plot or print both.

---

### Task 4.2 — Safe float→int narrowing (the Ariane lesson)

**Goal:** Write a conversion that range-checks before narrowing a `double` to an `int16`, and prove the unchecked version is unsafe.

- [ ] The naive cast of `40000.0` to `int16` wraps/overflows (or is UB in C)
- [ ] Your checked version returns an error for out-of-range and NaN/Inf inputs
- [ ] (C bonus) `-fsanitize=float-cast-overflow` flags the unchecked cast

**Hint:** Check `isfinite(x)` and `INT16_MIN <= round(x) <= INT16_MAX` before casting.

**Solution sketch:** `if not finite or out of [-32768, 32767]: error; else int16(round(x))`. Compare to the bare cast.

---

### Task 4.3 — Money type that forbids floats

**Goal:** Build a `Money` type storing integer minor units that makes adding a `double` a type error (or runtime guard), with correct splitting.

- [ ] `Money(1099, "USD")` + `Money(250, "USD")` = `Money(1349, "USD")`
- [ ] Adding mismatched currencies fails
- [ ] `split($10.00, 3)` returns shares summing to exactly `$10.00` (e.g., 334+333+333)

**Hint:** Largest-remainder split: `base, rem = divmod(total, parts)`; first `rem` shares get `+1`.

**Solution sketch:** A frozen struct/dataclass wrapping `cents: int` and `currency: str`; `__str__` divides by 100 for *display only*.

---

### Task 4.4 — Bound drift with re-baselining

**Goal:** Build a running-total accumulator that periodically recomputes from the source of truth, and show it beats a naive long-lived double accumulator.

- [ ] A naive `double` accumulator over many small increments drifts (or freezes via absorption)
- [ ] Your re-baselining accumulator stays accurate
- [ ] You can state the three drift signatures (linear, √n, freeze)

**Hint:** Every N adds, recompute the total with `fsum`/Kahan over the durable history and reset the accumulator.

**Solution sketch:** Keep `running` and a `history`; every `N` updates set `running = fsum(history)`.

---

### Task 4.5 — Catch NaN at the boundary

**Goal:** Add finiteness guards so a planted NaN trips an alarm at its source, not three layers downstream.

- [ ] Without guards, a NaN injected early surfaces as a NaN *output* with no clue where it came from
- [ ] With `assert isfinite(x)` at each stage boundary, the assert fires at the injection point with a stack trace
- [ ] (C bonus) `feenableexcept(FE_INVALID)` traps on the producing instruction

**Hint:** `not isfinite` catches NaN *and* ±Inf. Place guards after parse, before store, at module edges.

**Solution sketch:** A pipeline `parse → transform → aggregate → store`; inject NaN in `transform`; add `require_finite()` at each boundary; observe where it trips.

---

### Task 4.6 — Reproducibility fingerprint across configs

**Goal:** Hash the exact bit patterns of a computed float array and show that different build flags (FMA on/off, fast-math) change the hash.

- [ ] You hash the raw 8-byte representations (not decimal strings)
- [ ] `-ffp-contract=off` vs `-ffp-contract=fast` (or `-mfma`) can change the hash for an FMA-eligible kernel
- [ ] `-ffast-math` changes the hash (reassociation/subnormals)

**Hint:** Pack each double as 8 bytes (`struct.pack('>d', v)` / `math.Float64bits`) and feed to SHA-256.

**Solution sketch:** Compute `sum(a[i]*b[i] + c[i])` two ways/two builds; fingerprint each; compare. Discuss what it means for caching/consensus.

---

## Capstone

### Task C.1 — A float diagnostics CLI

**Goal:** Build a small tool that, given a decimal string, prints: the exact stored double (17 digits), the sign/exponent/fraction bits, the ULP at that magnitude, the next and previous representable doubles, and whether the input round-trips through the shortest printer.

- [ ] Handles normal, subnormal, zero, ±Inf, and NaN inputs
- [ ] Correctly shows `0.1` is stored as `0.10000000000000001` with a repeating fraction
- [ ] Shows `ulp(1e16) == 2.0` and the neighbors `1e16 ± 2`

**Hint:** Combine the bit-inspection (2.1), ULP (2.2), `nextafter`, and shortest/`%.17g` printing (3.7).

**Solution sketch:** Parse → `to_bits` → decode fields → `ulp`/`nextafter` → print. This consolidates Tier 2–3 into one reusable utility.

---

### Task C.2 — A statistics module that survives bad inputs

**Goal:** Implement `mean`, `variance` (Welford), and `sum` (Kahan/fsum) that are accurate on adversarial inputs and reject non-finite values at the boundary.

- [ ] Variance via Welford never goes negative (the naive `E[x²]-E[x]²` can, then `sqrt` → NaN)
- [ ] Summation stays accurate on `[1e16, 1.0, -1e16, 1.0, ...]`
- [ ] Non-finite inputs raise at ingestion, not in the output

**Hint:** Welford: maintain `n`, `mean`, `m2`; update incrementally. Guard each input with `isfinite`.

**Solution sketch:** Welford for variance; Kahan/fsum for the total; `require_finite` on every appended value. Compare against the naive formulas on the adversarial array.

---

## Self-Assessment

You've mastered this topic when you can, without looking anything up:

- [ ] Decode a `double`'s sign/exponent/fraction bits and explain the implicit 1 and the bias.
- [ ] Explain *why* `0.1` isn't representable and predict `0.1 + 0.2`.
- [ ] State machine epsilon and explain how ULP scales with magnitude.
- [ ] Recognize catastrophic cancellation and absorption on sight and reformulate around them.
- [ ] Write a correct `isclose` (combined relative + absolute) and know when to use ULP.
- [ ] Test for NaN/Inf correctly and explain `NaN != NaN`.
- [ ] Explain FMA, x87 extended precision, and what `-ffast-math` breaks.
- [ ] Choose the right money representation and explain the Patriot/Ariane/Vancouver incidents.
- [ ] Bound drift in a long-running accumulator and diagnose its signature.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md).
- Sibling numerics topics: integer representation and overflow, fixed-point arithmetic, and decimal/arbitrary-precision types in the parent section.
