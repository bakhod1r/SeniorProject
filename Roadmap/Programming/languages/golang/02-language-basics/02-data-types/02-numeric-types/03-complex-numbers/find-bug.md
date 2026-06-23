# Complex Numbers — Find the Bug

## Bug #1 — Wrong Argument Order in complex()
**Difficulty**: 🟢 Easy

```go
c := complex(4, 3)  // BUG: should be complex(3, 4) for 3+4i
fmt.Println("Real:", real(c)) // Expected: 3, Actual: 4
fmt.Println("Imag:", imag(c)) // Expected: 4, Actual: 3
```

<details><summary>Bug Explanation</summary>
`complex(real, imaginary)` — real part is first, imaginary is second. Writing `complex(4, 3)` creates `4+3i`, not `3+4i`.
</details>

<details><summary>Fixed Code</summary>

```go
c := complex(3, 4)  // 3+4i: real=3, imag=4
```
</details>

---

## Bug #2 — NaN Comparison
**Difficulty**: 🟡 Medium

```go
import "math"

c1 := complex(math.NaN(), 0)
c2 := complex(math.NaN(), 0)
fmt.Println("Equal:", c1 == c2) // Expected: true, Actual: false
```

<details><summary>Bug Explanation</summary>
NaN != NaN is a fundamental IEEE 754 rule. Even though both complex numbers have the same "structure", the NaN comparison returns false. Never use == with NaN-containing values.
</details>

<details><summary>Fixed Code</summary>

```go
import "math"
import "math/cmplx"

func complexNaN() bool {
    return math.IsNaN(real(c1)) && math.IsNaN(real(c2))
}
// Or use cmplx.IsNaN(c) which checks both components
```
</details>

---

## Bug #3 — Using complex64 for High-Precision Calculation
**Difficulty**: 🟡 Medium

```go
// BUG: computing factorial using complex64 loses precision
var factorial complex64 = 1
for i := 1; i <= 20; i++ {
    factorial *= complex64(complex(float64(i), 0))
}
fmt.Println("20! =", real(factorial)) // Imprecise! float32 only has 7 digits
```

<details><summary>Fixed Code</summary>

```go
var factorial complex128 = 1
for i := 1; i <= 20; i++ {
    factorial *= complex(float64(i), 0)
}
fmt.Println("20! =", real(factorial)) // 2.432902008176640e+18 (15-16 digits)
```
</details>

---

## Bug #4 — Division by Zero Complex
**Difficulty**: 🟡 Medium

```go
numerator := 1 + 2i
denominator := 0 + 0i  // zero complex number
result := numerator / denominator
fmt.Println(result) // What happens?
```

<details><summary>Bug Explanation</summary>
Dividing by zero complex number gives `(NaN+NaN*i)` or `(Inf+Inf*i)` — no panic, just IEEE 754 special values. Unlike integer division, complex division by zero does not panic.
</details>

<details><summary>Fixed Code</summary>

```go
if real(denominator) == 0 && imag(denominator) == 0 {
    return fmt.Errorf("division by zero complex")
}
result := numerator / denominator
```
</details>

---

## Bug #5 — Wrong Magnitude Calculation
**Difficulty**: 🟢 Easy

```go
c := 3 + 4i
// BUG: using real and imag addition instead of Pythagorean theorem
magnitude := real(c) + imag(c)  // 7, not 5!
fmt.Println("Magnitude:", magnitude)
```

<details><summary>Fixed Code</summary>

```go
import (
    "math"
    "math/cmplx"
)

// Option 1: manual (Pythagorean theorem)
magnitude := math.Sqrt(real(c)*real(c) + imag(c)*imag(c))  // 5

// Option 2: cmplx.Abs (preferred, handles overflow)
magnitude2 := cmplx.Abs(c)  // 5
```
</details>

---

## Bug #6 — Incorrect Complex Conjugate
**Difficulty**: 🟢 Easy

```go
c := 3 + 4i
// BUG: negate both parts instead of just imaginary
conjugate := complex(-real(c), -imag(c))  // (-3-4i), not (3-4i)
fmt.Println("Conjugate:", conjugate)
```

<details><summary>Fixed Code</summary>

```go
conjugate := complex(real(c), -imag(c))  // (3-4i) — only negate imaginary part
// Verify: c * conjugate == |c|^2
product := c * conjugate
fmt.Println("c * conj =", product)  // (25+0i) — real number = |c|^2 = 9+16 = 25
```
</details>

---

## Bug #7 — Euler's Formula Sign Error
**Difficulty**: 🟡 Medium

```go
import "math"

// BUG: wrong sign in exponent
func eulerFormula(theta float64) complex128 {
    return complex(math.Cos(theta), -math.Sin(theta))  // BUG: should be +sin
    // e^(iθ) = cos(θ) + i*sin(θ)  (not -sin!)
}
```

