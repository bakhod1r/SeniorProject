# Type Conversion in Go — Professional Level

## Focus: What Happens Under the Hood

---

## 1. How It Works Internally

### 1.1 The Compilation Pipeline for Conversions

When you write `float64(i)`, the Go compiler processes it through several phases:

1. **Parsing (syntax):** The parser sees `T(expr)` and creates an AST node `CallExpr` with the type as the function
2. **Type-checking (typecheck pass):** The compiler verifies the conversion is valid per the spec
3. **IR generation (SSA):** The conversion becomes an SSA instruction (`CONVNOP`, `CONV`, `CVTSL`, etc.)
4. **Code generation:** The SSA instruction maps to target machine instructions

### 1.2 Conversion Node in the AST

In the Go compiler source (`cmd/compile/internal/typecheck`), conversions generate a `OCONV` node:

```
OCONV
├── Left: expression to convert
├── Type: target type
└── Op: OCONV, OCONVNOP, ODOTTYPE (for interfaces)
```

For `float64(i)` where `i` is `int`:
- The compiler generates `OCONV(i, float64)`
- In SSA: `v = ConvertSL <float64> i` (or `CVTSL` = convert signed long)

### 1.3 Zero-Cost Conversions

The compiler recognizes conversions that are "no-ops" at the machine level:
- Named type to/from underlying type with same representation
- `type MyInt int` — `MyInt(x)` is a `OCONVNOP` — generates zero instructions

```go
type MyInt int
var n int = 42
m := MyInt(n)  // OCONVNOP — zero cost, compiler ensures same memory representation
```

Verify with: `go build -gcflags='-e -m' .`

---

## 2. Runtime Deep Dive

### 2.1 `runtime.slicebytetostring`

When you write `string(byteSlice)`, the compiler generates a call to:

```go
// Simplified version of runtime source
func slicebytetostring(buf *tmpBuf, b []byte) (str string) {
    l := len(b)
    if l == 0 {
        return ""
    }
    if l == 1 {
        stringStructOf(&str).str = unsafe.Pointer(&staticuint64s[b[0]])
        stringStructOf(&str).len = 1
        return
    }
    var p unsafe.Pointer
    if buf != nil && len(b) <= len(buf) {
        p = unsafe.Pointer(buf)
    } else {
        p = mallocgc(uintptr(l), nil, false)  // heap allocation
    }
    stringStructOf(&str).str = p
    stringStructOf(&str).len = l
    memmove(p, (*(*slice)(unsafe.Pointer(&b))).array, uintptr(l))
    return
}
```

Key observations:
- Single bytes use a static lookup table (`staticuint64s`) — no allocation
- Small strings (<32 bytes on stack) can use the `tmpBuf` — no heap allocation
- All other cases: `mallocgc` + `memmove`

### 2.2 `runtime.stringtoslicebyte`

```go
func stringtoslicebyte(buf *tmpBuf, s string) []byte {
    var b []byte
    if buf != nil && len(s) <= len(buf) {
        *buf = tmpBuf{}
        b = buf[:len(s)]
    } else {
        b = rawbyteslice(len(s))  // mallocgc
    }
    copy(b, s)
    return b
}
```

### 2.3 The tmpBuf Optimization

The compiler passes a stack-allocated `tmpBuf` (32 bytes) when it can prove the result doesn't escape to the heap. This avoids malloc for small strings/slices in many common cases.

```go
// This conversion may use tmpBuf (no heap alloc if s is short):
func example(s string) int {
    b := []byte(s)   // compiler may pass tmpBuf here
    return len(b)
}
```

### 2.4 Compiler-Elided Conversions

The compiler DOES NOT call `slicebytetostring` in these cases (optimization):

```go
// Case 1: string used directly in map lookup
m := map[string]int{"a": 1}
key := []byte("a")
_ = m[string(key)]  // no allocation — compiler special-cases this

// Case 2: for-range over converted string
b := []byte("hello")
for i, c := range string(b) {  // no allocation
    _, _ = i, c
}

// Case 3: string comparison
if string(b) == "hello" {  // no allocation
}

// Case 4: string concatenation with converted
_ = "prefix:" + string(b)  // actually DOES allocate — not optimized
```

---

## 3. Compiler Perspective

### 3.1 SSA Form for Numeric Conversions

Using `GOSSAFUNC=main go build`:

```go
func convert(i int) float64 {
    return float64(i)
}
```

