# Complex Numbers — Senior Level

## Introduction
> Focus: "How to optimize?" and "How to architect?"

Senior-level complex number usage in Go focuses on signal processing architecture, FFT optimization strategies, numerical stability, and integrating Go complex types with external libraries (FFTW, NumPy interop). This document also covers production use cases for complex numbers.

---

## Production Use Cases

### 1. Digital Signal Processing

```go
// Filter design: IIR filter using complex poles and zeros
type ComplexFilter struct {
    poles []complex128
    zeros []complex128
}

func (f *ComplexFilter) FrequencyResponse(freq float64, sampleRate float64) complex128 {
    z := cmplx.Exp(2i * math.Pi * complex(freq/sampleRate, 0))
    var numerator, denominator complex128 = 1, 1
    for _, zero := range f.zeros {
        numerator *= (z - zero)
    }
    for _, pole := range f.poles {
        denominator *= (z - pole)
    }
    return numerator / denominator
}
```

### 2. Radix-2 FFT Implementation

```go
// Cooley-Tukey FFT (power-of-2 length)
func fft(x []complex128) []complex128 {
    n := len(x)
    if n <= 1 {
        return x
    }
    // Split even/odd
    even := make([]complex128, n/2)
    odd := make([]complex128, n/2)
    for i := 0; i < n/2; i++ {
        even[i] = x[2*i]
        odd[i] = x[2*i+1]
    }
    // Recursive FFT
    even = fft(even)
    odd = fft(odd)
    // Combine
    result := make([]complex128, n)
    for k := 0; k < n/2; k++ {
        t := cmplx.Exp(complex(0, -2*math.Pi*float64(k)/float64(n))) * odd[k]
        result[k] = even[k] + t
        result[k+n/2] = even[k] - t
    }
    return result
}
```

---

## Numerical Stability

```go
// Catastrophic cancellation in complex subtraction
// When (a+bi) - (a+ci) where b≈c, relative error is amplified

// Use compensated summation for complex values
func kahanSumComplex(data []complex128) complex128 {
    var sum, comp complex128
    for _, v := range data {
        y := v - comp
        t := sum + y
        comp = (t - sum) - y
        sum = t
    }
    return sum
}
```

---

## Architecture: Complex Processing Pipeline

```go
type ComplexPipeline struct {
    stages []func([]complex128) []complex128
}

func (p *ComplexPipeline) AddStage(fn func([]complex128) []complex128) {
    p.stages = append(p.stages, fn)
}

func (p *ComplexPipeline) Process(input []complex128) []complex128 {
    result := input
    for _, stage := range p.stages {
        result = stage(result)
    }
    return result
}

// Usage:
pipeline := &ComplexPipeline{}
pipeline.AddStage(fft)
pipeline.AddStage(applyFilter)
pipeline.AddStage(ifft)
output := pipeline.Process(samples)
```

---

## Performance Optimization

```go
// In-place FFT to avoid allocations
func fftInPlace(x []complex128) {
    n := len(x)
    // Bit-reverse permutation
    for i, j := 1, 0; i < n; i++ {
        bit := n >> 1
        for ; j&bit != 0; bit >>= 1 {
            j ^= bit
        }
        j ^= bit
        if i < j {
            x[i], x[j] = x[j], x[i]
        }
    }
    // Butterfly operations
    for length := 2; length <= n; length <<= 1 {
        ang := 2 * math.Pi / float64(length)
        wlen := complex(math.Cos(ang), math.Sin(ang))
        for i := 0; i < n; i += length {
            w := complex128(1)
            for j := 0; j < length/2; j++ {
                u := x[i+j]
                v := x[i+j+length/2] * w
                x[i+j] = u + v
                x[i+j+length/2] = u - v
                w *= wlen
            }
        }
    }
}
```

---

## Postmortem: Complex Number Precision in FFT

**Case**: A medical imaging system used FFT with `complex64` (float32 internally). For large transforms (256K points), the accumulated rounding errors caused artifacts in MRI images. The fix was switching to `complex128` (float64 internally), which doubled memory usage but eliminated precision errors.

**Lesson**: Use `complex128` for any scientific computation where precision matters. Only use `complex64` when you explicitly know float32 precision is sufficient.

---

## Summary

At the senior level, complex numbers are tools for specific domains. Understanding FFT implementations, digital filter design, and numerical stability is key. Architecture decisions include pipeline design, in-place vs out-of-place transforms, and choosing complex64 vs complex128 based on precision requirements. For production DSP work, consider wrapping optimized C libraries (FFTW) via cgo.
