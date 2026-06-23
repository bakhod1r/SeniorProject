# Strings in Go — Professional Level

## 1. Overview

This document covers the deepest layer of Go string internals: compiler representation, runtime layout, assembly-level behavior, linker deduplication, and how the Go runtime and GC interact with string memory. It is intended for engineers working on compilers, runtime systems, or performance-critical libraries where strings are on the critical path.

---

## 2. Memory Layout

### 2.1 StringHeader

A Go string is exactly 16 bytes on 64-bit systems (8 bytes on 32-bit):

```
type StringHeader struct {
    Data uintptr  // pointer to first byte of backing array
    Len  int      // number of bytes (not runes)
}
```

In assembly terms:

```asm
; AX = pointer to string header
; 0(AX) = Data pointer (8 bytes)
; 8(AX) = Len (8 bytes)
```

### 2.2 String in .rodata

Constant strings are stored in the `.rodata` section of the ELF/Mach-O binary:

```bash
# View .rodata strings in a compiled binary
go build -o app main.go
strings app | grep "your_string"
objdump -s -j .rodata app | head -50
```

The linker deduplicates identical string literals:

```go
const a = "hello"
const b = "hello"
// a and b share the same .rodata bytes; their Data pointers are equal
```

### 2.3 Heap-Allocated String Backing Arrays

Runtime-built strings have their backing array on the heap, managed by the GC:

```go
s := strings.Repeat("a", 100) // backing array is a *[100]byte on heap

// GC metadata for the backing array:
// - type: []byte internally (no pointer fields — GC skips it)
// - This means string backing arrays are cheap for the GC
```

---

## 3. Compiler Internals

### 3.1 SSA Representation

In the compiler's SSA (Static Single Assignment) IR, a string is represented as two separate values:

```
OpStringPtr   string -> *byte   (the Data pointer)
OpStringLen   string -> int     (the Len)
```

The compiler tracks these separately and can avoid redundant loads. If a string is passed to multiple functions, the compiler may keep the header in registers rather than memory.

### 3.2 String([]byte) Compiler Optimization

The compiler has a special case for `string(b)` used as a map key or switch expression:

```go
m := map[string]int{"hello": 1}
b := []byte("hello")
_ = m[string(b)] // compiler emits a map lookup using b directly, no heap allocation
```

This optimization is implemented in `cmd/compile/internal/walk/convert.go` — the compiler recognizes the pattern `string(b)` as a temporary value that doesn't escape, and passes the byte slice pointer directly to the map runtime function.

### 3.3 String Concatenation Lowering

```go
s := a + b + c
```

Is lowered to:
1. `runtime.concatstring3(a, b, c)` for 3 arguments
2. `runtime.concatstrings([]string{a, b, c})` for N arguments

These functions allocate a single buffer of `len(a)+len(b)+len(c)` bytes and copy all parts.

### 3.4 Range Over String

```go
for i, r := range s { ... }
```

The compiler lowers this to a call to `utf8.DecodeRuneInString` in a loop. The index `i` advances by the rune's byte width at each step.

---

## 4. Runtime Implementation

### 4.1 runtime/string.go

Key runtime functions for strings:

```go
// concatstring2 — concatenate two strings
func concatstring2(buf *tmpBuf, a, b string) string

// slicebytetostring — convert []byte to string
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) (str string)

// stringtoslicebyte — convert string to []byte
func stringtoslicebyte(buf *tmpBuf, s string) []byte

// The buf *tmpBuf allows small allocations to avoid heap for short strings
```

### 4.2 tmpBuf Optimization

For strings <= 32 bytes, the runtime uses a stack-allocated `[32]byte` buffer:

```go
type tmpBuf [tmpStringBufSize]byte
const tmpStringBufSize = 32
```

This means short string conversions (string ↔ []byte) may not allocate at all — the temporary is on the stack.

### 4.3 rawstring / rawbyteslice

```go
// rawstring allocates a new string of length n
func rawstring(size int) (s string, b []byte)

// rawbyteslice allocates a new []byte of length n
func rawbyteslice(size int) (b []byte)
```

These are the fundamental allocation primitives for string creation. They call `mallocgc` directly.

---

## 5. Assembly

### 5.1 Reading a String Field in Assembly

```asm
// Assume DI = pointer to a Go string (StringHeader)
MOVQ 0(DI), AX    // AX = Data pointer
MOVQ 8(DI), CX    // CX = Len

// Access first byte
MOVBLZX 0(AX), BX // BX = first byte (zero-extended)
```

### 5.2 strings.IndexByte in Assembly

The standard library's `strings.IndexByte` uses SIMD on x86:

```
// internal/bytealg/indexbyte_amd64.s
// Uses PCMPESTRI (SSE4.2) or AVX2 to scan 32 bytes at a time
TEXT ·IndexByteString(SB),NOSPLIT,$0-32
    MOVQ s_base+0(FP), SI
    MOVQ s_len+8(FP), BX
    MOVBLZX c+16(FP), AX
    // ... SIMD scanning ...
```

### 5.3 Inspecting Generated Assembly

```bash
go build -gcflags="-S" main.go 2>&1 | grep -A 20 "main.f"
# Or use godbolt.org for interactive inspection
```

---

## 6. Linker String Deduplication

The Go linker merges identical string literals:

```bash
# View symbols and their string data
go tool nm -type app | grep "t.*rodata"

# The linker pass merges .rodata strings in cmd/link/internal/ld/deadcode.go
```

Impact: A binary with 100 uses of the string "Content-Type" has only one copy in .rodata.

---

## 7. GC Interaction

### 7.1 String Backing Arrays Have No Pointers