SSA output (simplified):
```
b1:
  v1 = InitMem <mem>
  v2 = SP <uintptr>
  v3 = Arg <int> {i}     ; load argument
  v4 = CVTSL <float64> v3 ; convert int64 → float64
  v5 = Store <mem> {ret} v4 v1
  Ret v5
```

The `CVTSL` instruction maps to `CVTSI2SDQ` on x86-64.

### 3.2 String Conversion SSA

```go
func convert2(b []byte) string {
    return string(b)
}
```

SSA output (simplified):
```
b1:
  v1 = InitMem
  v2 = Arg <[]byte>
  v3 = StaticCall <(string,mem)> {runtime.slicebytetostring}
       [buf=nil, b=v2]
  v4 = SelectN <string> [0] v3
  v5 = SelectN <mem> [1] v3
  Ret v4 v5
```

### 3.3 Type Assertion Compilation

A type assertion `x.(T)` compiles to a call to `runtime.assertI2T` or `runtime.assertI2I`:

```go
var i interface{} = "hello"
s := i.(string)  // calls runtime.assertI2T2 internally
```

```
; Pseudo-assembly for i.(string)
MOVQ  i.type, AX        ; load interface type pointer
CMPQ  AX, typeptr_string ; compare with string type pointer
JNE   panic_branch       ; if not equal, panic
MOVQ  i.data, AX        ; load data pointer
```

For the two-value form `s, ok := i.(string)`:
```
; No conditional jump — just compare and set ok flag
MOVQ  i.type, AX
CMPQ  AX, typeptr_string
SETE  ok                 ; set ok = (types are equal)
```

---

## 4. Memory Layout

### 4.1 Integer Representations

All integer types use two's complement representation:

```
int8 range:  -128 to 127
  Binary:    1000 0000 = -128 (most negative)
             0111 1111 = 127  (most positive)
             1111 1111 = -1

int8(200):
  200 = 1100 1000 in binary
  Interpreted as int8 (signed): -56
  Because: 1100 1000 = -(256 - 200) = -56

uint8(200):
  200 = 1100 1000 in binary
  Interpreted as uint8 (unsigned): 200 ✓
```

### 4.2 IEEE 754 Float Representation

```
float64 (64-bit):
  Bit 63:    sign (1 bit)
  Bits 62-52: exponent (11 bits, biased by 1023)
  Bits 51-0:  mantissa (52 bits + implicit 1 bit)

float64(42):
  Sign:      0 (positive)
  Exponent:  1028 (1028 - 1023 = 5, so 2^5 = 32)
  Mantissa:  1.3125 (32 × 1.3125 = 42)
  Binary:    0 10000000100 0101000000000000000000000000000000000000000000000000

Precision limit:
  2^53 = 9007199254740992
  float64 can exactly represent integers up to 2^53
  Beyond that, consecutive integers cannot all be represented
```

### 4.3 String Header vs Slice Header

```go
// From runtime/string.go
type stringStruct struct {
    str unsafe.Pointer  // 8 bytes (pointer to data)
    len int             // 8 bytes (length in bytes)
}  // Total: 16 bytes

// From reflect/value.go
type SliceHeader struct {
    Data uintptr  // 8 bytes (pointer to data)
    Len  int      // 8 bytes (length)
    Cap  int      // 8 bytes (capacity)
}  // Total: 24 bytes

// When converting string → []byte:
// New SliceHeader is created (24 bytes on stack)
// New data array is allocated on heap (len(s) bytes)
// memmove copies the data
```

### 4.4 Interface Internal Layout

```go
// iface — interface with methods (non-empty interface)
type iface struct {
    tab  *itab          // pointer to interface table
    data unsafe.Pointer // pointer to concrete data
}

// eface — empty interface{}
type eface struct {
    _type *_type        // pointer to type descriptor
    data  unsafe.Pointer
}

// Type assertion: i.(string)
// 1. Check i._type == &string_type
// 2. If yes, return *(*string)(i.data)
// 3. If no, panic (or return ok=false)
```

---

## 5. OS / Syscall Level

### 5.1 Conversions at OS Boundaries

When Go interacts with the OS, type conversions are critical:

```go
// syscall.Read takes a []byte buffer
// The OS sees a pointer and length
// Go's []byte → C void* conversion happens via unsafe
func Read(fd int, p []byte) (n int, err error) {
    // Internally:
    // _p0 := unsafe.Pointer(&p[0])   // extract data pointer
    // n = syscall(SYS_READ, fd, _p0, len(p))
}
```

