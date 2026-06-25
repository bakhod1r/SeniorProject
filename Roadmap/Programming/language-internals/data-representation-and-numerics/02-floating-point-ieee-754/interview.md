# Floating-Point (IEEE 754) — Interview Questions

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** Conceptual, language-specific, trap, and design questions on IEEE 754 — with precise answers an interviewer wants to hear.

---

## How to use this file

Questions are grouped: **Conceptual**, **Language-Specific** (Java / Go / Python / C++ / Rust / JS), **Tricky / Trap**, and **Design**. Each has a tight, correct answer. At a senior interview, the *reason* matters more than the fact — answers below give both.

---

## Conceptual

## Question 1
**Explain the bit layout of a `double` (binary64).**

64 bits: 1 **sign** bit, 11 **exponent** bits, 52 **fraction** (mantissa) bits. The value of a normal number is `(-1)^sign × 1.fraction × 2^(exponent - 1023)`. The leading `1.` is **implicit** (not stored), giving 53 effective significand bits. The exponent is stored **biased** by 1023, so a stored value of 1024 means a real exponent of +1. The reserved exponent values — all-zeros and all-ones — encode zero/subnormals and infinity/NaN respectively. `float` (binary32) is the same shape: 1 + 8 + 23 bits, bias 127.

## Question 2
**Why is `0.1` not exactly representable, and why does `0.1 + 0.2 != 0.3`?**

A binary fraction can represent a decimal exactly only if the decimal's denominator (in lowest terms) is a power of 2. `0.1 = 1/10` is not, so in binary it's `0.0001100110011...` repeating forever. With only 52 fraction bits, the hardware rounds, storing a value slightly larger than 0.1. The same happens to 0.2. Their stored approximations sum and round to a value slightly more than 0.3 — printed as `0.30000000000000004` — which differs from the stored approximation of the literal `0.3`. So `==` is false.

## Question 3
**What is machine epsilon, and what is a ULP? How do they differ?**

**Machine epsilon (ε)** is the gap between `1.0` and the next representable number: `2^-52 ≈ 2.22e-16` for double. It's the *relative* rounding error of one operation. A **ULP (unit in the last place)** is the gap between a given float and its neighbor *at that magnitude* — it scales with the value, doubling every power of 2. So ε is "the ULP at 1.0." Near `1e16` the ULP is `2.0`; near `1.0` it's `2.2e-16`. This is why a fixed absolute tolerance is wrong across magnitudes.

## Question 4
**What are subnormal (denormal) numbers and why do they exist?**

When the exponent field is all-zeros and the fraction is nonzero, the implicit leading bit becomes `0` and the exponent is pinned at the minimum. These **subnormals** fill the gap between the smallest normal number (`2^-1022`) and zero, providing **gradual underflow** — precision degrades bit by bit instead of snapping straight to zero. The cost: on many CPUs subnormal operations are 10-100× slower, which is why performance-critical code enables flush-to-zero.

## Question 5
**Explain NaN. Why is `NaN != NaN`?**

NaN ("Not a Number") is the result of undefined operations: `0.0/0.0`, `Inf - Inf`, `sqrt(-1)`. It has exponent all-ones and a nonzero fraction. By design, **every comparison with NaN is false** (except `!=`, which is true), because NaN represents "no meaningful value" — two meaningless results aren't "equal." This gives the canonical NaN test: `x != x` is true *only* when `x` is NaN. NaN also **propagates**: any arithmetic involving it yields NaN, so one bad value poisons a whole computation.

## Question 6
**What are the rounding modes, and why is the default "round half to even"?**

Five modes: round to nearest ties-to-even (default), round to nearest ties-away, toward zero, toward +∞, toward −∞. The default rounds to the nearest representable value and breaks exact ties toward the value with an even last bit. It's the default because rounding ties *always up* introduces a **systematic upward bias** that compounds over many operations (the Vancouver Stock Exchange index bug). Ties-to-even is statistically unbiased — half round up, half down — so long computations and aggregates don't drift.

## Question 7
**What is catastrophic cancellation?**

The loss of significant digits when subtracting two nearly-equal floating-point numbers. The high-order digits cancel, leaving only the low-order bits — which were rounding noise from the inputs — as the entire result. The relative error explodes even though both inputs were accurate. Classic example: the quadratic formula `-b + sqrt(b²-4ac)` when `b² ≫ 4ac`. The fix is algebraic reformulation (conjugate multiplication, `log1p`/`expm1`, the stable quadratic via the product-of-roots identity).

