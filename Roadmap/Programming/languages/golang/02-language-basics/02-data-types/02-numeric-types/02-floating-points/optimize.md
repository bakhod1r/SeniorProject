# Floating Points in Go — Optimization Exercises

## Difficulty Legend
- 🟢 Easy
- 🟡 Medium
- 🔴 Hard

---

## Exercise 1 🟢 — Avoid Repeated Square Root in Distance Comparison

**Description:** A function finds the nearest point by computing full Euclidean distance (including sqrt) for every candidate point. The sqrt is expensive and unnecessary for comparison.

**Slow / Bad Code:**
```go
package main

import "math"

type Point struct{ X, Y float64 }

func nearest(points []Point, target Point) Point {
    minDist := math.MaxFloat64
    var closest Point
    for _, p := range points {
        dx := p.X - target.X
        dy := p.Y - target.Y
        dist := math.Sqrt(dx*dx + dy*dy) // expensive sqrt every iteration
        if dist < minDist {
            minDist = dist
            closest = p
        }
    }
    return closest
}
```

<details>
<summary>Hint</summary>

If `sqrt(a) < sqrt(b)` then `a < b`. You don't need the square root for comparison — just compare the squared distances directly.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func nearest(points []Point, target Point) Point {
    minDistSq := math.MaxFloat64
    var closest Point
    for _, p := range points {
        dx := p.X - target.X
        dy := p.Y - target.Y
        distSq := dx*dx + dy*dy // no sqrt — ~15x cheaper
        if distSq < minDistSq {
            minDistSq = distSq
            closest = p
        }
    }
    return closest
}
```

**Why it's faster:** `math.Sqrt` takes ~15-20 CPU cycles. Eliminating it from a loop over millions of points provides ~10-15× speedup on the comparison loop.

Only compute `math.Sqrt(minDistSq)` if you need the actual distance value at the end.

</details>

---

## Exercise 2 🟢 — Replace Division with Multiplication by Reciprocal

**Description:** A physics simulation normalizes thousands of vectors per frame by dividing each component by the length.

**Slow / Bad Code:**
```go
type Vec3 struct{ X, Y, Z float64 }

func normalizeMany(vecs []Vec3) {
    for i := range vecs {
        l := math.Sqrt(vecs[i].X*vecs[i].X + vecs[i].Y*vecs[i].Y + vecs[i].Z*vecs[i].Z)
        if l > 0 {
            vecs[i].X /= l  // 3 divisions per vector
            vecs[i].Y /= l
            vecs[i].Z /= l
        }
    }
}
```

<details>
<summary>Hint</summary>

Division is ~4x slower than multiplication. You can compute `1/l` once and multiply by it three times instead of dividing three times.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func normalizeMany(vecs []Vec3) {
    for i := range vecs {
        lSq := vecs[i].X*vecs[i].X + vecs[i].Y*vecs[i].Y + vecs[i].Z*vecs[i].Z
        if lSq > 0 {
            invL := 1.0 / math.Sqrt(lSq) // 1 division + 1 sqrt
            vecs[i].X *= invL             // 3 multiplications (cheap)
            vecs[i].Y *= invL
            vecs[i].Z *= invL
        }
    }
}
```

**Why it's faster:** Replaces 3 divisions (each ~13-14 cycles) with 1 division + 3 multiplications (each ~4 cycles). From ~42 cycles to ~16 cycles per vector = ~2.6× speedup.

**Note:** The result may differ by 1 ULP from the original — acceptable for graphics.

</details>

---

## Exercise 3 🟢 — Cache Expensive Math Operations

**Description:** A logging system formats floating-point timestamps repeatedly with the same value.

**Slow / Bad Code:**
```go
func formatAllMessages(messages []string, timestamp float64) []string {
    result := make([]string, len(messages))
    for i, msg := range messages {
        // Formats the same timestamp value on every iteration
        ts := strconv.FormatFloat(timestamp, 'f', 3, 64)
        result[i] = ts + " " + msg
    }
    return result
}
```

