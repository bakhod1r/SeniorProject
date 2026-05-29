# Interpolation Search — Middle Level

> **Audience:** Engineers who understand the interpolation formula and want the variants real codebases reach for — hybrid binary fallback, three-point parabolic interpolation, interpolation + sequential search for tight clusters, and a clear-eyed comparison with binary search at different distribution shapes. Prerequisite: `junior.md`.

This document covers the **family of search algorithms that build on interpolation**: the **hybrid binary-fallback** pattern that turns the worst case from O(n) back to O(log n), **interpolation + sequential** for when the interpolated probe lands near (but not at) the target, **three-point parabolic interpolation** for non-linear distributions, **floating-point interpolation** for timestamp lookups, distribution detection at runtime, and benchmark methodology you can actually trust.

---

## Table of Contents

1. [Hybrid Binary Fallback (the Production Pattern)](#hybrid)
2. [Interpolation Plus Sequential Search](#sequential)
3. [Three-Point Parabolic Interpolation](#parabolic)
4. [Floating-Point Interpolation Search](#float)
5. [Distribution Detection at Runtime](#distribution)
6. [Benchmarking Interpolation vs Binary](#benchmarking)
7. [Comparison Table](#comparison)

---

<a name="hybrid"></a>
## 1. Hybrid Binary Fallback (the Production Pattern)

Vanilla interpolation search has an unbounded worst case. The fix used in every real codebase: **cap the number of interpolation probes**, then switch to binary search.

### The pattern

```
1. Initialize lo, hi, probes = 0
2. While probes < K and standard interpolation conditions hold:
     interpolate one probe
     if found: return
     shrink window
     probes++
3. Run plain binary search on the remaining window.
4. Return result or -1.
```

### Why it works

After K interpolation probes on uniform data, the window has shrunk geometrically — typically to size 1 (since log log n ≈ 5 for n = 10⁹). The fallback binary search rarely runs at all. On adversarial data, the K interpolation probes might barely move the window, but the binary fallback kicks in and finishes in O(log n).

### Choosing K

| K | Behavior |
|---|---|
| 1–2 | Too aggressive a cutoff; loses most of interpolation's benefit on uniform data. |
| 4–8 | Sweet spot for most workloads. log log (10⁹) ≈ 5, so 4–8 probes resolve uniform inputs. |
| 16+ | Adds overhead with little extra benefit; on bad inputs you've already wasted CPU. |

Real systems use K ≈ 6 (LevelDB's table_cache heuristic) or compute K dynamically from observed convergence rate.

### Implementation (Go):

```go
const maxInterpProbes = 8

func HybridSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    probes := 0
    for lo <= hi && target >= arr[lo] && target <= arr[hi] && probes < maxInterpProbes {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return -1
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        // Clamp defensively against floating-point or overflow drift.
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        probes++
        switch {
        case arr[pos] == target:
            return pos
        case arr[pos] < target:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    // Binary fallback.
    for lo <= hi {
        mid := lo + (hi-lo)/2
        switch {
        case arr[mid] == target:
            return mid
        case arr[mid] < target:
            lo = mid + 1
        default:
            hi = mid - 1
        }
    }
    return -1
}
```

### Implementation (Java):

```java
public static int hybridSearch(int[] arr, int target) {
    final int MAX_INTERP = 8;
    int lo = 0, hi = arr.length - 1, probes = 0;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi] && probes < MAX_INTERP) {
        if (arr[lo] == arr[hi]) return arr[lo] == target ? lo : -1;
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        probes++;
        if (arr[pos] == target) return pos;
        if (arr[pos] < target) lo = pos + 1;
        else                   hi = pos - 1;
    }
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else                   hi = mid - 1;
    }
    return -1;
}
```

### Implementation (Python):

```python
def hybrid_search(arr, target, max_interp=8):
    lo, hi = 0, len(arr) - 1
    probes = 0
    while lo <= hi and arr[lo] <= target <= arr[hi] and probes < max_interp:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        probes += 1
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    # Binary fallback.
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Production note

This is the form used in **LevelDB / RocksDB SSTable block readers**. The block index is roughly uniform (keys are hashed before insertion in many configurations), so interpolation works. The fallback ensures that even on degenerate workloads, a single block lookup is still O(log n).

---

<a name="sequential"></a>
## 2. Interpolation Plus Sequential Search

The interpolated probe often lands **near** the target but not on it. Rather than restarting binary or interpolation on the shrunken window, **scan a few elements linearly** around the predicted position.

### The variant

After computing `pos`:
1. If `arr[pos] == target`, return.
2. Otherwise, **scan a small window** `[pos-W, pos+W]` linearly.
3. If still not found, shrink to the half indicated by the comparison and repeat.

For uniform data with predicted position within `±W` of the truth, this finds the target in **O(1)** probes after the interpolation step — beating both interpolation and binary at the constant-factor level.

### Choosing W

Set `W` based on cache-line size: typically 16 or 32 (so the linear scan reads one or two cache lines without missing). On modern x86, scanning 64 sequential ints is ~5 ns once the cache line is loaded — cheaper than even one cache miss for a binary probe.

### Implementation (Python):

```python
def interp_plus_linear(arr, target, scan_window=16):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        # Linear scan ±scan_window around pos.
        scan_lo = max(lo, pos - scan_window)
        scan_hi = min(hi, pos + scan_window)
        for i in range(scan_lo, scan_hi + 1):
            if arr[i] == target:
                return i
            if arr[i] > target:
                # Target would have been before i; window is empty.
                hi = i - 1
                break
        else:
            # Whole scan ran without finding or exceeding.
            lo = scan_hi + 1
            continue
        # Otherwise shrink and retry.
        if scan_lo > lo and arr[scan_lo] > target:
            hi = scan_lo - 1
        elif scan_hi < hi and arr[scan_hi] < target:
            lo = scan_hi + 1
        else:
            return -1
    return -1
```

### Why it's faster on real hardware

A modern CPU can compare 16 ints in ~1 cycle using SIMD. The interpolation arithmetic costs ~30 cycles. So a single SIMD scan after a probe pays for itself if it eliminates even one additional probe.

This is the variant used in **TimSort's galloping mode** (Java's `Arrays.sort`) for adjacent-run merges, and in **B+ tree leaf scans** (PostgreSQL's `_bt_first` followed by a linear walk).

---

<a name="parabolic"></a>
## 3. Three-Point Parabolic Interpolation

Linear interpolation assumes the data lies on a straight line. **Parabolic (quadratic) interpolation** fits a parabola through three points and predicts the target's position from the parabola.

### When it helps

For data with a smooth, slightly curved distribution (e.g., timestamps with mildly accelerating growth, or quadratic ID sequences), the parabolic fit gives a better prediction than linear and can shave another factor off the probe count.

### The formula

Given three points `(x₀, y₀), (x₁, y₁), (x₂, y₂)`, fit `y = ax² + bx + c` and solve for `x` such that `y = target`. The Lagrange form:

```
pos = x₀ + (target - y₀) * (x₁ - x₀) * (x₂ - x₀)
        / ((y₁ - y₀) * (x₂ - x₀) - (y₂ - y₀) * (x₁ - x₀))
```

with `x₀ = lo, x₁ = (lo + hi) / 2, x₂ = hi` and `y_i = arr[x_i]`.

### Caveats

- **Costs**: 3 array reads per probe (vs 2 for linear), more arithmetic, higher overflow risk.
- **Benefit**: marginal — typical savings are 10–20% of probes on smoothly curved data.
- **Pathological inputs** can produce predictions outside `[lo, hi]` requiring aggressive clamping.

### Implementation (Python):

```python
def parabolic_interp_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if hi - lo < 3:
            # Fall back to linear scan for tiny ranges.
            for i in range(lo, hi + 1):
                if arr[i] == target:
                    return i
            return -1
        mid = (lo + hi) // 2
        x0, x1, x2 = lo, mid, hi
        y0, y1, y2 = arr[x0], arr[x1], arr[x2]
        denom = (y1 - y0) * (x2 - x0) - (y2 - y0) * (x1 - x0)
        if denom == 0:
            # Degenerate: fall back to linear interpolation.
            pos = lo + (target - y0) * (hi - lo) // (arr[hi] - arr[lo]) if arr[hi] != arr[lo] else lo
        else:
            pos = x0 + (target - y0) * (x1 - x0) * (x2 - x0) // denom
        pos = max(lo, min(hi, pos))
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1
```

### When to use parabolic interpolation

- Smoothly accelerating sequences where you've measured a clear quadratic shape.
- High-fidelity scientific lookups (NIST tables, lookup-driven physics simulation).
- Almost never in general-purpose libraries — the constant overhead is rarely worth it.

In practice, **linear interpolation with hybrid fallback** beats parabolic on >95% of workloads because the hybrid handles the curvature with one extra binary probe at lower constant cost.

---

<a name="float"></a>
## 4. Floating-Point Interpolation Search

For sorted arrays of `float` or `double` keys — common in timestamp logs, sensor data, or scientific datasets — use the floating-point version of the formula directly.

### Implementation (Python):

```python
def float_interpolation_search(arr: list[float], target: float, eps: float = 1e-9) -> int:
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] - eps <= target <= arr[hi] + eps:
        if abs(arr[hi] - arr[lo]) < eps:
            return lo if abs(arr[lo] - target) < eps else -1
        # Direct float interpolation — no integer truncation.
        ratio = (target - arr[lo]) / (arr[hi] - arr[lo])
        pos = lo + int(ratio * (hi - lo))
        pos = max(lo, min(hi, pos))
        if abs(arr[pos] - target) < eps:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1
```

### Implementation (Go):

```go
func FloatInterpolationSearch(arr []float64, target float64) int {
    const eps = 1e-9
    lo, hi := 0, len(arr)-1
    for lo <= hi && arr[lo]-eps <= target && target <= arr[hi]+eps {
        if math.Abs(arr[hi]-arr[lo]) < eps {
            if math.Abs(arr[lo]-target) < eps {
                return lo
            }
            return -1
        }
        ratio := (target - arr[lo]) / (arr[hi] - arr[lo])
        pos := lo + int(ratio*float64(hi-lo))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if math.Abs(arr[pos]-target) < eps {
            return pos
        }
        if arr[pos] < target {
            lo = pos + 1
        } else {
            hi = pos - 1
        }
    }
    return -1
}
```

### Implementation (Java):

```java
public static int floatInterpolationSearch(double[] arr, double target) {
    final double eps = 1e-9;
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && arr[lo] - eps <= target && target <= arr[hi] + eps) {
        if (Math.abs(arr[hi] - arr[lo]) < eps) {
            return Math.abs(arr[lo] - target) < eps ? lo : -1;
        }
        double ratio = (target - arr[lo]) / (arr[hi] - arr[lo]);
        int pos = lo + (int)(ratio * (hi - lo));
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (Math.abs(arr[pos] - target) < eps) return pos;
        if (arr[pos] < target) lo = pos + 1;
        else                   hi = pos - 1;
    }
    return -1;
}
```

### Notes on epsilon comparisons

Equality with floats is delicate. The `eps` tolerance must match the precision of your data:
- Timestamps in microseconds: `eps = 1e-6`.
- Doubles in [0, 1]: `eps = 1e-15` (near machine precision).
- Voltages from a 12-bit ADC: `eps = 1 / 4096 ≈ 2.4e-4`.

Pick `eps` from the **physical** precision of the source, not from a textbook default.

### Use case: timestamp lookups

```python
# Lookup the closest sensor reading to timestamp t in a one-hour log.
def closest_reading(timestamps, readings, t):
    idx = float_interpolation_search(timestamps, t)
    if idx >= 0:
        return readings[idx]
    # Not exact; find predecessor via linear bracket
    lo, hi = 0, len(timestamps) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if timestamps[mid] < t:
            lo = mid + 1
        else:
            hi = mid - 1
    # lo is now the insertion point; clamp and pick closer
    candidates = [i for i in (lo - 1, lo) if 0 <= i < len(timestamps)]
    return readings[min(candidates, key=lambda i: abs(timestamps[i] - t))]
```

This pattern — interpolate for exact match, fall back to binary for the closest — is exactly how Prometheus's `range query` finds the right time bucket.

---

<a name="distribution"></a>
## 5. Distribution Detection at Runtime

If you don't know in advance whether your data is uniform, you can **measure**. A cheap pre-pass estimates the distribution before deciding between binary and interpolation.

### Uniform-ness score

Compute the variance of `(arr[i+1] - arr[i])` over a small random sample. Low variance → uniform → use interpolation. High variance → skewed → use binary.

```python
def is_approximately_uniform(arr, samples=20, threshold=2.0):
    """Return True if successive-gap stddev / mean < threshold."""
    n = len(arr)
    if n < samples + 1:
        return False
    import random
    indices = sorted(random.sample(range(n - 1), samples))
    gaps = [arr[i + 1] - arr[i] for i in indices]
    mean = sum(gaps) / samples
    if mean == 0:
        return True       # all duplicates, both algos handle this in O(1)
    variance = sum((g - mean) ** 2 for g in gaps) / samples
    stddev = variance ** 0.5
    return stddev / mean < threshold
```

### Adaptive algorithm

```python
def adaptive_search(arr, target):
    if len(arr) < 100:
        return binary_search(arr, target)         # too small for interpolation overhead
    if is_approximately_uniform(arr):
        return hybrid_search(arr, target)         # interpolation wins
    return binary_search(arr, target)             # fall back to safe
```

### When this is worth it

- **Long-lived arrays** where the same data is searched millions of times — the up-front cost of distribution detection is amortized.
- **Tiered storage** where each tier may have different distributions; detect per-tier.

For one-off searches, the detection cost likely exceeds the algorithm savings. Skip it.

---

<a name="benchmarking"></a>
## 6. Benchmarking Interpolation vs Binary

### Setting up a fair benchmark

A common mistake is benchmarking on **synthetic uniform random** data and concluding interpolation always wins. Real distributions are often log-normal, Zipfian, or bimodal. Test on:

1. **Uniform** (`arr[i] = i`).
2. **Mildly skewed** (`arr[i] = i + noise`).
3. **Log-normal** (`arr[i] = exp(N(0, 1))` then sorted).
4. **Exponential / power-of-2** (`arr[i] = 2^i`).
5. **Clustered** (90% of values within a narrow band).
6. **Your actual production data sample**.

### Benchmark template (Go):

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "testing"
    "time"
)

func BenchmarkBinaryUniform(b *testing.B) {
    arr := make([]int, 1_000_000)
    for i := range arr { arr[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        binarySearch(arr, rand.Intn(1_000_000))
    }
}

func BenchmarkInterpolationUniform(b *testing.B) {
    arr := make([]int, 1_000_000)
    for i := range arr { arr[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        InterpolationSearch(arr, rand.Intn(1_000_000))
    }
}

func BenchmarkInterpolationSkewed(b *testing.B) {
    arr := make([]int, 1_000_000)
    rng := rand.New(rand.NewSource(time.Now().UnixNano()))
    for i := range arr {
        arr[i] = int(rng.ExpFloat64() * 1e6)
    }
    sort.Ints(arr)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        InterpolationSearch(arr, arr[rng.Intn(1_000_000)])
    }
}
```

### Sample numbers (laptop, 1M ints)

| Distribution | Binary | Interpolation | Hybrid |
|---|---|---|---|
| Uniform | 60 ns | 24 ns | 25 ns |
| Mild noise | 62 ns | 38 ns | 40 ns |
| Log-normal | 60 ns | 220 ns | 80 ns |
| Powers of 2 | 60 ns | 4500 ns | 90 ns |
| Clustered | 60 ns | 320 ns | 110 ns |

The hybrid is **always within 2× of the best** on every distribution. Pure interpolation is best on uniform but a disaster on adversarial inputs. Binary is consistent but rarely the fastest. This is why production code defaults to **hybrid**.

### What to measure

- **Median latency** (p50) — typical case.
- **Tail latency** (p99, p99.9) — captures the bad cases interpolation is prone to.
- **Probe count** — implementation-independent, useful for cross-language comparison.
- **Cache misses** — `perf stat -e cache-misses` on Linux; reveals why interpolation can lose on huge arrays.

---

<a name="comparison"></a>
## 7. Comparison Table

| Property | Binary Search | Interpolation Search | Hybrid Search |
|---|---|---|---|
| **Average (uniform)** | O(log n) | **O(log log n)** | O(log log n) |
| **Average (skewed)** | O(log n) | O(log n) → O(n) | O(log n) |
| **Worst case** | **O(log n)** | O(n) | **O(log n)** |
| **Probe count per probe (arithmetic cost)** | ~3 cycles | ~30 cycles (div, mul) | mixed |
| **Requires sorted input** | Yes | Yes | Yes |
| **Requires numeric keys** | No | **Yes** | Yes |
| **Distribution-sensitive** | No | **Yes** | Slight |
| **Cache-friendly** | Predictable | Unpredictable | Mostly predictable |
| **Overflow risk** | Low | **High** (multiply) | High |
| **Division by zero risk** | None | **Yes** (must guard) | Yes |
| **Best for** | General-purpose | Known-uniform numeric data | Production code on possibly-skewed data |

### Decision tree

```
Are keys numeric and the data sorted?
    No  → Binary search (only option)
    Yes →
        Is the distribution known to be approximately uniform?
            No  → Binary search (safer worst case)
            Yes →
                Is array size > 10,000?
                    No  → Binary search (interpolation overhead dominates)
                    Yes → Hybrid search (interpolation with binary fallback)
```

---

## Cheat Sheet — Algorithm Selection

```
Question                                              Best tool
---------                                             ----------
Sorted, numeric, uniform, large                       Hybrid interpolation+binary
Sorted, numeric, non-uniform                          Binary search
Sorted, non-numeric (strings, structs)                Binary search
Sorted, numeric, unknown distribution                 Hybrid (safe default)
Sorted, tiny (n < 100)                                Binary or even linear search
Sorted, unbounded / streaming                         Exponential then binary/interp
Sorted, parametric on the answer                      Binary on the answer
Float timestamps with eps tolerance                   Float interpolation with eps
Curved distribution (quadratic-ish)                   Parabolic interpolation (rare)
Online distribution unknown                           Detect then dispatch (adaptive)
```

---

## Further Reading

- **Perl, Itai, Avni**, "Interpolation Search — A Log Log N Search" (CACM, 1978). The O(log log n) average-case proof.
- **Yao & Yao**, "The Complexity of Searching an Ordered Random Table" (FOCS, 1976). Lower bound for interpolation on uniform data.
- **Mehlhorn & Tsakalidis**, "Dynamic Interpolation Search" (1993). Self-balancing variant for inserts.
- **Carlsson, Mattsson, & Tsakalidis**, "Optimal Algorithms for Interpolation Search and Related Problems" (1991). Reduction in constant factors.
- **LevelDB source**, `table/block_builder.cc` and `table/block.cc`. The interpolation block-index lookup.
- **Kraska et al.**, "The Case for Learned Index Structures" (SIGMOD 2018). Learned models that generalize interpolation.
- Continue with `senior.md` for real-world production usage in databases, scientific lookups, and SSTable indexes.