Because string backing arrays contain only bytes, they have no pointer fields. The GC uses a `noscan` flag for these allocations:

```go
// mallocgc for string backing arrays uses noscan=true
// This means the GC does not trace into the backing array
// Result: string backing arrays are cheaper for the GC than pointer-containing types
```

### 7.2 StringHeader Pointer is Scanned

The `Data` field of a StringHeader IS a pointer and IS scanned by the GC. If a string is reachable, the GC keeps its backing array alive.

### 7.3 Practical Impact

```
Scenario: 1 million strings in a map, each 20 bytes
Backing arrays: 20MB, noscan — GC touches these only for sweep
StringHeaders: 16MB (1M * 16), scanned — GC must trace these
```

---

## 8. unsafe Package — Full Detail

### 8.1 Pre-Go 1.20 Pattern (deprecated but seen in codebases)

```go
import (
    "reflect"
    "unsafe"
)

func bytesToString(b []byte) string {
    bh := (*reflect.SliceHeader)(unsafe.Pointer(&b))
    sh := reflect.StringHeader{
        Data: bh.Data,
        Len:  bh.Len,
    }
    return *(*string)(unsafe.Pointer(&sh))
}
```

### 8.2 Go 1.20+ Canonical Pattern

```go
import "unsafe"

func bytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func stringToBytes(s string) []byte {
    if len(s) == 0 {
        return nil
    }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

### 8.3 Safety Rules

1. Never modify the `[]byte` returned from `stringToBytes`
2. Never use the string after the source `[]byte` is modified
3. Never pass the unsafe `[]byte` to any function that might modify it
4. The source `[]byte` must remain live as long as the string is used

---

## 9. String Comparison Implementation

The runtime implements `==` on strings as:

```go
// runtime/alg.go
func strequal(p, q unsafe.Pointer) bool {
    a := *(*string)(p)
    b := *(*string)(q)
    return a == b
}

// Which compiles to:
// 1. Compare lengths — if different, return false immediately
// 2. Compare Data pointers — if same, return true (same backing array)
// 3. Fall through to memequal for byte-by-byte comparison
```

---

## 10. String Hashing

The runtime uses AES-based hashing for string map keys on CPUs that support AES-NI:

```go
// runtime/hash_amd64.s
// aeshashstr: AES-based string hash
// Falls back to wyhash on non-AES CPUs
```

This is why map[string] lookups are very fast — they use hardware-accelerated hashing.

---

## 11. strings.Builder Internals

```go
// src/strings/builder.go
type Builder struct {
    addr *Builder // self-pointer for copy detection
    buf  []byte   // internal buffer
}

func (b *Builder) copyCheck() {
    if b.addr == nil {
        b.addr = (*Builder)(noescape(unsafe.Pointer(b)))
    } else if b.addr != b {
        panic("strings: illegal use of non-zero Builder copied by value")
    }
}

// WriteString appends to buf using append()
func (b *Builder) WriteString(s string) (int, error) {
    b.copyCheck()
    b.buf = append(b.buf, s...)
    return len(s), nil
}

// String shares the Builder's internal buffer — zero-copy
func (b *Builder) String() string {
    return unsafe.String(unsafe.SliceData(b.buf), len(b.buf))
}
```

---

## 12. Escape Analysis — Detailed

```bash
# Full escape analysis output
go build -gcflags="-m=2" ./... 2>&1 | grep "string"
```

```go
// Case 1: Does not escape — stack string
func f() int {
    s := "hello"       // .rodata pointer, no allocation
    return len(s)
}

// Case 2: Escapes to heap — assigned to interface
func g() interface{} {
    s := "hello"
    return s           // s's StringHeader copies to heap for the interface
}

// Case 3: []byte -> string -> escape
func h() string {
    b := []byte("hello") // escapes: returned string holds reference
    return string(b)
}
```

---

## 13. Profiling String-Heavy Code

```go
package main

import (
    "os"
    "runtime/pprof"
    "strings"
)

func main() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    // Your string-heavy workload
    for i := 0; i < 1000000; i++ {
        _ = strings.Repeat("abc", 10)
    }
}
// Then: go tool pprof cpu.prof
// Look for: runtime.mallocgc, runtime.concatstrings
```

---

## 14. Cross-Platform Considerations

| Platform | Pointer Size | StringHeader Size | tmpBuf Stack Opt |
|----------|-------------|------------------|--------------------|
| amd64    | 8 bytes     | 16 bytes         | Yes (SSE/AVX)     |
| arm64    | 8 bytes     | 16 bytes         | Yes (NEON)        |
| 386      | 4 bytes     | 8 bytes          | Limited           |
| wasm     | 4 bytes     | 8 bytes          | No SIMD           |

---

## 15. Compiler Flags and String Behavior

```bash
# Disable inlining (affects string optimization)
go build -gcflags="-l" .

# See all compiler decisions
go build -gcflags="-m=2 -v" . 2>&1

# Check final binary string data
go tool nm ./app
readelf -p .rodata ./app   # Linux
otool -s __TEXT __cstring ./app  # macOS
```

---

## 16. Key Source Files

| File | Content |
|------|---------|
| `src/runtime/string.go` | Core string runtime functions |
| `src/strings/builder.go` | strings.Builder implementation |
| `src/strings/strings.go` | strings package implementations |
| `src/internal/bytealg/` | SIMD-optimized byte/string search |
| `src/cmd/compile/internal/walk/convert.go` | string conversion optimizations |
| `src/cmd/compile/internal/ssagen/ssa.go` | SSA generation for strings |
| `src/unicode/utf8/utf8.go` | UTF-8 encode/decode |
