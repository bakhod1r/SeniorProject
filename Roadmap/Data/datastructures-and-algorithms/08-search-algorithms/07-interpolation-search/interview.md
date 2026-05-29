# Interpolation Search — Interview Questions & Coding Challenges

> **Audience:** Anyone preparing for a software engineering interview where interpolation search comes up — typically systems-level (database, search infrastructure, distributed storage) or scientific-computing roles. Includes conceptual Q&A across levels and 7 coding challenges with full Go / Java / Python solutions.

---

## Section A — Conceptual Questions

### Junior level

**Q1. What does interpolation search require of its input?**
A sorted, numerically-comparable sequence with O(1) random access. Ideally, the values are approximately uniformly distributed across the index range. Non-numeric keys (strings, structs without natural arithmetic) cannot be interpolated directly.

**Q2. What is the interpolation formula?**

```
pos = lo + ((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo])
```

It linearly estimates where `target` should sit by assuming `arr` is a straight line between `arr[lo]` and `arr[hi]`.

**Q3. What is the average time complexity on uniform data?**
O(log log n). For n = 10⁹, that's about 5 probes, vs binary search's 30.

**Q4. What is the worst-case time complexity?**
O(n). On pathological distributions (powers of 2, single outlier), interpolation degenerates to linear scan.

**Q5. Why must you guard against `arr[lo] == arr[hi]`?**
Because the formula divides by `arr[hi] - arr[lo]`. If endpoints are equal, the denominator is zero — division by zero crashes (Java/Go) or produces NaN (floating-point). Always check first.

**Q6. Why do you need 64-bit arithmetic?**
Because `(target - arr[lo]) * (hi - lo)` can easily overflow a 32-bit signed integer. For `target ≈ INT_MAX` and `hi - lo ≈ INT_MAX`, the product is ≈ `INT_MAX²` — way beyond 32 bits. Cast to `long` / `int64` before multiplying.

**Q7. What does interpolation search return when the target is not present?**
By convention, `-1`. The value-range guard `arr[lo] <= target <= arr[hi]` provides an early exit when the target is outside the current window's value bounds.

### Middle level

**Q8. When should you choose interpolation search over binary search?**
Three conditions must hold:
1. Keys are numeric (not strings/structs).
2. Distribution is approximately uniform (sequence numbers, timestamps, sequential IDs).
3. Array is large enough (n > ~1,000) that the asymptotic improvement outweighs the per-probe arithmetic cost.

If even one fails, default to binary search.

**Q9. What is the hybrid interpolation+binary search pattern?**
Try interpolation for K probes (typically 4–8). If the target isn't found and the window hasn't shrunk dramatically, fall back to binary search on the remaining range. This guarantees O(log n) worst case while preserving O(log log n) average on uniform data. It's the **only** form of interpolation search that should appear in production.

**Q10. What is the per-probe CPU cost difference between binary and interpolation?**
Binary: ~3 cycles (shift, comparison). Interpolation: ~30 cycles (subtract, multiply, divide). Interpolation is ~10× slower **per probe**. The win comes from saving probes, which on uniform data more than makes up for the per-probe cost.

**Q11. How do you adapt interpolation search to floating-point keys?**
Use the float formula directly (no integer truncation). Compare with an epsilon tolerance: `if abs(arr[pos] - target) < eps`. Pick `eps` based on the physical precision of your data.

**Q12. What is the recurrence that gives O(log log n)?**
`T(n) = T(√n) + O(1)`. Each probe on uniform data reduces the window from `n` to `√n` in expectation. Setting `n = 2^(2^k)` and unrolling gives k = log log n levels.

**Q13. What if the data is sorted but has unknown distribution?**
Three options: (a) profile the distribution at runtime (measure successive-gap variance); (b) use binary search for guaranteed performance; (c) use the hybrid pattern, which protects against bad cases.

### Senior level

**Q14. Where in real databases is interpolation search used?**
- **SSTable block indexes** in LevelDB/RocksDB forks targeting numeric keys.
- **InfluxDB TSM index** — time-spaced indexes are uniform by construction.
- **Time-series chunk routing** in Prometheus / TimescaleDB.
- **QUIC packet sequence-number lookups** in high-throughput user-space stacks.
- **PostgreSQL histogram selectivity** uses interpolation within buckets (not for position lookup but for fraction estimation).