## Question 8
**Why is floating-point addition not associative? Give a consequence.**

Because every operation rounds, `(a+b)+c` and `a+(b+c)` can round differently. Example: `(1e16 + 1.0) - 1e16 == 0.0` (the `1.0` is absorbed, below one ULP at `1e16`), but reordering changes which value survives. Consequence: **summing the same list in different orders gives different results**, so parallel reductions are non-deterministic in the low bits, and compilers under `-ffast-math` may reorder sums and change your output.

## Question 9
**What is signed zero and when does its sign matter?**

IEEE 754 has both `+0.0` and `-0.0`, distinct bit patterns that compare *equal* under `==`. The sign matters in operations that aren't continuous at zero: `1.0/+0.0 == +Inf` but `1.0/-0.0 == -Inf`; `atan2(+0, -1) != atan2(-0, -1)`; `copysign` and `signbit` read it. It typically arises from underflow of a negative number or `-1.0 * 0.0`. Most code can ignore it, but division and branch-cut math (complex log, sqrt) depend on it.

## Question 10
**What is FMA and why does it matter?**

Fused multiply-add computes `a*b + c` with the full-precision product and a **single** final rounding, versus a separate multiply-then-add that rounds twice. It's more accurate (foundation of accurate dot products and Newton iteration) and enables error-free transforms: `fma(a, b, -(a*b))` yields the *exact* rounding error of `a*b`. The catch: it **changes results**, and compilers may insert it implicitly (contraction) unless you disable it — so "the same source" can produce different bits depending on `-ffp-contract`.

---

## Language-Specific

## Question 11 (Java)
**What does `strictfp` do, and what changed in Java 17?**

`strictfp` forces strictly IEEE 754 binary64/binary32 arithmetic, forbidding the use of x87 80-bit extended precision for intermediates — guaranteeing identical results on every platform. Before Java 17 it was opt-in (default FP could use platform extended precision). **Java 17 (JEP 306) made all floating-point operations strict by default**, removing the distinction; `strictfp` is now a no-op (the historical relevance was the x87 era). For money in Java, use `BigDecimal` with an explicit `RoundingMode`, never `double`.

## Question 12 (Java)
**Why is `Double.compare(a, b)` not the same as `a < b` / `a == b`?**

`Double.compare` imposes a **total order**: it treats `-0.0 < +0.0` and ranks `NaN` as greater than everything (and equal to itself). The `<`/`==` operators follow IEEE: `-0.0 == +0.0` is true and any comparison with `NaN` is false. So `Double.compare` is what you must use as a `Comparator` (sorting with raw `<` and NaN present corrupts the order or throws "comparison method violates its general contract"). It's the bit-level total order, not the numeric one.

## Question 13 (Go)
**Why does `1.0 / 0.0` not compile in Go, but `x / y` with zero `y` does?**

Go evaluates `1.0 / 0.0` as a **constant expression** at compile time, and division by a constant zero is a compile error — Go refuses to bake an infinity into a constant. With runtime `float64` variables, `x / 0.0` produces `+Inf` (or NaN for `0.0/0.0`) per IEEE 754, no panic. (Note: *integer* division by zero panics at runtime; only float division gives Inf/NaN.) Use `math.Inf(1)` and `math.NaN()` to get those values explicitly.

## Question 14 (Go)
**How do you correctly test for NaN and compare floats in Go?**

NaN: `math.IsNaN(x)` (not `x == math.NaN()`, which is always false). Infinity: `math.IsInf(x, sign)`. For "approximately equal," there's no stdlib helper — write a combined relative/absolute tolerance: `math.Abs(a-b) <= math.Max(absTol, relTol*math.Max(math.Abs(a), math.Abs(b)))`. For exact bit work, `math.Float64bits` / `math.Float64frombits`. Note Go's `==` on floats is the IEEE comparison, so `-0.0 == 0.0` is true and `NaN == NaN` is false.

## Question 15 (Python)
**What does Python's `round()` do that surprises people, and what is `math.isclose`?**

