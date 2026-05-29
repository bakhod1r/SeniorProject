# Newton's Method — Practice Tasks

> 15 graded practice problems with full Go / Java / Python solutions. Each task starts with a **problem statement**, gives **constraints**, then provides three implementations. Difficulty grows from "warmup" to "this is hard".

---

## Task 1 — Integer Square Root (Babylonian)

**Problem.** Given a non-negative integer `n`, return `⌊√n⌋` without using `sqrt`.

**Constraints.** `0 <= n <= 2^63 − 1`.

**Go:**
```go
func isqrt(n int64) int64 {
    if n < 2 { return n }
    r := n
    for {
        next := (r + n/r) / 2
        if next >= r { return r }
        r = next
    }
}
```

**Java:**
```java
long isqrt(long n) {
    if (n < 2) return n;
    long r = n;
    while (true) {
        long next = (r + n / r) >>> 1;
        if (next >= r) return r;
        r = next;
    }
}
```

**Python:**
```python
def isqrt(n: int) -> int:
    if n < 2: return n
    r = n
    while True:
        nxt = (r + n // r) // 2
        if nxt >= r: return r
        r = nxt
```

---

## Task 2 — Real Square Root to 1e-12

**Problem.** Compute `√x` for `x >= 0` to relative precision `1e-12`.

**Go:**
```go
func sqrtReal(x float64) float64 {
    if x < 0 { return math.NaN() }
    if x == 0 { return 0 }
    r := x
    for i := 0; i < 100; i++ {
        next := 0.5 * (r + x/r)
        if math.Abs(next-r) < 1e-12*math.Abs(next) { return next }
        r = next
    }
    return r
}
```

**Java:**
```java
double sqrtReal(double x) {
    if (x < 0) return Double.NaN;
    if (x == 0) return 0;
    double r = x;
    for (int i = 0; i < 100; i++) {
        double next = 0.5 * (r + x / r);
        if (Math.abs(next - r) < 1e-12 * Math.abs(next)) return next;
        r = next;
    }
    return r;
}
```

**Python:**
```python
def sqrt_real(x: float) -> float:
    if x < 0: return float('nan')
    if x == 0: return 0.0
    r = x
    for _ in range(100):
        nxt = 0.5 * (r + x / r)
        if abs(nxt - r) < 1e-12 * abs(nxt): return nxt
        r = nxt
    return r
```

---

## Task 3 — Cube Root

**Problem.** Compute `∛x` for any real `x` to precision `1e-12`. Handle negative inputs.

**Go:**
```go
func cbrt(x float64) float64 {
    if x == 0 { return 0 }
    sign := 1.0
    if x < 0 { sign = -1; x = -x }
    y := math.Cbrt(x)            // seed from a fast estimate
    for i := 0; i < 50; i++ {
        next := (2*y + x/(y*y)) / 3
        if math.Abs(next-y) < 1e-15*math.Abs(next) { return sign * next }
        y = next
    }
    return sign * y
}
```

**Java:**
```java
double cbrt(double x) {
    if (x == 0) return 0;
    double sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    double y = Math.cbrt(x);
    for (int i = 0; i < 50; i++) {
        double next = (2 * y + x / (y * y)) / 3;
        if (Math.abs(next - y) < 1e-15 * Math.abs(next)) return sign * next;
        y = next;
    }
    return sign * y;
}
```

**Python:**
```python
def cbrt(x: float) -> float:
    if x == 0: return 0.0
    sign = 1 if x > 0 else -1
    x = abs(x)
    y = x ** (1/3)
    for _ in range(50):
        nxt = (2*y + x / (y*y)) / 3
        if abs(nxt - y) < 1e-15 * abs(nxt): return sign * nxt
        y = nxt
    return sign * y
```

---

## Task 4 — K-th Root

**Problem.** Compute `n^(1/k)` for `n >= 0`, integer `k >= 1`, to precision `1e-12`.

**Go:**
```go
func kthRoot(n float64, k int) float64 {
    if n < 0 { return math.NaN() }
    if n == 0 { return 0 }
    kf := float64(k)
    y := math.Pow(n, 1/kf)
    for i := 0; i < 50; i++ {
        next := ((kf-1)*y + n/math.Pow(y, kf-1)) / kf
        if math.Abs(next-y) < 1e-15*math.Abs(next) { return next }
        y = next
    }
    return y
}
```

