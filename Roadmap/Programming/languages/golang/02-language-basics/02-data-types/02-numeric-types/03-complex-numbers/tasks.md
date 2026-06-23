# Complex Numbers — Tasks

## Junior Tasks

### Task 1 — Complex Number Basics
**Goal**: Practice creating and manipulating complex numbers.

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func main() {
    // Create complex numbers
    c1 := 3 + 4i
    c2 := complex(1.0, -2.0)
    c3 := complex64(2 + 3i)

    // Print components
    fmt.Printf("c1 = %v: real=%.0f, imag=%.0f\n", c1, real(c1), imag(c1))

    // Arithmetic
    fmt.Println("Sum:", c1+c2)
    fmt.Println("Product:", c1*c2)

    // Magnitude
    fmt.Printf("Magnitude of c1: %.2f\n", cmplx.Abs(c1))

    // TODO: compute conjugate of c1
    // TODO: verify c1 * conjugate == |c1|^2
}
```

**Expected Output**:
```
c1 = (3+4i): real=3, imag=4
Sum: (4+2i)
Product: (11+2i)
Magnitude of c1: 5.00
```

---

### Task 2 — Euler's Formula Verification
**Goal**: Verify Euler's formula e^(iπ) + 1 = 0.

```go
package main

import (
    "fmt"
    "math"
    "math/cmplx"
)

func main() {
    // e^(iπ) = cos(π) + i*sin(π) = -1 + 0i
    result := cmplx.Exp(complex(0, math.Pi))
    fmt.Printf("e^(iπ) = %.10f + %.10fi\n", real(result), imag(result))

    // e^(iπ) + 1 should be 0
    euler := result + 1
    fmt.Printf("e^(iπ) + 1 = %.10f + %.10fi\n", real(euler), imag(euler))
}
```

---

### Task 3 — Polar Form Conversion
**Goal**: Convert between rectangular (a+bi) and polar (r∠θ) form.

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func main() {
    c := 3 + 4i
    r, theta := cmplx.Polar(c)
    fmt.Printf("Rectangular: %.0f + %.0fi\n", real(c), imag(c))
    fmt.Printf("Polar: r=%.2f, θ=%.4f radians\n", r, theta)

    // Convert back
    c2 := cmplx.Rect(r, theta)
    fmt.Printf("Back to rectangular: %.4f + %.4fi\n", real(c2), imag(c2))
}
```

---

## Middle Tasks

### Task 4 — Simple DFT
**Goal**: Implement Discrete Fourier Transform.

```go
package main

import (
    "fmt"
    "math"
)

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

func main() {
    // Simple signal: sum of sin waves
    n := 8
    signal := make([]complex128, n)
    for i := range signal {
        signal[i] = complex(math.Sin(2*math.Pi*float64(i)/float64(n)), 0)
    }

    spectrum := dft(signal)
    fmt.Println("Frequency spectrum magnitudes:")
    for k, s := range spectrum {
        import_cmplx_abs := math.Sqrt(real(s)*real(s) + imag(s)*imag(s))
        fmt.Printf("freq[%d]: %.4f\n", k, import_cmplx_abs)
    }
}
```

### Task 5 — Mandelbrot Set Generator
**Goal**: Generate a text-based Mandelbrot set visualization.

```go
package main

import (
    "fmt"
    "math/cmplx"
)

func mandelbrot(c complex128, maxIter int) int {
    z := complex128(0)
    for i := 0; i < maxIter; i++ {
        if cmplx.Abs(z) > 2 { return i }
        z = z*z + c
    }
    return maxIter
}

func main() {
    width, height := 60, 25
    for y := 0; y < height; y++ {
        for x := 0; x < width; x++ {
            re := float64(x)/float64(width)*3.5 - 2.5
            im := float64(y)/float64(height)*2.0 - 1.0
            c := complex(re, im)
            n := mandelbrot(c, 50)
            if n == 50 {
                fmt.Print("*")
            } else if n > 25 {
                fmt.Print(".")
            } else {
                fmt.Print(" ")
            }
        }
        fmt.Println()
    }
}
```

---

## Senior Tasks

### Task 6 — FFT Implementation
Implement the Cooley-Tukey radix-2 FFT algorithm. Compare performance against the DFT implementation for N=1024 points.

### Task 7 — Digital Filter Design
Implement a simple low-pass FIR filter in the frequency domain using FFT:
1. FFT the input signal
2. Zero out frequency bins above cutoff
3. IFFT to get filtered signal

---

## Questions

1. What is the magnitude of `3 + 4i`? Prove it mathematically and verify in Go.
2. What does `cmplx.Sqrt(-1+0i)` return? Why?
3. Why does Go provide both complex64 and complex128?
4. What is the complex conjugate of `a + bi`? What is its product with the original?
5. How many float64 operations does multiplying two complex128 numbers require?

---

## Mini Projects

### Project 1 — Signal Analyzer
Build a simple audio signal analyzer that:
- Generates a composite sine wave (e.g., 440Hz + 880Hz)
- Applies DFT/FFT
- Prints the dominant frequencies

### Project 2 — Fractal Explorer
Build a Julia set renderer (similar to Mandelbrot but with a fixed `c` parameter) and render different julia sets by varying the `c` constant.

---

## Challenge — Vectorized Complex Operations

Implement batch complex operations that process N complex numbers simultaneously, using slices of float64 (for SIMD friendliness) rather than []complex128:

```go
// Struct-of-arrays layout for SIMD-friendliness
type ComplexArray struct {
    Real []float64
    Imag []float64
}

// Implement: Add, Mul, Magnitude for ComplexArray
// Benchmark against []complex128 approach
```