Python 3's `round()` uses **banker's rounding** (ties-to-even): `round(0.5) == 0`, `round(2.5) == 2`, `round(1.5) == 2`. People expecting "0.5 always up" are surprised. (Also, `round(2.675, 2)` gives `2.67` not `2.68` because `2.675` is stored as slightly less.) `math.isclose(a, b, rel_tol=1e-9, abs_tol=0.0)` is the correct float comparison: it checks `abs(a-b) <= max(rel_tol*max(|a|,|b|), abs_tol)`. You must pass `abs_tol` to compare against zero, since relative tolerance fails there.

## Question 16 (Python)
**When and how do you avoid `float` for money in Python?**

Always avoid it for money. Use `decimal.Decimal` constructed from **strings** (`Decimal('0.1')`, not `Decimal(0.1)` which captures the binary error), set the context's rounding mode explicitly (`ROUND_HALF_EVEN` or `ROUND_HALF_UP`), and `quantize` to the currency scale at each step. Or use scaled integers (cents). For accurate non-money summation, `math.fsum` gives a correctly-rounded total, far better than `sum`.

## Question 17 (C++)
**What is `FLT_EVAL_METHOD` and the x87 extended-precision problem?**

`FLT_EVAL_METHOD` reports how wide intermediate results are: `0` = to their type (SSE2 default on x86-64), `1` = `double`, `2` = `long double` / 80-bit (classic 32-bit x87). On x87, an expression's intermediate is held in 80 bits in a register, so `double y = a*b + c` may carry more precision than `double` until spilled to memory — causing values that compare unequal to themselves after a store, and **double rounding**. Modern x86-64 uses SSE2, avoiding it; `long double` and `-mfpmath=387` revive it.

## Question 18 (C++)
**What does `-ffast-math` actually disable, and why is it dangerous?**

It bundles: assume no NaN/Inf (so `isnan(x)` can fold to false and your NaN checks stop working), allow reassociation (`(a+b)+c → a+(b+c)`, which **deletes Kahan summation** because the compensation "simplifies" to zero), replace `x/y` with `x*(1/y)`, assume no FP exceptions, and flush subnormals. It's dangerous because it's not local — linking a fast-math object can set process-wide FTZ/DAZ via a static initializer, changing unrelated code. Never apply it globally; quarantine it to validated kernels.

## Question 19 (Rust)
**Why doesn't Rust implement `Eq`/`Ord` for `f64`, only `PartialEq`/`PartialOrd`?**

Because IEEE floats don't form a total order: `NaN != NaN` violates reflexivity (required by `Eq`), and `NaN` is unordered with everything (violating `Ord`'s totality). Rust encodes this in the type system — `f64: PartialOrd` but not `Ord` — so you can't accidentally use a float as a `HashMap` key or sort it without acknowledging NaN. To sort, use `f64::total_cmp` (the IEEE 754 total order over bit patterns) or `partial_cmp(...).unwrap()` after guaranteeing no NaN.

## Question 20 (JavaScript)
**Why is `Number.MAX_SAFE_INTEGER` only `2^53 - 1`?**

Every JS `Number` is an IEEE 754 `double`, with 53 bits of significand. Integers up to `2^53` are exactly representable; beyond that, the gap between adjacent doubles exceeds 1, so consecutive integers can't all be distinguished — `2^53 + 1 === 2^53` is `true`. `MAX_SAFE_INTEGER` (`9007199254740991`) is the largest integer where `n` and `n+1` are both representable. For larger integers (database IDs, snowflake IDs, currency in minor units exceeding this), use `BigInt` or strings.

---

## Tricky / Trap

## Question 21
**What does this print? `0.1 + 0.2 == 0.3`**

`false` in every IEEE 754 language. The stored approximations of 0.1 and 0.2 sum to a value (`0.30000000000000004`) slightly different from the stored approximation of 0.3. The trap is candidates who say "true" or "depends on the language" — it's `false` and it's the *standard*, not the language.

## Question 22
**`(0.1 + 0.2) - 0.3` — is it zero?**

No. It's approximately `5.55e-17` (one ULP-ish residual), not `0.0`. This is the quantitative version of Q21 and a good follow-up to check the candidate understands it's a small nonzero residual, not exactly zero, and not exactly `0.1`.

## Question 23
**Sort `[3.0, NaN, 1.0, 2.0]` with a naive `<` comparator. What happens?**

Undefined or corrupted ordering, language-dependent. NaN compares false against everything, so it breaks the comparator's transitivity/totality. In Java you may get `IllegalArgumentException: Comparison method violates its general contract`; in C `qsort` with a `<`-based comparator can produce garbage or crash; in Python 3 sorting a list with NaN silently leaves it partially sorted. Correct approach: filter NaN first, or use a total-order comparator (`Double.compare`, `f64::total_cmp`).

