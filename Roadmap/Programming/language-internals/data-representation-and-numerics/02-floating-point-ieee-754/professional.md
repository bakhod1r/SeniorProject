# Floating-Point (IEEE 754) — Professional Level

> **Topic:** [Floating-Point (IEEE 754)](README.md)
> **Focus:** What floating point costs in production — the real incidents (Patriot, Ariane 5, Vancouver), money systems done right, debugging numerical drift in live services, performance (subnormals, vectorization, FTZ), and reproducibility across a fleet.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [War Stories](#war-stories)
6. [Real-World Analogies](#real-world-analogies)
7. [Mental Models](#mental-models)
8. [Code Examples](#code-examples)
9. [Trade-offs](#trade-offs)
10. [Use Cases](#use-cases)
11. [Coding Patterns](#coding-patterns)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Debugging Playbook](#debugging-playbook)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)
21. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At senior level you learned the machine reality beneath the standard. At professional level the question becomes operational: **what does a floating-point mistake cost in dollars, lives, or downtime — and how do you find it in a system that's already in production?** Floating point has killed people (28, in the Patriot incident), destroyed a $370M rocket 37 seconds after launch (Ariane 5), and silently bled a stock index from 1000 to 520 over 22 months (Vancouver). None of these were exotic bugs. Each was a *boring* float mistake — accumulated drift, an unchecked conversion, the wrong rounding mode — that a senior engineer reviewing the code could have caught in five minutes.

This level is about the discipline that prevents those incidents and the tooling that diagnoses them after the fact. The themes: **money must never touch binary floating point** (and what to use instead, in real billing systems); **accumulated error in long-running processes** (24/7 services, simulations, telemetry counters) and how to bound it; **reproducibility across a heterogeneous fleet** (different CPUs, compilers, and `libm`s producing different bits, breaking caching, consensus, and replay); and the **production debugging playbook** for "the numbers don't match" tickets — comparing against a reference, bisecting the drift, catching NaN at the source instead of three layers downstream where it surfaces.

You are now the person who writes the code-review comment "this sums `float` deltas in a long-lived accumulator — it will drift; use a periodic re-baseline or Kahan," and the person who, when finance reports a one-cent discrepancy across a million invoices, knows it's a rounding-mode mismatch and finds it before lunch.

---

## Prerequisites

- The [junior](junior.md), [middle](middle.md), and [senior](senior.md) levels — the entire conceptual stack: bit layout, ULP, cancellation, FMA, x87, fast-math, decimal FP, round-trip printing.
- Production experience: you've shipped a service, read a profiler flame graph, and debugged something that only failed at scale.
- Familiarity with a money/decimal type in your stack (`BigDecimal`, `decimal.Decimal`, `decimal` in SQL).

## Glossary

| Term | Meaning |
|------|---------|
| **Drift** | Slow accumulation of rounding error in a long-running computation or accumulator. |
| **Re-baselining** | Periodically recomputing an accumulated value from scratch to discard drift. |
| **Reference / oracle** | A trusted high-precision computation (bignum, double-double, decimal) to compare production output against. |
| **Reproducibility / bit-exactness** | Identical FP results across machines, compilers, and runs — required for consensus, caching, replay, lockstep. |
| **FTZ / DAZ** | Flush-To-Zero / Denormals-Are-Zero: MXCSR bits that snap subnormals to 0 for speed, sacrificing gradual underflow. |
| **Subnormal stall** | The 10-100× slowdown when the FPU hits a denormal operand on some hardware. |
| **Scaled integer (minor units)** | Storing money as an integer count of the smallest unit (cents, satoshis) for exact arithmetic. |
| **Banker's rounding** | Round-half-to-even; the IEEE default and common accounting choice (bias-free). |
| **Round-half-up** | The "school" / regulatory rounding used in many tax jurisdictions. |
| **Condition number** | How much a function amplifies input error; a high condition number means small input error → large output error. |
| **Catastrophic cancellation** | Loss of significance subtracting near-equal numbers (see middle level) — the root cause of Patriot and Vancouver. |
| **NaN poisoning** | A single NaN spreading through a computation, surfacing far from its origin. |

## Core Concepts

### 1. Money: the rules, and the systems that get it right

The rule is absolute: **never represent monetary amounts as binary `float`/`double`.** `0.10` is not representable; sums drift; `0.1 × 3 != 0.3`; and a one-cent error multiplied across millions of transactions is a real, auditable loss. The correct representations:

- **Scaled integers (minor units).** Store cents (or mills, or satoshis) as a 64-bit integer. `$10.99` → `1099`. Arithmetic is exact; you choose the rounding only at division (interest, splits, tax). This is what Stripe, most ledgers, and high-volume payment systems use. 64 bits of cents covers ~$92 quadrillion — enough.
- **Arbitrary-precision decimal.** `BigDecimal` (Java), `decimal.Decimal` (Python), `System.Decimal` (C#, 128-bit, 28-29 digits), `NUMERIC`/`DECIMAL` in SQL. Use when you need exact division, percentages, and many decimal places (FX rates, scientific billing). Slower than integers but exact in base 10.

Critical operational details:
- **Always set the rounding mode and scale explicitly** at every division/quantize step. The default differs by library and jurisdiction (HALF_EVEN for unbiased aggregates; HALF_UP for many tax authorities). An unspecified rounding mode is a latent bug.
- **The total must reconcile.** Splitting `$10.00` three ways is `$3.34 + $3.33 + $3.33` — the "largest remainder" allocation. Naive per-share rounding loses or invents a cent.
- **Store the currency with the amount.** `1099` is meaningless without "USD" (and its 2-decimal convention; JPY has 0, some currencies 3).
- **Never let a `double` into the path** — not even "temporarily for the percentage calc." That's exactly where the cent leaks.

### 2. Accumulated error in long-running systems

A 24/7 service that maintains a running floating-point total — a cumulative metric, a moving average, a physics integrator, a financial position in a (wrongly-chosen) double — accumulates rounding error that grows over time. The error of naive summation grows like `O(n·ε)` in the worst case and `O(√n·ε)` typically. Over a billion updates, even `√n·ε ≈ 3e4 × 2e-16 ≈ 6e-12` relative — usually fine, but **absorption** can make it far worse: once your accumulator dwarfs the increments, increments start vanishing entirely (`1e16 + 1.0 == 1e16`).

Defenses in production:
- **Re-baseline periodically.** Every N updates or every interval, recompute the aggregate from the source of truth and reset the accumulator. Discards all accumulated drift.
- **Compensated summation** (Kahan/Neumaier) for the running total — but beware fast-math deleting it (senior level).
- **Keep the accumulator in higher precision** than the inputs (sum `float` streams into a `double`, or `double` into a `double-double`).
- **For counters that must be exact, use integers.** A request counter is an `int64`, never a `double`.
- **Welford for running mean/variance** instead of summing `x` and `x²` separately (which cancels).

### 3. Reproducibility across a fleet

When does bit-exactness matter? Caching/memoization keyed on computed floats; deterministic replay (debugging, audit); lockstep simulation (multiplayer games, distributed physics); and **consensus** (a blockchain or a quorum that must agree on a computed value). On a heterogeneous fleet — Intel and AMD and ARM nodes, different `libm` versions, different compilers and flags — the same input can produce different floats (senior level: transcendentals, FMA contraction, x87, fast-math). Symptoms: a cache that never hits because the key drifts; a consensus round that can't reach quorum; a replay that diverges from the recording.

The professional answers, in order of preference:
1. **Don't put floats in the agreement path.** Use integers/fixed-point for anything that must match exactly across nodes. This is why serious financial and consensus systems avoid FP for the canonical value.
2. **If you must use floats, pin everything:** same compiler + flags (`-ffp-contract=off`, no fast-math, SSE2), and *vendor your own* transcendentals (a fixed polynomial, `crlibm`, or a pinned SLEEF) so `sin`/`exp` match.
3. **Round to a tolerance before the comparison** — quantize computed values to a coarser grid so platform jitter in the low bits doesn't matter (works for caching, not for consensus).

### 4. Performance: subnormals, vectorization, and FTZ

Floating-point *performance* problems in production are usually one of:
- **Subnormal stalls.** A decaying signal (audio reverb tail, a physics sim coming to rest, a leaky-integrator metric) produces denormalized numbers, and on many CPUs each denormal op costs 100+ cycles (microcode assist). A loop that ran at 2 GFLOPS suddenly runs at 0.02. The fix: enable **FTZ/DAZ** (`_MM_SET_FLUSH_ZERO_MODE`, `-ffast-math` includes it, or set MXCSR directly), accepting that gradual underflow is lost — almost always fine for audio/graphics/ML.
- **Failure to vectorize.** Strict IEEE ordering forbids the compiler from reassociating a reduction loop, so it can't use SIMD. `-ffp-contract=fast` + restricted reassociation (or `#pragma omp simd reduction`) unlocks 4-8× — at the cost of bit-reproducibility.
- **`double` vs `float` bandwidth.** In memory-bound kernels (large arrays, ML inference), `float` (or `bfloat16`/`fp16`) halves bandwidth and doubles SIMD lane count. Mixed precision: compute in `float`, accumulate in `double`.
- **Division and transcendentals are slow.** `1.0/x` is ~10-20 cycles; `sin`/`exp` are ~50-200. Reciprocal approximation + Newton, or a polynomial approximation, when the ULP budget allows.

### 5. Rounding-mode and conversion bugs at the boundary

Two production bug families that aren't about precision at all:
- **Float→int conversion.** `(int)x` truncates toward zero in C/Java; out-of-range conversions are **undefined behavior in C** (and were the Ariane 5 failure: a `double` velocity that fit in 64 bits was converted to a 16-bit integer, overflowed, and triggered an unhandled exception). `(int) 1e10` is UB in C; in Rust it saturates; in JS `| 0` wraps. Always range-check before narrowing.
- **Rounding-mode mismatch.** Two services computing the same total with different rounding modes (one HALF_EVEN, one HALF_UP) disagree by a cent on ~half the ties. This is the classic "finance and engineering don't reconcile" ticket. The fix is a single, documented, enforced rounding policy.

## War Stories

### Patriot missile, Dhahran, 1991 — accumulated drift killed 28

The MIM-104 Patriot's range gate computed where to look for the incoming Scud using time since boot. Time was tracked in tenths of a second in a **24-bit fixed-point register**. The constant `0.1` was stored as a 24-bit truncation of `0.0001100110011001100110011…`, off by about `9.5e-8` per tenth-second. The system had been running for **~100 hours** continuously; the accumulated error was about `0.34 seconds`. A Scud travels ~1,600 m/s, so a 0.34 s error placed the predicted intercept point ~570 meters off — outside the range gate. The Patriot didn't fire. The Scud hit a barracks; **28 soldiers died**. The Army knew about the bug and had a patch in transit; a reboot every few hours also masked it. The lesson: **drift in a long-running accumulation of an inexact constant is lethal; re-baseline or use exact representation.**

### Ariane 5 Flight 501, 1996 — a float→int overflow destroyed a $370M rocket

37 seconds after launch, the Ariane 5's inertial reference system (SRI) tried to convert a 64-bit floating-point **horizontal velocity** into a 16-bit signed integer. Ariane 5 flew a steeper, faster trajectory than Ariane 4, whose code this was reused from. The velocity value exceeded 32,767; the conversion **overflowed**, raised an unhandled Ada exception, and the SRI shut down. The backup SRI, running identical code, had failed the same way 72 milliseconds earlier. With no attitude reference, the rocket veered, aerodynamic forces tore it apart, and the self-destruct fired. The payload (four Cluster satellites) and the rocket — about **$370 million** — were lost. The conversion was *unprotected* because analysis had "proved" the Ariane 4 value couldn't overflow — and that analysis didn't carry to Ariane 5. The lesson: **range-check every narrowing conversion; reused proofs don't transfer to new envelopes.**

### Vancouver Stock Exchange index, 1982-1983 — truncation bled an index in half

The VSE launched a new index at 1000.000. It was recalculated thousands of times a day, and on each recalculation the result was **truncated** (rounded toward zero) to three decimals instead of rounded to nearest. Each truncation lost a tiny fraction — but applied ~3000 times a day for 22 months, the systematic downward bias compounded. The index, which should have been around 1098, read **520**. When corrected to proper rounding, it jumped overnight from 524.811 to 1098.892. The lesson: **a biased rounding mode applied many times produces a systematic, compounding error — this is exactly why IEEE 754's default is bias-free round-half-to-even.**

### Honorable mentions

- **Intel Pentium FDIV bug (1994):** a hardware division lookup table had missing entries; certain `double` divisions returned wrong results in the 5th significant digit. Cost Intel **$475M** in recalls. Lesson: even the *correctly-rounded* operations are only correct if the silicon is.
- **Knight Capital (2012):** not strictly FP, but a numerical/logic deployment error lost **$440M in 45 minutes**. Reminds you that numeric code paths need the same deployment rigor as anything else.

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Accumulated drift (Patriot) | A clock that loses a third of a second after running 100 hours — fine for a minute, fatal for a missile. |
| Float→int overflow (Ariane) | Pouring a gallon into a pint glass and being surprised it spills and shorts out the wiring. |
| Biased rounding (Vancouver) | A cashier who always rounds *down* to the house — invisible per transaction, a fortune over a year. |
| Re-baselining | Resetting a stopwatch against the wall clock every hour so it can't drift far. |
| FTZ for subnormal stalls | Rounding pocket change to zero so the cashier stops fumbling with pennies and the line moves. |
| Reproducibility across a fleet | Two accountants on different calculators must reach the same total to the cent, or the books don't close. |
| Money as integers | Counting in pennies, not dollars-and-fractions, so no fraction can ever go missing. |

## Mental Models

### "Inexact × many = systematic"

A single rounding is noise. The *same* inexact operation applied N times with a consistent bias becomes a *signal* — a drift you can plot. Patriot (truncated 0.1 × 360,000 ticks) and Vancouver (truncate × 3000/day × 660 days) are the same phenomenon. Whenever you see a loop or a long-lived accumulator doing an inexact step, ask: *is the error biased, and how many times does it repeat?* Bias × count is your error.

### "The boundary is where floats die"

Floating point is mostly safe in the *middle* of a computation. The disasters happen at the **boundaries**: float→int (Ariane), float→money (every billing bug), float→cache-key (reproducibility), float→`==` (junior bugs), float→serialized-string (round-trip). Audit boundaries, not interiors. At every type or system boundary a float crosses, there is a conversion, and the conversion is where the bug lives.

### "Catch NaN at the source, not the symptom"

In production, NaN surfaces three layers downstream from where it was born — a chart shows a gap, an alert fires on `NaN > threshold` being false, a sum becomes NaN. By then the origin is gone. The discipline: **assert finiteness at the boundaries** (after parsing, before storing, at module edges) so a NaN trips an alarm at its birthplace with a stack trace, not as a mysterious gap in a dashboard.

## Code Examples

### Money done right — scaled integers with correct splitting

```python
def split_evenly(total_cents: int, parts: int) -> list[int]:
    """Split an integer amount into `parts` shares that sum EXACTLY to total."""
    base, remainder = divmod(total_cents, parts)
    # distribute the leftover cents to the first `remainder` shares
    return [base + (1 if i < remainder else 0) for i in range(parts)]

shares = split_evenly(1000, 3)     # $10.00 / 3
print(shares, sum(shares))          # [334, 333, 333]  sum=1000  ✓ no cent lost
```

### Money with decimal and an explicit rounding policy

```python
from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN

def apply_tax(amount: Decimal, rate: Decimal, policy=ROUND_HALF_UP) -> Decimal:
    # quantize is the ONLY place rounding happens, and the mode is explicit
    return (amount * rate).quantize(Decimal('0.01'), rounding=policy)

print(apply_tax(Decimal('19.99'), Decimal('0.0825')))  # 1.65  (HALF_UP, regulatory)
```

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

BigDecimal subtotal = new BigDecimal("19.99");
BigDecimal taxRate  = new BigDecimal("0.0825");
BigDecimal tax = subtotal.multiply(taxRate)
                         .setScale(2, RoundingMode.HALF_UP);  // explicit, documented
```

### Bounding drift: re-baselining a long-running accumulator

```python
class RunningTotal:
    """A double accumulator that periodically re-baselines from the source of truth."""
    def __init__(self, rebaseline_every=100_000):
        self._sum = 0.0
        self._n = 0
        self._every = rebaseline_every
        self._history = []          # in real systems, the durable source of truth

    def add(self, x: float):
        self._sum += x
        self._history.append(x)
        self._n += 1
        if self._n % self._every == 0:
            self._sum = math.fsum(self._history)   # exact re-sum, discards drift

import math
```

> `math.fsum` (Python) is a correctly-rounded full-precision sum — a production-grade alternative to hand-rolled Kahan when you have all values in hand.

### Catch NaN/Inf at the boundary, not downstream

```python
import math

def ingest_metric(name: str, value: float) -> float:
    if not math.isfinite(value):                  # catches NaN AND ±Inf
        raise ValueError(f"non-finite metric {name!r}: {value!r}")
    return value
```

```go
import "math"

func ingest(name string, v float64) (float64, error) {
    if math.IsNaN(v) || math.IsInf(v, 0) {
        return 0, fmt.Errorf("non-finite metric %q: %v", name, v)
    }
    return v, nil
}
```

### Safe float→int narrowing (the Ariane lesson)

```rust
// Rust: `as` saturates (won't UB), but be explicit about intent.
fn to_i16_checked(x: f64) -> Result<i16, &'static str> {
    if !x.is_finite() { return Err("non-finite"); }
    let r = x.round();
    if r < i16::MIN as f64 || r > i16::MAX as f64 {
        return Err("out of range");   // the check Ariane 5 lacked
    }
    Ok(r as i16)
}
```

```c
#include <math.h>
#include <limits.h>
// In C, out-of-range float->int is UNDEFINED BEHAVIOR. Always range-check.
int safe_d2i(double x, int *out) {
    if (!isfinite(x)) return -1;
    double r = nearbyint(x);
    if (r < (double)INT_MIN || r > (double)INT_MAX) return -1;
    *out = (int)r;
    return 0;
}
```

### Enabling FTZ/DAZ to kill subnormal stalls

```c
#include <pmmintrin.h>   // SSE3
// Call once per thread before the hot loop.
void enable_ftz_daz(void) {
    _MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON);       // subnormal results -> 0
    _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON); // subnormal inputs -> 0
}
```

### A reproducibility check across machines

```python
import struct, hashlib

def fp_fingerprint(values) -> str:
    """Hash the exact bit patterns so two machines can compare results."""
    h = hashlib.sha256()
    for v in values:
        h.update(struct.pack('>d', v))   # exact 8 bytes, not a decimal string
    return h.hexdigest()
# If two nodes disagree on this hash, the FP results diverged (FMA/libm/fast-math).
```

## Trade-offs

| You gain... | ...at the cost of... |
|-------------|----------------------|
| Scaled-integer money (exact) | Manual scale/currency handling; integer overflow at extreme magnitudes |
| Decimal money (exact, divisible) | 5-50× slower than binary FP; larger storage |
| Re-baselining accumulators | Extra recompute cost; needs a durable source of truth |
| FTZ/DAZ (no subnormal stalls) | Loses gradual underflow; changes results near zero |
| Vectorized reductions (fast) | Non-deterministic low bits; not bit-reproducible |
| Bit-reproducible FP | Vendored libm, no FMA/fast-math, big engineering cost, slower |
| Boundary NaN assertions | Slight overhead; must be placed at every edge |

## Use Cases

- **Billing / ledgers / accounting** → scaled integers (cents) as the canonical store; decimal for tax/FX/percentage math; explicit rounding policy enforced everywhere.
- **24/7 metrics & telemetry** → integer counters for exact counts; `double` accumulators with periodic re-baselining for rates/averages; Welford for variance.
- **Multiplayer lockstep / blockchain consensus** → fixed-point or integers in the agreement path; no transcendentals; never raw `double`.
- **Audio / DSP / real-time** → FTZ/DAZ to dodge subnormal stalls; `float` for bandwidth; watch decaying tails.
- **ML inference / HPC** → mixed precision (compute `float`/`bf16`, accumulate `double`), vectorized reductions, accepting non-determinism.
- **Geospatial / simulation** → `double` minimum; watch cancellation in coordinate subtraction (use local origins / offset coordinates).

## Coding Patterns

### 1. The "money type" wrapper

Wrap minor-unit integers in a type so a `double` can never accidentally enter:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Money:
    cents: int
    currency: str = "USD"
    def __add__(self, o): assert self.currency == o.currency; return Money(self.cents + o.cents, self.currency)
    def __str__(self): return f"{self.cents/100:.2f} {self.currency}"   # display only
```

### 2. Assert-finite boundary guards

Place `assert math.isfinite(x)` (or a raising check) at: after deserialization, before persistence, at API boundaries, and after any division. The cost is negligible; the diagnostic value is enormous.

### 3. Reference-oracle differential testing

For a critical numerical routine, compute the same thing two ways — production (`double`) and oracle (decimal / mpmath / double-double) — and assert they agree to a documented ULP/relative bound in CI. Catches algorithm regressions and platform drift.

### 4. Quantize-before-key for FP caches

```python
def cache_key(x: float) -> int:
    return round(x * 1e6)   # quantize to 1e-6 grid; platform jitter in low bits won't break the key
```

### 5. Local-origin coordinates to avoid cancellation

In geo/CAD, subtract a local origin from world coordinates *before* doing math, so you're not computing differences of two ~6,378,000 m numbers (which cancels to noise at `float` precision).

## Best Practices

- **Money: scaled integers or decimal, never binary float.** One enforced, documented rounding policy across every service. Store currency with amount.
- **Range-check every float→int (and double→float) narrowing.** Out-of-range is UB in C and a silent wrap/saturate elsewhere — both are bugs.
- **Assert finiteness at boundaries.** Catch NaN/Inf where it's born, with a stack trace.
- **Bound drift in long-lived accumulators:** re-baseline, compensate, or keep integers for exact counts.
- **For cross-fleet agreement, keep floats out of the consensus path.** If you can't, pin compiler/flags and vendor your `libm`.
- **Profile for subnormal stalls** in audio/DSP/physics; enable FTZ/DAZ on the hot path with eyes open.
- **Differential-test critical numerics against a high-precision oracle** in CI.
- **Pick the rounding mode deliberately** (HALF_EVEN for unbiased aggregates, HALF_UP for many regulators) and *write down why*.
- **Reconcile totals, don't round shares independently** — use largest-remainder allocation.

## Edge Cases & Pitfalls

- **A `double` accumulator that grows past `2^53`** stops counting small increments (absorption); your "total" silently freezes.
- **Out-of-range `(int)double` is UB in C/C++** — sanitizers catch it; production may not.
- **`-ffast-math` in a dependency** sets FTZ/DAZ process-wide, changing *your* subnormal results.
- **Two microservices, two rounding modes** → off-by-a-cent reconciliation failures on ties.
- **NaN in a sort comparator** corrupts ordering or throws "comparison contract violated."
- **`float` GPS/geo coordinates** lose ~1 m precision; differences cancel to garbage — use `double` + local origins.
- **`JSON.parse`/serialization not round-tripping** if you wrote with `%g` instead of shortest-round-trip.
- **JavaScript integer IDs over `2^53`** (`Number`) silently collide — use `BigInt` or strings for snowflake IDs.
- **Time as accumulated float seconds** drifts (Patriot) — accumulate integer ticks, convert at the edge.
- **Division by a value that can be `±0.0`** yields `±Inf` that poisons downstream silently.

## Common Mistakes

1. **Money in `double`** "because it's just a prototype" — prototypes ship.
2. **Unprotected float→int narrowing** — the Ariane class of bug, still common.
3. **Truncating instead of rounding** a value computed many times — the Vancouver class, a systematic bias.
4. **Long-running `double` accumulator** with no re-baseline — drifts, or freezes via absorption.
5. **Discovering NaN three layers downstream** because nobody asserted finiteness at the source.
6. **Assuming all fleet nodes compute identical floats** — they don't (FMA, libm, flags).
7. **Independent per-share rounding** that loses or invents a cent.
8. **Leaving a rounding mode unspecified**, inheriting a library/jurisdiction default nobody chose.
9. **Ignoring subnormal stalls** until a customer reports the audio plugin dropping frames.
10. **Storing 64-bit IDs as `double`/`Number`** and getting silent collisions above `2^53`.

## Debugging Playbook

When a ticket says "the numbers are wrong / don't match / show NaN":

1. **Reproduce with exact bits.** Print/log `%.17g` or the raw 8-byte hex, not the friendly decimal. The friendly printer hides the discrepancy.
2. **Localize the NaN/Inf.** Add finiteness asserts at module boundaries and bisect inward until the assert fires at the birthplace. Or run with FP exception trapping (`feenableexcept(FE_INVALID | FE_DIVBYZERO)`) to trap at the producing instruction.
3. **Diff against an oracle.** Recompute with `decimal`/`mpmath`/double-double. Where production and oracle first diverge is your cancellation or absorption site.
4. **For "matches on my machine, not in prod":** suspect FMA contraction, `libm`, fast-math, or x87. Compare build flags and CPU. Hash the bit patterns (fingerprint) on each node.
5. **For drift:** plot the error over time/iterations. Linear growth → biased step (truncation, like Vancouver). `√n` growth → unbiased accumulation. A sudden freeze → absorption past `2^53`.
6. **For money discrepancies:** check the rounding mode and scale at *every* division/quantize; check share-splitting reconciles; check no `double` snuck into the path.
7. **For float→int crashes/garbage:** check the range before the cast; enable UBSan (`-fsanitize=float-cast-overflow`).
8. **Confirm the fix with a regression test** that pins the exact bits or asserts the ULP/relative bound — so the drift can't silently return.

## Test Yourself

1. A service keeps a running `double` sum of per-event latencies, billions of events. What goes wrong, and what are three fixes?
2. Reproduce the Vancouver bug: compute an index updated 3000×/day for 600 days with truncation vs round-to-nearest. How far do they diverge?
3. Write a `Money` type that makes it a *compile/type error* to add a `double` to it.
4. Split `$100.00` among 7 people so the shares sum to exactly `$100.00`. Show the allocation.
5. Cause a float→int overflow that's UB in C and observe it under `-fsanitize=float-cast-overflow`.
6. Two nodes compute `sum(sin(x_i))` over the same data on Intel vs ARM. Why might the hashes differ, and how do you make them match?
7. Generate subnormals in a decaying loop, measure the slowdown, then enable FTZ and measure again.
8. Build a finiteness-assert boundary guard and show it catches a NaN at its source instead of three functions later.

## Cheat Sheet

```text
┌─────────────────────────────────────────────────────────────────────┐
│           FLOATING-POINT — PROFESSIONAL CHEAT SHEET                 │
├─────────────────────────────────────────────────────────────────────┤
│ MONEY: scaled integers (cents) or decimal. NEVER binary float.     │
│   one enforced rounding policy | store currency | split reconciles  │
├─────────────────────────────────────────────────────────────────────┤
│ THE BOUNDARY IS WHERE FLOATS DIE — audit every:                    │
│   float→int (range-check! Ariane)   float→money (cent leak)        │
│   float→== (junior)                 float→cache-key (drift)        │
│   float→string (round-trip)         float→time-accum (Patriot)     │
├─────────────────────────────────────────────────────────────────────┤
│ DRIFT in long-running accumulators:                                │
│   linear error growth → BIASED step (truncation) → Vancouver       │
│   √n growth          → unbiased accumulation                      │
│   sudden freeze      → ABSORPTION past 2^53                        │
│   fixes: re-baseline | Kahan/fsum | integers for exact counts      │
├─────────────────────────────────────────────────────────────────────┤
│ REPRODUCIBILITY across fleet: keep floats OUT of consensus path.   │
│   else pin flags (no FMA/fast-math, SSE2) + vendor libm            │
├─────────────────────────────────────────────────────────────────────┤
│ PERF: subnormal stalls → FTZ/DAZ | vectorize reductions (non-det)  │
│       float for bandwidth, accumulate in double                    │
├─────────────────────────────────────────────────────────────────────┤
│ DEBUG: print %.17g/hex | trap FE_INVALID | diff vs oracle |        │
│        assert isfinite at boundaries | hash bits across nodes      │
├─────────────────────────────────────────────────────────────────────┤
│ INCIDENTS: Patriot (drift, 28 dead) | Ariane 5 (f→int, $370M) |    │
│            Vancouver (truncation bias) | Pentium FDIV ($475M)       │
└─────────────────────────────────────────────────────────────────────┘
```

## Summary

- **Money never touches binary float.** Use scaled integers (minor units) as the canonical store and arbitrary-precision decimal for division/tax/FX, with one enforced, documented rounding policy and reconciling share allocation.
- **The boundary is where floats die:** float→int (range-check it — the Ariane 5 lesson), float→money, float→cache-key, float→`==`, float→string. Audit conversions, not interiors.
- **Long-running accumulators drift** — linearly if the step is biased (Vancouver truncation), like `√n` if unbiased, and they *freeze* once the total dwarfs the increments (absorption past `2^53`). Re-baseline, compensate, or use integers.
- **Accumulated inexact constants are lethal:** the Patriot's truncated `0.1 × 360,000 ticks` drifted 0.34 s over 100 hours and killed 28 people. Re-baseline or represent time exactly.
- **Reproducibility across a heterogeneous fleet** is hard because FMA, `libm`, and fast-math make the same input yield different bits — keep floats out of the consensus path, or pin flags and vendor your math.
- **Performance** problems are usually subnormal stalls (fix with FTZ/DAZ), failure to vectorize reductions (fix with controlled reassociation, losing determinism), or `double` bandwidth (use `float`, accumulate in `double`).
- **Debug numerics with exact bits** (`%.17g`/hex), an FP-exception trap or finiteness asserts to localize NaN at its source, and a high-precision oracle to bisect drift.
- The historical disasters — Patriot, Ariane 5, Vancouver, Pentium FDIV — were all *boring* float mistakes that review and the disciplines above would have caught.

## Further Reading

- *GAO Report IMTEC-92-26: Patriot Missile Defense — Software Problem Led to System Failure at Dhahran* — the official Patriot analysis.
- J.L. Lions et al., *Ariane 5 Flight 501 Failure: Report by the Inquiry Board*, 1996 — the canonical post-mortem.
- *The Vancouver Stock Exchange* — Toronto Star / IEEE write-ups on the index-truncation error.
- Michael Eisenstein / Intel, *Statistical Analysis of the Pentium FDIV bug* and Cleve Moler's account.
- David Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic* — still the foundation.
- Martin Fowler, *Patterns of Enterprise Application Architecture* — the *Money* pattern.
- Douglas Crockford and others on JavaScript's `Number`/`2^53` integer limit and `BigInt`.
- Stripe / Square engineering blogs on integer-minor-unit money handling.
- Python `math.fsum` docs and Raymond Hettinger's accurate-summation recipes.

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling numerics topics: integer overflow and two's complement, fixed-point arithmetic, decimal/arbitrary-precision types, and number parsing/formatting in the parent section.

## Diagrams & Visual Aids

### Drift signatures over time

```text
   error
     │                                   ╱ linear  → BIASED step (truncation)
     │                                 ╱             Vancouver, Patriot
     │                              ╱
     │                        ___╱── √n  → unbiased accumulation
     │                  __───
     │            __───
     │      __───                ────────  flat then FREEZE → absorption past 2^53
     │__───            ─────────
     └──────────────────────────────────────────────► iterations / time
```

### The Ariane 5 conversion

```text
   64-bit double horizontal velocity  =  (Ariane 5: larger than Ariane 4)
                    │
                    │  unprotected conversion
                    ▼
   16-bit signed integer  ── value > 32767 ──► OVERFLOW
                    │
                    ▼
   unhandled Ada exception ─► SRI shuts down ─► (backup already dead) ─► loss

   The missing box:  if (v < -32768 || v > 32767) handle_gracefully();
```

### Money: where the cent leaks

```text
   $10.00 split 3 ways

   WRONG (independent rounding):        RIGHT (largest-remainder):
   10.00/3 = 3.333... → round 3.33      base = 333, remainder = 1
   ×3 = 9.99  ← lost a cent!            shares = [334, 333, 333]
                                        sum = 1000  ✓ exact
```

### Catch NaN at the source, not the symptom

```text
   parse() → transform() → aggregate() → store() → dashboard
      │                                                 │
      │ NaN born here                         shows up here (3 layers later)
      ▼                                                 ▼
   assert isfinite()  ← guard at EACH boundary    "why is the chart blank?"
   trips with a stack trace at the birthplace      (origin already gone)
```

### Subnormal performance cliff

```text
   throughput
     │ ████████████████████  normal range: ~2 GFLOPS
     │                     │
     │                     ▼ values decay below 2^-1022
     │                     ░░░  subnormal range: ~0.02 GFLOPS (100× slower)
     │
     │  with FTZ/DAZ: ████████████████████████  flushed to 0, stays fast
     └──────────────────────────────────────────► value magnitude →
```