<details>
<summary>Hint</summary>

`strconv.FormatFloat` is called with the same arguments every iteration. Cache the result.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func formatAllMessages(messages []string, timestamp float64) []string {
    ts := strconv.FormatFloat(timestamp, 'f', 3, 64) // compute ONCE
    result := make([]string, len(messages))
    for i, msg := range messages {
        result[i] = ts + " " + msg
    }
    return result
}
```

**Why it's faster:** `strconv.FormatFloat` allocates and computes on every call. Moving it outside the loop means n-1 fewer allocations and string formatting operations. For 10,000 messages: from 10,000 allocations to 1.

</details>

---

## Exercise 4 🟡 — Use float32 for Large Slice to Improve Cache Performance

**Description:** A machine learning feature extraction function processes millions of sensor readings. Profiling shows memory bandwidth is the bottleneck.

**Slow / Bad Code:**
```go
type FeatureVector []float64  // 8 bytes per element

func extractFeatures(data []float64) FeatureVector {
    features := make(FeatureVector, len(data))
    for i, v := range data {
        features[i] = math.Tanh(v) * 0.5 + 0.5 // normalize to [0,1]
    }
    return features
}
// 1 million elements = 8MB — may not fit in L3 cache
```

<details>
<summary>Hint</summary>

If 7 decimal digits of precision is sufficient (it is for most ML use cases), use float32. Half the memory = twice as many elements fit in cache = nearly 2× throughput when memory-bound.

</details>

<details>
<summary>Optimized Solution</summary>

```go
type FeatureVector []float32  // 4 bytes per element

func extractFeatures(data []float64) FeatureVector {
    features := make(FeatureVector, len(data))
    for i, v := range data {
        // Compute in float64 (uses tanh), convert to float32 at store
        features[i] = float32(math.Tanh(v)*0.5 + 0.5)
    }
    return features
}
// 1 million elements = 4MB — fits in L3 cache on most CPUs

// Further optimization: if data is already float32:
func extractFeaturesF32(data []float32) FeatureVector {
    features := make(FeatureVector, len(data))
    for i, v := range data {
        f := float64(v)
        features[i] = float32(math.Tanh(f)*0.5 + 0.5)
    }
    return features
}
```

**Why it's faster:** Memory bandwidth is often the bottleneck for large array operations. Halving element size doubles effective cache capacity. On a memory-bound loop over 10M elements, this can give 1.5-2× speedup.

**Tradeoff:** 7 vs 15 significant digits — acceptable for normalized ML features.

</details>

---

## Exercise 5 🟡 — Polynomial Evaluation: Horner's Method

**Description:** A numerical library evaluates a polynomial with many terms using the direct formula.

**Slow / Bad Code:**
```go
// p(x) = a[0] + a[1]*x + a[2]*x² + ... + a[n]*x^n
func evalPoly(coeffs []float64, x float64) float64 {
    result := 0.0
    for i, c := range coeffs {
        result += c * math.Pow(x, float64(i)) // n multiplications + n pow calls
    }
    return result
}
// For n=10: 10 calls to math.Pow (each ~50-100 cycles) + 10 multiplications
```

<details>
<summary>Hint</summary>

Horner's method: `a[0] + x*(a[1] + x*(a[2] + x*a[3]))`. Work from the highest degree coefficient backwards, accumulating with one multiplication per step. No `math.Pow` needed.

</details>

<details>
<summary>Optimized Solution</summary>

```go
// Horner's method: n multiplications, 0 Pow calls, better numerical stability
func evalPoly(coeffs []float64, x float64) float64 {
    if len(coeffs) == 0 {
        return 0
    }
    result := coeffs[len(coeffs)-1]
    for i := len(coeffs) - 2; i >= 0; i-- {
        result = math.FMA(result, x, coeffs[i]) // result = result*x + coeffs[i]
    }
    return result
}