## Question 24
**Does `x == x` always evaluate to `true`?**

No. If `x` is NaN, `x == x` is `false`. This is the trap behind the `x != x` NaN test. (Under `-ffast-math`/`-ffinite-math-only` the compiler may *assume* no NaN and fold `x == x` to `true`, breaking the test — a double trap.)

## Question 25
**Is `(int)(0.1 + 0.2 == 0.3)` the only surprise, or does `0.1 * 3 == 0.3` also fail?**

`0.1 * 3` gives `0.30000000000000004` and `0.1 * 3 == 0.3` is `false` too — but note `0.1 + 0.1 + 0.1` and `0.1 * 3` may not even equal *each other* depending on rounding. The point: any chain of operations on non-representable decimals accumulates rounding; never expect algebraic identities to hold bit-exactly.

## Question 26
**`Math.round(2.5)` vs `round(2.5)` — same answer?**

Depends on the language. JavaScript's `Math.round(2.5) === 3` (it rounds half *up*, toward +∞). Python's `round(2.5) == 2` (ties-to-even). Java's `Math.round(2.5) == 3` (half-up). C's `round(2.5) == 3.0` (half-away-from-zero), but `rint`/`nearbyint` follow the current mode (default ties-to-even). The trap: "round" means different things across languages and functions. Know your library.

## Question 27
**`1e16 + 1.0` — what do you get and why?**

Exactly `1e16` (`10000000000000000.0`). The value `1.0` is smaller than one ULP at `1e16` (the ULP there is `2.0`), so it falls off the end of the significand and is absorbed. This is the mechanism that makes a long-running `double` accumulator silently stop counting small increments.

## Question 28
**Will `for (float f = 0.1f; f != 0.7f; f += 0.1f)` terminate?**

Possibly never — it's the classic infinite-loop trap. Accumulating `0.1f` ten times doesn't land exactly on the stored value of `0.7f`, so `f != 0.7f` may stay true forever (and `f` sails past 0.7). Never use `!=`/`==` as a float loop condition. Use an integer counter and compute `f = i * 0.1f`, or loop while `f < 0.7f - eps`.

## Question 29
**`Math.sqrt(-1)` — does it throw?**

In most languages, no — it returns `NaN` (C `sqrt`, Java `Math.sqrt`, JS `Math.sqrt`, Go `math.Sqrt`). Python's `math.sqrt(-1)` *does* raise `ValueError` (but `cmath.sqrt(-1)` returns `1j`). The trap: in the NaN-returning languages, your program keeps running with poison, surfacing the NaN far downstream.

## Question 30
**Is `0.0 == -0.0`? Is `1/0.0 == 1/-0.0`?**

`0.0 == -0.0` is `true` (they compare equal). But `1.0/0.0 == +Inf` and `1.0/-0.0 == -Inf`, and `+Inf != -Inf`. So two values that compare equal can produce unequal results through division — the signed-zero trap.

---

## Design

## Question 31
**Design the money representation for a payments system. Walk through the choices.**

Canonical store: **scaled integers in minor units** (cents) as a 64-bit integer, with the **currency code** stored alongside (since decimal places vary: USD 2, JPY 0, some 3). Arithmetic (add/subtract) is exact integer math. For division (splits, interest, tax) use **largest-remainder allocation** so shares reconcile to the total exactly, and apply a single **documented rounding policy** (HALF_EVEN for unbiased aggregates, HALF_UP if a regulator demands it). When you need many decimal places or exact percentages (FX), use arbitrary-precision **decimal** (`BigDecimal`/`Decimal`) — still never binary float. Wrap it in a `Money` type so a `double` can't enter the path. Guard against integer overflow at extreme magnitudes (64 bits of cents ≈ $92 quadrillion, usually safe).

## Question 32
**Design a function to compare two floats for "approximate equality" usable across all magnitudes.**

No single tolerance works. Use a **combined relative + absolute** test: `abs(a-b) <= max(rel_tol * max(|a|, |b|), abs_tol)`. The `rel_tol` term (e.g., `1e-9`) makes it scale-independent for large and small numbers; the `abs_tol` term (e.g., `1e-12`) saves comparisons near zero where relative error explodes. Handle NaN explicitly (return false). For maximum precision in numerical tests, offer a **ULP-based** mode: reinterpret the bit patterns as monotonic integers and compare the integer distance. This is exactly what `math.isclose` / `numpy.allclose` / `Double.compare`-based tests do.

