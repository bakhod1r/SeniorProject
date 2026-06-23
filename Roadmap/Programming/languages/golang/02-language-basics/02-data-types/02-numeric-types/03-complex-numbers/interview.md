# Complex Numbers — Interview Questions

## Junior Level

### Q1: What are Go's two complex number types?
**Answer**: `complex64` (uses two float32) and `complex128` (uses two float64).

```go
var c64 complex64  = 3 + 4i   // float32 components
var c128 complex128 = 3 + 4i  // float64 components (default)
lit := 3 + 4i                  // type: complex128 (default)
```

### Q2: How do you extract real and imaginary parts?
**Answer**: Use the built-in `real()` and `imag()` functions.

```go
c := 3 + 4i
fmt.Println(real(c))  // 3
fmt.Println(imag(c))  // 4
```

### Q3: How do you create a complex number from variables?
**Answer**: Use the built-in `complex(real, imag)` function.

```go
r, i := 3.0, 4.0
c := complex(r, i)  // (3+4i)
```

### Q4: What package provides complex math functions?
**Answer**: `math/cmplx`

```go
import "math/cmplx"
c := 3 + 4i
fmt.Println(cmplx.Abs(c))   // 5 (magnitude)
fmt.Println(cmplx.Phase(c)) // arctan(4/3)
fmt.Println(cmplx.Sqrt(-1+0i)) // (0+1i)
```

### Q5: What is the zero value of complex128?
**Answer**: `(0+0i)` — both real and imaginary parts are 0.

---

## Middle Level

### Q6: When would you use complex64 vs complex128?
**Answer**: `complex64` uses half the memory (8 vs 16 bytes) and may be faster with SIMD operations. Use it when: (1) float32 precision is sufficient for your calculations, (2) you have large arrays of complex values and memory/cache matters. Use `complex128` for scientific computing where precision matters.

### Q7: Implement the magnitude of a complex number without using cmplx.Abs.
```go
func magnitude(c complex128) float64 {
    return math.Sqrt(real(c)*real(c) + imag(c)*imag(c))
}
// Note: cmplx.Abs uses math.Hypot for better numerical stability
// (avoids overflow when components are very large)
```

### Q8: What is Euler's formula and how do you verify it in Go?
**Answer**: Euler's formula: e^(iπ) + 1 = 0. In Go:

```go
result := cmplx.Exp(1i * math.Pi) + 1
// result should be ≈ 0+0i
fmt.Printf("%.10f+%.10fi
", real(result), imag(result))
// 0.0000000000+0.0000000000i
```

### Q9: How would you implement a DFT (Discrete Fourier Transform) using complex128?
```go
func dft(x []complex128) []complex128 {
    n := len(x)
    X := make([]complex128, n)
    for k := 0; k < n; k++ {
        for j := 0; j < n; j++ {
            angle := -2 * math.Pi * float64(k*j) / float64(n)
            X[k] += x[j] * complex(math.Cos(angle), math.Sin(angle))
        }
    }
    return X
}
```

---

## Senior Level

### Q10: What are the primary production use cases for Go's complex types?
**Answer**: Signal processing (FFT, filtering), medical imaging (MRI reconstruction), radar processing, audio analysis, electrical engineering simulations, and mathematical visualizations (Mandelbrot sets). In most business applications, complex numbers are not needed.

### Q11: How do you compute the complex conjugate in Go?
```go
func conjugate(c complex128) complex128 {
    return complex(real(c), -imag(c))
}
// Conjugate of (a+bi) is (a-bi)
// Property: c * conjugate(c) = |c|^2 (always real and positive)
```

### Q12: How do complex number operations map to CPU instructions?
**Answer**: complex128 addition compiles to 2 `ADDSD` instructions (one for real, one for imaginary). Multiplication compiles to 4 `MULSD` + 2 `ADDSD`/`SUBSD` (4 multiplications, 2 additions). The `real()` and `imag()` builtins compile to zero-cost memory loads (no actual function call).

---

## Scenario-Based Questions

### Scenario 1: Audio Analysis
You need to analyze the frequency content of audio samples. How would you use complex numbers in Go?

**Answer**: Convert time-domain samples to complex128 (imaginary part = 0), apply FFT to get frequency-domain representation. The magnitude of each complex output bin represents the amplitude at that frequency. The phase gives timing information.

```go
samples := []float64{/* audio samples */}
input := make([]complex128, len(samples))
for i, s := range samples {
    input[i] = complex(s, 0)
}
spectrum := fft(input)
// spectrum[k] represents frequency: k * sampleRate / len(samples)
```

### Scenario 2: Mandelbrot Set
Implement a check whether a point is in the Mandelbrot set.

```go
func inMandelbrot(c complex128, maxIter int) bool {
    z := complex128(0)
    for i := 0; i < maxIter; i++ {
        if cmplx.Abs(z) > 2 {
            return false
        }
        z = z*z + c
    }
    return true
}
```

---

## FAQ

**Q: Can complex numbers be used as map keys?**
A: Yes, complex numbers are comparable. `map[complex128]int` is valid. But rarely useful.

**Q: Is there a complex integer type in Go?**
A: No. Go only has `complex64` (float32 components) and `complex128` (float64 components). There is no complex integer.

**Q: What happens with NaN in complex numbers?**
A: NaN in either component makes comparisons return false (IEEE 754 rules apply to each component independently). `complex(math.NaN(), 0) == complex(math.NaN(), 0)` is false.
