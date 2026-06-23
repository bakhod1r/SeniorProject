# Complex Numbers — Optimization Exercises

## Exercise #1 — Use cmplx.Abs Instead of Manual Magnitude
**Difficulty**: 🟢 Easy | **Category**: 🔄 Correctness + ⚡ Speed

```go
// Unsafe: can overflow for large components
func magnitude(c complex128) float64 {
    return math.Sqrt(real(c)*real(c) + imag(c)*imag(c))
}
```

<details><summary>Optimized Solution</summary>

```go
import "math/cmplx"
func magnitude(c complex128) float64 {
    return cmplx.Abs(c)  // Uses math.Hypot internally — overflow-safe
}
```
</details>

---

## Exercise #2 — Complex64 for Large Arrays
**Difficulty**: 🟡 Medium | **Category**: 💾 Memory

```go
// Uses 16 bytes per element
type FFTBuffer struct {
    data []complex128
}
// For 1M samples: 16MB memory
```

<details><summary>Optimized Solution</summary>

```go
// Use complex64 when float32 precision is sufficient (6-7 digits)
type FFTBuffer struct {
    data []complex64
}
// For 1M samples: 8MB memory (50% savings)
// Also: 2x more values per cache line → better performance

// When to use complex64: audio processing, graphics, ML inference
// When to keep complex128: scientific measurement, navigation, physics
```
</details>

---

## Exercise #3 — Avoid Redundant complex() Calls
**Difficulty**: 🟢 Easy | **Category**: ⚡ Speed

```go
// Creating complex from float components repeatedly
func makeSignal(n int, freq float64) []complex128 {
    sig := make([]complex128, n)
    for i := range sig {
        angle := 2 * math.Pi * freq * float64(i)
        re := math.Cos(angle)
        im := math.Sin(angle)
        sig[i] = complex(re, im)  // OK but can precompute step
    }
    return sig
}
```

<details><summary>Optimized Solution</summary>

```go
func makeSignalFast(n int, freq float64) []complex128 {
    sig := make([]complex128, n)
    // Precompute rotation step (avoids n trig calls → 1 trig call)
    step := cmplx.Exp(complex(0, 2*math.Pi*freq))
    phasor := complex128(1)
    for i := range sig {
        sig[i] = phasor
        phasor *= step  // rotate by step angle each iteration
    }
    return sig
    // n trig calls → 2 trig calls + n complex multiplications
}
```
</details>

---

## Exercise #4 — In-Place FFT to Avoid Allocations
**Difficulty**: 🔴 Hard | **Category**: 💾 Memory + ⚡ Speed

```go
// Allocating FFT (creates new slices)
func fftAlloc(x []complex128) []complex128 {
    n := len(x)
    if n <= 1 { return append([]complex128{}, x...) }
    even := fftAlloc(x[0::2])  // new allocation each recursion
    odd  := fftAlloc(x[1::2])
    // ... combine
    return result
}
```

<details><summary>Optimized Solution</summary>

```go
// In-place iterative FFT (no allocations)
func fftInPlace(x []complex128) {
    n := len(x)
    // Bit-reverse permutation (in-place)
    for i, j := 1, 0; i < n; i++ {
        bit := n >> 1
        for ; j&bit != 0; bit >>= 1 { j ^= bit }
        j ^= bit
        if i < j { x[i], x[j] = x[j], x[i] }
    }
    // Butterfly operations (in-place)
    for length := 2; length <= n; length <<= 1 {
        ang := 2 * math.Pi / float64(length)
        wlen := complex(math.Cos(ang), math.Sin(ang))
        for i := 0; i < n; i += length {
            w := complex128(1)
            for j := 0; j < length/2; j++ {
                u, v := x[i+j], x[i+j+length/2]*w
                x[i+j] = u + v
                x[i+j+length/2] = u - v
                w *= wlen
            }
        }
    }
}
// Zero allocations vs O(n log n) allocations in recursive version
```
</details>

---

## Exercise #5 — Batch Complex Operations
**Difficulty**: 🟡 Medium | **Category**: ⚡ Speed

```go
// Process complex numbers one at a time
func computeMagnitudes(data []complex128) []float64 {
    result := make([]float64, len(data))
    for i, c := range data {
        result[i] = cmplx.Abs(c)
    }
    return result
}
```

<details><summary>Optimized Solution</summary>

```go
import "math"

// Manual implementation avoids function call overhead in hot loop
func computeMagnitudesFast(data []complex128) []float64 {
    result := make([]float64, len(data))
    for i, c := range data {
        r, im := real(c), imag(c)
        result[i] = math.Sqrt(r*r + im*im)
        // Faster than cmplx.Abs for non-overflow inputs (avoids hypot overhead)
    }
    return result
}
```
</details>

---

## Exercise #6 — Precompute Twiddle Factors
**Difficulty**: 🔴 Hard | **Category**: ⚡ Speed

```go
// FFT recomputes twiddle factors on every call
func fftWithRecompute(x []complex128) {
    for length := 2; length <= len(x); length <<= 1 {
        ang := 2 * math.Pi / float64(length)
        // These cos/sin computations repeat for every FFT call!
        wlen := complex(math.Cos(ang), math.Sin(ang))
        // ...
    }
}
```

<details><summary>Optimized Solution</summary>

```go
// Precompute twiddle factors once for a given FFT size
type FFTEngine struct {
    n       int
    twiddle []complex128  // precomputed
}

func NewFFTEngine(n int) *FFTEngine {
    twiddle := make([]complex128, n/2)
    for k := 0; k < n/2; k++ {
        angle := -2 * math.Pi * float64(k) / float64(n)
        twiddle[k] = complex(math.Cos(angle), math.Sin(angle))
    }
    return &FFTEngine{n: n, twiddle: twiddle}
}

func (e *FFTEngine) Transform(x []complex128) {
    // Use precomputed e.twiddle instead of cos/sin in inner loop
    // 2 trig calls at init vs 2*log2(n) per transform call
}
```
</details>

---

## Exercise #7 — Struct-of-Arrays for Complex Batch Processing
**Difficulty**: 🔴 Hard | **Category**: 💾 Memory + ⚡ Speed

```go
// Array-of-Structs (AoS) — complex128 interleaves real and imag
type Signal []complex128
// Memory: [re0,im0,re1,im1,re2,im2,...] (interleaved)
// SIMD: harder to vectorize with 64-bit floats
```

<details><summary>Optimized Solution</summary>

```go
// Struct-of-Arrays (SoA) — separate real and imag arrays
type SignalSoA struct {
    Real []float64
    Imag []float64
}

// Benefits:
// 1. SIMD can process 4 real values (or 4 imag values) simultaneously with AVX
// 2. If you only need magnitudes (no phase), only read Real/Imag, not interleaved
// 3. Better cache utilization for operations that only touch one component

func (s *SignalSoA) Magnitudes() []float64 {
    result := make([]float64, len(s.Real))
    for i := range result {
        r, im := s.Real[i], s.Imag[i]
        result[i] = math.Sqrt(r*r + im*im)
    }
    return result
}
```
</details>

---

## Summary

| # | Category | Technique |
|---|----------|-----------|
| 1 | 🔄 | Use cmplx.Abs (overflow-safe) |
| 2 | 💾 | complex64 for large arrays |
| 3 | ⚡ | Phasor rotation avoids trig calls |
| 4 | 💾 | In-place iterative FFT |
| 5 | ⚡ | Inline magnitude for hot loops |
| 6 | ⚡ | Precompute twiddle factors |
| 7 | 💾 | SoA layout for SIMD |