### 5.2 cgo and Type Conversion

```go
/*
#include <stdint.h>
int32_t add(int32_t a, int32_t b) { return a + b; }
*/
import "C"

func callC() {
    var a, b int32 = 10, 20
    // Must convert Go int32 to C.int32_t
    result := C.add(C.int32_t(a), C.int32_t(b))
    // Convert back
    goResult := int32(result)
    _ = goResult
}
```

The cgo tool generates C bridge code that handles type conversions between Go's type system and C's type system.

---

## 6. Source Code References

### 6.1 Relevant Go Compiler Files

- `cmd/compile/internal/typecheck/typecheck.go` — conversion type checking
- `cmd/compile/internal/walk/convert.go` — conversion code generation
- `runtime/string.go` — string conversion runtime functions
- `runtime/iface.go` — interface type assertion runtime

### 6.2 Key Functions in the Runtime

```go
// runtime/string.go
func slicebytetostring(buf *tmpBuf, b []byte) (str string)
func stringtoslicebyte(buf *tmpBuf, s string) []byte
func stringtoslicerune(buf *[tmpStringBufSize]rune, s string) []rune
func slicerunetostring(buf *tmpBuf, a []rune) string

// runtime/iface.go
func assertI2I(inter *interfacetype, i iface) (r iface)
func assertI2I2(inter *interfacetype, i iface) (r iface, b bool)
func assertE2I(inter *interfacetype, e eface) (r iface)
func panicdottypeE(have, want, iface *_type)  // panic for failed assertions
```

---

## 7. Assembly Output

### 7.1 Numeric Conversion

```go
func intToFloat(n int) float64 {
    return float64(n)
}
```

x86-64 assembly (from `go tool compile -S`):
```asm
"".intToFloat STEXT nosplit size=7 args=0x10 locals=0x0
    MOVQ    "".n+8(SP), AX      ; load n from stack
    CVTSI2SDQ AX, X0            ; convert int64 to float64
    MOVSD   X0, "".~r1+16(SP)  ; store result
    RET
```

### 7.2 String to []byte Assembly

```go
func convert(s string) []byte {
    return []byte(s)
}
```

x86-64 (simplified):
```asm
"".convert STEXT size=64
    MOVQ    $0, "".buf+0(SP)         ; buf = nil (no tmpBuf)
    MOVQ    "".s_data+8(SP), AX      ; load string.Data
    MOVQ    "".s_len+16(SP), BX      ; load string.Len
    MOVQ    AX, ""..autotmp+24(SP)
    MOVQ    BX, ""..autotmp+32(SP)
    MOVQ    BX, ""..autotmp+40(SP)   ; set slice header
    CALL    runtime.stringtoslicebyte(SB)
    ; ...
    RET
```

### 7.3 Type Assertion Assembly

```go
func assertString(i interface{}) string {
    return i.(string)
}
```

x86-64:
```asm
"".assertString STEXT size=72
    MOVQ    "".i.type+8(SP), AX   ; load interface type pointer
    MOVQ    "".i.data+16(SP), BX  ; load interface data pointer
    CMPQ    AX, type·string(SB)   ; compare with string type
    JNE     paniccode              ; panic if not string
    MOVQ    (BX), CX              ; dereference data pointer
    MOVQ    8(BX), DX             ; get string length
    MOVQ    CX, "".~r1+24(SP)    ; store result
    MOVQ    DX, "".~r1+32(SP)
    RET
paniccode:
    CALL    runtime.panicdottypeE(SB)
```

---

## 8. Performance Internals

### 8.1 The `tmpBuf` Mechanism in Detail

The compiler performs escape analysis to determine if a converted value escapes to the heap:

```go
// Compiler generates a tmpBuf when:
// 1. The result does not escape to the heap
// 2. The string/slice is small enough (≤32 bytes by default)

// tmpBuf size: typically 32 bytes
const tmpStringBufSize = 32
type tmpBuf [tmpStringBufSize]byte

// Example where tmpBuf IS used (no heap alloc):
func f(b []byte) bool {
    return string(b) == "hello"  // result doesn't escape
}

// Example where tmpBuf is NOT used (heap alloc):
func g(b []byte) string {
    return string(b)  // result may be stored/returned, must heap allocate
}
```

### 8.2 GC Impact