// Without FMA (still much faster than original):
func evalPolyNoFMA(coeffs []float64, x float64) float64 {
    result := coeffs[len(coeffs)-1]
    for i := len(coeffs) - 2; i >= 0; i-- {
        result = result*x + coeffs[i]
    }
    return result
}
```

**Why it's faster:**
- Eliminates all `math.Pow` calls (~50-100 cycles each)
- Uses only multiplications (~4 cycles) and additions (~4 cycles)
- For degree-10 polynomial: from ~600 cycles to ~90 cycles (~7× speedup)
- `math.FMA` version also improves numerical accuracy (single rounding per step)

</details>

---

## Exercise 6 🟡 — Precompute Trigonometry for Repeated Angle

**Description:** A game engine draws particles, each with the same rotation angle applied many times.

**Slow / Bad Code:**
```go
type Particle struct{ X, Y float64 }

func rotateParticles(particles []Particle, angleDeg float64) {
    for i := range particles {
        angle := angleDeg * math.Pi / 180.0        // same every iteration
        particles[i].X = particles[i].X*math.Cos(angle) - particles[i].Y*math.Sin(angle)
        particles[i].Y = particles[i].X*math.Sin(angle) + particles[i].Y*math.Cos(angle)
        // math.Cos and math.Sin called twice each per particle = 4 transcendental calls
    }
}
```

<details>
<summary>Hint</summary>

1. The angle-to-radians conversion is constant — move it out.
2. `math.Cos` and `math.Sin` are expensive (~50-100 cycles each). They only need to be called once, not per particle.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func rotateParticles(particles []Particle, angleDeg float64) {
    // Precompute: convert and compute trig ONCE (not per particle)
    angle := angleDeg * math.Pi / 180.0
    cos := math.Cos(angle) // ~50-100 cycles, but only once
    sin := math.Sin(angle) // ~50-100 cycles, but only once

    for i := range particles {
        x := particles[i].X
        y := particles[i].Y
        particles[i].X = x*cos - y*sin  // 2 muls + 1 sub
        particles[i].Y = x*sin + y*cos  // 2 muls + 1 add
    }
}

// Even better: use math.Sincos which computes both simultaneously
func rotateParticlesV2(particles []Particle, angleDeg float64) {
    sin, cos := math.Sincos(angleDeg * math.Pi / 180.0) // 1 call instead of 2
    for i := range particles {
        x, y := particles[i].X, particles[i].Y
        particles[i].X = x*cos - y*sin
        particles[i].Y = x*sin + y*cos
    }
}
```

**Why it's faster:**
- Move constant computation outside loop: angle conversion saves n multiplications
- Call trig once instead of 4 times per particle
- `math.Sincos` computes sin and cos together (only slightly faster than two separate calls on modern CPUs, but cleaner)
- For 10,000 particles: from ~4,000,000 cycles to ~200 cycles for trig + ~80,000 for arithmetic

</details>

---

## Exercise 7 🟡 — Accumulate with Kahan for Long Sums

**Description:** A data pipeline sums a billion small values. The naive sum loses precision.

**Slow / Bad Code:**
```go
func naiveSumStream(ch <-chan float64) float64 {
    sum := 0.0
    for v := range ch {
        sum += v  // accumulation error: O(n * epsilon * value)
    }
    return sum
}
```

<details>
<summary>Hint</summary>

The Kahan (compensated) summation algorithm adds a compensation term that captures the rounding error of each addition and feeds it back into the next step.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func kahanSumStream(ch <-chan float64) float64 {
    sum := 0.0
    c := 0.0 // compensation for lost low-order bits
    for v := range ch {
        y := v - c          // compensated value
        t := sum + y        // new sum (some low-order bits of y may be lost)
        c = (t - sum) - y   // (t - sum) recovers what was added; subtracting y gives the error
        sum = t
    }
    return sum + c // add final compensation
}

// For streaming with unknown end, use a struct:
type KahanAccumulator struct {
    sum float64
    c   float64
}

func (k *KahanAccumulator) Add(v float64) {
    y := v - k.c
    t := k.sum + y
    k.c = (t - k.sum) - y
    k.sum = t
}