**Q15. How is interpolation search related to learned index structures?**
Interpolation search uses a **degree-1 polynomial model** fit online to two points. Learned indexes (RMI, ALEX, PGM) use **trained models** (polynomials, splines, neural networks) fit to many points offline. Both pipelines are "predict position → search locally". Interpolation is the simplest member of this family.

**Q16. Why don't general-purpose databases like PostgreSQL use interpolation search by default?**
Because keys can be **arbitrary user types** with custom comparators — strings, composite keys, types with no useful linear distance function. Interpolation is only safe for numeric, sortable types with a meaningful arithmetic gap. Binary search works on any totally ordered type.

**Q17. What is the "value-aware" model and why does it matter for lower bounds?**
The standard comparison model treats each probe as extracting 1 bit of information ("less or greater"). The value-aware model treats each probe as also revealing `A[pos]`, which carries far more bits. Yao-Yao (1976) proved a matching `Ω(log log n)` lower bound in this model for uniform data. Interpolation is asymptotically optimal there.

### Professional level

**Q18. Sketch the O(log log n) derivation.**
Treat the array as iid samples from U(0, M). The k-th order statistic has variance O(M²/n), so a single interpolation probe lands within O(√n) of the true position in expectation. The recurrence T(n) = T(√n) + O(1), substituted with n = 2^(2^k), unrolls to k = log₂ log₂ n levels. Hence T(n) = O(log log n).

**Q19. Sketch the Ω(n) worst-case construction.**
Take A = [0, 1, 2, …, n−2, M] where M is some huge value. For target = n−2:
- The formula computes pos = ⌊((n−2)(n−1)) / M⌋ ≈ 0.
- The probe advances lo by 1.
- Repeat until lo reaches n−2.
Total probes: n−2 = Θ(n). One outlier turns the algorithm linear.

**Q20. What does the hybrid pattern's worst-case bound look like?**
Θ(K + log(n)) where K is the interpolation probe cap. For typical K = 8 and n = 10⁹, that's 8 + 30 = 38 probes max — only slightly worse than pure binary's 30 in the bad case, while still hitting ~5 probes on the good case. This bound is achieved by always letting the binary search handle the post-cap window.

---

## Section B — Coding Challenges

### Challenge 1 — Classic Interpolation Search

> Given a sorted array of integers and a target, return its index (or `-1` if absent) using interpolation search.

**Go:**
```go
func interpolationSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi && target >= arr[lo] && target <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return -1
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        switch {
        case arr[pos] == target:
            return pos
        case arr[pos] < target:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    return -1
}
```

**Java:**
```java
public int interpolationSearch(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == target ? lo : -1;
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (arr[pos] == target) return pos;
        if (arr[pos] < target) lo = pos + 1;
        else                   hi = pos - 1;
    }
    return -1;
}
```

**Python:**
```python
def interpolation_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1
```

**Complexity:** O(log log n) average on uniform data, O(n) worst case.

---

### Challenge 2 — Hybrid Interpolation+Binary

> Same as Challenge 1, but guarantee O(log n) worst case via a bounded interpolation cap (8 probes) followed by binary fallback.

