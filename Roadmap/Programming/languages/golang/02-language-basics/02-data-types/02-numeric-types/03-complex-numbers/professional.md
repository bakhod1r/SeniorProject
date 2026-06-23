# Complex Numbers — Professional Level

## Introduction
> Focus: "What happens under the hood?"

At the professional level, we examine how complex number operations are implemented at the CPU level, how Go's compiler handles complex arithmetic, and what the binary representation looks like in memory.

---

## Memory Layout

```
complex64:  8 bytes total
  float32 real part:      bytes 0-3 (IEEE 754 single precision)
  float32 imaginary part: bytes 4-7 (IEEE 754 single precision)

complex128: 16 bytes total
  float64 real part:      bytes 0-7  (IEEE 754 double precision)
  float64 imaginary part: bytes 8-15 (IEEE 754 double precision)

Alignment:
  complex64:  4-byte aligned (float32 alignment)
  complex128: 8-byte aligned (float64 alignment)
```

---

## Compiler Perspective

### Complex Multiplication Implementation

```go
// Source: complex multiplication
func mul(a, b complex128) complex128 { return a * b }

// Compiler expands to:
// result_real = real(a)*real(b) - imag(a)*imag(b)
// result_imag = real(a)*imag(b) + imag(a)*real(b)

// Assembly uses SSE2 scalar double operations:
// MULSD, ADDSD, SUBSD for each component
// 4 multiplications + 2 additions per complex multiply
```

---

## How `real()` and `imag()` Work

```go
// real() and imag() are compiler intrinsics
// They compile to zero-cost memory access:

c := 3 + 4i  // stored as [3.0f64, 4.0f64] in memory
r := real(c)  // load first 8 bytes → no-op on optimizer
i := imag(c)  // load bytes 8-15 → offset memory access

// Assembly: just a MOVSD with offset 0 vs offset 8
```

---

## Performance Internals

```
complex64 arithmetic uses SSE2 float32 instructions (ADDSS, MULSS)
complex128 arithmetic uses SSE2 float64 instructions (ADDSD, MULSD)

On CPUs with AVX support:
- Can process 4 complex64 values simultaneously (8 float32 in 256-bit register)
- Can process 2 complex128 values simultaneously (4 float64 in 256-bit register)

complex128 multiply latency: ~12 cycles (4 MULSD + 2 ADDSD + pipeline)
complex128 add latency:       ~4 cycles (2 ADDSD)
```

---

## Source Code Walkthrough

```
src/math/cmplx/abs.go:
func Abs(x complex128) float64 {
    return math.Hypot(real(x), imag(x))
}
// Uses math.Hypot for numerical stability (avoids overflow for large components)

src/math/cmplx/exp.go:
func Exp(x complex128) complex128 {
    // e^(a+bi) = e^a * (cos(b) + i*sin(b))
    r, theta := math.Exp(real(x)), imag(x)
    return complex(r*math.Cos(theta), r*math.Sin(theta))
}
// Euler's formula directly implemented
```

---

## Test

```go
package complex_pro_test

import (
    "math"
    "math/cmplx"
    "testing"
    "unsafe"
)

func TestComplex128Layout(t *testing.T) {
    c := complex128(3 + 4i)
    if unsafe.Sizeof(c) != 16 {
        t.Errorf("complex128 should be 16 bytes, got %d", unsafe.Sizeof(c))
    }
}

func TestComplexMultiplication(t *testing.T) {
    // (3+4i)(3-4i) = 9+16 = 25 (complex conjugate product = |z|^2)
    c := 3 + 4i
    conj := complex(real(c), -imag(c))
    result := c * conj
    expected := complex(25.0, 0.0)
    if math.Abs(real(result)-real(expected)) > 1e-10 {
        t.Errorf("conjugate product failed: got %v, want %v", result, expected)
    }
}

func TestEulerFormula(t *testing.T) {
    // e^(iπ) = -1 + 0i
    result := cmplx.Exp(1i * math.Pi)
    if math.Abs(real(result)+1) > 1e-10 || math.Abs(imag(result)) > 1e-10 {
        t.Errorf("Euler formula: got %v, want (-1+0i)", result)
    }
}
```

---

## Tricky Questions

**Q**: How many float64 operations does `complex128` multiplication require?
**A**: 6 total: 4 multiplications (ac, bd, ad, bc) and 2 additions/subtractions. Result = (ac-bd) + (ad+bc)i.

**Q**: What is the alignment of `complex128`?
**A**: 8 bytes (same as float64, since it contains two float64 values).

**Q**: Is `complex(0, math.NaN()) == complex(0, math.NaN())` true or false?
**A**: False. NaN comparisons always return false, and since the imaginary part is NaN, the comparison returns false.

---

## Summary

Complex numbers in Go are stored as pairs of floating-point values (two float32 for complex64, two float64 for complex128). Arithmetic compiles to scalar SSE2 operations. The `real()` and `imag()` builtins are zero-cost memory loads. The `math/cmplx` package implements all standard complex functions using Euler's formula and other mathematical identities.