func (k *KahanAccumulator) Result() float64 {
    return k.sum + k.c
}
```

**Performance note:** Kahan adds ~4 operations per element (sub, add, sub, sub). This is about 2× slower in operations, but the improved accuracy is worth it for precision-critical sums. On modern CPUs, the extra operations often fit in instruction-level parallelism, making it only ~1.2-1.5× slower than naive.

</details>

---

## Exercise 8 🟡 — Batch Float Validation with Early Exit

**Description:** An API validates an array of probability values. The current version always processes every element even after finding the first invalid one.

**Slow / Bad Code:**
```go
func validateProbabilities(probs []float64) []error {
    errs := []error{}
    for i, p := range probs {
        if math.IsNaN(p) {
            errs = append(errs, fmt.Errorf("index %d: NaN", i))
        }
        if math.IsInf(p, 0) {
            errs = append(errs, fmt.Errorf("index %d: Inf", i))
        }
        if p < 0 || p > 1 {
            errs = append(errs, fmt.Errorf("index %d: %v out of [0,1]", i, p))
        }
    }
    return errs // returns all errors but caller may only need first
}
```

<details>
<summary>Hint</summary>

Consider two optimizations: (1) if the caller only needs to know if there's any error (not all of them), return early on first error; (2) `math.IsNaN` and `math.IsInf` can be combined into a single check.

</details>

<details>
<summary>Optimized Solution</summary>

```go
// Fast path: just check if all valid (caller only needs bool)
func allValidProbabilities(probs []float64) bool {
    for _, p := range probs {
        // Combined check: NaN and Inf fail both comparisons
        // p >= 0 && p <= 1 handles NaN (NaN comparisons always false)
        if !(p >= 0 && p <= 1) {
            return false // early exit
        }
    }
    return true
}

// If you need error details but want to fail fast:
func validateFirstError(probs []float64) error {
    for i, p := range probs {
        if math.IsNaN(p) {
            return fmt.Errorf("index %d: NaN", i)
        }
        if math.IsInf(p, 0) {
            return fmt.Errorf("index %d: Inf", i)
        }
        if p < 0 || p > 1 {
            return fmt.Errorf("index %d: %v out of [0,1]", i, p)
        }
    }
    return nil
}
```

**Key insight:** `!(p >= 0 && p <= 1)` handles NaN without explicit `math.IsNaN` call, because any comparison with NaN returns false. So NaN fails the `p >= 0` check. This is one fewer function call per element.

**Why it's faster:** Early return on first error avoids processing the rest. For large inputs where errors are rare, this processes all elements. For inputs with early errors, it exits immediately. The simplified NaN check also saves the `math.IsNaN` call overhead.

</details>

---

## Exercise 9 🔴 — Replace math.Pow(x, 2) with x*x

**Description:** A geometric computation library uses `math.Pow` for squaring values in a tight loop.

**Slow / Bad Code:**
```go
func sumOfSquares(vals []float64) float64 {
    sum := 0.0
    for _, v := range vals {
        sum += math.Pow(v, 2)    // VERY slow: Pow uses logarithms internally
        // Equivalent: sum += math.Exp(2 * math.Log(v))
    }
    return sum
}
```

<details>
<summary>Hint</summary>

`math.Pow(x, 2)` is implemented using `math.Exp(2 * math.Log(x))` or similar — very expensive (~100+ cycles). For small integer exponents, direct multiplication is much faster.

</details>

<details>
<summary>Optimized Solution</summary>

```go
func sumOfSquares(vals []float64) float64 {
    sum := 0.0
    for _, v := range vals {
        sum += v * v  // 1 multiplication (~4 cycles) vs Pow (~100+ cycles)
    }
    return sum
}

// General rule for small integer exponents:
// x^2  → v*v
// x^3  → v*v*v
// x^4  → sq := v*v; sq*sq  (2 mults, not 3)
// x^8  → sq := v*v; q4 := sq*sq; q4*q4  (3 mults)
// x^n  → use binary exponentiation