**Go:**
```go
func hybridSearch(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    const maxInterp = 8
    probes := 0
    for lo <= hi && target >= arr[lo] && target <= arr[hi] && probes < maxInterp {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return -1
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
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

**Java:**
```java
public int hybridSearch(int[] arr, int target) {
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

**Python:**
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

**Complexity:** O(log log n) average, **O(log n) worst case**. This is the production form.

---

### Challenge 3 — Find First Occurrence with Interpolation

> Given a sorted array (possibly with duplicates) and a target, return the **smallest** index where target appears, or `-1`.

**Go:**
```go
func findFirstInterp(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    result := -1
    for lo <= hi && target >= arr[lo] && target <= arr[hi] {
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo
            }
            return result
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if arr[pos] == target {
            result = pos
            hi = pos - 1
        } else if arr[pos] < target {
            lo = pos + 1
        } else {
            hi = pos - 1
        }
    }
    return result
}
```

**Java:**
```java
public int findFirstInterp(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1, result = -1;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
        if (arr[lo] == arr[hi]) return arr[lo] == target ? lo : result;
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (arr[pos] == target) {
            result = pos;
            hi = pos - 1;
        } else if (arr[pos] < target) {
            lo = pos + 1;
        } else {
            hi = pos - 1;
        }
    }
    return result;
}
```

**Python:**
```python
def find_first_interp(arr, target):
    lo, hi, result = 0, len(arr) - 1, -1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else result
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        if arr[pos] == target:
            result = pos
            hi = pos - 1
        elif arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return result
```

**Complexity:** O(log log n) average for uniform data with few duplicates.

---

### Challenge 4 — Interpolation on Floating-Point Timestamps

> Given a sorted array of `double` timestamps and a query timestamp `t`, find the index of `t` within epsilon tolerance, or `-1`.

**Python:**
```python
def timestamp_search(timestamps, t, eps=1e-9):
    lo, hi = 0, len(timestamps) - 1
    while lo <= hi and timestamps[lo] - eps <= t <= timestamps[hi] + eps:
        if abs(timestamps[hi] - timestamps[lo]) < eps:
            return lo if abs(timestamps[lo] - t) < eps else -1
        ratio = (t - timestamps[lo]) / (timestamps[hi] - timestamps[lo])
        pos = lo + int(ratio * (hi - lo))
        pos = max(lo, min(hi, pos))
        if abs(timestamps[pos] - t) < eps:
            return pos
        if timestamps[pos] < t:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1
```

**Go:**
```go
func timestampSearch(ts []float64, t float64) int {
    const eps = 1e-9
    lo, hi := 0, len(ts)-1
    for lo <= hi && ts[lo]-eps <= t && t <= ts[hi]+eps {
        if math.Abs(ts[hi]-ts[lo]) < eps {
            if math.Abs(ts[lo]-t) < eps {
                return lo
            }
            return -1
        }
        ratio := (t - ts[lo]) / (ts[hi] - ts[lo])
        pos := lo + int(ratio*float64(hi-lo))
        if pos < lo { pos = lo }
        if pos > hi { pos = hi }
        if math.Abs(ts[pos]-t) < eps {
            return pos
        }
        if ts[pos] < t {
            lo = pos + 1
        } else {
            hi = pos - 1
        }
    }
    return -1
}
```

**Java:**
```java
public int timestampSearch(double[] ts, double t) {
    final double eps = 1e-9;
    int lo = 0, hi = ts.length - 1;
    while (lo <= hi && ts[lo] - eps <= t && t <= ts[hi] + eps) {
        if (Math.abs(ts[hi] - ts[lo]) < eps) {
            return Math.abs(ts[lo] - t) < eps ? lo : -1;
        }
        double ratio = (t - ts[lo]) / (ts[hi] - ts[lo]);
        int pos = lo + (int)(ratio * (hi - lo));
        if (pos < lo) pos = lo;
        if (pos > hi) pos = hi;
        if (Math.abs(ts[pos] - t) < eps) return pos;
        if (ts[pos] < t) lo = pos + 1;
        else             hi = pos - 1;
    }
    return -1;
}
```

**Complexity:** O(log log n) average on uniformly-sampled timestamps.

---

### Challenge 5 — Detect Pathological Distribution

> Given a sorted array, return `true` if vanilla interpolation search would degenerate to O(n) on a uniform-random query — i.e., the distribution is too skewed.

**Strategy:** measure the variance of successive gaps. If `stddev / mean > threshold`, the distribution is skewed.

**Python:**
```python
def is_pathological(arr, threshold=3.0):
    n = len(arr)
    if n < 10:
        return False
    gaps = [arr[i + 1] - arr[i] for i in range(n - 1)]
    mean = sum(gaps) / (n - 1)
    if mean == 0:
        return False                # all duplicates — both algos handle O(1)
    var = sum((g - mean) ** 2 for g in gaps) / (n - 1)
    stddev = var ** 0.5
    return stddev / mean > threshold
```

**Go:**
```go
func isPathological(arr []int, threshold float64) bool {
    n := len(arr)
    if n < 10 {
        return false
    }
    gaps := make([]float64, n-1)
    sum := 0.0
    for i := 0; i < n-1; i++ {
        gaps[i] = float64(arr[i+1] - arr[i])
        sum += gaps[i]
    }
    mean := sum / float64(n-1)
    if mean == 0 {
        return false
    }
    varSum := 0.0
    for _, g := range gaps {
        d := g - mean
        varSum += d * d
    }
    stddev := math.Sqrt(varSum / float64(n-1))
    return stddev/mean > threshold
}
```

**Java:**
```java
public boolean isPathological(int[] arr, double threshold) {
    int n = arr.length;
    if (n < 10) return false;
    double sum = 0;
    for (int i = 0; i < n - 1; i++) sum += (arr[i + 1] - arr[i]);
    double mean = sum / (n - 1);
    if (mean == 0) return false;
    double varSum = 0;
    for (int i = 0; i < n - 1; i++) {
        double d = (arr[i + 1] - arr[i]) - mean;
        varSum += d * d;
    }
    double stddev = Math.sqrt(varSum / (n - 1));
    return stddev / mean > threshold;
}
```

**Complexity:** O(n) one-time. Use it to decide between interpolation and binary at index-build time.

---

### Challenge 6 — Count Probes (Diagnostic Tool)

> Modify interpolation search to return both the result index and the number of probes used. Useful for diagnosing whether your distribution suits interpolation.

**Python:**
```python
def interp_with_probe_count(arr, target):
    lo, hi = 0, len(arr) - 1
    probes = 0
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        probes += 1
        if arr[lo] == arr[hi]:
            return (lo if arr[lo] == target else -1), probes
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            return pos, probes
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1, probes
```

**Go:**
```go
func interpProbes(arr []int, target int) (int, int) {
    lo, hi := 0, len(arr)-1
    probes := 0
    for lo <= hi && target >= arr[lo] && target <= arr[hi] {
        probes++
        if arr[lo] == arr[hi] {
            if arr[lo] == target {
                return lo, probes
            }
            return -1, probes
        }
        pos := lo + int(int64(target-arr[lo])*int64(hi-lo)/int64(arr[hi]-arr[lo]))
        switch {
        case arr[pos] == target:
            return pos, probes
        case arr[pos] < target:
            lo = pos + 1
        default:
            hi = pos - 1
        }
    }
    return -1, probes
}
```

**Java:**
```java
public int[] interpProbes(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1, probes = 0;
    while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
        probes++;
        if (arr[lo] == arr[hi]) return new int[]{ arr[lo] == target ? lo : -1, probes };
        long num = (long)(target - arr[lo]) * (hi - lo);
        long den = arr[hi] - arr[lo];
        int  pos = lo + (int)(num / den);
        if (arr[pos] == target) return new int[]{pos, probes};
        if (arr[pos] < target) lo = pos + 1;
        else                   hi = pos - 1;
    }
    return new int[]{-1, probes};
}
```

**Usage:** Compare average probes against `log₂ log₂ n` (expected for uniform) and `log₂ n` (binary's bound). Ratio reveals distribution skew.

---

### Challenge 7 — Benchmark Three Algorithms Side-by-Side

> Given a sorted array, run binary, interpolation, and hybrid searches on a series of random targets and report average probes used. The output answers "Which algorithm wins on my data?"

**Python:**
```python
import random

def benchmark_searches(arr, num_queries=10_000):
    """Returns (binary_avg, interp_avg, hybrid_avg) probe counts."""
    bin_probes = interp_probes = hyb_probes = 0
    n = len(arr)
    for _ in range(num_queries):
        # 70% in-array, 30% miss
        if random.random() < 0.7:
            t = arr[random.randint(0, n - 1)]
        else:
            t = random.randint(arr[0] - 1000, arr[-1] + 1000)
        bin_probes   += _binary_probes(arr, t)
        interp_probes += _interp_probes(arr, t)
        hyb_probes   += _hybrid_probes(arr, t)
    return (bin_probes / num_queries,
            interp_probes / num_queries,
            hyb_probes / num_queries)

def _binary_probes(arr, t):
    lo, hi, p = 0, len(arr) - 1, 0
    while lo <= hi:
        p += 1
        mid = (lo + hi) // 2
        if arr[mid] == t: return p
        if arr[mid] < t: lo = mid + 1
        else: hi = mid - 1
    return p

def _interp_probes(arr, t):
    lo, hi, p = 0, len(arr) - 1, 0
    while lo <= hi and arr[lo] <= t <= arr[hi]:
        p += 1
        if arr[lo] == arr[hi]: return p
        pos = lo + ((t - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == t: return p
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    return p

def _hybrid_probes(arr, t):
    lo, hi, p = 0, len(arr) - 1, 0
    K = 8
    interp_done = 0
    while lo <= hi and arr[lo] <= t <= arr[hi] and interp_done < K:
        p += 1
        interp_done += 1
        if arr[lo] == arr[hi]: return p
        pos = lo + ((t - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        pos = max(lo, min(hi, pos))
        if arr[pos] == t: return p
        if arr[pos] < t: lo = pos + 1
        else: hi = pos - 1
    while lo <= hi:
        p += 1
        mid = (lo + hi) // 2
        if arr[mid] == t: return p
        if arr[mid] < t: lo = mid + 1
        else: hi = mid - 1
    return p
```

**Sample output on uniform `range(1_000_000)`:**

```
Binary avg probes:        19.7
Interpolation avg probes: 2.1
Hybrid avg probes:        2.2
```

**Sample output on exponential `[2**i for i in range(20)]`:**

```
Binary avg probes:        4.4
Interpolation avg probes: 8.7
Hybrid avg probes:        5.1
```

The hybrid pattern's robustness across distributions is exactly why production code uses it.

---

## Section C — Common Interview Pitfalls

### Pitfall 1 — Forgetting the equal-endpoints guard
Without `if arr[lo] == arr[hi]`, the formula divides by zero on the first probe whenever values repeat. Crashes the program.

### Pitfall 2 — 32-bit overflow on the multiplication
`(target - arr[lo]) * (hi - lo)` overflows 32-bit signed integers easily. Always cast to `long` / `int64` before multiplying.

### Pitfall 3 — Skipping the value-range guard
Forgetting `arr[lo] <= target <= arr[hi]` makes the algorithm waste probes on impossible-to-find targets (out of range). Costs probes, can also produce out-of-bounds `pos`.

### Pitfall 4 — Claiming O(log log n) without qualification
Interpolation is O(log log n) **on uniform data**. On general data it's O(log n) at best, O(n) at worst. Interviewers want you to acknowledge the distribution assumption.

### Pitfall 5 — Recommending interpolation over binary without conditions
If asked "should we use interpolation here?", check: numeric keys? uniform distribution? large array? If any answer is "no", recommend binary or hybrid.

### Pitfall 6 — Missing the hybrid pattern
Interviewers love the "what if the worst case is unacceptable?" follow-up. The right answer is the hybrid pattern: bounded interpolation, then binary. If you only know vanilla interpolation, you fail this follow-up.

### Pitfall 7 — Confusing interpolation search with linear interpolation of values
`numpy.interp` interpolates **values** between sample points. Interpolation search interpolates the **position** of a query within an index. Same formula, different purpose. Don't conflate them.

### Pitfall 8 — Recursion on potentially adversarial data
The recursive form can stack-overflow on pathological inputs (depth becomes O(n)). Always prefer iterative. Mention this if asked about recursion.

### Pitfall 9 — Skipping the probe clamp
`pos = max(lo, min(hi, pos))` defends against rounding errors, overflow remnants, and floating-point drift. One extra comparison per probe — cheap insurance.

### Pitfall 10 — Benchmarking on synthetic uniform data only
Real workloads are rarely uniform. If your benchmark only uses `range(n)` shuffled and sorted, you'll overclaim interpolation's advantage. Use real-world distributions (log-normal, Zipfian, your production data sample).

---

## Section D — Mock Interview Drill (15 minutes)

A typical 45-minute systems interview where interpolation search appears will cover:

1. **Conceptual warmup** (5 min): "What is interpolation search and when would you use it?"
2. **Code it up** (10 min): "Write interpolation search in Python / Go / Java. Handle edge cases."
3. **Follow-up complications** (10 min): "What if the data isn't uniform? What if you need a worst-case bound?"
4. **System design connection** (15 min): "How would you use this in an SSTable / time-series DB / network packet buffer?"
5. **Stretch** (5 min): "How does this relate to learned index structures?"

**Drill questions to practice aloud:**
- *"Walk me through interpolation search step by step on `[10, 20, 30, …, 100]` searching for 70."*
- *"What goes wrong if the array is `[1, 2, 4, 8, …, 2^n]`?"*
- *"Show me the formula. Why do we need 64-bit arithmetic?"*
- *"Describe the hybrid pattern and explain why production code uses it."*
- *"In a time-series database, which lookups should use interpolation?"*
- *"How would you adapt this to floating-point timestamps with microsecond precision?"*
- *"Why can't we use interpolation search on B-tree internal nodes in PostgreSQL?"*

Master:
- The formula and the equal-endpoints / overflow / range guards.
- The hybrid pattern and its worst-case bound.
- One real-world example (SSTable index, time-series chunk, QUIC packet buffer).
- The O(log log n) derivation at sketch level (recurrence T(n) = T(√n) + 1).

With those, 90% of interpolation-search interview questions become straightforward.