**Java:**
```java
double kthRoot(double n, int k) {
    if (n < 0) return Double.NaN;
    if (n == 0) return 0;
    double kf = k;
    double y = Math.pow(n, 1.0 / k);
    for (int i = 0; i < 50; i++) {
        double next = ((kf - 1) * y + n / Math.pow(y, kf - 1)) / kf;
        if (Math.abs(next - y) < 1e-15 * Math.abs(next)) return next;
        y = next;
    }
    return y;
}
```

**Python:**
```python
def kth_root(n: float, k: int) -> float:
    if n < 0: return float('nan')
    if n == 0: return 0.0
    y = n ** (1/k)
    for _ in range(50):
        nxt = ((k - 1) * y + n / y**(k - 1)) / k
        if abs(nxt - y) < 1e-15 * abs(nxt): return nxt
        y = nxt
    return y
```

---

## Task 5 — Solve `cos(x) = x`

**Problem.** Find the value `r` with `cos(r) = r` (true value ≈ 0.7390851332151607).

**Go:**
```go
func cosEqX(x0 float64) float64 {
    x := x0
    for i := 0; i < 50; i++ {
        f  := math.Cos(x) - x
        fp := -math.Sin(x) - 1
        next := x - f/fp
        if math.Abs(next-x) < 1e-15 { return next }
        x = next
    }
    return x
}
```

**Java:**
```java
double cosEqX(double x0) {
    double x = x0;
    for (int i = 0; i < 50; i++) {
        double f  = Math.cos(x) - x;
        double fp = -Math.sin(x) - 1;
        double next = x - f / fp;
        if (Math.abs(next - x) < 1e-15) return next;
        x = next;
    }
    return x;
}
```

**Python:**
```python
import math
def cos_eq_x(x0: float = 0.5) -> float:
    x = x0
    for _ in range(50):
        f  = math.cos(x) - x
        fp = -math.sin(x) - 1
        nxt = x - f / fp
        if abs(nxt - x) < 1e-15: return nxt
        x = nxt
    return x
```

---

## Task 6 — Fast Inverse Square Root (Quake III)

**Problem.** Compute `1/√x` using the magic constant `0x5f3759df` and one Newton iteration. Input is a positive `float`.

**Go:**
```go
func fastInvSqrt(x float32) float32 {
    i := math.Float32bits(x)
    i = 0x5f3759df - (i >> 1)
    y := math.Float32frombits(i)
    y = y * (1.5 - 0.5*x*y*y)
    return y
}
```

**Java:**
```java
float fastInvSqrt(float x) {
    int i = Float.floatToRawIntBits(x);
    i = 0x5f3759df - (i >> 1);
    float y = Float.intBitsToFloat(i);
    y = y * (1.5f - 0.5f * x * y * y);
    return y;
}
```

**Python:**
```python
import struct
def fast_inv_sqrt(x: float) -> float:
    i = struct.unpack('I', struct.pack('f', x))[0]
    i = 0x5f3759df - (i >> 1)
    y = struct.unpack('f', struct.pack('I', i))[0]
    return y * (1.5 - 0.5 * x * y * y)
```

**Compare against `1/sqrt(x)`** — the error should be ≤ 0.2% (about 7 correct bits).

---

## Task 7 — Divide Without Division (Goldschmidt)

**Problem.** Compute `a / b` for `a >= 0, b > 0` using only `*`, `+`, `−`. Implement Newton on `1/b`.

**Strategy:** Scale `b` into `[0.5, 1.0]` first, then iterate `x' = x · (2 − b·x)` (about 30 iterations from `x_0 = 1`).

**Go:**
```go
func divide(a, b float64) float64 {
    if b <= 0 { panic("b must be positive") }
    e := math.Floor(math.Log2(b))
    scale := math.Pow(2, -e)
    bs := b * scale
    x := 1.5
    for i := 0; i < 30; i++ {
        x = x * (2 - bs*x)
    }
    return a * x * scale
}
```

**Java:**
```java
double divide(double a, double b) {
    if (b <= 0) throw new IllegalArgumentException();
    double e = Math.floor(Math.log(b) / Math.log(2));
    double scale = Math.pow(2, -e);
    double bs = b * scale;
    double x = 1.5;
    for (int i = 0; i < 30; i++) {
        x = x * (2 - bs * x);
    }
    return a * x * scale;
}
```