func intPow(x float64, n int) float64 {
    if n == 0 { return 1 }
    if n < 0 { return 1 / intPow(x, -n) }
    result := 1.0
    for n > 0 {
        if n&1 == 1 {
            result *= x
        }
        x *= x
        n >>= 1
    }
    return result
}
```

**Performance:**
- `math.Pow(x, 2)`: ~100+ cycles (general algorithm using log/exp)
- `v * v`: ~4 cycles
- Speedup: ~25×

**Note:** `math.Pow` has special cases for integer exponents in recent Go versions, but `v*v` is still faster and clearer.

</details>

---

## Exercise 10 🔴 — Neumaier Sum for Mixed-Magnitude Values

**Description:** A financial system sums both very large (yearly revenue: 1e10) and very small (transaction fees: 0.01) values. Standard Kahan fails when the new value is LARGER than the current sum.

**Slow / Bad Code:**
```go
// Standard Kahan — misses some error cases
func kahanSum(vals []float64) float64 {
    sum, c := 0.0, 0.0
    for _, v := range vals {
        y := v - c
        t := sum + y
        c = (t - sum) - y
        sum = t
    }
    return sum
}

// This fails when a new value is much LARGER than the running sum:
// e.g., sum = 1e-10, v = 1e10
// y = 1e10, t = 1e10, c = (1e10 - 1e10) - 1e10 = -1e10 (WRONG!)
```

<details>
<summary>Hint</summary>

The Neumaier/improved Kahan algorithm adds a branch: if `|sum| >= |v|`, use the Kahan formula; otherwise, use the symmetric formula. This handles both cases correctly.

</details>

<details>
<summary>Optimized Solution</summary>

```go
// Neumaier improved Kahan sum — handles all cases correctly
func neumaierSum(vals []float64) float64 {
    sum := 0.0
    c := 0.0
    for _, v := range vals {
        t := sum + v
        if math.Abs(sum) >= math.Abs(v) {
            // Original Kahan: sum is bigger, v may be lost
            c += (sum - t) + v
        } else {
            // Symmetric case: v is bigger, sum may be lost
            c += (v - t) + sum
        }
        sum = t
    }
    return sum + c
}

// Demonstration:
func main() {
    // Mix of large and small values where Kahan struggles
    vals := []float64{1e10, 1.0, -1e10, 1.0} // expected sum: 2.0

    kahan := kahanSum(vals)
    neumaier := neumaierSum(vals)

    fmt.Printf("Kahan:    %v\n", kahan)    // may give 0.0 or 2.0 depending on order
    fmt.Printf("Neumaier: %v\n", neumaier) // always 2.0
    fmt.Printf("Expected: 2.0\n")
}
```

**Why Neumaier is better than Kahan:**
- Kahan assumes `|sum| >= |v|` always holds (the new value is smaller than running sum)
- Neumaier handles both orderings with a branch
- The branch overhead is small (~1 cycle for branch prediction hit)
- Accuracy is significantly better for mixed-magnitude sequences

**Performance vs accuracy:**
- Naive: O(n × ε × avg)
- Kahan: O(ε × total) for monotone sequences
- Neumaier: O(ε × total) always
- Overhead: ~6 ops per element (vs ~2 for naive), ~3 ops per element over Kahan

</details>

---

## Exercise 11 🔴 — SIMD-Friendly Loop Structure

**Description:** A signal processing function applies a coefficient to each sample. The current version has a conditional that prevents compiler vectorization.

**Slow / Bad Code:**
```go
func applyGain(samples []float64, gain float64, threshold float64) {
    for i := range samples {
        if samples[i] > threshold { // branch prevents vectorization
            samples[i] *= gain
        }
    }
}
```

<details>
<summary>Hint</summary>

Remove the branch from the inner loop. Instead of `if x > threshold { x *= gain }`, multiply everything but use a mask: first compute which elements are above threshold (0 or 1), then multiply by `gain` only for those.

</details>

<details>
<summary>Optimized Solution</summary>

```go
// Branchless version — compiler can vectorize with AVX2
func applyGain(samples []float64, gain float64, threshold float64) {
    for i := range samples {
        // Branchless: math.Max returns samples[i] if it > threshold
        // multiplied by gain; otherwise 0 * gain = 0... not quite right

        // Actually: use conditional assignment without branch
        above := samples[i] > threshold // bool
        var g float64
        if above {
            g = gain
        } else {
            g = 1.0 // multiply by 1 = no change
        }
        samples[i] *= g
    }
}

