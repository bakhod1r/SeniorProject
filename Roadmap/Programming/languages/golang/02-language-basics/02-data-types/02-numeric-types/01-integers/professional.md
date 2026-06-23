# Integers — Professional Level

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
10. [SSA Form & Optimization Passes](#ssa-form-optimization-passes)
11. [Unsafe Operations](#unsafe-operations)
12. [ABI & Calling Conventions](#abi-calling-conventions)
13. [Integer Internals: Two's Complement](#integer-internals-twos-complement)
14. [Tricky Questions](#tricky-questions)

---

## How It Works Internally

> **Focus:** "What happens under the hood?"

### Integer Types in the Go Runtime

All integer types in Go are represented as their natural binary format in memory:

```
int8:   8-bit two's complement
int16:  16-bit two's complement (little-endian in memory on x86)
int32:  32-bit two's complement
int64:  64-bit two's complement
uint8:  8-bit unsigned
uint64: 64-bit unsigned
int:    native word size (32 or 64 bit depending on platform)
```

The Go runtime itself uses integers extensively:
- `int` for slice lengths and indices
- `uint64` for garbage collector heap pointers
- `int64` for goroutine IDs, timer values
- `uintptr` for pointer arithmetic in the runtime

### Two's Complement in Detail

```
For int8 (8 bits):
  Positive: standard binary
    0 = 00000000
    1 = 00000001
    127 = 01111111

  Negative: invert bits + 1
    -1: invert(00000001) + 1 = 11111110 + 1 = 11111111
    -2: invert(00000010) + 1 = 11111101 + 1 = 11111110
    -128: 10000000 (special: min value)

  Property: -x = ~x + 1 (bitwise NOT + 1)
  This means:
    MaxInt8 + 1 = 01111111 + 1 = 10000000 = -128 (overflow wraps)
```

### Why Two's Complement?

```go
// In two's complement, addition/subtraction is the same circuit
// regardless of sign. The CPU doesn't know if the operands are signed or unsigned.
// The difference is only in INTERPRETATION:

var a uint8 = 200
var b uint8 = 100
fmt.Println(a + b) // 44 (wraps: 300 - 256 = 44)

var x int8 = -56 // same bit pattern as uint8(200): 11001000
var y int8 = -100 // same as uint8(156): 10011100
// x - y = (-56) - (-100) = 44
// bit pattern: 11001000 + 01100100 = 00101100 = 44
// Same addition circuit, different interpretation!
```

---

## Runtime Deep Dive

### Integer Arithmetic in the Runtime

The Go runtime (`src/runtime`) performs arithmetic on integers for:

1. **Memory allocation**: sizes computed as `int` or `uintptr`
2. **Goroutine stack management**: stack sizes as `uintptr`
3. **Timer wheels**: times stored as `int64` (nanoseconds)
4. **GC spans**: object counts as `uintptr`

```go
// From src/runtime/msize.go (simplified):
func roundupsize(size uintptr) uintptr {
    // Round up allocation size to next size class
    // Uses bitwise operations for efficiency:
    return (size + 7) &^ 7  // round up to 8-byte boundary
}
```

### Integer Division in the Runtime (div by zero)

When you divide an integer by zero, the CPU raises a hardware exception (`#DE` on x86). The Go runtime catches this via a signal handler and converts it to a panic:

```go
// From src/runtime/signal_unix.go (conceptual):
// When SIGFPE (floating-point exception, also used for integer divide-by-zero) arrives:
// → convertpanic("integer divide by zero")
// → panic(divisionByZero)

var divisionByZero = plainError("integer divide by zero")
```

This is why you get a clean panic message rather than a crash dump.

---

## Compiler Perspective

### Integer Operations → SSA Opcodes

```go
// From src/cmd/compile/internal/ssa/op.go:
const (
    OpAdd8   // int8 addition
    OpAdd16  // int16 addition
    OpAdd32  // int32 addition
    OpAdd64  // int64 addition
    // Similar for Sub, Mul, Div...

    OpLsh32x8  // int32 << uint8 (left shift with 8-bit shift amount)
    OpRsh32x8  // int32 >> uint8 (arithmetic right shift)
    OpRsh32Ux8 // uint32 >> uint8 (logical right shift)

    OpAnd64   // bitwise AND on int64
    OpOr32    // bitwise OR on int32
    OpXor16   // bitwise XOR on int16
)
```

Different shift opcodes for different shift amount types prevent undefined behavior (shifting by a negative amount or amount >= bit width).

### Division by Constant Optimization

The compiler performs Barrett reduction for division by constants:

```go
func divBy10(x int64) int64 { return x / 10 }
```

Compiler transform (conceptual):
```
1. Compute magic number m = ceil(2^(N+s) / d) where d=10, N=64
   m = 7378697629483820647, s = 2
2. Result = (x * m) >> (N + s)
   (with adjustment for sign)
```

This replaces a 35-90 cycle `IDIV` instruction with:
- `IMULQ` (multiply, 3 cycles)
- `SARQ`  (shift, 1 cycle)
- `ADDQ` / `SARQ` (adjustment, 2 cycles)
Total: ~6-7 cycles instead of 35-90.

---

## Memory Layout

### Integer Type Sizes and Alignments

```go
import (
    "fmt"
    "unsafe"
)

func main() {
    types := []interface{}{
        int8(0), int16(0), int32(0), int64(0),
        uint8(0), uint16(0), uint32(0), uint64(0),
        int(0), uint(0), uintptr(0),
    }
    names := []string{
        "int8", "int16", "int32", "int64",
        "uint8", "uint16", "uint32", "uint64",
        "int", "uint", "uintptr",
    }
    for i, t := range types {
        v := reflect.ValueOf(t)
        fmt.Printf("%-8s size=%-2d align=%d\n",
            names[i],
            v.Type().Size(),
            v.Type().Align())
    }
}
/* Output on amd64:
int8     size=1  align=1
int16    size=2  align=2
int32    size=4  align=4
int64    size=8  align=8
uint8    size=1  align=1
...
int      size=8  align=8  (64-bit platform)
uintptr  size=8  align=8
*/
```

### Little-Endian Memory Storage

Go on x86 (little-endian): lower bytes stored at lower addresses.

```go
var x uint32 = 0x01020304

ptr := (*[4]byte)(unsafe.Pointer(&x))
fmt.Printf("%02x %02x %02x %02x\n", ptr[0], ptr[1], ptr[2], ptr[3])
// 04 03 02 01 (little-endian: least significant byte first)

// Big-endian network byte order uses encoding/binary:
import "encoding/binary"
buf := make([]byte, 4)
binary.BigEndian.PutUint32(buf, x)
fmt.Printf("%02x %02x %02x %02x\n", buf[0], buf[1], buf[2], buf[3])
// 01 02 03 04 (big-endian: most significant byte first)
```

---

## OS / Syscall Level

### Integer Types in Linux Syscalls

Linux syscalls use C types. Go's `syscall` package maps Go integers to C types:

```go
// From src/syscall/ztypes_linux_amd64.go:
type Stat_t struct {
    Dev   uint64 // device (st_dev): unsigned long long
    Ino   uint64 // inode (st_ino): unsigned long long
    Nlink uint64 // hard links (st_nlink)
    Mode  uint32 // file mode (st_mode): unsigned int
    Uid   uint32 // user ID (st_uid)
    Gid   uint32 // group ID (st_gid)
    _     int32  // padding
    Rdev  uint64
    Size  int64  // total size (st_size): long long
    // ...
}
```

The specific types are dictated by the OS ABI — Go must use the same types as the kernel struct.

### Read/Write syscalls

```go
// From src/syscall/syscall_linux.go:
func Read(fd int, p []byte) (n int, err error) {
    n, err = read(fd, p)
    // ...
    return
}

// The 'fd' is int (signed) because:
// 1. Linux file descriptors are C int (32-bit signed)
// 2. -1 is used as error indicator
// 3. Valid FDs are 0 to ~1M (fit in int32)
```

---

## Source Code Walkthrough

### Key Files for Integer Implementation

```
src/
  builtin/builtin.go     - int, uint, int8-int64, uint8-uint64, uintptr documented
  go/types/basic.go      - BasicKind constants: Int, Int8, ..., Uint64, Uintptr
  cmd/compile/internal/
    ssagen/ssa.go        - integer SSA opcodes generation
    walk/expr.go         - arithmetic expression lowering
    walk/convert.go      - integer conversion code generation (sign-extend, zero-extend, truncate)
  runtime/
    internal/math/       - overflow-detecting arithmetic
    asm_amd64.s          - runtime assembly for various operations
  math/bits/             - math/bits package: Add64, Mul64, LeadingZeros, etc.
  encoding/binary/       - integer byte-order conversion
```

### math/bits Implementation

```go
// From src/math/bits/bits.go:
func Add64(x, y, carry uint64) (sum, carryOut uint64) {
    sum = x + y + carry
    // Overflow if sum < x (or if carry + y overflows)
    carryOut = ((x & y) | ((x | y) &^ sum)) >> 63
    return
}
```

This is implemented in Go but the compiler recognizes it and replaces it with the ADC (add with carry) instruction on amd64.

---

## Assembly Output Analysis

### Integer Addition (int64)

```go
func addInts(a, b int64) int64 { return a + b }
```

amd64 assembly (register ABI, Go 1.17+):
```asm
; a in AX, b in BX
ADDQ BX, AX  ; 64-bit ADD: 1 cycle, 1 instruction
RET
```

### Integer Overflow Check (before Go uses it)

```go
func addChecked(a, b int64) (int64, bool) {
    result := a + b
    overflow := (a^result)&(b^result) < 0
    return result, overflow
}
```

Assembly:
```asm
ADDQ  BX, AX       ; result = a + b
MOVQ  "".a(SP), CX ; reload a (for XOR check)
MOVQ  "".b(SP), DX ; reload b
XORQ  AX, CX       ; a^result
XORQ  AX, DX       ; b^result
ANDQ  DX, CX       ; (a^result) & (b^result)
SHRQ  $63, CX      ; check sign bit (bit 63)
; CX = 1 if overflow, 0 if not
```

### Division by Constant (magic number)

```go
func div10(x int64) int64 { return x / 10 }
```

Assembly (compiler optimized):
```asm
MOVQ  "".x(SP), AX
MOVQ  $7378697629483820647, CX  ; magic number
IMULQ CX                          ; high 64 bits in DX
MOVQ  DX, CX
SHRQ  $63, DX                     ; extract sign bit
SARQ  $2, CX                      ; shift right by 2 (s=2 for dividing by 10)
ADDQ  DX, CX                      ; add sign correction
RET
```

### Bitwise AND

```go
func andOp(a, b int64) int64 { return a & b }
```

Assembly:
```asm
ANDQ BX, AX  ; 1 cycle
RET
```

### Left Shift

```go
func shl(x int64, n uint) int64 { return x << n }
```

Assembly:
```asm
MOVQ "".n(SP), CX  ; shift amount
SHLQ CL, AX       ; shift AX left by CL bits
RET
```

Note: The shift amount must be in the CL register on x86.

### Arithmetic Right Shift (signed)

```go
func sar(x int64, n uint) int64 { return x >> n }
```

Assembly:
```asm
MOVQ "".n(SP), CX
SARQ CL, AX  ; Shift Arithmetic Right: fills with sign bit
RET
```

### Logical Right Shift (unsigned)

```go
func lsr(x uint64, n uint) uint64 { return x >> n }
```

Assembly:
```asm
SHRQ CL, AX  ; Shift Right: fills with ZEROS (logical)
RET
```

`SAR` vs `SHR` — this is the key difference between signed and unsigned right shift at the machine level.

---

## Performance Internals

### x86 Integer Instruction Latencies (Intel Skylake)

```
Instruction    Latency  Throughput
ADD/SUB          1       4/cycle
MUL (32x32)      3       1/cycle
IMUL (64x64)     3       1/cycle
IDIV (64)        35-90   1/35-90
AND/OR/XOR       1       4/cycle
SHL/SHR/SAR      1-3     2-4/cycle
POPCNT           3       1/cycle  (bits.OnesCount64)
LEA              1-3     2/cycle  (address calculation)
```

**Key takeaway**: Integer division is 10-100x slower than other operations. The compiler replaces division by constants with multiply sequences. Division by variables cannot be optimized.

### Branch Misprediction with Integer Comparisons

```go
// Predictable: data sorted or mostly monotone → fast
for _, x := range sortedSlice {
    if x > 0 { // predictable
        process(x)
    }
}

// Unpredictable: random data → up to 15-cycle misprediction penalty
for _, x := range randomSlice {
    if x > threshold { // 50/50 → branch predictor fails
        process(x)
    }
}

// Branchless alternative for simple operations:
for _, x := range randomSlice {
    // Branchless: no branch, no misprediction
    val := x * int64((x > 0))  // multiply by 0 or 1
    _ = val
}
```

### SIMD Integer Vectorization

Go's compiler can auto-vectorize integer loops for SIMD:

```go
func addSlices(a, b, c []int32) {
    for i := range a {
        c[i] = a[i] + b[i] // compiler may emit PADDD (128-bit SSE2) or VPADDD (256-bit AVX2)
    }
}
// With VPADDD (AVX2): 8 int32 additions per instruction
// Throughput: 8x vs scalar
```

---

## Garbage Collector Interaction

### Integers Are Not Pointers

Integer types (`int`, `uint`, `int64`, etc.) have `PtrBytes=0` in their `runtime._type`:
- The GC never traces integer fields
- Integers in structs are invisible to the GC scan
- This makes integer-heavy data structures GC-efficient

### Interface Boxing of Integers

```go
// From src/runtime/iface.go:
// staticuint64s: a table of the first 256 uint64 values
// Used to avoid heap allocation for small boxed integers:

var staticuint64s = [256]uint64{ 0, 1, 2, ... 255 }

// When boxing int(42) into interface{}:
// If 0 <= x <= 255: return pointer into staticuint64s[x]
//   → zero heap allocation
// If x > 255 or x < 0: allocate on heap

var i interface{} = int(42)  // uses staticuint64s[42], no alloc
var j interface{} = int(256) // heap allocation
```

---

## SSA Form & Optimization Passes

### Integer Constant Folding

```go
const x = 3
const y = 7
const z = x * y // 21 — computed at compile time as untyped constant

var a int = z  // no runtime multiplication
```

SSA pass: replace `Mul64(Const64(3), Const64(7))` with `Const64(21)`.

### Dead Code Elimination for Integer Conditions

```go
const version = 1

func process() {
    if version < 2 {
        // Always true: this block is kept
        fmt.Println("v1 processing")
    }
    if version >= 2 {
        // Always false: this block is compiled out
        fmt.Println("v2 processing") // REMOVED
    }
}
```

### Strength Reduction

```go
// Source:
x * 4  // MUL instruction

// After strength reduction:
x << 2 // SAL instruction (1 cycle vs 3)

// x % 8 (for unsigned):
x & 7  // AND instruction (1 cycle vs 35-90 for DIV)
```

---

## Unsafe Operations

### Direct Memory Access for Integer Manipulation

```go
import "unsafe"

// Read int32 from arbitrary byte offset
func readInt32LE(data []byte, offset int) int32 {
    return *(*int32)(unsafe.Pointer(&data[offset]))
    // Note: assumes little-endian; be careful about alignment
}

// Swap bytes (big-endian to little-endian)
func bswap32(x uint32) uint32 {
    return (x>>24) | ((x>>8)&0xFF00) | ((x&0xFF00)<<8) | (x<<24)
}

// Or use math/bits:
import "math/bits"
func bswap32bits(x uint32) uint32 {
    return bits.ReverseBytes32(x)
}
```

### Integer Pointer Arithmetic

```go
// Walk through an array of int64 using pointer arithmetic
func sumArray(data []int64) int64 {
    var sum int64
    ptr := unsafe.Pointer(&data[0])
    for i := 0; i < len(data); i++ {
        sum += *(*int64)(unsafe.Pointer(uintptr(ptr) + uintptr(i)*8))
    }
    return sum
}

// SAFER: just use the slice (this is only for education)
func sumArraySafe(data []int64) int64 {
    var sum int64
    for _, v := range data {
        sum += v
    }
    return sum
}
```

---

## ABI & Calling Conventions

### Integer Registers in Go's Register ABI (Go 1.17+, amd64)

```
Integer argument registers: AX, BX, CX, DI, SI, R8, R9, R10, R11
Return value registers:     AX, BX, CX, DI, SI, R8, R9, R10, R11

function add(a, b int64) int64:
  a → AX
  b → BX
  return → AX

function multiReturn(a, b int64) (int64, int64):
  a → AX
  b → BX
  return 1 → AX
  return 2 → BX
```

### 64-bit Atomic on 32-bit Platform

```go
// On 32-bit ARM/x86, int64 operations are NOT atomic:
// A 64-bit store is two 32-bit stores → not atomic without lock

// The runtime provides 64-bit aligned access:
// sync/atomic guarantees atomicity by:
//   - On 64-bit: using native 64-bit instructions (XCHG, LOCK ADD)
//   - On 32-bit: using a mutex (much slower)

// This is why sync/atomic.Int64 fields must be 64-bit aligned:
type Counter struct {
    value int64 // must be at offset multiple of 8
    // BAD:
    // _ uint32
    // value int64  // offset 4: NOT 8-aligned → atomic panics on 32-bit!
}
```

---

## Integer Internals: Two's Complement

### Why Two's Complement?

```
History:
  One's complement (historical): -x = ~x (flip all bits)
  Problem: two representations of zero (+0 = 0000, -0 = 1111)
  Two's complement: -x = ~x + 1
  Advantage: unique zero, simpler hardware (add is always ADDQ)

Verification:
  -1 in 8-bit two's complement:
    ~1 = 11111110
    +1 = 11111111 = 255 unsigned = -1 signed ✓

  Addition works without knowing signs:
    127 + 1 = 01111111 + 00000001 = 10000000 = -128 (overflow defined!)
    -1 + 1  = 11111111 + 00000001 = 00000000 = 0 ✓
    -1 + -1 = 11111111 + 11111111 = 11111110 = -2 ✓ (carry out ignored)
```

### Negation Formula

```go
// -x = ~x + 1 (two's complement negation)
var x int8 = 5        // 00000101
var y int8 = ^x + 1   // ^(00000101) + 1 = 11111010 + 1 = 11111011 = -5
fmt.Println(y)        // -5 ✓

// Edge case: MinInt cannot be negated!
var m int8 = -128     // 10000000
fmt.Println(-m)       // still -128 (overflow: ~10000000 + 1 = 01111111 + 1 = 10000000)
```

---

## Tricky Questions

**Q1: What machine code does `x / 2` generate for an int64 vs uint64?**
A:
- `uint64 / 2`: `SHR $1, AX` — logical right shift by 1 (1 cycle)
- `int64 / 2`: requires sign correction:
  - `MOVQ AX, CX; SHRQ $63, CX; ADDQ CX, AX; SARQ $1, AX` — arithmetic shift with sign fixup

For negative odd numbers: int(-7)/2 = -3 (truncation toward zero), but sar(-7,1) = -4 (floor division). The compiler adds a correction step.

**Q2: Why is `bits.Add64` preferred over manual `+` with carry check?**
A: `bits.Add64` maps directly to the `ADC` (Add with Carry) x86 instruction, which uses the processor's carry flag. The manual check `result < a` requires an extra comparison. The compiler recognizes `bits.Add64` and emits `ADC` directly.

**Q3: On a 64-bit system, what is `unsafe.Sizeof(int(0))` and why?**
A: 8 bytes. `int` is defined as the native word size, which is 64 bits (8 bytes) on 64-bit platforms. This ensures that `int` can hold any slice index or pointer value.

**Q4: What does `IMULQ` produce vs `MULQ` on amd64?**
A: `IMULQ` = signed multiply; `MULQ` = unsigned multiply. Both produce 128-bit results (64-bit high + 64-bit low). The difference is the sign extension of operands. `bits.Mul64` uses `MULQ` (unsigned). For signed overflow detection, the check is based on sign bits after multiplication.

**Q5: Why does Go forbid shifting by a negative amount?**
A: Shifting by a negative amount is undefined behavior in C/C++ and causes inconsistent results across CPUs. x86 masks the shift count to 6 bits (for 64-bit) = 0-63. ARM handles it differently. Go enforces shift amount >= 0 at compile time for typed constants, and panics at runtime for variable negative shifts.

**Q6: What is the POPCNT instruction and when does Go use it?**
A: POPCNT counts the number of set bits in an integer (population count / Hamming weight). Go's `math/bits.OnesCount64(x)` compiles to `POPCNT RAX, RAX` on x86 with SSE4.2 support. This is a 3-cycle instruction vs ~16 cycles for the software implementation.