```
Heap allocated during conversions:
  []byte(s)   → 1 allocation = GC work proportional to len(s)
  string(b)   → 1 allocation = GC work proportional to len(b)
  []rune(s)   → 1 allocation = 4 × len(s) bytes for Unicode

GC scan cost:
  - Each allocation adds to GC scan work
  - 1000 conversions/request × 1000 RPS = 1M allocations/second
  - This can cause GC to run >100 times/second with short STW pauses
```

### 8.3 SIMD Optimization Opportunity

For bulk conversions (e.g., ASCII-only strings to []byte), SIMD instructions can process 16-32 bytes at a time. The Go runtime uses this for `memmove` but not directly in user-visible conversion paths. High-performance string processing libraries implement SIMD explicitly:

```go
// Conceptual SIMD copy (actual SIMD requires assembly)
// Process 16 bytes at a time using SSE2 instructions
// Reduces effective cost from O(n) sequential to O(n/16)
```

---

## 9. Internal Type System

### 9.1 How Type Compatibility Is Checked

From `cmd/compile/internal/types/type.go`, the `Identical` function determines if two types are identical:

```go
func Identical(t1, t2 *Type) bool {
    if t1 == t2 {
        return true
    }
    if t1.kind != t2.kind {
        return false
    }
    // ... recursively check fields, elements, etc.
}
```

The `ConvertibleTo` check (from the spec):
1. Both types have the same underlying type
2. Both are unnamed pointer types to same underlying type
3. Both are integer or floating point types
4. Both are complex number types
5. `T` is `string` and `x` is integer type
6. `T` is `[]byte` and `x` is `string` type (or vice versa)
7. `T` is `[]rune` and `x` is `string` type (or vice versa)

### 9.2 itab (Interface Table) Internals

```go
type itab struct {
    inter *interfacetype  // the interface type
    _type *_type          // the concrete type
    hash  uint32          // copy of _type.hash (used for type switches)
    _     [4]byte
    fun   [1]uintptr      // variable-length array of method pointers
}
```

When a type assertion is performed:
1. Extract `itab` from the interface
2. Compare `itab.inter` with the target interface type
3. If matched, return the concrete data pointer

This is **O(1)** — not a hash lookup, but a pointer comparison (with caching).

---

## 10. Benchmarks and Measurements

### 10.1 Comprehensive Benchmark Suite

```go
package conversion_test

import (
    "fmt"
    "strconv"
    "testing"
    "unsafe"
)

const testString = "hello world this is a typical string value"
var testBytes = []byte(testString)

func BenchmarkStringToBytes(b *testing.B) {
    s := testString
    var result []byte
    for i := 0; i < b.N; i++ {
        result = []byte(s)
    }
    _ = result
}

func BenchmarkBytesToString(b *testing.B) {
    bs := testBytes
    var result string
    for i := 0; i < b.N; i++ {
        result = string(bs)
    }
    _ = result
}

func BenchmarkUnsafeStringToBytes(b *testing.B) {
    s := testString
    var result []byte
    for i := 0; i < b.N; i++ {
        result = unsafe.Slice(unsafe.StringData(s), len(s))
    }
    _ = result
}

func BenchmarkStrconvItoa(b *testing.B) {
    var result string
    for i := 0; i < b.N; i++ {
        result = strconv.Itoa(i)
    }
    _ = result
}

func BenchmarkFmtSprintfInt(b *testing.B) {
    var result string
    for i := 0; i < b.N; i++ {
        result = fmt.Sprintf("%d", i)
    }
    _ = result
}

func BenchmarkAppendInt(b *testing.B) {
    buf := make([]byte, 0, 32)
    for i := 0; i < b.N; i++ {
        buf = strconv.AppendInt(buf[:0], int64(i), 10)
    }
    _ = buf
}
```

### 10.2 Expected Results (Go 1.21, x86-64)

```
BenchmarkStringToBytes/42chars     ~15 ns/op    1 alloc/op   48 B/op
BenchmarkBytesToString/42chars     ~15 ns/op    1 alloc/op   48 B/op
BenchmarkUnsafeStringToBytes       ~0.5 ns/op   0 allocs/op   0 B/op
BenchmarkStrconvItoa               ~30 ns/op    1 alloc/op   16 B/op
BenchmarkFmtSprintfInt             ~200 ns/op   2 allocs/op  32 B/op
BenchmarkAppendInt                 ~25 ns/op    0 allocs/op   0 B/op
```

---

## 11. Escape Analysis and Conversions

### 11.1 How Escape Analysis Affects Conversions