// Better: completely branchless using bit tricks
// Note: Go compiler may auto-vectorize the range loop above if pattern is simple
// Benchmark both to verify

// Most vectorization-friendly version:
func applyGainVec(samples []float64, gain float64, threshold float64) {
    gainMinus1 := gain - 1.0
    for i := range samples {
        // If above threshold: sample * gain = sample + sample*(gain-1)
        // If below threshold: sample * 1 = sample
        // Both can be expressed without branch using a float multiplier:
        var mask float64
        if samples[i] > threshold {
            mask = 1.0
        }
        samples[i] += samples[i] * gainMinus1 * mask
    }
}
```

**Performance note:** Loop vectorization depends heavily on the compiler and hardware. The key principles:
1. Remove data-dependent branches from inner loops
2. Keep the loop body simple (no function calls other than math builtins)
3. Avoid pointer aliasing (use `range` not pointer arithmetic)

Run `go build -gcflags="-S"` and look for `VMOVUPD`, `VMULPD` instructions — these indicate AVX2 vectorization.

</details>

---

## Exercise 12 🔴 — Batch NaN Detection using Bit Patterns

**Description:** An audio processing pipeline needs to detect NaN samples in large buffers. `math.IsNaN` calls have overhead for each element.

**Slow / Bad Code:**
```go
func hasNaN(samples []float64) bool {
    for _, s := range samples {
        if math.IsNaN(s) { // function call overhead per element
            return true
        }
    }
    return false
}
```

<details>
<summary>Hint</summary>

A float64 is NaN when exponent bits are all 1s (bits 62-52 = 0x7FF) and mantissa is nonzero. You can check this directly using `math.Float64bits` and bitwise operations — no function call needed. For even better performance, check multiple uint64 values using a vectorized pattern.

</details>

<details>
<summary>Optimized Solution</summary>

```go
import (
    "math"
    "unsafe"
)

// Optimized NaN detection using bit manipulation
func hasNaN(samples []float64) bool {
    for _, s := range samples {
        bits := math.Float64bits(s)
        // NaN: exponent = 0x7FF (all ones) AND mantissa != 0
        // = (bits & 0x7FFFFFFFFFFFFFFF) > 0x7FF0000000000000
        if (bits&0x7FFFFFFFFFFFFFFF) > 0x7FF0000000000000 {
            return true
        }
    }
    return false
}

// Even faster: reinterpret slice as []uint64 to avoid Float64bits calls
// WARNING: uses unsafe — only for performance-critical, tested code
func hasNaNUnsafe(samples []float64) bool {
    if len(samples) == 0 {
        return false
    }
    uints := (*[1 << 30]uint64)(unsafe.Pointer(&samples[0]))[:len(samples)]
    for _, b := range uints {
        if (b&0x7FFFFFFFFFFFFFFF) > 0x7FF0000000000000 {
            return true
        }
    }
    return false
}

// Standard approach: leverage the property NaN != NaN
// This is idiomatic and often vectorized by the compiler:
func hasNaNIdiomatic(samples []float64) bool {
    for _, s := range samples {
        if s != s { // NaN is the only float where x != x
            return true
        }
    }
    return false
}
```

**Why `s != s` works:** NaN is the only IEEE 754 value where self-comparison fails. Modern Go compilers recognize this pattern and generate efficient machine code. It's also cleaner than bit manipulation.

**Benchmark results (approximate, 1M elements):**
- `math.IsNaN`: ~3ms (function call overhead)
- `bits manipulation`: ~1ms
- `s != s`: ~0.8ms (compiler may vectorize UCOMISD)

</details>