**Python:**
```python
import math
def divide(a: float, b: float) -> float:
    if b <= 0: raise ValueError
    e = math.floor(math.log2(b))
    scale = 2.0 ** -e
    bs = b * scale
    x = 1.5
    for _ in range(30):
        x = x * (2 - bs * x)
    return a * x * scale
```

---

## Task 8 — Root of a Polynomial

**Problem.** Find a real root of `p(x) = x⁵ + x − 1 = 0` (true root ≈ 0.7548776662) starting from `x_0 = 1.0`.

**Go:**
```go
func polyRoot(x0 float64) float64 {
    p  := func(x float64) float64 { return x*x*x*x*x + x - 1 }
    pp := func(x float64) float64 { return 5*x*x*x*x + 1 }
    x := x0
    for i := 0; i < 50; i++ {
        next := x - p(x)/pp(x)
        if math.Abs(next-x) < 1e-15 { return next }
        x = next
    }
    return x
}
```

**Java:**
```java
double polyRoot(double x0) {
    java.util.function.DoubleUnaryOperator p  = x -> x*x*x*x*x + x - 1;
    java.util.function.DoubleUnaryOperator pp = x -> 5*x*x*x*x + 1;
    double x = x0;
    for (int i = 0; i < 50; i++) {
        double next = x - p.applyAsDouble(x) / pp.applyAsDouble(x);
        if (Math.abs(next - x) < 1e-15) return next;
        x = next;
    }
    return x;
}
```

**Python:**
```python
def poly_root(x0: float = 1.0) -> float:
    p  = lambda x: x**5 + x - 1
    pp = lambda x: 5*x**4 + 1
    x = x0
    for _ in range(50):
        nxt = x - p(x) / pp(x)
        if abs(nxt - x) < 1e-15: return nxt
        x = nxt
    return x
```

---

## Task 9 — Bracketed Newton with Bisection Fallback

**Problem.** Implement a safe root finder: given a bracket `[a, b]` with `f(a)·f(b) < 0`, find the root using Newton when productive, else bisect. Demonstrate on `f(x) = x³ − 2x + 2` from bracket `[-2, 0]` (Newton from `x_0 = 0` would oscillate).

**Python:**
```python
def safe_newton(f, fp, a, b, eps=1e-12, max_iter=100):
    fa, fb = f(a), f(b)
    if fa == 0: return a
    if fb == 0: return b
    if fa * fb > 0: raise ValueError("no bracket")
    x = 0.5 * (a + b)
    for _ in range(max_iter):
        fx = f(x)
        if abs(fx) < eps: return x
        dfx = fp(x)
        x_new = None
        if dfx != 0:
            cand = x - fx / dfx
            if a < cand < b and abs(cand - x) < 0.5 * (b - a):
                x_new = cand
        if x_new is None:
            x_new = 0.5 * (a + b)
        x = x_new
        if f(x) * fa < 0:
            b = x
        else:
            a, fa = x, f(x)
    return x

# demo
root = safe_newton(
    lambda x: x**3 - 2*x + 2,
    lambda x: 3*x*x - 2,
    -2.0, 0.0
)
# root ≈ -1.7693
```

**Go:**
```go
func safeNewton(f, fp func(float64) float64, a, b, eps float64, maxIter int) float64 {
    fa, fb := f(a), f(b)
    if fa == 0 { return a }
    if fb == 0 { return b }
    if fa*fb > 0 { panic("no bracket") }
    x := 0.5 * (a + b)
    for i := 0; i < maxIter; i++ {
        fx := f(x)
        if math.Abs(fx) < eps { return x }
        used := false
        var xNew float64
        if dfx := fp(x); dfx != 0 {
            cand := x - fx/dfx
            if cand > a && cand < b && math.Abs(cand-x) < 0.5*(b-a) {
                xNew = cand; used = true
            }
        }
        if !used { xNew = 0.5 * (a + b) }
        x = xNew
        if f(x)*fa < 0 { b = x } else { a = x; fa = f(x) }
    }
    return x
}
```

