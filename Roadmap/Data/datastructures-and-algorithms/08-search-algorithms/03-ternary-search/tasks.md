# Ternary Search — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "warmup" to "harder than the LC label suggests".

---

## Task 1 — Ternary Search on a Bitonic Integer Array

**Problem.** Given an array `a[]` that first strictly increases then strictly decreases, return the index of the maximum.

**Constraints.** `1 <= n <= 10^5`, all values distinct.

**Go:**
```go
func ternaryPeak(a []int) int {
    lo, hi := 0, len(a)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if a[m1] < a[m2] { lo = m1 + 1 } else { hi = m2 - 1 }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ {
        if a[i] > a[best] { best = i }
    }
    return best
}
```

**Java:**
```java
int ternaryPeak(int[] a) {
    int lo = 0, hi = a.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (a[m1] < a[m2]) lo = m1 + 1;
        else               hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) if (a[i] > a[best]) best = i;
    return best;
}
```

**Python:**
```python
def ternary_peak(a):
    lo, hi = 0, len(a) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]: lo = m1 + 1
        else:             hi = m2 - 1
    return max(range(lo, hi + 1), key=lambda i: a[i])
```

---

## Task 2 — Recursive Variant

**Problem.** Same as Task 1, but recursive.

**Go:**
```go
func ternaryPeakRec(a []int) int { return tprec(a, 0, len(a)-1) }
func tprec(a []int, lo, hi int) int {
    if hi-lo <= 2 {
        best := lo
        for i := lo + 1; i <= hi; i++ { if a[i] > a[best] { best = i } }
        return best
    }
    m1 := lo + (hi-lo)/3
    m2 := hi - (hi-lo)/3
    if a[m1] < a[m2] { return tprec(a, m1+1, hi) }
    return tprec(a, lo, m2-1)
}
```

**Java:**
```java
int ternaryPeakRec(int[] a) { return rec(a, 0, a.length - 1); }
int rec(int[] a, int lo, int hi) {
    if (hi - lo <= 2) {
        int best = lo;
        for (int i = lo + 1; i <= hi; i++) if (a[i] > a[best]) best = i;
        return best;
    }
    int m1 = lo + (hi - lo) / 3;
    int m2 = hi - (hi - lo) / 3;
    if (a[m1] < a[m2]) return rec(a, m1 + 1, hi);
    return rec(a, lo, m2 - 1);
}
```

**Python:**
```python
def ternary_peak_rec(a):
    def rec(lo, hi):
        if hi - lo <= 2:
            return max(range(lo, hi + 1), key=lambda i: a[i])
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]: return rec(m1 + 1, hi)
        return rec(lo, m2 - 1)
    return rec(0, len(a) - 1)
```

---

## Task 3 — Find the Maximum of a Real-Valued Unimodal Function

**Problem.** Find `argmax_x f(x)` on `[lo, hi]` to precision `1e-9`.

**Go:**
```go
func ternaryMaxFloat(lo, hi float64, f func(float64) float64) float64 {
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if f(m1) < f(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double ternaryMaxFloat(double lo, double hi,
                       java.util.function.DoubleUnaryOperator f) {
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (f.applyAsDouble(m1) < f.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Python:**
```python
def ternary_max_float(lo, hi, f):
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2): lo = m1
        else:             hi = m2
    return (lo + hi) / 2
```

---

## Task 4 — Find the Minimum of `f(x) = x² - 6x + 5`

**Problem.** True minimum is at `x = 3` (calculus). Verify by ternary search.

**Python:**
```python
def min_quadratic():
    f = lambda x: x * x - 6 * x + 5
    lo, hi = -100.0, 100.0
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) > f(m2): lo = m1     # for min, flipped
        else:             hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
