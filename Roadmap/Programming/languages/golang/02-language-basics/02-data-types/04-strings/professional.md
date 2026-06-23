# Strings in Go — Professional Level (Internals)

## 1. Introduction

This document covers the internal implementation of Go strings: how the compiler represents them, how the runtime manages memory, what assembly is generated, and what the garbage collector does with string data. This is for engineers who need to understand Go strings at the machine level.

---

## 2. Prerequisites

- Proficiency with Go, C, and assembly concepts
- Understanding of virtual memory, heap/stack organization
- Familiarity with ELF/Mach-O binary formats
- Experience reading Go compiler output (`go tool compile`, `go tool objdump`)
- Understanding of the Go garbage collector's tricolor algorithm

---

## 3. The String Type: Compiler Representation

In the Go compiler source (cmd/compile), a string is represented as:

```go
// src/internal/abi/type.go
// A string at runtime is a StringHeader:
type StringHeader struct {
    Data uintptr
    Len  int
}

// In the compiler's IR (Intermediate Representation):
// a string value is a two-element structure: (ptr, len)
// Both fields are pointer-sized (8 bytes on amd64)
```

The compiler generates different code depending on where the string lives:

```go
// String literal: stored in read-only data section
s := "hello"
// Compiler emits:
// .rodata section: 68 65 6c 6c 6f  (h e l l o)
// Stack variable s: [ptr to .rodata, len=5]

// Runtime string: heap-allocated
s := strings.Repeat("a", 1000)
// Runtime allocates 1000 bytes on heap
// Stack variable s: [ptr to heap, len=1000]
```

---

## 4. Assembly Output

### Simple String Assignment

```go
// Source:
s := "hello"
fmt.Println(len(s))
```

```asm
; Generated amd64 assembly (simplified):
; s is stored in two registers or stack slots
; LEAQ  "hello"<>(SB), AX   ; load address of string data
; MOVQ  AX, s+0(SP)          ; store data pointer
; MOVQ  $5, s+8(SP)          ; store length = 5
```

### String Concatenation Assembly

```go
// Source:
s := a + b
```

```asm
; For short strings, compiler may call runtime.concatstring2:
; runtime.concatstring2(buf *[32]byte, a, b string) string
; The 32-byte buf avoids heap allocation for small results

; For longer strings:
; runtime.growslice equivalent: allocates len(a)+len(b) bytes
; memmove copies a's bytes
; memmove copies b's bytes
```

### Viewing Assembly

```bash
# View assembly for a Go file
go tool compile -S main.go

# Or disassemble a compiled binary
go build -o prog main.go
go tool objdump -s "main\." prog
```

---

## 5. Memory Layout in Detail

### String Literals in the Binary

```
ELF sections for Go binary:
.text       - machine code (functions)
.rodata     - read-only data (string literals, type descriptors)
.data       - initialized mutable global variables
.bss        - zero-initialized global variables
.noptrbss   - no-pointer bss (safe for GC to skip)

String literals go to .rodata:
$ strings -t x prog | grep "hello"
  4a2b30 hello
$ readelf -x .rodata prog | grep -A2 "hello"
```

### Heap-Allocated String Data

When a string is created at runtime, the data is allocated in the Go heap:

```
Go heap structure (simplified):
┌──────────────────────────────────┐
│  mheap: the main heap structure  │
│  ┌────────────────────────────┐  │
│  │  mspan (8KB blocks)        │  │
│  │  ┌──────┬──────┬──────┐   │  │
│  │  │ "hel"│ "lo" │ ...  │   │  │
│  │  └──────┴──────┴──────┘   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 6. Garbage Collector Interaction

### String Pointer Scanning

The Go GC uses a tricolor mark-and-sweep algorithm. For strings:

```
GC roots (stack, globals) contain string headers:
  ┌──────────────────┐
  │ string.Data = ●  │──────► heap: "hello"
  │ string.Len  = 5  │
  └──────────────────┘

During mark phase:
1. GC scans the string header
2. Sees the Data pointer
3. Marks the pointed-to bytes as live
4. The len field is NOT a pointer — GC knows this from type metadata

Type metadata (internal/abi.Type) records:
- ptrdata: number of bytes at start of struct that may contain pointers
- For strings, ptrdata = 8 (only Data field is a pointer)
```

### The `gcmask` for Strings

```go
// The GC mask for a string type encodes:
// byte 0: bit 0 = 1 (Data is a pointer), bit 1 = 0 (Len is not a pointer)
// This tells the GC scanner which fields to follow
```

### String Data in Read-Only Memory

String literals in `.rodata` are not managed by the GC — they're part of the binary and live forever. The GC does NOT scan read-only memory. This is why string literals have zero GC overhead.

---

## 7. The strings.Builder Internals

```go
// Source: src/strings/builder.go
type Builder struct {
    addr *Builder // of receiver, to detect copies by value
    buf  []byte
}

func (b *Builder) WriteString(s string) (int, error) {
    b.copyCheck()
    b.buf = append(b.buf, s...)
    return len(s), nil
}