**Java:**
```java
double safeNewton(DoubleUnaryOperator f, DoubleUnaryOperator fp,
                  double a, double b, double eps, int maxIter) {
    double fa = f.applyAsDouble(a), fb = f.applyAsDouble(b);
    if (fa == 0) return a;
    if (fb == 0) return b;
    if (fa * fb > 0) throw new IllegalArgumentException("no bracket");
    double x = 0.5 * (a + b);
    for (int i = 0; i < maxIter; i++) {
        double fx = f.applyAsDouble(x);
        if (Math.abs(fx) < eps) return x;
        double dfx = fp.applyAsDouble(x);
        boolean used = false; double xNew = 0;
        if (dfx != 0) {
            double cand = x - fx / dfx;
            if (cand > a && cand < b && Math.abs(cand - x) < 0.5 * (b - a)) {
                xNew = cand; used = true;
            }
        }
        if (!used) xNew = 0.5 * (a + b);
        x = xNew;
        if (f.applyAsDouble(x) * fa < 0) b = x;
        else { a = x; fa = f.applyAsDouble(x); }
    }
    return x;
}
```

---

## Task 10 — Secant Method (Newton Without `f'`)

**Problem.** Find a root of `f(x) = e^x − 2x − 1` using the secant method (do not compute the derivative analytically). Seed: `x_0 = 0`, `x_1 = 2`.

**Python:**
```python
import math
def secant_solve(x0: float, x1: float, eps=1e-12, max_iter=100) -> float:
    f = lambda x: math.exp(x) - 2*x - 1
    f0, f1 = f(x0), f(x1)
    for _ in range(max_iter):
        if f1 == f0: raise ZeroDivisionError
        x2 = x1 - f1 * (x1 - x0) / (f1 - f0)
        if abs(x2 - x1) < eps: return x2
        x0, x1, f0, f1 = x1, x2, f1, f(x2)
    raise RuntimeError
```

**Go:**
```go
func secantSolve(x0, x1 float64) float64 {
    f := func(x float64) float64 { return math.Exp(x) - 2*x - 1 }
    f0, f1 := f(x0), f(x1)
    for i := 0; i < 100; i++ {
        if f1 == f0 { return x1 }
        x2 := x1 - f1*(x1-x0)/(f1-f0)
        if math.Abs(x2-x1) < 1e-12 { return x2 }
        x0, x1, f0, f1 = x1, x2, f1, f(x2)
    }
    return x1
}
```

**Java:**
```java
double secantSolve(double x0, double x1) {
    DoubleUnaryOperator f = x -> Math.exp(x) - 2*x - 1;
    double f0 = f.applyAsDouble(x0), f1 = f.applyAsDouble(x1);
    for (int i = 0; i < 100; i++) {
        if (f1 == f0) return x1;
        double x2 = x1 - f1 * (x1 - x0) / (f1 - f0);
        if (Math.abs(x2 - x1) < 1e-12) return x2;
        x0 = x1; x1 = x2; f0 = f1; f1 = f.applyAsDouble(x2);
    }
    return x1;
}
```

---

## Task 11 — Demonstrate Oscillation Failure

**Problem.** Run Newton on `f(x) = x³ − 2x + 2` from `x_0 = 0` and detect the oscillation `0 → 1 → 0 → 1 → ...`. Return `None` after detection rather than looping forever.

**Python:**
```python
def detect_cycle(x0: float, max_iter=50):
    f  = lambda x: x**3 - 2*x + 2
    fp = lambda x: 3*x*x - 2
    history = [x0]
    x = x0
    for _ in range(max_iter):
        if fp(x) == 0: return None
        x = x - f(x) / fp(x)
        if any(abs(x - h) < 1e-10 for h in history[-3:]):
            return None       # cycling
        if abs(f(x)) < 1e-12: return x
        history.append(x)
    return None
```

**Go:**
```go
func detectCycle(x0 float64) (float64, bool) {
    f  := func(x float64) float64 { return x*x*x - 2*x + 2 }
    fp := func(x float64) float64 { return 3*x*x - 2 }
    var hist []float64
    hist = append(hist, x0)
    x := x0
    for i := 0; i < 50; i++ {
        if fp(x) == 0 { return 0, false }
        x = x - f(x)/fp(x)
        for _, h := range hist {
            if math.Abs(x-h) < 1e-10 { return 0, false }
        }
        if math.Abs(f(x)) < 1e-12 { return x, true }
        hist = append(hist, x)
    }
    return 0, false
}
```

