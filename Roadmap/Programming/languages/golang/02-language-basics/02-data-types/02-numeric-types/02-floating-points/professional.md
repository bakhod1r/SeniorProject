# Floating Points in Go — Professional / Under the Hood

## Table of Contents
1. [Introduction](#introduction)
2. [How It Works Internally](#how-it-works-internally)
3. [Runtime Deep Dive](#runtime-deep-dive)
4. [Compiler Perspective](#compiler-perspective)
5. [Memory Layout](#memory-layout)
6. [OS / Syscall Level](#os-syscall-level)
7. [Source Code Walkthrough](#source-code-walkthrough)
8. [Assembly Output Analysis](#assembly-output-analysis)
9. [Performance Internals](#performance-internals)
10. [Metrics (Runtime Level)](#metrics-runtime-level)
11. [Edge Cases at the Lowest Level](#edge-cases-at-the-lowest-level)
12. [Test](#test)
13. [Tricky Questions](#tricky-questions)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Diagrams](#diagrams)

---

## Introduction

This document explores Go's floating-point types at the level of IEEE 754 bits, machine instructions, compiler decisions, and runtime behavior. The goal is to understand exactly what happens from the moment you write `a + b` to the moment the CPU executes a floating-point instruction.

Topics covered:
- IEEE 754 encoding bit-by-bit
- How Go's compiler lowers float operations to machine instructions
- The `math` package's assembly implementations
- Subnormal numbers and their performance impact
- Floating-point state in the CPU (x87 vs SSE2/AVX)
- Memory alignment and packing of float fields

---

## How It Works Internally

### IEEE 754 Double Precision Encoding

A `float64` is a 64-bit value stored as:

```
Bit 63:    sign bit (0 = positive, 1 = negative)
Bits 62–52: biased exponent (11 bits, bias = 1023)
Bits 51–0:  mantissa / significand (52 bits, with implicit leading 1)
```

**Value formula**: `(-1)^sign × 2^(exp-1023) × (1.mantissa_in_binary)`

**Special encodings**:
- `exp = 0, mantissa = 0`: ±0 (signed zero)
- `exp = 0, mantissa ≠ 0`: subnormal (gradual underflow)
- `exp = 2047, mantissa = 0`: ±Infinity
- `exp = 2047, mantissa ≠ 0`: NaN (quiet if bit 51 = 1, signaling if bit 51 = 0)

```go
package main

import (
    "fmt"
    "math"
)

func inspectFloat64(f float64) {
    bits := math.Float64bits(f)
    sign := bits >> 63
    rawExp := (bits >> 52) & 0x7FF
    mantissa := bits & ((1 << 52) - 1)

    fmt.Printf("Value:    %v\n", f)
    fmt.Printf("Bits:     %016X\n", bits)
    fmt.Printf("Sign:     %d\n", sign)
    fmt.Printf("RawExp:   %d (biased exp = %d)\n", rawExp, int(rawExp)-1023)
    fmt.Printf("Mantissa: %013X (%052b)\n", mantissa, mantissa)
    fmt.Println()
}

func main() {
    inspectFloat64(1.0)
    // Sign: 0, RawExp: 1023 (biased exp = 0), Mantissa: 0
    // Value: 1.0 × 2^0 × 1.000...000 = 1.0

    inspectFloat64(0.1)
    // Mantissa is non-zero: 0.1 is irrational in base 2
    // Actual stored value: 0.1000000000000000055511151...

    inspectFloat64(math.NaN())
    // RawExp: 2047, Mantissa: non-zero

    inspectFloat64(math.Inf(1))
    // RawExp: 2047, Mantissa: 0

    inspectFloat64(-0.0)
    // Sign: 1, RawExp: 0, Mantissa: 0
}
```

### Representing 0.1 in IEEE 754

0.1 in binary is a repeating fraction:
`0.1 = 0.0001100110011001100110011001100110011001100110011...₂`

The float64 stores 52 bits of mantissa (plus the implicit 1), so it stores:
`1.1001100110011001100110011001100110011001100110011010₂ × 2^-4`

Which equals: `0.1000000000000000055511151231257827021181583404541015625`

This is the exact value stored — not 0.1.

---

## Runtime Deep Dive

### Floating-Point in Go's Type System

Go's type checker (`gc` compiler) treats `float32` and `float64` as separate types. There is no implicit conversion between them.

- **Untyped float constants** have "ideal" precision during compilation and are assigned the precision of the context at use.
- **Typed float literals** are rounded to the appropriate precision at parse time.

```go
// Untyped constant: precision determined at use
const x = 1.1  // unlimited precision during const evaluation
var a float32 = x  // truncated to float32 at assignment
var b float64 = x  // truncated to float64 at assignment

// The constant folding during compilation:
const result = 1.1 + 2.2  // computed at full precision, then truncated when assigned
```

### Go Runtime Floating-Point State

Go does not use x87 FPU on amd64 — it uses SSE2. The `MXCSR` register controls:
- Rounding mode (bits 13-14): Go uses "round to nearest even" (IEEE 754 default)
- Flush-to-zero (bit 15): Go does NOT set this — subnormals are preserved
- Denormals-are-zero (bit 6): Go does NOT set this either

This means Go gives you full IEEE 754 compliance by default.

```
MXCSR bits in Go runtime:
  FTZ (bit 15) = 0  → subnormals NOT flushed to zero
  DAZ (bit 6)  = 0  → denormals treated as subnormals
  RC  (13-14)  = 00 → round to nearest even (default)
```

### Goroutine and Float State

Each goroutine has its own register file when scheduled. The Go runtime does NOT save/restore the `MXCSR` register on goroutine switches — this means all goroutines share the same floating-point control settings. This is safe because Go never changes MXCSR after initialization.

---

## Compiler Perspective

### How the Go Compiler (gc) Handles Floats

The Go compiler (gc) goes through these phases:

1. **Parsing**: `3.14` is parsed as an untyped float constant
2. **Type checking**: assigned float type or inferred as float64
3. **IR lowering**: float operations become SSA (Static Single Assignment) nodes
4. **Backend**: SSA nodes become architecture-specific instructions

**On amd64**, float operations use SSE2 instructions:
- `ADDSD` — add scalar double (float64)
- `ADDSS` — add scalar single (float32)
- `MULSD`, `DIVSD`, `SQRTSD` — similar pattern
- `UCOMISD` — unordered compare double (handles NaN correctly)

**Key point**: `UCOMISD` is used for float comparisons, not `COMISD`. The "unordered" version sets the parity flag (PF) for NaN comparisons, which is why `NaN < x` returns false AND `NaN >= x` returns false (both comparisons fail with a NaN operand).

### Constant Folding

Go folds float constants at compile time with arbitrary precision:

```go
const pi = 3.14159265358979323846264338327950288
// Computed with arbitrary precision, then truncated to float64 when used
var f float64 = pi
// f = 3.141592653589793  (15 significant digits)
```

### Strength Reduction

The compiler does NOT perform aggressive float optimizations that would violate IEEE 754:
- `x * 2.0` is NOT replaced by `x + x` (different rounding)
- `x / 2.0` is NOT replaced by `x * 0.5` (different rounding for subnormals)
- `a * b + c` is NOT combined into FMA without explicit `math.FMA`

```go
// Explicit FMA (fused multiply-add) since Go 1.14
import "math"
result := math.FMA(a, b, c)  // computes a*b+c with single rounding
// On hardware with FMA (modern x86, ARM64), this generates a single instruction
```

---

## Memory Layout

### Struct Alignment Rules

```go
// float64 has alignment 8 on all architectures
// float32 has alignment 4

type Example struct {
    A float64  // offset 0, size 8
    B float32  // offset 8, size 4
    // 4 bytes padding here
    C float64  // offset 16, size 8
}
// Total size: 24 bytes

// Better packing:
type Packed struct {
    A float64  // offset 0
    C float64  // offset 8
    B float32  // offset 16
    // 4 bytes padding at end
}
// Total size: 24 bytes (same, but better for sequential access)
```

### Array vs Slice of Floats

```go
// Array: contiguous, stack-allocated for small arrays
var arr [4]float64 // 32 bytes on stack, address is &arr[0]

// Slice: three words on stack (pointer, len, cap), data on heap
s := make([]float64, 4) // 24 bytes on stack (header), 32 bytes on heap

// For SIMD-friendly code, alignment matters:
// Go's allocator guarantees at least 16-byte alignment for allocations
// AVX2 requires 32-byte alignment for aligned loads
```

### Float in Interfaces

```go
// float64 in interface: stored directly if it fits (no heap allocation for small values)
// float64 is 8 bytes, fits in the interface value word on 64-bit systems
var i interface{} = 3.14  // no heap allocation on amd64
// The float64 value is stored directly in the interface{} data field
```

---

## OS / Syscall Level

### Floating-Point Context in Signals

When a goroutine is preempted by a signal, the OS saves the full CPU state including floating-point registers:

On Linux amd64:
- `sigcontext.fpstate` contains the full `FXSAVE` state (512 bytes)
- Includes XMM0-XMM15, MXCSR, and x87 state
- The Go runtime restores this state when resuming the goroutine

### Floating-Point Exceptions

By default, Go has all floating-point exceptions masked (disabled):
- Division by zero → returns ±Inf (not a signal)
- Overflow → returns ±Inf (not a signal)
- Invalid operation → returns NaN (not a signal)

This is controlled by MXCSR bits 0-5. Go keeps them all set to 1 (masked = exceptions disabled).

If you need to detect FP exceptions explicitly, you would need to use `unsafe` + `syscall` to modify MXCSR — not recommended.

---

## Source Code Walkthrough

### Go Runtime: float32/float64 in `runtime/float.go`

Go's runtime has minimal float-specific code because float operations are primitive CPU instructions. Key source files:

- `src/math/bits.go` — `Float64bits`, `Float64frombits` (simple casting)
- `src/math/floor.go` — `Floor`, `Ceil`, `Round` implementations
- `src/math/sqrt.go` — `Sqrt` uses a hardware SQRT instruction via assembly
- `src/math/sin.go` — software implementation of transcendental functions

### `math.Sqrt` Source (simplified)

```go
// In src/math/sqrt.go:
// Sqrt is implemented in hardware for amd64:
// SQRTSD instruction gives the correctly-rounded result in 1 instruction.

// For arm64:
// FSQRTD instruction

// The Go source has a pure-Go fallback for other architectures.
// The architecture-specific implementation is in:
// src/math/sqrt_amd64.s (assembly)

// Assembly stub:
// TEXT ·Sqrt(SB),NOSPLIT,$0
//     MOVSD   x+0(FP), X0
//     SQRTSD  X0, X0
//     MOVSD   X0, ret+8(FP)
//     RET
```

### `math.Floor` Source

```go
// src/math/floor.go
func Floor(x float64) float64 {
    if haveArchFloor {
        return archFloor(x)  // uses ROUNDSD instruction if available
    }
    return floor(x)
}

func floor(x float64) float64 {
    if x == 0 || IsNaN(x) || IsInf(x, 0) {
        return x
    }
    if x < 0 {
        d, frac := Modf(-x)
        if frac != 0.0 {
            d += 1
        }
        return -d
    }
    d, _ := Modf(x)
    return d
}
```

---

## Assembly Output Analysis

### Examining Go Assembly

You can see the assembly generated by the Go compiler:

```bash
# Generate assembly
go build -gcflags="-S" main.go 2>&1 | grep -A5 "ADDSD\|MULSD\|MOVSD"

# Or use go tool compile
go tool compile -S main.go
```

### Sample: `a + b` for float64

Input Go code:
```go
func addFloat(a, b float64) float64 {
    return a + b
}
```

Output assembly (amd64):
```asm
TEXT main.addFloat(SB), NOSPLIT|ABIInternal, $0-24
    MOVSD   a+0(FP), X0    // load a into XMM0
    ADDSD   b+8(FP), X0    // XMM0 += b (scalar double add)
    MOVSD   X0, ret+16(FP) // store result
    RET
```

Key: SSE2 `ADDSD` (Add Scalar Double) — single instruction, ~1 clock cycle throughput.

### Sample: Float Comparison (with NaN handling)

```go
func isGreater(a, b float64) bool {
    return a > b
}
```

Assembly:
```asm
TEXT main.isGreater(SB), NOSPLIT|ABIInternal, $0-17
    MOVSD  a+0(FP), X0
    UCOMISD b+8(FP), X0    // unordered compare (sets PF for NaN)
    SETHI  AL              // set AL=1 if above (unsigned > after comparison)
    MOVB   AL, ret+16(FP)
    RET

// UCOMISD vs COMISD:
// COMISD raises invalid exception on NaN
// UCOMISD sets CF=1, ZF=1, PF=1 for NaN (no exception)
// The "unordered" in UCOMISD means NaN comparisons return false
```

### Loop Vectorization

```go
func sumSlice(s []float64) float64 {
    sum := 0.0
    for _, v := range s {
        sum += v
    }
    return sum
}
```

With `-gcflags="-e -N -l"` (no inlining, no optimizations): scalar ADDSD in loop.

With full optimization: the compiler may unroll and use `ADDPD` (packed double = 2 at once) or `VADDPD` (AVX2 = 4 at once).

---

## Performance Internals

### CPU Pipeline: Float Operations

Modern x86 CPUs (e.g., Intel Skylake):
- **ADDSD/SUBSD**: 4-cycle latency, 0.5-cycle throughput (2 per cycle with pipelining)
- **MULSD**: 4-cycle latency, 0.5-cycle throughput
- **DIVSD**: 13-14 cycle latency, 4-5 cycle throughput (not pipelined!)
- **SQRTSD**: 15-16 cycle latency, 8-14 cycle throughput

**Implication**: Division and square root are disproportionately expensive. Where possible:
- Replace division by a constant with multiplication by the reciprocal
- Replace `sqrt(a) < b` with `a < b*b` (avoid sqrt entirely)

### FP Register File

On amd64, Go uses 16 XMM registers (XMM0–XMM15) for float operations.
In AVX mode (extended by Go for some math operations): YMM registers (256-bit = 4× float64 or 8× float32).

The Go register-based calling convention (ABI in Go 1.17+) passes float arguments in XMM registers:
- First float64 argument: XMM0
- Second: XMM1
- Up to 15 float arguments in registers (XMM0–XMM14)
- Return values: XMM0, XMM1, ...

### Subnormal Performance Penalty

Subnormal (denormalized) numbers are handled in software on most CPUs (not in hardware fast path):

```
Normal float64 add:    ~1 cycle
Subnormal float64 add: ~10-100 cycles (CPU microcode assist)
```

If your data contains many near-zero values, this can cause a 10-100× slowdown:

```go
// Detection: check for subnormals
func hasSubnormals(vals []float64) bool {
    const minNormal = 2.2250738585072014e-308 // math.SmallestNonzeroFloat64 * 2^1022
    for _, v := range vals {
        if v != 0 && math.Abs(v) < minNormal {
            return true
        }
    }
    return false
}

// Mitigation: flush near-zero values to zero
func flushSubnormals(vals []float64) {
    const minNormal = 2.2250738585072014e-308
    for i, v := range vals {
        if v != 0 && math.Abs(v) < minNormal {
            vals[i] = 0
        }
    }
}
```

---

## Metrics (Runtime Level)

| Operation | Latency (cycles) | Throughput (cycles) | Notes |
|-----------|-----------------|---------------------|-------|
| ADDSD (float64 add) | 4 | 0.5 | Intel Skylake |
| MULSD (float64 mul) | 4 | 0.5 | Intel Skylake |
| DIVSD (float64 div) | 13-14 | 4-5 | Non-pipelined |
| SQRTSD (sqrt) | 15-16 | 8-14 | HW instruction |
| ADDPD (2× float64) | 4 | 0.5 | SSE2 packed |
| VADDPD (4× float64) | 4 | 0.5 | AVX2 packed |
| math.Sin | ~50-100 | varies | Software impl |
| math.Exp | ~50-100 | varies | Software impl |
| Subnormal ADDSD | ~150-500 | varies | Microcode assist |

---

## Edge Cases at the Lowest Level

### Bit-Level NaN Taxonomy

Not all NaN values are equal at the bit level:

```go
// Quiet NaN (bit 51 = 1): does NOT raise FP exception
qNaN := math.Float64frombits(0x7FF8000000000001) // quiet NaN

// Signaling NaN (bit 51 = 0, other mantissa bits set): raises exception if unmasked
sNaN := math.Float64frombits(0x7FF0000000000001) // signaling NaN

// Go keeps all exceptions masked, so both behave the same in Go code
// but sNaN may behave differently if you call into C code that unmasks exceptions
```

### Negative Zero Propagation

```go
// Negative zero through operations
negZero := math.Float64frombits(1 << 63) // -0.0
fmt.Println(negZero == 0.0)              // true
fmt.Println(1.0 / negZero)              // -Inf (not +Inf!)
fmt.Println(math.Sqrt(negZero))         // -0.0 (sqrt preserves sign of ±0)
fmt.Println(-0.0 + 0.0)                 // +0.0 (addition of ±0 = +0)
fmt.Println(-0.0 * 1.0)                 // -0.0 (sign propagates through multiplication)
```

### Float64 → Int64 Conversion Traps

```go
// On amd64, Go uses CVTTSD2SI instruction (Convert with Truncation)
// If float is out of int64 range, result is 0x8000000000000000 (MinInt64)
// No signal is raised, no panic in Go — this is a silent bug

f := math.MaxFloat64
i := int64(f) // On amd64: CVTTSD2SI → result is -9223372036854775808 (MinInt64)!
fmt.Println(i) // -9223372036854775808 — SILENT DATA CORRUPTION

// Always validate:
if f > math.MaxInt64 || f < math.MinInt64 || math.IsNaN(f) {
    panic("out of range")
}
```

### Compiler's FP Expression Evaluation

The Go specification says expressions are evaluated with at least the precision of the operand types. For constant expressions, arbitrary precision is used. This means:

```go
const c = 1.0/3.0 + 2.0/3.0  // = 1.0 exactly (arbitrary precision constant evaluation)
var f = 1.0/3.0 + 2.0/3.0    // ≠ 1.0 (runtime float64 evaluation with rounding)
```

---

## Test

1. What CPU instruction does Go use for float64 comparison on amd64?
   - **UCOMISD** (unordered compare, handles NaN without exception) ✓

2. What happens when you convert `math.MaxFloat64` to `int64` in Go?
   - **Returns MinInt64 (0x8000000000000000) silently** — CVTTSD2SI overflow ✓

3. What is the bit pattern for negative zero in float64?
   - **Bit 63 = 1, all other bits 0** (value = 0x8000000000000000) ✓

4. Why does Go use SSE2 instead of x87 for floats?
   - **SSE2 is IEEE 754 precise (64-bit registers), x87 uses 80-bit internal precision which causes non-reproducible results** ✓

5. What MXCSR flags does Go set for subnormal handling?
   - **FTZ=0, DAZ=0** — Go preserves subnormals (full IEEE 754 compliance) ✓

---

## Tricky Questions

**Q: Why does `math.Sqrt` have a software fallback in Go's source even though there's a hardware SQRT instruction?**

A: The hardware `SQRTSD` instruction is only available on amd64 and arm64. For other architectures (MIPS, RISCV, 386 without SSE2), Go falls back to a software implementation. The build system (`//go:build amd64`) selects the appropriate implementation at compile time.

**Q: What is the difference between `float64(int64(math.MaxFloat64))` and `int64(math.MaxFloat64)` in terms of CPU instructions?**

A: `int64(math.MaxFloat64)` is a single `CVTTSD2SI` instruction that silently overflows to MinInt64. `float64(int64(math.MaxFloat64))` first overflows to MinInt64, then converts that to float64 using `CVTSI2SD`, giving `-9.223372036854776e+18`. Both are wrong — always validate before conversion.

**Q: Why does Go NOT use FMA (Fused Multiply-Add) automatically for `a*b + c`?**

A: FMA computes `a*b+c` with a single rounding, which gives a DIFFERENT result than computing `a*b` (round) `+ c` (round). Automatically using FMA would change the semantics of existing code. Go provides `math.FMA(a, b, c)` as an explicit opt-in for when you want the FMA behavior.

**Q: How does the Go garbage collector handle float registers?**

A: The GC only needs to scan memory for pointers. Float registers don't contain pointers and are not scanned. The GC knows the type of every memory location through type metadata; floats in memory are marked as non-pointer so the GC skips them.

---

## Summary

At the professional level, Go's floating-point system is:

1. **IEEE 754 strict**: Go uses SSE2 (not x87), never changes MXCSR rounding mode, never sets FTZ/DAZ. This guarantees reproducible, standard-conforming behavior.

2. **Compiled to single instructions**: `+`, `-`, `*` compile to `ADDSD`, `SUBSD`, `MULSD` — 0.5-cycle throughput with pipelining.

3. **Division and sqrt are expensive**: `DIVSD` takes 13-14 cycles (latency), vs 4 for `MULSD`. Avoid division in inner loops; use reciprocal multiplication.

4. **Subnormals are a performance trap**: preserved by default (IEEE 754), but 10-100× slower than normal floats. Consider flushing to zero for performance-critical ML code.

5. **Float→int conversion is dangerous**: `CVTTSD2SI` silently overflows to `MinInt64` — always validate range before converting.

6. **Constants have unlimited precision**: Go evaluates constant float expressions with arbitrary precision before truncating to the target type. This means constant folding at compile time is more accurate than runtime computation.

---

## Further Reading

- [Go SSA architecture](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa)
- [Go ABI specification (register-based calling convention)](https://go.googlesource.com/proposal/+/refs/heads/master/design/40724-register-calling.md)
- [Intel Software Developer Manual — Chapter 4.8: Floating-Point](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- [x86-64 SSE2 instruction reference](https://www.felixcloutier.com/x86/addsd)
- [Go math package assembly (src/math/*.s)](https://cs.opensource.google/go/go/+/main:src/math/)

---

## Diagrams

### float64 Bit Layout (Annotated)
```
  63   62              52  51                              0
  +----+------------------+--------------------------------+
  | S  |    Exponent (E)  |         Mantissa (M)          |
  +----+------------------+--------------------------------+

Value = (-1)^S × 2^(E-1023) × (1.M)   [normal]
      = (-1)^S × 2^(-1022) × (0.M)    [subnormal, E=0]

Special values:
  E=0,    M=0:  ±0.0
  E=0,    M≠0:  ±subnormal
  E=2047, M=0:  ±Infinity
  E=2047, M≠0:  NaN (quiet if bit 51=1, signaling if bit 51=0)
```

### Go Float Compilation Pipeline
```
Go source: a + b (float64)
      ↓ Parser
AST: BinaryExpr{Op: ADD, X: a, Y: b, Type: float64}
      ↓ Type checker
Typed IR
      ↓ SSA conversion
SSA: v3 = ADDF64 v1 v2
      ↓ Arch-specific lowering (amd64)
Machine IR: ADDSD X1, X0
      ↓ Register allocation + code generation
Assembly: ADDSD b+8(FP), X0
      ↓ Assembler
Binary: machine code bytes
```

### SSE2 Register Usage in Go
```
XMM0  ← arg1 / return1
XMM1  ← arg2 / return2
XMM2  ← arg3
...
XMM14 ← arg15
XMM15 ← scratch

MXCSR (control/status register):
  [15] FTZ=0  [6] DAZ=0  [13:12] RC=00 (round-to-nearest)
  [5:0] = 111111 (all exceptions masked)
```
