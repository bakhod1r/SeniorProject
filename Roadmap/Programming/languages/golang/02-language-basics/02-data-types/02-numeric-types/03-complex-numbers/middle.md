# Complex Numbers — Middle Level

## Introduction
> Focus: "Why?" and "When to use?"

Complex numbers in Go exist primarily for scientific computing, signal processing, and mathematical applications. While `complex64` and `complex128` are built-in types, they are rarely used in typical web or systems programming. At the middle level, understanding complex numbers means knowing when they are the right tool, how the `math/cmplx` package works, and what the performance trade-offs are.

---

## Why Go Has Built-In Complex Numbers

Go was designed with scientific computing in mind. Complex numbers appear in:
- Signal processing (FFT, filters)
- Electrical engineering (impedance calculations)
- Physics simulations (wave equations, quantum mechanics)
- Control theory
- Computer graphics (conformal mappings, fractals)

By making complex numbers built-in with operator support (+, -, *, /), Go allows writing mathematical formulas that look like their mathematical notation.

---

## The math/cmplx Package

```go
import "math/cmplx"

c := 3 + 4i

// Magnitude (absolute value): sqrt(real^2 + imag^2)
fmt.Println(cmplx.Abs(c))     // 5

// Phase angle (argument) in radians
fmt.Println(cmplx.Phase(c))   // 0.9272952180016122 (arctan(4/3))

// Polar form
r, theta := cmplx.Polar(c)
fmt.Println(r, theta)          // 5, 0.9272...

// Square root
fmt.Println(cmplx.Sqrt(-1+0i)) // (0+1i) — sqrt of -1!

// Exponential: Euler's formula e^(iπ) = -1
result := cmplx.Exp(1i * math.Pi)
fmt.Printf("e^(iπ) = %.0f+%.0fi
", real(result), imag(result)) // -1+0i

// Logarithm
fmt.Println(cmplx.Log(1+0i))   // (0+0i) — log(1) = 0
fmt.Println(cmplx.Log(-1+0i))  // (0+πi) — log(-1) = iπ

// Trigonometric
fmt.Println(cmplx.Sin(1+0i))
fmt.Println(cmplx.Cos(0+1i))   // cosh(1) = 1.5430806...
```

---

## Complex Arithmetic

```go
c1 := 3 + 4i
c2 := 1 - 2i

fmt.Println(c1 + c2)  // (4+2i)
fmt.Println(c1 - c2)  // (2+6i)
fmt.Println(c1 * c2)  // (3+4i)(1-2i) = 3-6i+4i-8i² = 3-2i+8 = (11+2i)
fmt.Println(c1 / c2)  // (3+4i)/(1-2i) = (3+4i)(1+2i)/((1-2i)(1+2i))

// Conjugate (flip sign of imaginary part)
conj := complex(real(c1), -imag(c1))  // (3-4i)
fmt.Println(conj)

// Power
fmt.Println(cmplx.Pow(c1, 2))  // (3+4i)^2 = 9+24i-16 = (-7+24i)
```

---

## Mandelbrot Set (Real-World Use)

```go
package main

import (
    "image"
    "image/color"
    "math/cmplx"
)

func mandelbrot(c complex128, maxIter int) int {
    z := complex128(0)
    for i := 0; i < maxIter; i++ {
        if cmplx.Abs(z) > 2 {
            return i
        }
        z = z*z + c
    }
    return maxIter
}

func generateMandelbrot(width, height, maxIter int) *image.RGBA {
    img := image.NewRGBA(image.Rect(0, 0, width, height))
    for y := 0; y < height; y++ {
        for x := 0; x < width; x++ {
            // Map pixel to complex plane
            re := float64(x)/float64(width)*3.5 - 2.5
            im := float64(y)/float64(height)*2.0 - 1.0
            c := complex(re, im)
            n := mandelbrot(c, maxIter)
            // Color based on escape speed
            v := uint8(255 * n / maxIter)
            img.Set(x, y, color.RGBA{v, v, v, 255})
        }
    }
    return img
}
```

---

## Fast Fourier Transform (FFT) Concept

```go
// DFT (Discrete Fourier Transform) in Go — educational version
func dft(x []complex128) []complex128 {
    n := len(x)
    X := make([]complex128, n)
    for k := 0; k < n; k++ {
        for j := 0; j < n; j++ {
            X[k] += x[j] * cmplx.Exp(-2i*math.Pi*complex(float64(k*j), 0)/complex(float64(n), 0))
        }
    }
    return X
}
// Real FFT libraries (like gonum/dsp) use the Cooley-Tukey algorithm O(n log n)
```

---

## Anti-Patterns

### Anti-Pattern 1: Using Complex for 2D Points
```go
// BAD: using complex as a 2D point type
type Point complex128  // confusing

// GOOD: use a proper struct
type Point struct{ X, Y float64 }
```

### Anti-Pattern 2: complex64 vs complex128 Precision
```go
// BAD for precision-sensitive calculations
var c complex64 = 1000000 + 1000000i
// complex64 uses float32 internally — only 6-7 decimal digits precision

// GOOD
var c complex128 = 1000000 + 1000000i
// float64 internally — 15-16 decimal digits precision
```

---

## Performance

```go
// complex128 uses two float64 operations
// complex64 uses two float32 operations — faster on SIMD, less precise

// Multiplication of complex numbers: 4 multiplications + 2 additions
// (a+bi)(c+di) = (ac-bd) + (ad+bc)i

// For FFT performance, consider:
// - Use complex64 if float32 precision suffices (2x memory savings)
// - Use hardware-accelerated FFT libraries (gonum/dsp, fftw via cgo)
```

---

## Test

```go
package complex_test

import (
    "math"
    "math/cmplx"
    "testing"
)

func TestComplexArithmetic(t *testing.T) {
    c1 := 3 + 4i
    c2 := 1 - 2i

    sum := c1 + c2
    if real(sum) != 4 || imag(sum) != 2 {
        t.Errorf("addition: expected (4+2i), got %v", sum)
    }
}

func TestEulersFormula(t *testing.T) {
    // e^(iπ) + 1 should equal 0
    result := cmplx.Exp(complex(0, math.Pi)) + 1
    if math.Abs(real(result)) > 1e-10 || math.Abs(imag(result)) > 1e-10 {
        t.Errorf("Euler's formula: got %v, expected ≈0", result)
    }
}

func TestMagnitude(t *testing.T) {
    c := 3 + 4i
    if cmplx.Abs(c) != 5.0 {
        t.Errorf("magnitude of 3+4i should be 5, got %v", cmplx.Abs(c))
    }
}
```

---

## Comparison with Other Languages

| Language | Complex Type | Operator Support | Math Functions |
|----------|-------------|------------------|----------------|
| Go | complex64/128 | Yes (+,-,*,/) | math/cmplx |
| Python | complex (built-in) | Yes | cmath |
| Java | No built-in | No (class-based) | Apache Commons |
| C | No (C99: _Complex) | C99: yes | complex.h |
| Fortran | complex | Yes | Built-in |

---

## Summary

Go's complex number types are built-in for a reason: scientific computing applications need idiomatic support. Use `complex128` (float64-based) for precision and `complex64` (float32-based) for memory efficiency. The `math/cmplx` package provides comprehensive mathematical functions. For typical web applications, you will rarely use complex types. When you do need them (signal processing, physics simulations, fractal rendering), they offer clean, expressive code.
