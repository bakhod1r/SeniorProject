# Iterating Strings — Professional Level (Internals, Compiler, Memory, Assembly)

## 1. String Representation in the Runtime

```go
// runtime/string.go
type stringStruct struct {
    str unsafe.Pointer // pointer to bytes
    len int            // byte length
}

// Identical to reflect.StringHeader:
// type StringHeader struct { Data uintptr; Len int }

// A string literal in Go is stored in the read-only data segment (.rodata)
// Converting string → []byte always copies (string is immutable)
// Substrings share the same backing memory — no copy
```

String immutability enables several optimizations:
- Goroutines can share strings without synchronization
- Substring = pointer arithmetic, zero allocation
- The compiler can store string literals in read-only pages

---

## 2. UTF-8 Decoding: The Lookup Table

```go
// unicode/utf8/utf8.go — the 'first' lookup table
// Each byte maps to encoding info:
// - top 3 bits: rune type (ASCII, 2-byte, 3-byte, 4-byte, invalid)
// - bottom 3 bits: sequence length
var first = [256]uint8{
    //   0   1   2   3   4   5   6   7   8   9   a   b   c   d   e   f
    as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, // 0x00-0x0f
    // ... 128 ASCII entries (0x00-0x7F) all map to 'as' (ASCII single byte)
    // ... continuation bytes (0x80-0xBF) map to 'xx' (invalid lead)
    // ... 2-byte leads (0xC0-0xDF) map to 'x1' (2-byte sequence)
    // ... 3-byte leads (0xE0-0xEF) map to various 3-byte types
    // ... 4-byte leads (0xF0-0xF7) map to various 4-byte types
    // ... invalid (0xF8-0xFF) map to 'xx'
}
```

This 256-byte table fits entirely in L1 cache (~4KB), making the initial decode dispatch extremely fast (~1 cache hit).

---

## 3. Compiler SSA for String Range

```go
func countRunes(s string) int { count := 0; for range s { count++ }; return count }
```

SSA phases (from `GOSSAFUNC=countRunes go build`):
```
// After "lower" phase:
b1: (entry)
    v1 = StringPtr s  // s.Data
    v2 = StringLen s  // s.Len (byte count)
    v3 = 0            // i = 0
    v4 = 0            // count = 0

b2: (loop header)
    v5 = phi v3 v8    // i = phi(0, next_i)
    v6 = phi v4 v9    // count = phi(0, count+1)
    v7 = Less64 v5 v2 // i < len
    If v7 → b3 else b4

b3: (loop body)
    v8 = load byte at v1+v5
    v10 = Less8 v8 0x80   // ASCII check
    If v10 → b5 else b6

b5: (ASCII path)
    v11 = v5 + 1          // next_i = i+1
    v9 = v6 + 1           // count++
    Jump b2

b6: (multi-byte path)
    CALL utf8.DecodeRuneInString
    ; v12 = size
    v11 = v5 + v12
    v9 = v6 + 1
    Jump b2

b4: (exit)
    return v6
```

---

## 4. Memory Layout: String vs []byte vs []rune

```
String "Hello, 世界" (13 bytes):
Header:  [ ptr | len=13 ]  (16 bytes on 64-bit)
Data:    48 65 6c 6c 6f 2c 20 e4 b8 96 e7 95 8c  (13 bytes)

[]byte("Hello, 世界"):
Header:  [ ptr | len=13 | cap=16 ]  (24 bytes)
Data:    same 13 bytes  (COPY of string data)

[]rune("Hello, 世界"):  (9 runes)
Header:  [ ptr | len=9 | cap=16 ]   (24 bytes)
Data:    48000000 65000000 6c000000 6c000000 6f000000  (36 bytes)
         2c000000 20000000 16e40000 8c950000
         (9 × 4 bytes = 36 bytes)  COPY + EXPAND

Cost: []rune uses 36 bytes for 13-byte string (2.8× expansion)
```

---

## 5. Strings Package: SIMD Optimizations

The `strings` and `bytes` packages use platform-specific assembly for hot paths:

```go
// strings/strings_amd64.go (internal assembly)
// strings.Index uses Boyer-Moore-Horspool with SSE2/AVX2
// strings.Count uses SSE2 for counting bytes

// For ASCII-heavy workloads, using strings.Index is faster than manual range
// because it operates at the hardware level

// Example: finding a byte in a large string
import "strings"

func findByte(s string, b byte) int {
    return strings.IndexByte(s, b)
    // Internally: loads 16 bytes at a time via SSE2 PCMPEQB instruction
    // ~10x faster than manual range for large strings
}
```

---

## 6. Unsafe String Operations

```go
package main

import (
    "fmt"
    "unsafe"
)

// Zero-copy []byte from string (READ ONLY — DO NOT MODIFY!)
func unsafeBytes(s string) []byte {
    if s == "" { return nil }
    return unsafe.Slice(unsafe.StringData(s), len(s))
    // unsafe.StringData(s) returns *byte pointer to first byte
    // This is valid in Go 1.20+
}

// Zero-copy string from []byte (string must not modify underlying bytes)
func unsafeString(b []byte) string {
    if len(b) == 0 { return "" }
    return unsafe.String(&b[0], len(b))
    // Go 1.20+: unsafe.String(*byte, int) string
}

func main() {
    s := "Hello, World!"
    b := unsafeBytes(s)
    fmt.Printf("b[0]=%d\n", b[0]) // 72 — same bytes as s
    // DO NOT: b[0] = 99 — this would corrupt the string literal!
}
```

**Warning:** `unsafe.StringData` points into immutable memory. Any write causes undefined behavior or a segfault.

---

## 7. String Interning in the Runtime

```go
// The Go compiler interns string literals:
a := "hello"
b := "hello"
// a and b may point to the same memory — implementation defined

// You can verify:
import "unsafe"
sa := (*[2]uintptr)(unsafe.Pointer(&a))
sb := (*[2]uintptr)(unsafe.Pointer(&b))
fmt.Println(sa[0] == sb[0]) // often true for literals

// runtime.stringinterner is used internally for some cases
// but user code should not rely on interning behavior
```

---

## 8. String Hashing in the Runtime

```go
// When strings are used as map keys, Go hashes them:
// runtime/hash.go

// For strings, Go uses AES-based hash on platforms with AES hardware:
// - x86: uses AES-NI instructions
// - ARM: uses software AES or fallback

// The hash of a string depends on:
// 1. The string contents (all bytes)
// 2. A per-map random seed (hash0 in hmap)

// This means:
// - Two programs hashing "hello" may get different values (seed differs)
// - Security: prevents hash-flooding via random seed
```

---

## 9. Compiler Optimizations for String Comparisons

```go
// The compiler optimizes short string comparisons to integer comparisons:
func equal4(a, b string) bool {
    if len(a) != 4 || len(b) != 4 { return false }
    return a == b
    // Compiler may emit: load 4 bytes as uint32, compare
    // No byte-by-byte loop needed
}

// For variable-length comparisons, runtime uses:
// - memcmp for same-length strings (optimized per platform)
// - Early exit on length mismatch
```

---

## 10. Assembly: Manual UTF-8 Encoding

```go
// utf8.EncodeRune writes one rune into a byte slice
// Understanding the encoding for professional use:

func encodeRune(r rune) []byte {
    switch {
    case r < 0x80:
        return []byte{byte(r)}
    case r < 0x800:
        return []byte{
            0xC0 | byte(r>>6),
            0x80 | byte(r&0x3F),
        }
    case r < 0x10000:
        return []byte{
            0xE0 | byte(r>>12),
            0x80 | byte((r>>6)&0x3F),
            0x80 | byte(r&0x3F),
        }
    default:
        return []byte{
            0xF0 | byte(r>>18),
            0x80 | byte((r>>12)&0x3F),
            0x80 | byte((r>>6)&0x3F),
            0x80 | byte(r&0x3F),
        }
    }
}
```

---

## 11. GC Interaction with Strings