func minQuadratic() float64 {
    f := func(x float64) float64 { return x*x - 6*x + 5 }
    lo, hi := -100.0, 100.0
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if f(m1) > f(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double minQuadratic() {
    java.util.function.DoubleUnaryOperator f = x -> x * x - 6 * x + 5;
    double lo = -100, hi = 100;
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (f.applyAsDouble(m1) > f.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2;
}
```

---

## Task 5 — Find Peak Element (LeetCode 162) — Ternary Variant

**Problem.** Given an array where `a[i] != a[i+1]`, find any peak index (an `i` with `a[i] > a[i-1]` and `a[i] > a[i+1]`, treating out-of-bounds as `-∞`).

Note: when the input is **guaranteed bitonic**, ternary applies. For the general LC162 (possibly multiple internal peaks), binary search via adjacent-pair comparison is the textbook answer.

**Python (ternary, bitonic-input variant):**
```python
def findPeakElement(a):
    lo, hi = 0, len(a) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]:
            lo = m1 + 1
        else:
            hi = m2 - 1
    return max(range(lo, hi + 1), key=lambda i: a[i])
```

**Go:**
```go
func findPeakElement(a []int) int {
    lo, hi := 0, len(a)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if a[m1] < a[m2] { lo = m1 + 1 } else { hi = m2 - 1 }
    }
    best := lo
    for i := lo + 1; i <= hi; i++ { if a[i] > a[best] { best = i } }
    return best
}
```

**Java:**
```java
int findPeakElement(int[] a) {
    int lo = 0, hi = a.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (a[m1] < a[m2]) lo = m1 + 1;
        else               hi = m2 - 1;
    }
    int best = lo;
    for (int i = lo + 1; i <= hi; i++) if (a[i] > a[best]) best = i;
    return best;
}
```

---

## Task 6 — Closest Distance to a Parabola

**Problem.** Given `(a, b)`, find the point on `y = x²` closest to it.

**Python:**
```python
def closest_on_parabola(a, b):
    def d2(t):
        return (t - a) ** 2 + (t * t - b) ** 2
    R = max(10.0, abs(a) + abs(b) ** 0.5 + 5)
    lo, hi = -R, R
    for _ in range(300):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if d2(m1) > d2(m2): lo = m1
        else:               hi = m2
    t = (lo + hi) / 2
    return (t, t * t)
```

**Go:**
```go
import "math"
func closestOnParabola(a, b float64) (float64, float64) {
    d2 := func(t float64) float64 {
        return (t-a)*(t-a) + (t*t-b)*(t*t-b)
    }
    R := math.Max(10.0, math.Abs(a)+math.Sqrt(math.Max(0, b))+5)
    lo, hi := -R, R
    for i := 0; i < 300; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if d2(m1) > d2(m2) { lo = m1 } else { hi = m2 }
    }
    t := (lo + hi) / 2
    return t, t * t
}
```

**Java:**
```java
double[] closestOnParabola(double a, double b) {
    java.util.function.DoubleUnaryOperator d2 = t ->
        (t - a) * (t - a) + (t * t - b) * (t * t - b);
    double R = Math.max(10.0, Math.abs(a) + Math.sqrt(Math.max(0, b)) + 5);
    double lo = -R, hi = R;
    for (int i = 0; i < 300; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (d2.applyAsDouble(m1) > d2.applyAsDouble(m2)) lo = m1;
        else                                             hi = m2;
    }
    double t = (lo + hi) / 2;
    return new double[]{t, t * t};
}
```

---

## Task 7 — Minimize Time of Closest Approach

**Problem.** A car at position `(x0, y0)` moves with velocity `(vx, vy)`. Find the time `t* ≥ 0` minimizing distance to target `(a, b)`.

**Python:**
```python
def closest_time(x0, y0, vx, vy, a, b):
    def d(t):
        dx = (x0 + vx * t) - a
        dy = (y0 + vy * t) - b
        return (dx * dx + dy * dy) ** 0.5
    lo, hi = 0.0, 1e9
    for _ in range(300):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if d(m1) > d(m2): lo = m1
        else:             hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