**Java:**
```java
Double detectCycle(double x0) {
    DoubleUnaryOperator f  = x -> x*x*x - 2*x + 2;
    DoubleUnaryOperator fp = x -> 3*x*x - 2;
    java.util.List<Double> hist = new java.util.ArrayList<>();
    hist.add(x0);
    double x = x0;
    for (int i = 0; i < 50; i++) {
        if (fp.applyAsDouble(x) == 0) return null;
        x = x - f.applyAsDouble(x) / fp.applyAsDouble(x);
        for (double h : hist) {
            if (Math.abs(x - h) < 1e-10) return null;
        }
        if (Math.abs(f.applyAsDouble(x)) < 1e-12) return x;
        hist.add(x);
    }
    return null;
}
```

---

## Task 12 — Verify Quadratic Convergence Numerically

**Problem.** Compute `√2` by Newton from `x_0 = 1`. Print the error `|x_n − √2|` after each step and verify that `e_{n+1} / e_n²` approaches a constant.

**Python:**
```python
import math
def verify_quadratic():
    r = math.sqrt(2)
    x = 1.0
    errs = []
    for _ in range(10):
        x = 0.5 * (x + 2/x)
        errs.append(abs(x - r))
    for i in range(1, len(errs)):
        if errs[i-1] > 1e-300:
            ratio = errs[i] / (errs[i-1] ** 2)
            print(f"step {i}: err={errs[i]:.3e}, e_n+1/e_n^2 = {ratio:.4f}")
```

**Go:**
```go
func verifyQuadratic() {
    r := math.Sqrt(2)
    x := 1.0
    var errs []float64
    for i := 0; i < 10; i++ {
        x = 0.5 * (x + 2/x)
        errs = append(errs, math.Abs(x-r))
    }
    for i := 1; i < len(errs); i++ {
        if errs[i-1] > 1e-300 {
            ratio := errs[i] / (errs[i-1] * errs[i-1])
            fmt.Printf("step %d: err=%.3e, e_n+1/e_n^2 = %.4f\n", i, errs[i], ratio)
        }
    }
}
```

**Java:**
```java
void verifyQuadratic() {
    double r = Math.sqrt(2);
    double x = 1.0;
    double[] errs = new double[10];
    for (int i = 0; i < 10; i++) {
        x = 0.5 * (x + 2/x);
        errs[i] = Math.abs(x - r);
    }
    for (int i = 1; i < errs.length; i++) {
        if (errs[i-1] > 1e-300) {
            double ratio = errs[i] / (errs[i-1] * errs[i-1]);
            System.out.printf("step %d: err=%.3e, e_n+1/e_n^2 = %.4f%n", i, errs[i], ratio);
        }
    }
}
```

The expected `e_{n+1}/e_n²` value is `1/(2√2) ≈ 0.3536` (from the formula `½ · f''/f' = ½ · 2/(2x) = 1/(2x)` at the root `x = √2`).

---

## Task 13 — Logistic Regression via Newton (IRLS)

**Problem.** Fit `p = σ(β₀ + β₁x)` to a small toy dataset using IRLS (Newton on the log-likelihood gradient). Use ≤ 20 iterations.

**Python:**
```python
import numpy as np

def fit_logistic(X, y, max_iter=20, eps=1e-10):
    """
    X: (n, d) matrix (include a column of 1s for intercept)
    y: (n,) binary labels (0/1)
    Returns: beta (d,)
    """
    n, d = X.shape
    beta = np.zeros(d)
    for _ in range(max_iter):
        z = X @ beta
        p = 1 / (1 + np.exp(-z))
        W = np.diag(p * (1 - p))
        grad = X.T @ (y - p)
        H    = -X.T @ W @ X
        delta = np.linalg.solve(H, -grad)   # Newton step
        beta += delta
        if np.linalg.norm(delta) < eps: break
    return beta

# Toy demo
X = np.array([[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]], float)
y = np.array([0, 0, 1, 1, 1])
print(fit_logistic(X, y))
```

**Go/Java:** equivalent dense-matrix code using `gonum/mat` or `Apache Commons Math`.

---

## Task 14 — Newton for Optimization (Minimize a Smooth Function)

**Problem.** Minimize `g(x) = x⁴ − 4x² + 5` using Newton on `g'(x) = 0`. Compare with gradient descent.