<details><summary>Fixed Code</summary>

```go
func eulerFormula(theta float64) complex128 {
    return complex(math.Cos(theta), math.Sin(theta))
    // or: cmplx.Exp(complex(0, theta))
}
```
</details>

---

## Bug #8 — Mixing complex64 and complex128
**Difficulty**: 🟡 Medium

```go
var a complex64 = 1 + 2i
var b complex128 = 3 + 4i
// c := a + b  // BUG: compile error — mismatched types
```

<details><summary>Fixed Code</summary>

```go
// Must convert explicitly
c := complex128(a) + b  // convert complex64 to complex128 first
```
</details>

---

## Bug #9 — Incorrect DFT Formula (Sign Convention)
**Difficulty**: 🔴 Hard

```go
// BUG: wrong sign in DFT exponent
func dftBug(x []complex128) []complex128 {
    n := len(x)
    X := make([]complex128, n)
    for k := 0; k < n; k++ {
        for j := 0; j < n; j++ {
            angle := 2 * math.Pi * float64(k*j) / float64(n)  // BUG: should be negative
            X[k] += x[j] * complex(math.Cos(angle), math.Sin(angle))
        }
    }
    return X
}
```

<details><summary>Bug Explanation</summary>
The standard DFT formula uses e^(-2πi*k*j/N) (negative exponent). The positive exponent gives the inverse DFT. While both are valid mathematical transforms, using the wrong convention gives incorrect frequency ordering.
</details>

<details><summary>Fixed Code</summary>

```go
angle := -2 * math.Pi * float64(k*j) / float64(n)  // negative exponent for forward DFT
```
</details>

---

## Bug #10 — Phase Unwrapping Error
**Difficulty**: 🔴 Hard

```go
// BUG: assuming phase is always in [-π, π] without checking
func instantaneousFrequency(phases []float64) []float64 {
    freqs := make([]float64, len(phases)-1)
    for i := range freqs {
        freqs[i] = phases[i+1] - phases[i]  // BUG: phase jumps at ±π
    }
    return freqs
}
```

<details><summary>Fixed Code</summary>

```go
// Phase unwrapping: handle the 2π discontinuity
func instantaneousFrequency(phases []float64) []float64 {
    freqs := make([]float64, len(phases)-1)
    for i := range freqs {
        diff := phases[i+1] - phases[i]
        // Unwrap: bring difference to [-π, π]
        for diff > math.Pi  { diff -= 2 * math.Pi }
        for diff < -math.Pi { diff += 2 * math.Pi }
        freqs[i] = diff
    }
    return freqs
}
```
</details>

---

## Bug #11 — Forgetting to Take Real Part After Complex Calculation
**Difficulty**: 🟢 Easy

```go
// Computing power of a signal (should be real-valued)
func signalPower(x []complex128) complex128 {  // BUG: return type should be float64
    var sum complex128
    for _, v := range x {
        sum += v * complex(real(v), -imag(v))  // v * conj(v) = |v|^2 (real)
    }
    return sum / complex(float64(len(x)), 0)
}
// Caller gets (power+0i) — complex when float64 is expected
```

<details><summary>Fixed Code</summary>

```go
func signalPower(x []complex128) float64 {
    var sum float64
    for _, v := range x {
        sum += real(v)*real(v) + imag(v)*imag(v)  // |v|^2
    }
    return sum / float64(len(x))
}
```
</details>

---

## Bug #12 — Overflow in Complex Magnitude
**Difficulty**: 🔴 Hard

```go
import "math"

// BUG: naive magnitude calculation can overflow float64
func magnitude(c complex128) float64 {
    return math.Sqrt(real(c)*real(c) + imag(c)*imag(c))
    // If real(c) = 1e200, real(c)*real(c) = 1e400 which overflows float64!
}
```

<details><summary>Fixed Code</summary>

```go
import "math/cmplx"

// cmplx.Abs uses math.Hypot which handles overflow correctly
func magnitude(c complex128) float64 {
    return cmplx.Abs(c)
    // math.Hypot(a, b) = sqrt(a^2 + b^2) without overflow
    // Uses: result = max * sqrt(1 + (min/max)^2)
}
```
</details>

---

## Summary

| # | Difficulty | Issue |
|---|-----------|-------|
| 1 | 🟢 | complex() argument order |
| 2 | 🟡 | NaN comparison |
| 3 | 🟡 | complex64 precision |
| 4 | 🟡 | Division by zero |
| 5 | 🟢 | Magnitude formula |
| 6 | 🟢 | Conjugate formula |
| 7 | 🟡 | Euler formula sign |
| 8 | 🟡 | Type mismatch |
| 9 | 🔴 | DFT sign convention |
| 10 | 🔴 | Phase unwrapping |
| 11 | 🟢 | Real vs complex return |
| 12 | 🔴 | Overflow in magnitude |