```go
// Strings are NOT garbage collected separately
// They are either:
// 1. String literals: in .rodata segment, never GC'd
// 2. Dynamically created: the backing byte array is heap-allocated
//    and GC'd when no string references it

// Problem: Large string keeps large allocation alive
largeData := readHuge() // 100MB string
small := largeData[:10] // substring — keeps 100MB alive!

// Fix: explicit copy
small := string([]byte(largeData[:10])) // new 10-byte allocation, releases large

// strings.Clone (Go 1.20) for explicit copy:
import "strings"
small = strings.Clone(largeData[:10])
```

---

## 12. Reflect: StringHeader and String Manipulation

```go
package main

import (
    "fmt"
    "reflect"
    "unsafe"
)

// Inspecting string internals via reflect
func inspectString(s string) {
    h := (*reflect.StringHeader)(unsafe.Pointer(&s))
    fmt.Printf("Data: %x\n", h.Data)
    fmt.Printf("Len:  %d\n", h.Len)

    // Read bytes directly from Data pointer
    bytes := unsafe.Slice((*byte)(unsafe.Pointer(h.Data)), h.Len)
    fmt.Printf("Bytes: % X\n", bytes)
}

func main() {
    inspectString("Hello, 世界")
}
```

---

## 13. Compiler Directive: go:nosplit and String Range

```go
//go:nosplit
func criticalStringProcess(s string) int {
    // This function cannot grow the stack
    // Range over large strings in nosplit functions is dangerous:
    // - Each multi-byte rune call hits utf8.DecodeRuneInString
    // - That function may have its own stack requirements
    // - Keep nosplit functions to simple ASCII byte loops
    count := 0
    for i := 0; i < len(s); i++ { // byte loop — safe in nosplit
        if s[i] > 32 { count++ }
    }
    return count
}
```

---

## 14. Benchmarks: All String Iteration Methods

```go
package main

import (
    "strings"
    "testing"
    "unicode/utf8"
)

var testStr = strings.Repeat("Hello, 世界! 😀", 1000)

func BenchmarkRange(b *testing.B) {
    for n := 0; n < b.N; n++ {
        count := 0
        for range testStr { count++ }
    }
}

func BenchmarkRuneSlice(b *testing.B) {
    for n := 0; n < b.N; n++ {
        runes := []rune(testStr)
        count := len(runes)
        _ = count
    }
}

func BenchmarkManualUTF8(b *testing.B) {
    for n := 0; n < b.N; n++ {
        count := 0
        for i := 0; i < len(testStr); {
            _, size := utf8.DecodeRuneInString(testStr[i:])
            count++
            i += size
        }
    }
}

func BenchmarkRuneCount(b *testing.B) {
    for n := 0; n < b.N; n++ {
        _ = utf8.RuneCountInString(testStr)
    }
}

// Results (approximate, 10K char string with mix of ASCII and multi-byte):
// BenchmarkRange:      ~5 μs/op, 0 alloc
// BenchmarkRuneSlice:  ~15 μs/op, 1 alloc (40KB)
// BenchmarkManualUTF8: ~8 μs/op, 0 alloc
// BenchmarkRuneCount:  ~3 μs/op, 0 alloc (uses SIMD internally)
```

---

## 15. Professional Summary: String Internals Cost Model

| Operation | Time | Allocation | Notes |
|---|---|---|---|
| `for range s` (all ASCII) | ~0.5 ns/byte | 0 | Inline fast path |
| `for range s` (multi-byte) | ~3-5 ns/rune | 0 | `utf8.DecodeRuneInString` per rune |
| `[]rune(s)` | ~2-4 ns/char | 1 (4× string len) | Full scan + copy |
| `len(s)` | O(1) | 0 | Pre-stored in header |
| `len([]rune(s))` | O(n) | 1 | `utf8.RuneCountInString` under hood |
| `utf8.RuneCountInString` | ~0.3 ns/byte | 0 | Optimized (SIMD on amd64) |
| `strings.Index` | ~0.1-1 ns/byte | 0 | SIMD Boyer-Moore-Horspool |
| `s[:i]` substring | O(1) | 0 | Zero copy |
| `string([]byte)` | O(n) | 1 | Copy required |
| `strings.Clone(s)` | O(n) | 1 | Explicit GC-safe copy |