```go
// Run: go build -gcflags='-m' to see escape decisions

// Does NOT escape → stack allocation or tmpBuf
func f1(b []byte) bool {
    s := string(b)          // "does not escape"
    return s == "hello"
}

// DOES escape → heap allocation
func f2(b []byte) *string {
    s := string(b)          // "s escapes to heap"
    return &s
}

// DOES escape (returned)
func f3(b []byte) string {
    return string(b)        // may escape depending on call site
}
```

---

## 12. Type Conversion in the Go Type Checker

### 12.1 Walkthrough: Type-Checking a Conversion

From `go/types` package (used by tools, not the compiler directly):

```go
// Simplified logic from go/types/conversions.go
func (check *Checker) conversion(x *operand, T Type) {
    constArg := x.mode == constant_

    if isString(T) {
        switch {
        case isInteger(x.typ):
            // Valid: string(integer) — creates Unicode char
            // This is the famous string(65) = "A" behavior!
        case isByteSlice(x.typ):
            // Valid: string([]byte)
        case isRuneSlice(x.typ):
            // Valid: string([]rune)
        }
    }
    // ... many more cases
}
```

---

## 13. Linker and Binary Output

### 13.1 Type Descriptors in Binary

Every type in a Go binary has a `_type` structure embedded in the binary:

```
.rodata section:
  type·"".MyInt:      type descriptor for MyInt
  type·int:           type descriptor for int
  ...
  itab·io.Reader·os.File: interface table
```

Type assertions at runtime compare pointers to these descriptors — which is why type assertion comparison is O(1) pointer equality.

---

## 14. Deep Internals: strconv Package

### 14.1 How `strconv.Itoa` Works

```go
// From strconv/itoa.go
func Itoa(i int) string {
    return FormatInt(int64(i), 10)
}

func FormatInt(i int64, base int) string {
    _, s := formatBits(nil, uint64(i), base, i < 0, false)
    return s
}

func formatBits(dst []byte, u uint64, base int, neg bool, append_ bool) (d []byte, s string) {
    // Uses a static buffer to avoid allocation for small integers!
    var a [64 + 1]byte  // stack-allocated buffer
    i := len(a)

    if base == 10 {
        // Optimized decimal path using lookup table
        for u >= 100 {
            is := u % 100 * 2
            u /= 100
            i -= 2
            a[i+1] = smallsString[is+1]
            a[i+0] = smallsString[is+0]
        }
        // Handle remaining digits
    }
    // ...
    return a[i:], string(a[i:])  // copies to new string
}
```

The `smallsString` lookup table contains all two-digit combinations:
```go
const smallsString = "00010203040506070809" +
    "10111213141516171819" + ...
```

---

## 15. Security Internals

### 15.1 How Integer Overflow Is (Not) Detected

Go's compiler does NOT insert overflow checks for integer arithmetic or conversions (unlike `-fsanitize=undefined` in C). This is by design for performance. However:

```go
// The compiler DOES detect overflow for constant expressions:
const x = int8(200)  // COMPILE ERROR: constant 200 overflows int8

// But NOT for runtime conversions:
n := 200
m := int8(n)  // silent overflow, m = -56
```

Go's `go vet` and `staticcheck` tools have analyzers that detect suspicious conversions, but they're not exhaustive.

---

## 16. Summary

The professional-level understanding of type conversion in Go reveals:

1. **Zero-cost conversions** (`MyInt(x)`) generate `OCONVNOP` — literally no code
2. **Numeric conversions** (`float64(i)`) generate single CPU instructions (`CVTSI2SDQ`)
3. **String/byte conversions** call runtime functions (`slicebytetostring`) that call `mallocgc`
4. **The `tmpBuf` optimization** avoids heap allocation for small strings that don't escape
5. **Type assertions** are O(1) pointer comparisons against type descriptor pointers in `.rodata`
6. **Interface itab** contains both the interface type and the concrete type — used for fast dispatch and assertion
7. **unsafe.Slice/unsafe.String** (Go 1.20+) provide zero-copy conversion at the cost of immutability guarantees
8. **Escape analysis** determines whether conversion results go on the stack or heap
9. **No overflow checks** are inserted at runtime — programmer responsibility
10. **strconv uses lookup tables** for fast integer-to-string conversion

Understanding these internals allows you to make informed decisions about when to use unsafe optimizations, how to structure code for minimal GC pressure, and where to focus optimization efforts in high-throughput systems.