func (b *Builder) String() string {
    // unsafe conversion: no copy!
    // This is safe because Builder.buf won't be modified in a way
    // that would affect the returned string's safety — the Builder
    // only appends, never modifies existing bytes
    return unsafe.String(unsafe.SliceData(b.buf), len(b.buf))
}

func (b *Builder) Grow(n int) {
    if n < 0 {
        panic("strings.Builder.Grow: negative count")
    }
    if cap(b.buf)-len(b.buf) < n {
        b.grow(n)
    }
}

func (b *Builder) grow(n int) {
    buf := make([]byte, len(b.buf), 2*cap(b.buf)+n)
    copy(buf, b.buf)
    b.buf = buf
}
```

Key insight: `Builder.String()` uses `unsafe.String` internally to return the buffer as a string **without copying**. The returned string is safe because:
1. The Builder only appends (bytes at existing offsets never change)
2. If the Builder grows (reallocates), the old buffer is retained by the returned string

---

## 8. Runtime String Functions

The Go runtime contains key string functions in `src/runtime/string.go`:

```go
// concatstrings creates a new string from multiple strings
func concatstrings(buf *tmpBuf, a []string) string {
    idx := 0
    l := 0
    count := 0
    for i, x := range a {
        n := len(x)
        if n == 0 {
            continue
        }
        if l+n < l { // overflow
            throw("string concatenation too long")
        }
        l += n
        count++
        idx = i
    }
    if count == 0 {
        return ""
    }
    // Single non-empty string: return it directly (no copy)
    if count == 1 && (buf != nil || !stringDataOnStack(a[idx])) {
        return a[idx]
    }
    s, b := rawstringtmp(buf, l)
    for _, x := range a {
        n := copy(b, x)
        b = b[n:]
    }
    return s
}

// rawstringtmp allocates a new string using the temporary buffer
// if the string fits, otherwise heap-allocates
func rawstringtmp(buf *tmpBuf, l int) (s string, b []byte) {
    if buf != nil && l <= len(buf) {
        b = buf[:l]
        s = slicebytetostringtmp(&b[0], l)
    } else {
        s, b = rawstring(l)
    }
    return
}
```

### The Temporary Buffer Optimization

For concatenations like `a + b + c`, the compiler may pass a 32-byte stack buffer to `concatstrings`. If the result fits, no heap allocation occurs:

```go
// Stack buffer passed to concatstrings:
type tmpBuf [tmpStringBufSize]byte
const tmpStringBufSize = 32
```

---

## 9. String to []byte Conversion Internals

```go
// runtime/string.go: stringtoslicebyte
func stringtoslicebyte(buf *tmpBuf, s string) []byte {
    var b []byte
    if buf != nil && len(s) <= len(buf) {
        *buf = tmpBuf{}
        b = buf[:len(s)]
    } else {
        b = rawbyteslice(len(s))
    }
    copy(b, s)
    return b
}

// runtime/string.go: slicebytetostring
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
    if n == 0 {
        return ""
    }
    if raceenabled {
        racereadrangepc(...)
    }
    if msanenabled {
        msanread(...)
    }
    if asanenabled {
        asanread(...)
    }
    if n == 1 {
        p := unsafe.Pointer(&staticuint64s[*ptr]) // singleton bytes!
        // ...
    }
    var p unsafe.Pointer
    if buf != nil && n <= len(buf) {
        p = unsafe.Pointer(buf)
    } else {
        p = mallocgc(uintptr(n), nil, false)
    }
    memmove(p, unsafe.Pointer(ptr), uintptr(n))
    return unsafe.String((*byte)(p), n)
}
```

### The `staticuint64s` Optimization

Single-byte strings (`string([]byte{b})` where `b` is a single byte) don't allocate — they reference a static table of 256 pre-allocated single-byte strings.

---

## 10. UTF-8 Encoding Details

Go's `unicode/utf8` package implements the encoding:

```
UTF-8 encoding table:
Code Point Range  | Bytes | Byte Pattern
──────────────────┼───────┼──────────────────────────────
U+0000 - U+007F   |   1   | 0xxxxxxx
U+0080 - U+07FF   |   2   | 110xxxxx 10xxxxxx
U+0800 - U+FFFF   |   3   | 1110xxxx 10xxxxxx 10xxxxxx
U+10000 - U+10FFFF|   4   | 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx

