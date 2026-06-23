# Runes — Professional Level

## Introduction
> Focus: "What happens under the hood?"

At the professional level, we examine how Go's UTF-8 decoding works internally, how `range` over strings is implemented by the compiler, the memory layout of rune data, and the performance characteristics of rune operations.

---

## How UTF-8 Decoding Works Internally

### The `range` Loop Compilation

```go
// Source:
for i, r := range s {
    process(i, r)
}

// Equivalent Go runtime expansion:
for i := 0; i < len(s); {
    r, size := utf8.DecodeRuneInString(s[i:])
    process(i, r)
    i += size
}
// The compiler generates inline UTF-8 decoding — no function call overhead
```

### utf8.DecodeRune Implementation

```go
// From src/unicode/utf8/utf8.go (simplified)
func DecodeRune(p []byte) (r rune, size int) {
    n := len(p)
    if n < 1 { return RuneError, 0 }
    
    b0 := p[0]
    if b0 < 0x80 {
        // Single byte (ASCII): 0xxxxxxx
        return rune(b0), 1
    }
    
    if b0 < 0xC0 {
        // Continuation byte without leading byte
        return RuneError, 1
    }
    
    if b0 < 0xE0 {
        // 2-byte sequence: 110xxxxx 10xxxxxx
        if n < 2 { return RuneError, 1 }
        r = rune(b0&0x1F)<<6 | rune(p[1]&0x3F)
        return r, 2
    }
    
    // 3-byte and 4-byte follow similar pattern...
}
```

---

## Memory Layout

```
string in Go:
  type stringHeader struct {
      Data unsafe.Pointer  // pointer to bytes (8 bytes on 64-bit)
      Len  int             // byte length (8 bytes on 64-bit)
  }
  Total: 16 bytes for the header (data lives on heap)

rune = int32:
  4 bytes in memory
  
[]rune:
  type sliceHeader struct {
      Data unsafe.Pointer  // 8 bytes
      Len  int             // 8 bytes
      Cap  int             // 8 bytes
  }
  Total: 24 bytes header + 4*n bytes data
  
Converting "Hello" to []rune:
  - allocates 5 * 4 = 20 bytes
  - copies each rune into the new array
  - O(n) time and memory
```

---

## Compiler Perspective

### Optimization: range on ASCII-Only Strings

For strings that are proven to be ASCII-only at compile time, the compiler may optimize the range loop to avoid UTF-8 decoding:

```go
const s = "hello"  // compile-time constant, ASCII proven
for i, r := range s {
    // Compiler may generate: r = rune(s[i]), i++ (no UTF-8 check)
}
```

### How `string(r)` Works

```go
s := string(rune(20013))  // "中"
// This allocates a new string and UTF-8 encodes the rune:
// U+4E2D → 0xE4 0xB8 0xAD (3 bytes)
// The compiler generates UTF-8 encoding inline
```

---

## Performance Internals

```
utf8.DecodeRuneInString: ~3-8 ns per call
range loop over string: ~2-6 ns per byte (amortized)
[]rune(s) conversion: O(n) time and memory
utf8.RuneCountInString: O(n) time, O(1) memory (better than []rune)
string(r): allocates, UTF-8 encodes (10-15 ns)
strings.Builder.WriteRune: amortized O(1), O(n) total
```

---

## Source Code Walkthrough

```
unicode/utf8 package (src/unicode/utf8/utf8.go):
- DecodeRune, DecodeRuneInString: decode first rune
- EncodeRune: encode rune to byte slice
- RuneCountInString: count runes without allocation
- ValidString: check UTF-8 validity
- RuneLen: bytes needed for a rune

Key constant: RuneError = U+FFFD (replacement character)
Returned by DecodeRune for invalid sequences.
```

---

## Edge Cases at the Lowest Level

```go
// U+FFFD: the replacement character
// Appears when DecodeRune encounters invalid UTF-8
invalidUTF8 := string([]byte{0xFF, 0xFE})
for _, r := range invalidUTF8 {
    fmt.Printf("U+%04X\n", r)  // U+FFFD for each invalid byte
}

// Null rune: valid in Go strings (strings can contain null bytes)
s := "hello\x00world"
fmt.Println(len(s))  // 11 (null byte included)
```

---

## Test

```go
package runes_pro_test

import (
    "testing"
    "unicode/utf8"
    "unsafe"
)

func TestStringLayout(t *testing.T) {
    // A string header is 16 bytes on 64-bit
    type stringHeader struct {
        ptr uintptr
        len int
    }
    if unsafe.Sizeof(stringHeader{}) != 16 {
        t.Error("string header should be 16 bytes on 64-bit")
    }
}

func TestRuneSize(t *testing.T) {
    var r rune
    if unsafe.Sizeof(r) != 4 {
        t.Errorf("rune should be 4 bytes (int32), got %d", unsafe.Sizeof(r))
    }
}

func TestDecodeRune(t *testing.T) {
    // Chinese character "中" encoded as UTF-8
    bytes := []byte{0xE4, 0xB8, 0xAD}
    r, size := utf8.DecodeRune(bytes)
    if r != '中' || size != 3 {
        t.Errorf("DecodeRune: got r=%d size=%d, want r=中 size=3", r, size)
    }
}
```

---

## Tricky Questions

**Q**: How does the Go runtime avoid allocations when ranging over a string?
**A**: The `range` loop over a string operates directly on the underlying byte array of the string. It incrementally decodes UTF-8 bytes at the current offset without converting the entire string to `[]rune`.

**Q**: What is `utf8.RuneError` and when does it appear?
**A**: `utf8.RuneError` (U+FFFD, value 65533) is returned by `DecodeRune` when it encounters an invalid UTF-8 byte sequence. It's also the Unicode replacement character shown when text cannot be displayed.

---

## Summary

At the machine level, runes are `int32` values stored in CPU registers. String iteration via `range` performs inline UTF-8 decoding at ~2-6 ns/byte. The `utf8` package functions use table-driven state machines for efficient decoding. Converting `string` to `[]rune` requires O(n) allocation and is the main performance bottleneck in rune-heavy code. Design for O(1) space rune operations using `range` and `utf8` package functions instead.