import "math"
func closestTime(x0, y0, vx, vy, a, b float64) float64 {
    d := func(t float64) float64 {
        dx := (x0 + vx*t) - a
        dy := (y0 + vy*t) - b
        return math.Sqrt(dx*dx + dy*dy)
    }
    lo, hi := 0.0, 1e9
    for i := 0; i < 300; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if d(m1) > d(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double closestTime(double x0, double y0, double vx, double vy,
                   double a, double b) {
    java.util.function.DoubleUnaryOperator d = t -> {
        double dx = (x0 + vx * t) - a;
        double dy = (y0 + vy * t) - b;
        return Math.sqrt(dx * dx + dy * dy);
    };
    double lo = 0, hi = 1e9;
    for (int i = 0; i < 300; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (d.applyAsDouble(m1) > d.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2;
}
```

---

## Task 8 — Optimal Projectile Angle

**Problem.** Given target horizontal distance `D`, find the launch angle `θ ∈ (0, π/2)` that minimizes the launch speed needed to land at `D` (vacuum model). Optimum should be `π/4 = 45°`.

**Python:**
```python
import math
def optimal_angle(D):
    g = 9.8
    def speed_needed(theta):
        s = math.sin(2 * theta)
        if s <= 0: return float('inf')
        return math.sqrt(D * g / s)
    lo, hi = 1e-6, math.pi / 2 - 1e-6
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if speed_needed(m1) > speed_needed(m2): lo = m1
        else:                                   hi = m2
    return (lo + hi) / 2     # Expected: π/4 ≈ 0.7854
```

**Go:**
```go
import "math"
func optimalAngle(D float64) float64 {
    g := 9.8
    speedNeeded := func(theta float64) float64 {
        s := math.Sin(2 * theta)
        if s <= 0 { return math.Inf(1) }
        return math.Sqrt(D * g / s)
    }
    lo, hi := 1e-6, math.Pi/2 - 1e-6
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if speedNeeded(m1) > speedNeeded(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double optimalAngle(double D) {
    double g = 9.8;
    java.util.function.DoubleUnaryOperator speedNeeded = theta -> {
        double s = Math.sin(2 * theta);
        if (s <= 0) return Double.POSITIVE_INFINITY;
        return Math.sqrt(D * g / s);
    };
    double lo = 1e-6, hi = Math.PI / 2 - 1e-6;
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (speedNeeded.applyAsDouble(m1) > speedNeeded.applyAsDouble(m2)) lo = m1;
        else                                                               hi = m2;
    }
    return (lo + hi) / 2;
}
```

---

## Task 9 — Maximize Area of an Inscribed Rectangle

**Problem.** Inside the parabola `y = -x² + 4` and the x-axis, the largest axis-aligned rectangle has area `A(x) = 2x × (4 - x²)` for `x ∈ [0, 2]`. Find the `x` maximizing `A`.

**Python:**
```python
def max_inscribed_rectangle():
    A = lambda x: 2 * x * (4 - x * x)
    lo, hi = 0.0, 2.0
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if A(m1) < A(m2): lo = m1
        else:             hi = m2
    x = (lo + hi) / 2
    return x, A(x)           # Expected x ≈ 1.1547, area ≈ 6.158
```

**Go:**
```go
func maxInscribedRect() (float64, float64) {
    A := func(x float64) float64 { return 2 * x * (4 - x*x) }
    lo, hi := 0.0, 2.0
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if A(m1) < A(m2) { lo = m1 } else { hi = m2 }
    }
    x := (lo + hi) / 2
    return x, A(x)
}
```

**Java:**
```java
double[] maxInscribedRect() {
    java.util.function.DoubleUnaryOperator A = x -> 2 * x * (4 - x * x);
    double lo = 0, hi = 2;
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (A.applyAsDouble(m1) < A.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    double x = (lo + hi) / 2;
    return new double[]{x, A.applyAsDouble(x)};
}
```

---

## Task 10 — Find in Mountain Array (LeetCode 1095)

**Problem.** Locate `target` in a mountain array. First find the peak (ternary), then binary-search each side.

**Python:**
```python
def findInMountainArray(target, a):
    # Step 1: peak
    lo, hi = 0, len(a) - 1
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if a[m1] < a[m2]: lo = m1 + 1
        else:             hi = m2 - 1
    peak = max(range(lo, hi + 1), key=lambda i: a[i])

    # Step 2: ascending binary search [0, peak]
    lo, hi = 0, peak
    while lo <= hi:
        m = (lo + hi) // 2
        if a[m] == target: return m
        if a[m] < target: lo = m + 1
        else:             hi = m - 1

    # Step 3: descending binary search [peak, n-1]
    lo, hi = peak, len(a) - 1
    while lo <= hi:
        m = (lo + hi) // 2
        if a[m] == target: return m
        if a[m] > target: lo = m + 1   # descending
        else:             hi = m - 1
    return -1
```

**Go:**
```go
func findInMountainArray(target int, a []int) int {
    lo, hi := 0, len(a)-1
    for hi-lo > 2 {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if a[m1] < a[m2] { lo = m1 + 1 } else { hi = m2 - 1 }
    }
    peak := lo
    for i := lo + 1; i <= hi; i++ { if a[i] > a[peak] { peak = i } }

    lo, hi = 0, peak
    for lo <= hi {
        m := lo + (hi-lo)/2
        if a[m] == target { return m }
        if a[m] < target { lo = m + 1 } else { hi = m - 1 }
    }
    lo, hi = peak, len(a)-1
    for lo <= hi {
        m := lo + (hi-lo)/2
        if a[m] == target { return m }
        if a[m] > target { lo = m + 1 } else { hi = m - 1 }
    }
    return -1
}
```

**Java:**
```java
int findInMountainArray(int target, int[] a) {
    int lo = 0, hi = a.length - 1;
    while (hi - lo > 2) {
        int m1 = lo + (hi - lo) / 3;
        int m2 = hi - (hi - lo) / 3;
        if (a[m1] < a[m2]) lo = m1 + 1;
        else               hi = m2 - 1;
    }
    int peak = lo;
    for (int i = lo + 1; i <= hi; i++) if (a[i] > a[peak]) peak = i;

    int l = 0, h = peak;
    while (l <= h) {
        int m = l + (h - l) / 2;
        if (a[m] == target) return m;
        if (a[m] < target) l = m + 1; else h = m - 1;
    }
    l = peak; h = a.length - 1;
    while (l <= h) {
        int m = l + (h - l) / 2;
        if (a[m] == target) return m;
        if (a[m] > target) l = m + 1; else h = m - 1;
    }
    return -1;
}
```

---

## Task 11 — Golden-Section Search (Half the `f` Calls)

**Problem.** Implement golden-section search for argmax over `[lo, hi]` with precision `eps`. Should use **one new function call per iteration** after the first.

**Python:**
```python
import math
def golden_section_max(lo, hi, f, eps=1e-9):
    rho = (math.sqrt(5) - 1) / 2
    m1 = hi - rho * (hi - lo)
    m2 = lo + rho * (hi - lo)
    f1, f2 = f(m1), f(m2)
    while hi - lo > eps:
        if f1 < f2:
            lo = m1
            m1, f1 = m2, f2
            m2 = lo + rho * (hi - lo)
            f2 = f(m2)
        else:
            hi = m2
            m2, f2 = m1, f1
            m1 = hi - rho * (hi - lo)
            f1 = f(m1)
    return (lo + hi) / 2
```

**Go:**
```go
import "math"
func goldenSectionMax(lo, hi float64, f func(float64) float64, eps float64) float64 {
    rho := (math.Sqrt(5) - 1) / 2
    m1 := hi - rho*(hi-lo)
    m2 := lo + rho*(hi-lo)
    f1, f2 := f(m1), f(m2)
    for hi-lo > eps {
        if f1 < f2 {
            lo = m1
            m1, f1 = m2, f2
            m2 = lo + rho*(hi-lo)
            f2 = f(m2)
        } else {
            hi = m2
            m2, f2 = m1, f1
            m1 = hi - rho*(hi-lo)
            f1 = f(m1)
        }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double goldenSectionMax(double lo, double hi,
                        java.util.function.DoubleUnaryOperator f, double eps) {
    double rho = (Math.sqrt(5) - 1) / 2.0;
    double m1 = hi - rho * (hi - lo);
    double m2 = lo + rho * (hi - lo);
    double f1 = f.applyAsDouble(m1), f2 = f.applyAsDouble(m2);
    while (hi - lo > eps) {
        if (f1 < f2) {
            lo = m1;
            m1 = m2; f1 = f2;
            m2 = lo + rho * (hi - lo); f2 = f.applyAsDouble(m2);
        } else {
            hi = m2;
            m2 = m1; f2 = f1;
            m1 = hi - rho * (hi - lo); f1 = f.applyAsDouble(m1);
        }
    }
    return (lo + hi) / 2;
}
```

---

## Task 12 — Maximum-Throughput Send Rate (Noise-Tolerant Variant)

**Problem.** A network's measured throughput is unimodal in send-rate but noisy. Find the optimal rate by averaging `k = 5` samples per probe.

**Python:**
```python
def best_send_rate_robust(measure_once, k=5):
    """measure_once(rate) returns one noisy throughput sample."""
    def f(rate):
        return sum(measure_once(rate) for _ in range(k)) / k
    lo, hi = 1.0, 1e6
    for _ in range(50):     # fewer iters because each costs k samples
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) < f(m2): lo = m1
        else:             hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
func bestSendRateRobust(measureOnce func(float64) float64, k int) float64 {
    f := func(rate float64) float64 {
        total := 0.0
        for i := 0; i < k; i++ { total += measureOnce(rate) }
        return total / float64(k)
    }
    lo, hi := 1.0, 1e6
    for i := 0; i < 50; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if f(m1) < f(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double bestSendRateRobust(java.util.function.DoubleUnaryOperator measureOnce, int k) {
    java.util.function.DoubleUnaryOperator f = rate -> {
        double total = 0;
        for (int i = 0; i < k; i++) total += measureOnce.applyAsDouble(rate);
        return total / k;
    };
    double lo = 1, hi = 1e6;
    for (int i = 0; i < 50; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (f.applyAsDouble(m1) < f.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return (lo + hi) / 2;
}
```

---

## Task 13 — Nested Ternary for 2-D Unimodal Surface

**Problem.** `f(x, y) = -(x - 3)² - (y - 5)² + 100`. Find `argmax (x, y)` over `[0, 10] × [0, 10]`.

**Python:**
```python
def nested_ternary_max():
    f = lambda x, y: -(x - 3) ** 2 - (y - 5) ** 2 + 100
    def best_y(x):
        lo, hi = 0.0, 10.0
        for _ in range(100):
            m1 = lo + (hi - lo) / 3
            m2 = hi - (hi - lo) / 3
            if f(x, m1) < f(x, m2): lo = m1
            else:                   hi = m2
        return f(x, (lo + hi) / 2)

    lo, hi = 0.0, 10.0
    for _ in range(100):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if best_y(m1) < best_y(m2): lo = m1
        else:                       hi = m2
    return (lo + hi) / 2     # Expected x = 3 (and inner gives y = 5)
```

**Go:**
```go
func nestedTernaryMax() float64 {
    f := func(x, y float64) float64 { return -(x-3)*(x-3) - (y-5)*(y-5) + 100 }
    bestY := func(x float64) float64 {
        lo, hi := 0.0, 10.0
        for i := 0; i < 100; i++ {
            m1 := lo + (hi-lo)/3
            m2 := hi - (hi-lo)/3
            if f(x, m1) < f(x, m2) { lo = m1 } else { hi = m2 }
        }
        return f(x, (lo+hi)/2)
    }
    lo, hi := 0.0, 10.0
    for i := 0; i < 100; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if bestY(m1) < bestY(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double nestedTernaryMax() {
    java.util.function.DoubleBinaryOperator f =
        (x, y) -> -(x - 3) * (x - 3) - (y - 5) * (y - 5) + 100;
    java.util.function.DoubleUnaryOperator bestY = x -> {
        double lo = 0, hi = 10;
        for (int i = 0; i < 100; i++) {
            double m1 = lo + (hi - lo) / 3.0;
            double m2 = hi - (hi - lo) / 3.0;
            if (f.applyAsDouble(x, m1) < f.applyAsDouble(x, m2)) lo = m1;
            else                                                 hi = m2;
        }
        return f.applyAsDouble(x, (lo + hi) / 2);
    };
    double lo = 0, hi = 10;
    for (int i = 0; i < 100; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (bestY.applyAsDouble(m1) < bestY.applyAsDouble(m2)) lo = m1;
        else                                                   hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Complexity:** O(log² N) function evaluations.

---

## Task 14 — Ladder Around a Corner

**Problem.** Two corridors of widths `W` and `H` meet at a right angle. The longest ladder that can be carried around the corner is `min over θ ∈ (0, π/2) of (W / sin θ + H / cos θ)`. Find that minimum length.

**Python:**
```python
import math
def longest_ladder(W, H):
    def L(theta):
        return W / math.sin(theta) + H / math.cos(theta)
    lo, hi = 1e-6, math.pi / 2 - 1e-6
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if L(m1) > L(m2): lo = m1
        else:             hi = m2
    return L((lo + hi) / 2)
```

**Go:**
```go
import "math"
func longestLadder(W, H float64) float64 {
    L := func(theta float64) float64 {
        return W/math.Sin(theta) + H/math.Cos(theta)
    }
    lo, hi := 1e-6, math.Pi/2 - 1e-6
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if L(m1) > L(m2) { lo = m1 } else { hi = m2 }
    }
    return L((lo + hi) / 2)
}
```

**Java:**
```java
double longestLadder(double W, double H) {
    java.util.function.DoubleUnaryOperator L = theta ->
        W / Math.sin(theta) + H / Math.cos(theta);
    double lo = 1e-6, hi = Math.PI / 2 - 1e-6;
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (L.applyAsDouble(m1) > L.applyAsDouble(m2)) lo = m1;
        else                                           hi = m2;
    }
    return L.applyAsDouble((lo + hi) / 2);
}
```

**Aside:** For `W = H = 1`, the answer is `2^(3/2) ≈ 2.828`.

---

## Task 15 — Minimize Maximum Distance (Parametric Ternary)

**Problem.** Given `n` points on the x-axis at positions `p[i]`, place a new point `x ∈ [min(p), max(p)]` to minimize the maximum distance from `x` to any of the points (the 1-D 1-center problem).

**Python:**
```python
def one_center_1d(points):
    def max_dist(x):
        return max(abs(x - p) for p in points)
    lo, hi = min(points), max(points)
    for _ in range(200):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if max_dist(m1) > max_dist(m2): lo = m1
        else:                           hi = m2
    return (lo + hi) / 2
```

**Go:**
```go
import "math"
func oneCenter1D(points []float64) float64 {
    maxDist := func(x float64) float64 {
        m := 0.0
        for _, p := range points {
            d := math.Abs(x - p)
            if d > m { m = d }
        }
        return m
    }
    lo, hi := points[0], points[0]
    for _, p := range points {
        if p < lo { lo = p }
        if p > hi { hi = p }
    }
    for i := 0; i < 200; i++ {
        m1 := lo + (hi-lo)/3
        m2 := hi - (hi-lo)/3
        if maxDist(m1) > maxDist(m2) { lo = m1 } else { hi = m2 }
    }
    return (lo + hi) / 2
}
```

**Java:**
```java
double oneCenter1D(double[] points) {
    double lo = points[0], hi = points[0];
    for (double p : points) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    final double[] pts = points;
    java.util.function.DoubleUnaryOperator maxDist = x -> {
        double m = 0;
        for (double p : pts) m = Math.max(m, Math.abs(x - p));
        return m;
    };
    for (int i = 0; i < 200; i++) {
        double m1 = lo + (hi - lo) / 3.0;
        double m2 = hi - (hi - lo) / 3.0;
        if (maxDist.applyAsDouble(m1) > maxDist.applyAsDouble(m2)) lo = m1;
        else                                                       hi = m2;
    }
    return (lo + hi) / 2;
}
```

**Why ternary works:** `max_i |x - p[i]|` is the maximum of convex functions, which is itself convex (hence unimodal). Its minimum is found by ternary in 200 iterations × `n` evaluations.

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write ternary search on an integer unimodal array from memory in any of Go / Java / Python.
- [ ] Write real-valued ternary search with a fixed iteration count.
- [ ] Implement golden-section search and explain why it makes half as many function calls.
- [ ] Apply ternary to parametric problems (closest approach, optimal angle, longest ladder).
- [ ] Recognize when ternary works (strict unimodality) vs when it fails (multimodal, noisy, monotonic).
- [ ] Use nested ternary for 2-D unimodal optimization.
- [ ] Choose between ternary and binary based on whether the data is unimodal or monotonic.
- [ ] Identify when to use derivative-based methods instead (when `f'(x)` is available).

If any of these feel uncertain, revisit the relevant section of `junior.md` or `middle.md` and redo the task without looking at the solution.