## Question 33
**You're building lockstep multiplayer (or a blockchain) where all nodes must compute identical floats. How?**

The same FP expression yields different bits across CPUs/compilers due to FMA contraction, `libm` transcendentals, x87, and fast-math. Options, best first: (1) **Keep floats out of the agreement path entirely** — use fixed-point or integers for any canonical value that must match; this is what serious systems do. (2) If floats are unavoidable, **pin the environment**: same compiler and flags (`-ffp-contract=off`, no fast-math, force SSE2), and **vendor your own** transcendentals (a fixed polynomial, `crlibm`, pinned SLEEF) so `sin`/`exp` agree. (3) For non-consensus uses (caching), **quantize** computed values to a coarse grid before keying, so low-bit jitter doesn't matter.

## Question 34
**A 24/7 service keeps a running `double` total over billions of events and the number is drifting. Diagnose and fix.**

Two failure modes. **Drift:** naive summation accumulates rounding error (`O(√n·ε)` typically, `O(n·ε)` worst case). **Absorption:** once the total dwarfs the increments (past `2^53`), small increments vanish entirely and the total *freezes*. Fixes: **re-baseline** periodically (recompute from the durable source of truth and reset the accumulator, discarding drift); use **compensated summation** (Kahan/Neumaier or `math.fsum`) for the running total — but ensure fast-math doesn't delete it; keep the accumulator in **higher precision** than inputs; and for anything that must be *exact* (counts), use **integers**, not a double. Diagnose by plotting error over time: linear growth ⇒ biased step, `√n` ⇒ unbiased accumulation, sudden freeze ⇒ absorption.

## Question 35
**Design a NaN-detection strategy for a large numerical pipeline so bugs surface at their origin.**

NaN surfaces far downstream from where it's born, so detect it *at the boundaries*. Add `assert isfinite(x)` (raising in production) after deserialization, before persistence, at every module/API edge, and after any division — so a NaN trips an alarm with a stack trace at its birthplace, not as a blank dashboard three layers later. For hot paths, optionally enable FP exception trapping (`feenableexcept(FE_INVALID | FE_DIVBYZERO)`) to trap on the producing instruction. In CI, **differential-test** critical routines against a high-precision oracle to catch the NaN-producing input class. Never rely on a downstream `value > threshold` check — `NaN > x` is always false, so NaN slips through every comparison guard.

## Question 36
**When would you choose `float` over `double` in a production system, and what's the risk?**

Choose `float` (binary32) when **memory bandwidth or footprint dominates**: large arrays/tensors (ML inference, GPU), where halving the size doubles cache efficiency and SIMD lane count; or embedded/DSP with limited memory. The risk is `float`'s ~7 significant digits — accumulation drifts fast, cancellation bites harder, and the `2^24` integer ceiling is low. Mitigation: **compute in `float`, accumulate in `double`** (mixed precision) — you get the bandwidth win on storage and the precision win on reductions. For most general business/backend code where data fits in memory, default to `double`; the extra 4 bytes prevents a class of bugs.

---

## Quick-fire round

**`NaN == NaN`?** → `false`. **Test NaN how?** → `isnan(x)` or `x != x`.
**`0.1 + 0.2 == 0.3`?** → `false`. **`0.0 == -0.0`?** → `true`. **`1/-0.0`?** → `-Inf`.
**Default rounding mode?** → nearest, ties-to-even. **`round(2.5)` in Python 3?** → `2`.
**Machine epsilon for double?** → `2^-52 ≈ 2.22e-16`. **Largest exact integer in double?** → `2^53`.
**Money in float?** → never; scaled integers or decimal. **Float→int out of range in C?** → undefined behavior.
**Compare floats how?** → combined relative+absolute tolerance or ULP, never `==`.
**FMA does what?** → `a*b+c` with one rounding. **`-ffast-math` breaks?** → NaN checks, Kahan, subnormals.
**x87 surprise?** → 80-bit intermediates change values when stored. **`%.17g` for?** → guaranteed round-trip print.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`tasks.md`](tasks.md).
- Sibling numerics topics: integer representation and overflow, fixed-point arithmetic, and decimal/arbitrary-precision types in the parent section.
