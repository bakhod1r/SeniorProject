# Numeric Types (Overview) — Professional Level

## Table of Contents
1. [How It Works Internally](#how-it-works-internally)
2. [Runtime Deep Dive](#runtime-deep-dive)
3. [Compiler Perspective](#compiler-perspective)
4. [Memory Layout](#memory-layout)
5. [OS / Syscall Level](#os-syscall-level)
6. [Source Code Walkthrough](#source-code-walkthrough)
7. [Assembly Output Analysis](#assembly-output-analysis)
8. [Performance Internals](#performance-internals)
9. [Garbage Collector Interaction](#garbage-collector-interaction)
10. [Escape Analysis](#escape-analysis)
11. [Compiler Flags & Build Tags](#compiler-flags-build-tags)
12. [SSA Form & Optimization Passes](#ssa-form-optimization-passes)
13. [Unsafe Operations](#unsafe-operations)
14. [ABI & Calling Conventions](#abi-calling-conventions)
15. [Float Internals: IEEE 754](#float-internals-ieee-754)
16. [Tricky Questions](#tricky-questions)

---

## How It Works Internally

> **Focus:** "What happens under the hood?"

### Numeric Types in the Go Type System

From `src/go/types/type.go`, all numeric types are `*Basic`:

```go
// BasicKind values (from Go source)
const (
    Invalid BasicKind = iota
    Bool
    Int     // int
    Int8
    Int16
    Int32
    Int64
    Uint
    Uint8
    Uint16
    Uint32
    Uint64
    Uintptr
    Float32
    Float64
    Complex64
    Complex128
    String
    UnsafePointer
)
```

Each basic type has an associated `BasicInfo` bitmask:
```go
IsBoolean  BasicInfo = 1 << iota
IsInteger
IsUnsigned
IsFloat
IsComplex
IsString
IsUntyped
```

For example, `int32` has `IsInteger` set; `float64` has `IsFloat` set; `complex128` has `IsComplex` set; `uint8` has both `IsInteger` and `IsUnsigned`.

### Integer Representation: Two's Complement

All signed integers in Go use **two's complement** representation:

```
int8 representation (8 bits):
  0 = 00000000
  1 = 00000001
  127 = 01111111    (max positive: high bit = 0)
  -1 = 11111111     (all bits 1)
  -128 = 10000000   (min negative: only high bit = 1)

Why two's complement?
  Addition is the same circuit for positive and negative numbers.
  No separate "negative" bit — arithmetic just works.
```

Overflow wraps by definition: `127 + 1 = 00000000 + 10000000 = 10000000 = -128`.

### Float Representation: IEEE 754

```
float64 (64-bit double precision):
Bit 63:   sign (0=positive, 1=negative)
Bits 62-52: biased exponent (11 bits, bias=1023)
Bits 51-0:  mantissa/significand (52 bits, implicit leading 1)

Value = (-1)^sign × 2^(exponent-1023) × 1.mantissa
```

Special values:
```
Exponent=0,    mantissa=0:  ±0
Exponent=2047, mantissa=0:  ±Infinity
Exponent=2047, mantissa≠0:  NaN (Not a Number)
Exponent=0,    mantissa≠0:  Subnormal (very small numbers)
```

---

## Runtime Deep Dive

### Numeric Type Storage in the Runtime

Go's runtime treats all numeric types as scalar values of their respective sizes. They are NOT heap-allocated individually; they live inline in structs, arrays, and stack frames.

### Numeric Types in `runtime._type`

```go
// From src/internal/abi/type.go
type Type struct {
    Size_       uintptr
    PtrBytes    uintptr   // for GC: number of bytes with pointers
    Hash_       uint32
    Tflag       Tflag
    Align_      uint8
    FieldAlign_ uint8
    Kind_       uint8     // BasicKind value
    Equal       func(unsafe.Pointer, unsafe.Pointer) bool
    GCData      *byte     // GC pointer map
    Str_        NameOff
    PtrToThis   TypeOff
}
```

For `int64`: `Size_=8, PtrBytes=0, Align_=8, Kind_=Int64`.
The `PtrBytes=0` is critical: the GC never scans numeric fields — they can't contain pointers.

### Integer Arithmetic in the Runtime

The runtime itself uses `int`, `uint`, `uintptr`, `int32`, `int64` extensively:
- `uintptr` for pointer arithmetic
- `int32` for type hash values
- `int64` for timers, goroutine IDs
- `uint64` for garbage collector spans

---

## Compiler Perspective

### Numeric Operations → IR Opcodes

```go
// From src/cmd/compile/internal/ir/op.go
const (
    OADD  // a + b
    OSUB  // a - b
    OMUL  // a * b
    ODIV  // a / b (integer or float)
    OMOD  // a % b
    OLSH  // a << b (left shift)
    ORSH  // a >> b (right shift, arithmetic for signed)
    OAND  // a & b
    OOR   // a | b
    OXOR  // a ^ b
    OANDNOT // a &^ b (AND NOT)
)
```

### Type Conversion in SSA

```go
// Source:
var x int32 = 100
y := int64(x)
```

SSA:
```
v1 = Arg <int32> {x}
v2 = SignExt32to64 <int64> v1   ; sign-extend: fills upper bits with sign bit
```

Different conversion types in SSA:
- `SignExt8to64`: signed widening (sign extension)
- `ZeroExt8to64`: unsigned widening (zero extension)
- `Trunc64to32`: narrowing (discard upper bits)
- `Cvt32to64F`: int32 → float64
- `Cvt64Fto32F`: float64 → float32

---

## Memory Layout

### Numeric Type Sizes and Alignment

```go
import (
    "fmt"
    "unsafe"
)

func main() {
    types := []struct {
        name string
        size uintptr
        align uintptr
    }{
        {"int8",    unsafe.Sizeof(int8(0)),    uintptr(unsafe.Alignof(int8(0)))},
        {"int16",   unsafe.Sizeof(int16(0)),   uintptr(unsafe.Alignof(int16(0)))},
        {"int32",   unsafe.Sizeof(int32(0)),   uintptr(unsafe.Alignof(int32(0)))},
        {"int64",   unsafe.Sizeof(int64(0)),   uintptr(unsafe.Alignof(int64(0)))},
        {"float32", unsafe.Sizeof(float32(0)), uintptr(unsafe.Alignof(float32(0)))},
        {"float64", unsafe.Sizeof(float64(0)), uintptr(unsafe.Alignof(float64(0)))},
        {"complex64",  unsafe.Sizeof(complex64(0)),  uintptr(unsafe.Alignof(complex64(0)))},
        {"complex128", unsafe.Sizeof(complex128(0)), uintptr(unsafe.Alignof(complex128(0)))},
    }
    for _, t := range types {
        fmt.Printf("%-12s size=%d align=%d\n", t.name, t.size, t.align)
    }
}
```

Output:
```
int8         size=1 align=1
int16        size=2 align=2
int32        size=4 align=4
int64        size=8 align=8
float32      size=4 align=4
float64      size=8 align=8
complex64    size=8 align=4   (two float32, align = float32 align)
complex128   size=16 align=8  (two float64, align = float64 align)
```

### Complex Number Layout

```go
// complex64 is laid out as two adjacent float32 values:
var c complex64 = 3 + 4i
realPtr := (*float32)(unsafe.Pointer(&c))
imagPtr := (*float32)(unsafe.Pointer(uintptr(unsafe.Pointer(&c)) + 4))
fmt.Println(*realPtr, *imagPtr) // 3 4

// complex128: two float64 values
var d complex128 = 1.5 + 2.5i
realD := (*float64)(unsafe.Pointer(&d))
imagD := (*float64)(unsafe.Pointer(uintptr(unsafe.Pointer(&d)) + 8))
fmt.Println(*realD, *imagD) // 1.5 2.5

// Access via built-in functions (idiomatic):
fmt.Println(real(d), imag(d)) // 1.5 2.5
```

---

## OS / Syscall Level

### Numeric Types in Syscalls

The OS kernel uses C types for its ABI. Go's `syscall` package maps between Go numeric types and kernel types:

```go
// From src/syscall/ztypes_linux_amd64.go
type Stat_t struct {
    Dev     uint64  // device number
    Ino     uint64  // inode number
    Nlink   uint64  // number of hard links
    Mode    uint32  // file mode
    Uid     uint32  // user ID
    Gid     uint32  // group ID
    _       int32   // padding
    Rdev    uint64  // device ID (if special file)
    Size    int64   // total size in bytes
    Blksize int64   // blocksize for filesystem I/O
    Blocks  int64   // number of 512B blocks
    Atim    Timespec
    Mtim    Timespec
    Ctim    Timespec
    _       [3]int64 // padding
}
```

Note how each field has a specific type matching the Linux kernel struct. `uint32` for mode/uid/gid, `int64` for sizes, `uint64` for device numbers.

### Integer Sizes in Networking

```go
// From src/syscall/ztypes_linux.go:
type RawSockaddrInet4 struct {
    Family uint16   // AF_INET = 2
    Port   uint16   // network byte order
    Addr   [4]byte  // IPv4 address
    Zero   [8]uint8 // padding
}

// Port in network byte order: big-endian
// Go uses encoding/binary.BigEndian to convert
import "encoding/binary"

port := uint16(8080)
networkBytes := make([]byte, 2)
binary.BigEndian.PutUint16(networkBytes, port)
// networkBytes = [0x1F, 0x90]
```

---

## Source Code Walkthrough

### Key Files for Numeric Types

```
src/
  builtin/builtin.go         - int, uint, float32, float64, complex64, complex128 documented
  go/types/basic.go          - BasicKind constants for all numeric types
  cmd/compile/internal/
    types2/basic.go          - Type information: size, alignment
    ssagen/ssa.go            - SSA opcodes for numeric ops
    walk/convert.go          - Type conversion code generation
    walk/expr.go             - Arithmetic expression lowering
  runtime/
    internal/math/
      bits.go                - Overflow-detecting arithmetic helpers
    stubs.go                 - Runtime support for division (div by zero)
  math/
    bits/bits.go             - math/bits package: Add64, Mul64, etc.
```

### Integer Division: div by zero handling

```go
// From src/runtime/stubs.go
// When the compiler generates a division instruction, it inserts a check:
// if b == 0 { panic(divisionByZero) }

// The actual panic type:
var divideError = plainError("integer divide by zero")

// Generated for: a / b
// → if b == 0 { panic("integer divide by zero") }
// → result = a / b (IDIV instruction on x86)
```

---

## Assembly Output Analysis

### Integer Addition: `a + b` (int64)

```go
func add(a, b int64) int64 { return a + b }
```

x86-64 assembly (register-based ABI, Go 1.17+):
```asm
; a in AX, b in BX
ADDQ BX, AX    ; AX = AX + BX (64-bit addition)
RET
```

One instruction! The register ABI (Go 1.17+) eliminates stack operations for simple functions.

### Type Conversion: int32 → int64

```go
func widen(x int32) int64 { return int64(x) }
```

Assembly:
```asm
; x in AX (32-bit)
MOVLQSX AX, AX  ; sign-extend 32-bit AX to 64-bit RAX
RET
```

`MOVLQSX` = MOVe Long (32-bit) to Quad (64-bit) with Sign eXtension. The upper 32 bits are filled with the sign bit of the lower 32 bits.

### Float Operations: float64 addition

```go
func addFloat(a, b float64) float64 { return a + b }
```

Assembly (using SSE2):
```asm
; a in X0, b in X1 (XMM floating-point registers)
ADDSD X1, X0   ; Add Scalar Double (float64): X0 = X0 + X1
RET
```

### Integer to Float Conversion

```go
func toFloat(x int64) float64 { return float64(x) }
```

Assembly:
```asm
; x in AX
CVTSQ2SD AX, X0  ; ConVert Signed Quadword to Scalar Double: X0 = float64(AX)
RET
```

### Division: float64

```go
func divFloat(a, b float64) float64 { return a / b }
```

Assembly:
```asm
DIVSD X1, X0  ; Divide Scalar Double: X0 = X0 / X1
RET
```

Note: No division-by-zero check for floats! Float division by zero produces `+Inf` or `-Inf`, not a panic.

---

## Performance Internals

### Integer Division is Slow

```
Instruction latency on Intel Skylake:
  ADD, SUB:    1 cycle
  MUL:         3 cycles
  IMUL (64):   3 cycles
  IDIV (64):   35-90 cycles!! (variable latency)
  FDIV (f64):  13-14 cycles
```

The compiler replaces integer division by constants with multiplication and shift:

```go
func divBy4(x int) int { return x / 4 }
```

Assembly:
```asm
; Compiler replaces /4 with >>2 (arithmetic right shift)
SARQ $2, AX  ; Arithmetic Shift Right by 2: /4 in one cycle
RET
```

For division by a non-power-of-2 constant (like `/10`), the compiler uses a "magic number" multiply trick:

```go
func divBy10(x int64) int64 { return x / 10 }
```

Assembly (approximate):
```asm
MOVQ $7378697629483820647, CX  ; magic number for division by 10
IMULQ CX                        ; multiply
SARQ $2, DX                     ; adjust
; Result in DX
```

This replaces a ~90-cycle `IDIV` with a ~6-cycle multiply+shift sequence.

### Floating-Point Special Values

```go
import (
    "fmt"
    "math"
)

func main() {
    // Inf
    posInf := math.Inf(1)
    negInf := math.Inf(-1)
    fmt.Println(posInf)   // +Inf
    fmt.Println(negInf)   // -Inf
    fmt.Println(1.0 / 0.0) // COMPILE ERROR: constant division by zero

    // NaN
    nan := math.NaN()
    fmt.Println(nan)        // NaN
    fmt.Println(nan == nan) // false! NaN != NaN by IEEE 754
    fmt.Println(math.IsNaN(nan)) // true

    // Zero: positive and negative zero
    posZero := float64(0)
    negZero := -posZero
    fmt.Println(posZero == negZero) // true! +0 == -0
    fmt.Println(math.Signbit(negZero)) // true: negative zero

    // Subnormals (very small numbers)
    tiny := math.SmallestNonzeroFloat64 // 5e-324
    fmt.Println(tiny)
}
```

---

## Garbage Collector Interaction

### Numeric Types and GC

Numeric types (int, float, complex) are **not pointers**. The GC's pointer map (`GCData`) marks them as non-pointer regions:

```
GC scan of a struct {x int64; s string; y float64}:
  int64:   skip (no pointer)
  string:  scan (contains pointer to string data)
  float64: skip (no pointer)
```

This means:
1. GC overhead for numeric-heavy data is minimal
2. Large numeric arrays (`[]float64{...}`) don't cause GC pressure beyond the slice header

### Numeric Types and Escape Analysis

```go
func main() {
    x := int64(42)          // stack (does not escape)
    p := &x                 // x escapes to heap (address taken)
    fmt.Println(*p)

    // But for interface wrapping of common small integers,
    // the compiler uses static data:
    var i interface{} = int(0) // uses staticuint64s[0] — no allocation
    var j interface{} = int(255) // uses staticuint64s[255] — no allocation
    var k interface{} = int(256) // DOES allocate — beyond static table
    _ = i; _ = j; _ = k
}
```

From `src/runtime/iface.go`:
```go
// staticuint64s is a table of the first 256 uint64 values
// Used to avoid heap allocation when boxing small integers
var staticuint64s = [256]uint64{
    0, 1, 2, ... 255,
}
```

When an integer 0-255 is stored in an `interface{}`, Go uses a pointer into this static table instead of allocating on the heap.

---

## Escape Analysis

```bash
# See escape analysis decisions for numeric types
go build -gcflags="-m=2" ./...
```

```go
func escapesInt() *int64 {
    x := int64(42)  // "x escapes to heap"
    return &x       // address taken, returned — escapes
}

func stackInt() int64 {
    x := int64(42)  // "x does not escape"
    return x        // value copy — stays on stack
}

func interfaceInt(x int) interface{} {
    return x  // may or may not escape depending on value and compiler version
    // For 0-255: uses staticuint64s, no allocation
    // For larger: "x escapes to heap"
}
```

---

## Compiler Flags & Build Tags

### Viewing Numeric Type IR

```bash
# View SSA passes for a numeric function
GOSSAFUNC=add go build .

# View final assembly
go tool compile -S -N -l numeric_test.go

# Disable bounds checking (dangerous, for benchmarking only)
go build -gcflags="-B" .

# Disable inlining (see real function call costs)
go build -gcflags="-l" .
```

### Build Tags for Platform-Specific Numeric Code

```go
//go:build amd64
// +build amd64

package simd

// x86-specific float32 batch processing using assembly
func addFloat32x8(a, b, result *[8]float32)
```

---

## SSA Form & Optimization Passes

### Constant Folding for Numeric Literals

```go
const x = 10
const y = 20
const z = x * y // 200 — computed at compile time, no runtime multiply
```

SSA constant folding reduces `10 * 20` to the literal `200` during compilation.

### Strength Reduction

The compiler replaces expensive operations with cheaper equivalents:

```go
x * 2   → x + x  (or ADDQ)
x * 4   → x << 2
x / 4   → x >> 2 (for positive, SAR for signed)
x % 8   → x & 7  (for powers of 2)
```

### Nil Check Elimination for Numeric Pointers

```go
func sum(p *int64, n int) int64 {
    if p == nil { return 0 }
    // After nil check, compiler knows p != nil
    // and eliminates redundant nil checks in the loop
    var total int64
    for i := 0; i < n; i++ {
        total += *(*int64)(unsafe.Pointer(uintptr(unsafe.Pointer(p)) + uintptr(i)*8))
    }
    return total
}
```

### Inlining of Numeric Functions

Small numeric functions (like `math.Abs`, `math.Max`) are inlined by the compiler:

```go
func abs(x float64) float64 {
    if x < 0 { return -x }
    return x
}
```

This becomes a single `ANDPD` (AND packed double) or `VABSSD` instruction — no function call overhead.

---

## Unsafe Operations

### Reinterpreting Float Bits as Integer

```go
import (
    "fmt"
    "math"
    "unsafe"
)

func floatBits(f float64) uint64 {
    return *(*uint64)(unsafe.Pointer(&f))
}

func bitsFloat(u uint64) float64 {
    return *(*float64)(unsafe.Pointer(&u))
}

// Idiomatic alternative (no unsafe):
func floatBitsClean(f float64) uint64 {
    return math.Float64bits(f)
}

func main() {
    f := 1.0
    bits := math.Float64bits(f)
    fmt.Printf("1.0 bits: %064b\n", bits)
    // 0 01111111111 0000000000000000000000000000000000000000000000000000
    // sign=0, exp=1023 (biased)=0 unbiased, mantissa=0 → value=1.0

    fmt.Printf("-0.0 bits: %064b\n", math.Float64bits(-0.0))
    // 1 00000000000 0000000000000000000000000000000000000000000000000000
    // sign=1, exp=0, mantissa=0 → negative zero
}
```

### Direct Memory Access for Numeric Arrays

```go
// Access float64 slice as bytes (for binary serialization)
func float64SliceToBytes(s []float64) []byte {
    if len(s) == 0 { return nil }
    return unsafe.Slice((*byte)(unsafe.Pointer(&s[0])), len(s)*8)
}

// This is how encoding/binary works internally for numeric types
```

---

## ABI & Calling Conventions

### Register-Based ABI (Go 1.17+, amd64)

Go uses a register-based ABI for function calls on amd64, arm64, and other architectures:

```
Integer/pointer registers for arguments: AX, BX, CX, DI, SI, R8, R9, R10, R11
Float registers for arguments: X0-X14 (XMM registers)

Return values: same registers

For function add(a, b int64) int64:
  a → AX, b → BX, return → AX

For function f(x float64) float64:
  x → X0, return → X0
```

### SIMD Auto-Vectorization

The Go compiler can sometimes auto-vectorize numeric loops for SIMD:

```go
func addSlices(a, b, c []float32) {
    for i := range a {
        c[i] = a[i] + b[i] // compiler may generate VADDPS (256-bit AVX)
    }
}
```

Check with:
```bash
go build -gcflags="-d=ssa/check_bce/debug=1" .
```

---

## Float Internals: IEEE 754

### Special Value Arithmetic

```go
import "math"

// Infinity arithmetic
math.Inf(1) + 1  = +Inf
math.Inf(1) * -1 = -Inf
math.Inf(1) + math.Inf(-1) = NaN  // ∞ - ∞ is undefined
math.Inf(1) * 0 = NaN             // ∞ × 0 is undefined

// NaN propagation
math.NaN() + 1  = NaN  // NaN propagates through all operations
math.NaN() * 0  = NaN
math.NaN() == math.NaN() = false  // NaN is not equal to itself!

// Zero
0.0 * math.Inf(1) = NaN
1.0 / 0.0         // COMPILE ERROR (constant division)
x := 0.0; 1.0/x  = +Inf  // runtime: no panic
```

### Float Bit Manipulation

```go
// Fast inverse square root (Quake III algorithm concept)
func fastInvSqrt(x float32) float32 {
    bits := math.Float32bits(x)
    bits = 0x5f3759df - (bits >> 1) // bit-level hack
    result := math.Float32frombits(bits)
    // One Newton-Raphson iteration:
    return result * (1.5 - (x*0.5)*result*result)
}
```

### Subnormal Numbers (Denormals)

```go
// When exponent = 0 and mantissa ≠ 0: subnormal (denormal)
tiny := math.SmallestNonzeroFloat64 // 5e-324
fmt.Println(tiny) // 5e-324

// Subnormal arithmetic is slow on some CPUs (x87 mode)
// Modern x86 uses DAZ/FTZ modes to flush to zero
// Go does NOT enable DAZ/FTZ — subnormals are handled correctly
```

---

## Tricky Questions

**Q1: What does `MOVLQSX` instruction do in x86-64?**
A: MOVe Long (32-bit) to Quadword (64-bit) with Sign eXtension. It zero-fills the upper 32 bits based on the sign bit of the 32-bit value. Used for `int32 → int64` conversion.

**Q2: Why does `float64(math.MaxInt64)` return a value larger than `math.MaxInt64`?**
A: `float64` has only 52 mantissa bits, so the nearest representable float64 to MaxInt64 (2^63-1) is 2^63 — which is larger. Converting back to int64 overflows.

**Q3: Why is integer division by zero a panic in Go, but float division by zero is not?**
A: Integer division by zero is undefined in all ISAs — x86 generates a `#DE` exception. The Go runtime catches this hardware exception and turns it into a panic. Float division by zero is defined by IEEE 754 as producing `±Infinity`, so no exception occurs.

**Q4: How does the compiler convert `int/10` to multiplications without using `IDIV`?**
A: It uses Barrett reduction — multiply by a "magic number" (reciprocal estimate), then correct with shifts. This replaces a ~90-cycle IDIV with ~6 cycles of multiply and shift.

**Q5: Why are integers 0-255 stored in `interface{}` without heap allocation?**
A: Go's runtime has a `staticuint64s [256]uint64` table. When boxing an integer 0-255 into `interface{}`, Go stores a pointer into this static array — avoiding heap allocation entirely.

**Q6: What is the Go register ABI and when was it introduced?**
A: The register-based ABI (RABI) was introduced in Go 1.17. It passes function arguments in CPU registers (AX, BX, CX, etc. for integers; X0-X14 for floats) instead of on the stack. This eliminates memory traffic for simple function calls.

**Q7: What is `VADDPS` and when might Go generate it?**
A: `VADDPS` is AVX/AVX2 instruction that adds 8 float32 values simultaneously (SIMD). Go's compiler can auto-vectorize simple loops over float32 slices. Check with assembly output: `go tool compile -S`.

---

## Diagrams & Visual Aids

### float64 Bit Layout

```
Bit: 63  62         52  51                                0
     ┌─┬──────────────┬──────────────────────────────────┐
     │S│   Exponent   │           Mantissa                │
     │1│   11 bits    │            52 bits                │
     └─┴──────────────┴──────────────────────────────────┘

S=0, E=01111111111(1023), M=0    → 1.0
S=0, E=01111111111(1023), M=1000 → 1.5
S=0, E=all 1s,           M=0    → +∞
S=0, E=all 1s,           M≠0   → NaN
S=0, E=0,                M=0    → +0.0
```

### int8 Overflow Visualization

```
int8 values on a circle:
            0
          / | \
      -1    |    1
    /        |        \
  127 ←── 126       ... ──→ -128
           wrap-around!
```

### SSA Numeric Conversion Types

```
WIDENING (information preserved):
  int8 → int16 → int32 → int64  (SignExt)
  uint8 → uint16 → uint32 → uint64 (ZeroExt)
  float32 → float64 (CVTSS2SD)

NARROWING (may lose information):
  int64 → int32  (Trunc64to32)
  float64 → float32 (CVTSD2SS)

CROSS-KIND:
  int32 → float64 (CVTSL2SD)
  float64 → int32 (CVTSD2SL + truncation)
```