**Python:**
```python
def minimize_g(x0=1.0):
    gp  = lambda x: 4*x**3 - 8*x
    gpp = lambda x: 12*x*x - 8
    x = x0
    for _ in range(50):
        nxt = x - gp(x) / gpp(x)
        if abs(nxt - x) < 1e-15: return nxt
        x = nxt
    return x
```

**Go:**
```go
func minimizeG(x0 float64) float64 {
    gp  := func(x float64) float64 { return 4*x*x*x - 8*x }
    gpp := func(x float64) float64 { return 12*x*x - 8 }
    x := x0
    for i := 0; i < 50; i++ {
        next := x - gp(x)/gpp(x)
        if math.Abs(next-x) < 1e-15 { return next }
        x = next
    }
    return x
}
```

**Java:**
```java
double minimizeG(double x0) {
    DoubleUnaryOperator gp  = x -> 4*x*x*x - 8*x;
    DoubleUnaryOperator gpp = x -> 12*x*x - 8;
    double x = x0;
    for (int i = 0; i < 50; i++) {
        double next = x - gp.applyAsDouble(x) / gpp.applyAsDouble(x);
        if (Math.abs(next - x) < 1e-15) return next;
        x = next;
    }
    return x;
}
```

**Discussion:** the true minima are at `±√2`. Starting at `x_0 = 1.0`, Newton converges to `+√2` in ~5 iterations. Gradient descent with a fixed step size `η = 0.01` takes ~200 iterations.

---

## Task 15 — Complex Newton: Find Cube Root of Unity

**Problem.** Find a complex cube root of `1` (`z³ = 1`) by Newton starting from a complex seed. Three roots: `1`, `e^{2πi/3}`, `e^{4πi/3}`. Demonstrate that the basin of attraction depends sensitively on the seed.

**Python:**
```python
def complex_newton(z0: complex, max_iter=50) -> complex:
    z = z0
    for _ in range(max_iter):
        if z == 0: return None
        z_new = (2*z + 1/(z*z)) / 3
        if abs(z_new - z) < 1e-15: return z_new
        z = z_new
    return z

# Different seeds → different roots
print(complex_newton( 1 + 0.5j))    # → 1
print(complex_newton(-1 - 0.5j))    # → e^{-2πi/3}
print(complex_newton(-0.5 + 1j))    # → e^{2πi/3}
```

**Go:**
```go
import "math/cmplx"

func complexNewton(z0 complex128) complex128 {
    z := z0
    for i := 0; i < 50; i++ {
        if z == 0 { return z }
        zNew := (2*z + 1/(z*z)) / 3
        if cmplx.Abs(zNew-z) < 1e-15 { return zNew }
        z = zNew
    }
    return z
}
```

**Java:**
```java
import org.apache.commons.math3.complex.Complex;

Complex complexNewton(Complex z0) {
    Complex z = z0;
    Complex three = new Complex(3);
    Complex two   = new Complex(2);
    for (int i = 0; i < 50; i++) {
        if (z.abs() < 1e-300) return z;
        Complex zNew = two.multiply(z).add(z.multiply(z).reciprocal()).divide(three);
        if (zNew.subtract(z).abs() < 1e-15) return zNew;
        z = zNew;
    }
    return z;
}
```

---

## Self-Check

After completing these tasks, you should be able to:

- [ ] Write Newton's method from memory in any of Go / Java / Python.
- [ ] Derive the Babylonian sqrt formula from Newton on `x² − n`.
- [ ] Derive the Goldschmidt reciprocal `x · (2 − n·x)` from Newton on `1/x − n`.
- [ ] Explain the Quake III fast inverse square root, including the role of the magic constant.
- [ ] Recognize that Newton can oscillate (`x³ − 2x + 2` from `x_0 = 0`) and code a detector.
- [ ] Build a safe Newton + bisection hybrid (the Brent skeleton).
- [ ] Distinguish "Newton for root-finding" from "Newton for optimization" (the latter uses `f''`).
- [ ] Verify quadratic convergence numerically by checking `|e_{n+1}|/|e_n|²` is bounded.
- [ ] Recognize when to fall back to secant (no derivative) or Brent (need robustness).

If any of these feel uncertain, revisit the relevant section of `junior.md` or `middle.md` and redo the task without looking at the solution.
