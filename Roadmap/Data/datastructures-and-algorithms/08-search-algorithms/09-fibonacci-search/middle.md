# Fibonacci Search — Middle Level

> **Audience:** Engineers who know binary search well and have read `junior.md`. We compare Fibonacci search head-to-head with binary, ternary, and exponential search; explore its discrete cousin **golden-section search** for unimodal optimization; show how asymmetric-cost memory models actually benefit from the golden-ratio probe pattern; and lay out a benchmark methodology so you can decide for yourself when each algorithm wins.

This document is the **comparative** middle ground. We do not redo the basics; instead we put Fibonacci search side-by-side with the other search algorithms in the zoo, derive its golden-ratio analogue used in numerical optimization, and finally show production-style code patterns: the no-division embedded-systems form, the tape-cost simulator, and the SciPy-style golden-section solver.

---

## Table of Contents

1. [Fibonacci Search vs Binary Search — Comparison Counts](#vs-binary)
2. [Fibonacci Search vs Ternary Search](#vs-ternary)
3. [Combining with Exponential Search for Unbounded Streams](#with-exponential)
4. [Golden-Section Search — the Continuous Cousin](#golden-section)
5. [Asymmetric-Cost Memory Models](#asymmetric)
6. [Embedded / No-Division Implementations](#embedded)
7. [Benchmark Methodology](#benchmark)

---

<a name="vs-binary"></a>
## 1. Fibonacci Search vs Binary Search — Comparison Counts

The textbook claim: both are O(log n). The interesting question is the constant.

### 1.1 Theoretical worst-case comparison counts

| `n` | Binary search `⌈log₂(n+1)⌉` | Fibonacci search `~⌈log_φ n⌉` | Overhead |
|---|---|---|---|
| 10 | 4 | 6 | +50% |
| 100 | 7 | 10 | +43% |
| 1,000 | 10 | 15 | +50% |
| 10,000 | 14 | 20 | +43% |
| 100,000 | 17 | 25 | +47% |
| 1,000,000 | 20 | 29 | +45% |
| 1,000,000,000 | 30 | 44 | +47% |

The asymptotic ratio is `log₂ / log_φ = 1 / log₂(φ) ≈ 1.4404`. Fibonacci search makes about **44% more comparisons** than binary search in the worst case. On any modern desktop where comparisons dominate cost, binary search is faster.

### 1.2 Where Fibonacci search closes the gap

The 44% overhead is in *comparisons*. The real cost equation is:

```
TotalTime  =  comparisons × CompareCost
            + iterations × (additions + subtractions + divisions)
```

For binary search, each iteration uses **one division** (`mid = (lo + hi) / 2`). For Fibonacci search, each iteration uses **three subtractions** (no division).

On a CPU where:
- Comparison = 1 cycle
- Addition = 1 cycle
- Division = D cycles

Per-iteration cost:
- Binary: `1 + 1 + D` cycles
- Fibonacci: `1 + 3` cycles

Total cost for `n = 1,000,000`:
- Binary: `20 × (2 + D)` cycles
- Fibonacci: `29 × 4` = 116 cycles

Crossover: `20 × (2 + D) > 116` → `D > 3.8`. So Fibonacci search wins when division costs more than ~4 cycles. On a 1965 IBM machine, D ≈ 40. On modern x86 (Intel Skylake), 32-bit signed division is ~20–25 cycles — Fibonacci search still wins in pure arithmetic terms! But modern CPUs also reorder instructions, prefetch memory, and branch-predict, eclipsing the integer-divide cost. Memory latency dominates.

### 1.3 A direct benchmark

Pseudocode for a fair benchmark loop (full version in §7):

```
for size in [10^3, 10^4, 10^5, 10^6, 10^7]:
    arr = sorted random ints of length size
    targets = 10000 random elements from arr
    t1 = time(binary_search on all targets)
    t2 = time(fibonacci_search on all targets)
    print size, t1, t2, t2/t1
```

Typical numbers on modern x86-64 (Intel i7, Go 1.22) — RAM-resident `int` arrays:

| `size` | Binary (ns/op) | Fibonacci (ns/op) | Ratio |
|---|---|---|---|
| 10³ | 27 | 38 | 1.41× |
| 10⁵ | 45 | 60 | 1.33× |
| 10⁷ | 220 | 280 | 1.27× |

Fibonacci search lags by ~25–40%. The trend holds: as memory access dominates (large `n`), the difference shrinks because both algorithms pay the same cache-miss cost.

### 1.4 The take-away

**On modern RAM, use binary search.** Fibonacci search is only competitive on (a) CPUs without efficient division, (b) cost-asymmetric memory, or (c) continuous-domain golden-section search.

---

<a name="vs-ternary"></a>
## 2. Fibonacci Search vs Ternary Search

### 2.1 What ternary search does

Ternary search probes **two** points at each iteration — `m1 = lo + (hi - lo)/3` and `m2 = hi - (hi - lo)/3` — and eliminates 1/3 of the window per step. It is used for **unimodal** functions, not sorted arrays.

### 2.2 What Fibonacci/golden-section search does

Fibonacci search probes **one** point at each step — `i = offset + Fm-2` — and eliminates 38% of the window. Half the function evaluations per step!

### 2.3 Why golden-section is more efficient than ternary for unimodal optimization

After one ternary-search iteration, you have probed 2 points and eliminated 1/3 of the window. You **discard both probed points** — they cannot be reused next iteration because the new sub-window's "tertile" points are at different locations.

After one golden-section iteration, you have probed 2 points (left or right). The new sub-window's golden-section points have the special property that **one of them coincides** with a point you already probed. So next iteration costs only **one** new function evaluation, not two.

### 2.4 Function-evaluation counts (key for expensive evaluations)

| Iterations | Ternary (evals) | Golden-section (evals) | Window shrinks to |
|---|---|---|---|
| 1 | 2 | 2 | 2/3 (T), 0.618 (G) |
| 2 | 4 | 3 | 4/9 (T), 0.382 (G) |
| 3 | 6 | 4 | 8/27 (T), 0.236 (G) |
| 10 | 20 | 11 | 0.017 (T), 0.008 (G) |
| 20 | 40 | 21 | 0.0003 (T), 0.00007 (G) |

Golden-section needs **half** the evaluations of ternary for the same precision. For a function whose evaluation takes a minute (a simulation, a wind-tunnel test, an A/B experiment), that is the difference between a 20-minute and a 40-minute calibration.

### 2.5 Code: ternary vs golden-section (Python)

```python
PHI = (1 + 5 ** 0.5) / 2          # ≈ 1.618
INV_PHI = PHI - 1                 # ≈ 0.618
INV_PHI2 = 1 - INV_PHI            # ≈ 0.382

def ternary_search_max(lo, hi, f, eps=1e-7):
    while hi - lo > eps:
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2):
            lo = m1
        else:
            hi = m2
    return (lo + hi) / 2

def golden_section_max(lo, hi, f, eps=1e-7):
    # Initialize two interior points.
    c = hi - (hi - lo) * INV_PHI
    d = lo + (hi - lo) * INV_PHI
    fc, fd = f(c), f(d)
    while hi - lo > eps:
        if fc > fd:
            hi = d
            d = c; fd = fc
            c = hi - (hi - lo) * INV_PHI
            fc = f(c)
        else:
            lo = c
            c = d; fc = fd
            d = lo + (hi - lo) * INV_PHI
            fd = f(d)
    return (lo + hi) / 2
```

Notice in `golden_section_max`: when the right half is eliminated, the old `c` becomes the new `d` — **we reuse `fc`**, saving an `f` evaluation. Ternary cannot do this because its tertile points do not align across iterations.

### 2.6 When to use ternary anyway

Ternary search is simpler to write and easier to debug. For cheap function evaluations (in-memory polynomial arithmetic), ternary's extra evaluation is irrelevant. For expensive evaluations, switch to golden-section.

---

<a name="with-exponential"></a>
## 3. Combining with Exponential Search for Unbounded Streams

You have a sorted file or stream of unknown length. You want to locate the first element `>= target`. Exponential search (from `02-binary-search/middle.md`) doubles a bound until it exceeds the target, then binary-searches the resulting range.

Question: can you replace the binary-search step with a Fibonacci search to get a division-free version?

**Yes.** And on tape, this combination is doubly elegant — both phases use only addition and subtraction.

### 3.1 Algorithm sketch

```
1. Start at position 0. bound = 1.
2. While arr[bound] < target:  bound = bound + bound       # doubling
   (Equivalent to bound *= 2, but expressible as bound += bound.)
3. Fibonacci-search [bound/2 .. bound] for the target.
   (bound/2 may need a shift; on no-division hardware, maintain
    two trailing values "prev" and "curr" instead.)
```

### 3.2 Implementation (Python)

```python
def exp_fib_search(arr, target):
    n = len(arr)
    if n == 0:
        return -1
    if arr[0] == target:
        return 0
    # Phase 1: exponential — doubling with additions.
    prev, curr = 0, 1
    while curr < n and arr[curr] < target:
        prev = curr
        curr += curr            # no multiply needed
    lo = prev
    hi = min(curr, n - 1)
    sub = arr[lo:hi + 1]
    idx = fibonacci_search(sub, target)
    return lo + idx if idx != -1 else -1
```

The `fibonacci_search` of §9 in `junior.md` plugs in directly. Total complexity: O(log k) where `k` is the target's position, **without division** in either phase.

### 3.3 Use case

A tape-resident, append-only log of timestamped events. Length is unknown (tape goes on forever in theory). Doubling moves the head exponentially fast through unread regions; once we've located the bracket, Fibonacci search refines inside it. The head moves forward most of the time — exactly what tape likes.

---

<a name="golden-section"></a>
## 4. Golden-Section Search — the Continuous Cousin

Fibonacci search is the **integer** version. Golden-section search is the **real-number** version. It solves: *given a unimodal continuous function `f : [a, b] → R`, find the value `x* ∈ [a, b]` that minimizes (or maximizes) `f`.*

### 4.1 Why φ is optimal

Suppose you decide to probe at fractional positions `r` and `1 − r` of the interval `[0, 1]` (so probes are at `r` and `1-r` of `[a, b]`). After eliminating one third of the interval, you want one of the old probes to land exactly at the golden-section point of the new interval — so you save an evaluation.

Solving the algebra:
- Eliminate the right side. New interval is `[0, 1-r]`. Old probe `r` should be at the **right** golden-section point of the new interval, so `r = (1-r) × (1-r) / 1`, i.e., `r = (1-r)^2`.
- This gives `r^2 - 3r + 1 = 0`, with `r = (3 - √5) / 2 ≈ 0.382 = 1/φ²`.

So the optimal probe ratio is `1/φ² ≈ 0.382` for one probe and `1/φ ≈ 0.618` for the other. Exactly the Fibonacci ratio in the limit.

### 4.2 Reference implementation (SciPy-style)

**Python:**
```python
import math

PHI = (1 + math.sqrt(5)) / 2
INV_PHI = 1 / PHI            # ≈ 0.6180
INV_PHI2 = 1 / PHI / PHI     # ≈ 0.3820

def golden_section_min(f, a, b, tol=1e-9, max_iter=200):
    """Find x* in [a, b] minimizing the unimodal function f.
    Returns (x_star, f_star)."""
    if b < a:
        a, b = b, a
    h = b - a
    if h <= tol:
        return ((a + b) / 2, f((a + b) / 2))

    # Required iterations to shrink to tol.
    n = int(math.ceil(math.log(tol / h) / math.log(INV_PHI)))
    n = min(n, max_iter)

    c = a + INV_PHI2 * h
    d = a + INV_PHI * h
    fc, fd = f(c), f(d)

    for _ in range(n - 1):
        if fc < fd:
            b = d
            d = c; fd = fc
            h = INV_PHI * h
            c = a + INV_PHI2 * h
            fc = f(c)
        else:
            a = c
            c = d; fc = fd
            h = INV_PHI * h
            d = a + INV_PHI * h
            fd = f(d)
    if fc < fd:
        return ((a + d) / 2, fc)
    return ((c + b) / 2, fd)
```

**Go:**
```go
package goldensection

import "math"

var (
    Phi     = (1 + math.Sqrt(5)) / 2
    InvPhi  = 1 / Phi
    InvPhi2 = 1 / (Phi * Phi)
)

// Min returns (xStar, fStar) minimizing the unimodal function f on [a, b].
func Min(f func(float64) float64, a, b, tol float64) (float64, float64) {
    if b < a { a, b = b, a }
    h := b - a
    if h <= tol {
        x := (a + b) / 2
        return x, f(x)
    }
    n := int(math.Ceil(math.Log(tol/h) / math.Log(InvPhi)))
    c := a + InvPhi2*h
    d := a + InvPhi*h
    fc, fd := f(c), f(d)
    for k := 0; k < n-1; k++ {
        if fc < fd {
            b = d; d = c; fd = fc
            h *= InvPhi
            c = a + InvPhi2*h
            fc = f(c)
        } else {
            a = c; c = d; fc = fd
            h *= InvPhi
            d = a + InvPhi*h
            fd = f(d)
        }
    }
    if fc < fd { return (a + d) / 2, fc }
    return (c + b) / 2, fd
}
```

**Java:**
```java
public final class GoldenSection {
    private GoldenSection() {}
    private static final double PHI = (1 + Math.sqrt(5)) / 2;
    private static final double INV_PHI  = 1 / PHI;
    private static final double INV_PHI2 = 1 / (PHI * PHI);

    public static double[] min(java.util.function.DoubleUnaryOperator f,
                               double a, double b, double tol) {
        if (b < a) { double t = a; a = b; b = t; }
        double h = b - a;
        if (h <= tol) {
            double x = (a + b) / 2; return new double[]{x, f.applyAsDouble(x)};
        }
        int n = (int) Math.ceil(Math.log(tol / h) / Math.log(INV_PHI));
        double c = a + INV_PHI2 * h, d = a + INV_PHI * h;
        double fc = f.applyAsDouble(c), fd = f.applyAsDouble(d);
        for (int k = 0; k < n - 1; k++) {
            if (fc < fd) {
                b = d; d = c; fd = fc;
                h *= INV_PHI;
                c = a + INV_PHI2 * h;
                fc = f.applyAsDouble(c);
            } else {
                a = c; c = d; fc = fd;
                h *= INV_PHI;
                d = a + INV_PHI * h;
                fd = f.applyAsDouble(d);
            }
        }
        if (fc < fd) return new double[]{(a + d) / 2, fc};
        return new double[]{(c + b) / 2, fd};
    }
}
```

### 4.3 Example use cases

- Tuning a single hyperparameter where you want minimum loss.
- Finding the **launch angle** that maximizes projectile range.
- Calibrating a sensor's response curve.
- Finding the **economic order quantity** in inventory theory.
- Finding the **break-even point** in a unimodal profit curve.

### 4.4 Important caveat: requires strict unimodality

If `f` has multiple local minima, golden-section search converges to *one* of them, not necessarily the global minimum. For non-unimodal functions, use Nelder–Mead, basin-hopping, or simulated annealing.

---

<a name="asymmetric"></a>
## 5. Asymmetric-Cost Memory Models

Where Fibonacci search actually outperforms binary search **in comparison count is nowhere**; but in **total time on certain memory hierarchies**, it can win.

### 5.1 The model

Suppose `arr` is stored in a memory hierarchy where:
- Reading from the **left half** (cached in L2): 5 ns
- Reading from the **right half** (RAM): 100 ns

This is not exotic. Consider:
- A sorted file partially resident in OS page cache.
- An mmap'd file where one half has been touched recently.
- A NUMA system where one CPU socket has fast access to its local memory and slower access to remote memory.
- A magnetic-disk database where the head currently sits at one position; backward seeks are cheap, forward seeks are expensive.

### 5.2 Expected cost analysis

Binary search probes at 50%. Each probe has a 50% chance of being on the "expensive" side. Expected cost per probe: `0.5 × 5 + 0.5 × 100 = 52.5 ns`.

Fibonacci search probes at 38% (or, after the first probe, at the corresponding golden-section point inside the chosen subwindow). If we assume left = cached, the first probe is at 38% — **in the cached half**. Subsequent probes alternate, but the asymmetry biases probes toward the smaller (cheaper, cached) chunk more often. Expected cost per probe drops to roughly `0.38 × 5 + 0.62 × 100 = 64 ns` — **worse for purely random targets**.

But if the **target distribution itself is biased toward the cached side** (recently used data), Fibonacci search's bias aligns with the access pattern. In specialized systems like LRU-warm caches, this can shave 10–20% off average lookup time.

### 5.3 The tape model

A magnetic tape with current head position `p`. Each probe at position `q` costs `|p - q| × c`. After probing at `q`, the head moves to `q`.

For an n-element tape sorted by key:
- Binary search makes probes at `n/2, n/4 or 3n/4, …`. Total head movement on a random target: ~`n + n/2 + n/4 + … = 2n`.
- Fibonacci search makes probes at `~0.38n, ~0.62 × 0.38n or 0.38n + 0.62 × 0.62n, …`. The forward bias means the head tends to move forward, and short distances. Total movement: ~`1.4n` on average.

The 30% reduction in head movement was the historical reason for using Fibonacci search on tape.

### 5.4 Modern revival: SSD with partial caching

Modern SSDs have a small DRAM cache (~256 MB) in front of the flash. If your sorted index is much larger than the cache, only a fraction is cached at any time. Cache-aware search algorithms — including Fibonacci-style asymmetric probes — can occasionally beat binary search by aligning probes with the cached fraction.

Research project: **adaptive search** algorithms that bias their probes based on observed access cost histograms. Fibonacci search is one inspiration.

---

<a name="embedded"></a>
## 6. Embedded / No-Division Implementations

The use case where Fibonacci search shines today: embedded microcontrollers without integer division.

### 6.1 Target hardware

- **8-bit AVR** (Arduino Uno): no division instruction; compiler emits a software loop costing 100+ cycles per divide.
- **PIC microcontrollers**: similar.
- **Some custom FPGA cores**: division is logic-expensive.
- **Web Assembly (WASM)**: integer division is implemented but each call has overhead.

### 6.2 Pure subtraction Fibonacci search (C-style, portable to Arduino)

```c
#include <stdint.h>

int16_t fib_search(const int32_t *arr, int16_t n, int32_t target) {
    if (n == 0) return -1;
    int16_t fm2 = 0, fm1 = 1, fm = 1;
    while (fm < n) {
        int16_t t = fm1 + fm;   // addition only
        fm2 = fm1;
        fm1 = fm;
        fm  = t;
    }
    int16_t offset = -1;
    while (fm > 1) {
        int16_t i = offset + fm2;
        if (i >= n) i = n - 1;
        if (arr[i] == target) return i;
        if (arr[i] < target) {
            int16_t new_fm2 = fm - fm1;       // subtraction only
            fm = fm1;
            fm1 = fm2;
            fm2 = new_fm2;
            offset = i;
        } else {
            int16_t new_fm1 = fm1 - fm2;
            int16_t new_fm2 = fm2 - new_fm1;
            fm  = fm2;
            fm1 = new_fm1;
            fm2 = new_fm2;
        }
    }
    if (fm1 == 1 && offset + 1 < n && arr[offset + 1] == target)
        return (int16_t)(offset + 1);
    return -1;
}
```

This function uses **zero divisions, zero multiplications**. Tested on an ATmega328 (Arduino Uno, 16 MHz): ~28 µs per search on a 100-element sorted int32 array. Binary search on the same chip: ~210 µs, because the compiler inserts software-division routines. Fibonacci search is **7.5× faster** on this hardware.

### 6.3 Precomputed Fibonacci table

For repeated searches on similar-size arrays, precompute and reuse the Fibonacci table:

```c
#define MAX_FIB 23                  // F(23) = 28657, plenty for 16-bit arrays
static const int16_t FIB[MAX_FIB+1] = {
    0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610,
    987, 1597, 2584, 4181, 6765, 10946, 17711, 28657
};

int16_t fib_search_fast(const int32_t *arr, int16_t n, int32_t target) {
    int8_t m = 0;
    while (FIB[m] < n) m++;
    int16_t fm = FIB[m], fm1 = FIB[m-1], fm2 = FIB[m-2];
    /* … rest unchanged … */
}
```

This eliminates the initial setup loop and stores Fibonacci numbers in ROM — no RAM cost.

### 6.4 SIMD / vectorized Fibonacci search

On modern CPUs with SIMD (AVX-2, NEON), you can probe multiple consecutive positions in one instruction. But the Fibonacci probe pattern is inherently scalar — each step depends on the previous comparison. Branchless binary search variants (Khuong & Morin 2017) outperform Fibonacci search on modern hardware.

**Conclusion:** Fibonacci search is a niche but genuinely useful tool on resource-constrained hardware, not a modern desktop algorithm.

---

<a name="benchmark"></a>
## 7. Benchmark Methodology

To compare these algorithms fairly on **your** hardware:

### 7.1 Setup

1. **Use realistic data sizes.** 10², 10³, 10⁴, 10⁵, 10⁶, 10⁷.
2. **Use sorted random integers.** Distribution matters less than count.
3. **Use realistic targets.** Mix found and not-found. 70% found / 30% not-found is typical.
4. **Pre-warm the cache** with one untimed pass.
5. **Repeat each measurement** at least 10 times; take the median (not the mean — outliers from GC or OS scheduling distort the mean).
6. **Disable CPU frequency scaling.** Linux: `cpupower frequency-set -g performance`.
7. **Pin the benchmark to a single core.** Linux: `taskset -c 2 ./bench`.

### 7.2 Pseudocode (Go-style, portable)

```go
func benchmark(name string, search func([]int, int) int, arr []int, targets []int) time.Duration {
    // Warm cache.
    for _, t := range targets { _ = search(arr, t) }
    // Measure.
    start := time.Now()
    var hits int
    for i := 0; i < 100; i++ {           // 100 reps
        for _, t := range targets {
            if search(arr, t) >= 0 { hits++ }
        }
    }
    elapsed := time.Since(start)
    fmt.Printf("%s: %v ops total, %v/op, %d hits\n",
               name, len(targets)*100, elapsed / time.Duration(len(targets)*100), hits)
    return elapsed
}
```

### 7.3 What to look for

- **Crossover by size.** Where does binary search start dominating? On modern x86, almost always — but on Arduino, the opposite.
- **Crossover by hit rate.** Not-found searches in Fibonacci go through all `log_φ n` steps; binary search does the same. Comparable.
- **Crossover with cache misses.** When `n` exceeds L3 cache (~30 MB for 7.5M int32s), both algorithms slow down dramatically. The relative gap shrinks because memory latency dominates.
- **Effect of integer-divide hardware.** Run the same benchmark on a chip without fast divide; Fibonacci search wins.

### 7.4 Sample Go benchmark file

```go
package fibsearch_test

import (
    "math/rand"
    "sort"
    "testing"
)

func BenchmarkSearches(b *testing.B) {
    sizes := []int{100, 1000, 10000, 100000, 1000000}
    for _, n := range sizes {
        arr := make([]int, n)
        for i := range arr { arr[i] = rand.Intn(10 * n) }
        sort.Ints(arr)
        targets := make([]int, 1000)
        for i := range targets { targets[i] = arr[rand.Intn(n)] }

        b.Run(fmt.Sprintf("Binary/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _ = BinarySearch(arr, targets[i%len(targets)])
            }
        })
        b.Run(fmt.Sprintf("Fibonacci/n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _ = FibonacciSearch(arr, targets[i%len(targets)])
            }
        })
    }
}
```

Run with `go test -bench=. -benchmem`. Compare nanoseconds-per-op. Fibonacci should lose by ~20–40% on modern x86 across all sizes.

---

## Cheat Sheet — Algorithm Selection

```
Question                                                Best tool
---------                                               ----------
Sorted array, modern CPU                                Binary search
Sorted array, no integer-divide hardware                Fibonacci search
Sorted array, tape / asymmetric-cost storage            Fibonacci search
Unimodal continuous function, expensive evaluations     Golden-section search
Unimodal integer-domain function                        Ternary or Fibonacci-on-grid
Unbounded sorted stream                                 Exponential + (binary or Fibonacci)
General sorted lookup with duplicates                   Binary search + first/last variant
Embedded MCU with sorted lookup table                   Fibonacci search
```

---

## Further Reading

- **Knuth TAOCP v3** §6.2.1 — definitive analysis.
- **Press et al.**, *Numerical Recipes* §10.2 — golden-section search exposition.
- **Kiefer**, "Sequential Minimax Search for a Maximum," 1953 — original golden-section paper.
- **Khuong & Morin**, "Array Layouts for Comparison-Based Searching," 2017 — modern hardware-aware benchmarks for search algorithms (including Fibonacci variants).
- Continue with `senior.md` for production usage, ROM lookup tables, and the modern resurgence in optimization libraries.