Examples:
'A'  = U+0041 → 0x41           → 1 byte:  01000001
'é'  = U+00E9 → 0xC3 0xA9     → 2 bytes: 11000011 10101001
'世' = U+4E16 → 0xE4 0xB8 0x96 → 3 bytes: 11100100 10111000 10010110
'😀' = U+1F600 → 0xF0 0x9F 0x98 0x80 → 4 bytes
```

### DecodeRuneInString Assembly

```go
// The range loop decodes UTF-8 using:
func DecodeRuneInString(s string) (r rune, size int) {
    n := len(s)
    if n < 1 {
        return RuneError, 0
    }
    s0 := s[0]
    x := first[s0]
    if x >= as {
        // single-byte rune: x == xx
        mask := rune(x) << 31 >> 31 // Create 0x0000 or 0xFFFF
        return rune(s0)&^mask | RuneError&mask, 1
    }
    sz := int(x & 7)
    accept := acceptRanges[x>>4]
    if n < sz {
        return RuneError, 1
    }
    s1 := s[1]
    if s1 < accept.lo || accept.hi < s1 {
        return RuneError, 1
    }
    // ... continues for 3 and 4 byte cases
}
```

---

## 11. Compiler Optimizations for Strings

### String Map Key Lookup

```go
// When using a string as a map key, the compiler generates
// inline hash computation using FNV-like algorithm (aeshash on modern CPUs)

// On CPUs with AES support:
// AESENC and AESENCLAST instructions provide very fast hashing
// This is why string map lookups are fast in Go
```

### Zero-Copy Detection

The compiler recognizes certain patterns and avoids allocation:

```go
// Pattern 1: []byte conversion used only for read (no modification)
m := make(map[string]int)
b := []byte("key")
_ = m[string(b)] // compiler may avoid allocating string(b)

// Pattern 2: string comparison using []byte
b := []byte("hello")
if string(b) == "hello" { // compiler may avoid allocation
}

// Pattern 3: switch on string([]byte)
switch string(b) {
case "GET", "POST": // compiler may avoid allocation
}
```

---

## 12. The `reflect` Package and Strings

```go
import "reflect"

// reflect.StringHeader is the Go-accessible version of the internal string struct
// (deprecated in Go 1.20 in favor of unsafe.String/unsafe.StringData)
type StringHeader struct {
    Data uintptr
    Len  int
}

// Modern approach (Go 1.20+):
s := "hello"
ptr := unsafe.StringData(s)  // *byte pointing to first byte
// OR
sh := (*[2]uintptr)(unsafe.Pointer(&s))
// sh[0] = data pointer, sh[1] = length
```

---

## 13. String Interning in the Runtime

The Go runtime itself interns strings in specific cases:

```go
// 1. String literals: identical literals share the same .rodata location
//    (though the compiler doesn't guarantee this)

// 2. Small integer conversions: string(rune(r)) for common runes
//    uses a table of pre-computed strings

// 3. HTTP/2: header names are interned by the http2 package
//    (using the hpack package)

// 4. JSON: the encoding/json package interns struct field names
//    to avoid per-request allocation
```

---

## 14. SIMD String Operations

Modern CPUs can process 16 or 32 bytes at once using SIMD instructions. The Go runtime uses these for:

```
strings.Contains: uses AVX2 for fast substring search
strings.Index:    uses PCMPESTRI/PCMPISTRM on SSE4.2 CPUs
bytes.Equal:      uses VMOVDQU for 32-byte comparison
memmove:          uses AVX/AVX-512 for large moves
```

The implementation is in `src/internal/bytealg/`:
```
bytealg_amd64.go  — architecture selection
equal_amd64.s     — assembly for fast byte comparison
indexbyte_amd64.s — assembly for fast byte search
```

---

## 15. Memory Safety Invariants

The Go runtime maintains these invariants for strings:

1. **Data pointer validity**: `s.Data` always points to at least `s.Len` bytes of readable memory
2. **Immutability enforcement**: String data in `.rodata` is mapped read-only by the OS; heap-allocated string data is never written after the string is created (only the Builder's buffer is written, and only before `String()` is called)
3. **GC safety**: All string data pointers are scanned by the GC via type metadata
4. **Nil safety**: A zero-value string (`var s string`) has a nil Data pointer but Len=0; code must handle this

---

## 16. Further Reading

- `src/runtime/string.go` — Runtime string operations
- `src/strings/builder.go` — strings.Builder implementation
- `src/internal/bytealg/` — SIMD string/byte operations
- `src/unicode/utf8/utf8.go` — UTF-8 encoding/decoding
- [The Go Programming Language Specification: String Types](https://go.dev/ref/spec#String_types)
- [Go internals: string representation](https://research.swtch.com/godata)
- [Plan 9 UTF-8 paper by Pike and Thompson](https://www.cl.cam.ac.uk/~mgk25/ucs/utf-8-history.txt)
- [Go compiler: escape analysis](https://go.dev/doc/faq#stack_or_heap)
- AMD64 ABI: [System V Application Binary Interface](https://gitlab.com/x86-psABIs/x86-64-ABI)

---

## Summary

Go strings at the machine level are:
- **16-byte headers** on the stack containing a pointer and length
- **Read-only data** for literals (`.rodata` section, zero GC cost)
- **Heap objects** for runtime-created strings (GC manages pointer field only)
- **Zero-copy slicing** via new headers pointing into existing data
- **SIMD-accelerated** operations in the standard library
- **Compiler-optimized** conversions that avoid allocation in common patterns

The internal `unsafe.String`/`unsafe.StringData` primitives (Go 1.20+) provide the foundation for all string/byte interoperability with zero overhead.
