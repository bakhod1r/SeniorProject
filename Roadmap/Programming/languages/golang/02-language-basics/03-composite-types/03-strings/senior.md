# Strings in Go — Senior Level

## 1. Introduction

At the senior level, string mastery means understanding compiler optimizations, escape analysis, GC interaction with string data, the `unsafe` package for zero-copy paths, and designing string-heavy APIs that are both safe and performant. You reason about memory pressure, benchmark allocations, write production postmortems, and choose the right abstraction for each context.

---

## 2. Prerequisites

- Middle-level string knowledge
- Understanding of Go's garbage collector and escape analysis
- Familiarity with `unsafe` package and its risks
- Experience with `pprof`, `go test -benchmem`, `go build -gcflags="-m"`
- Knowledge of Go runtime internals

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **escape analysis** | Compiler analysis that decides whether a value lives on stack or heap |
| **stack allocation** | Allocation on the goroutine stack; free when function returns |
| **heap allocation** | Allocation tracked by the GC; costs GC pressure |
| **interned string** | String whose backing bytes are shared with a compile-time constant |
| **mmap'd string** | String backed by memory-mapped read-only data segment |
| **strings.Builder.copyCheck** | Runtime panic guard on copied Builder |
| **noescape** | Compiler hint that a pointer does not escape to the heap |
| **GC pressure** | Rate of heap allocations that the GC must track and collect |
| **zero-copy** | Avoiding allocation when converting between string and []byte |
| **string deduplication** | Linker merging identical string literals to one backing array |

---

## 4. Core Concepts

### 4.1 Escape Analysis and String Allocations

```bash
# See what escapes to heap
go build -gcflags="-m=2" ./...
```

```go
// These do NOT escape to heap (stack-allocated)
func f() string {
    s := "hello" // constant: backed by read-only data segment
    return s      // header copied; backing array is .rodata
}

// This DOES escape to heap
func g(n int) string {
    b := make([]byte, n) // heap allocation
    return string(b)     // another heap allocation
}
```

### 4.2 Compiler-Optimized string([]byte) in Map/Switch

```go
// The compiler avoids allocating a string for map lookup
// when the key is a []byte converted inline
m := map[string]int{"hello": 1}
b := []byte("hello")
_ = m[string(b)] // NO heap allocation in Go 1.20+ (compiler optimizes this)
```

### 4.3 The strings.Builder copyCheck

```go
// strings.Builder uses a trick to detect copies
type Builder struct {
    addr *Builder // points to itself; if addr != &b after copy, panic
    buf  []byte
}
```

### 4.4 Read-Only String Data Segment

```go
// Constant strings are stored in the binary's .rodata section
// They are never garbage collected
const s = "Hello, World" // in .rodata
var s2 = "Hello, World"  // also in .rodata (compiler interning)

// Runtime-built strings go on the heap
s3 := strings.Repeat("a", 100) // heap-allocated backing array
```

### 4.5 Zero-Copy Patterns with unsafe (Go 1.20+)

```go
import (
    "unsafe"
)

// safe because we know string was created from this exact []byte
// and we do not hold a reference that would allow modification
func bytesToStringZeroCopy(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func stringToBytesZeroCopy(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
// WARNING: never modify the returned []byte from stringToBytesZeroCopy
```

---

## 5. Real-World Analogies

**Escape Analysis as a Lease vs Purchase Decision:**
The compiler decides whether to "lease" stack space (fast, automatic cleanup) or "purchase" heap space (tracked by GC). Strings built from constants are like leasing space in the binary itself — zero cost at runtime.

**String Interning as Shared Textbooks:**
In a school, instead of printing 30 copies of the same textbook, you have one and students share read-only access. Constant strings in Go share a single backing array the same way.

---

## 6. Mental Models

### Model 1: Three Kinds of String Backing Storage

```
1. .rodata (read-only data)    — string constants, zero GC cost
2. Heap                        — runtime-built strings, GC-tracked
3. Stack (rare)                — very short-lived strings in some compiler optimizations
```

### Model 2: String Conversion Cost Matrix

```
Operation            | Allocation | Notes
---------------------|-----------|---------------------------
s := "literal"       | None      | .rodata pointer
s2 := s1[a:b]        | None      | shares backing array
s3 := s1 + s2        | 1         | new heap backing array
string([]byte)       | 1         | copies bytes to heap
[]byte(string)       | 1         | copies bytes to heap
string([]byte) key   | 0         | compiler optimization in map lookup
```

---

## 7. Pros and Cons

### Pros

- Constant strings live in .rodata, zero GC overhead
- Compiler optimizes `string([]byte)` in map lookups and switches
- `unsafe` zero-copy available for extreme hot paths
- String header is only 16 bytes; goroutine stack effects are minimal

### Cons

- Every non-constant string build allocates
- Substring retaining large arrays is a real production memory leak
- `unsafe` zero-copy is unsafe: wrong usage corrupts memory
- Go lacks string deduplication at runtime (no JVM-style intern pool)

---

## 8. Use Cases

- **High-throughput HTTP servers** — zero-copy header parsing
- **Protocol parsers** — zero-allocation scanning with `[]byte` kept as strings
- **In-memory caches** — interning frequently used keys
- **Compression libraries** — operating on `[]byte` internally, exposing string API
- **Serialization** — JSON encoder operating on string fields without allocation

---

## 9. Code Examples

### Example 1: Benchmark String Conversion Strategies

```go
package bench_test

import (
    "testing"
    "unsafe"
)

var sink string

func BenchmarkStringConvert(b *testing.B) {
    data := []byte("hello world this is a test string for benchmarking")

    b.Run("standard", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            sink = string(data) // allocates
        }
    })

    b.Run("unsafe", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            sink = unsafe.String(unsafe.SliceData(data), len(data)) // zero-copy
        }
    })
}
```

### Example 2: String Interning Cache

```go
package main

import (
    "sync"
)

// InternPool deduplicates identical strings to save memory
type InternPool struct {
    mu   sync.RWMutex
    pool map[string]string
}

func (p *InternPool) Intern(s string) string {
    p.mu.RLock()
    if v, ok := p.pool[s]; ok {
        p.mu.RUnlock()
        return v
    }
    p.mu.RUnlock()

    p.mu.Lock()
    defer p.mu.Unlock()
    if v, ok := p.pool[s]; ok {
        return v
    }
    // Store a clone to avoid retaining caller's backing array
    import_str := strings.Clone(s)
    p.pool[import_str] = import_str
    return import_str
}
```

### Example 3: Zero-Allocation HTTP Header Lookup

```go
package main

import (
    "net/http"
    "unsafe"
)

// headerToString converts header bytes to string without allocation
// SAFE only because http.Header keys are ASCII and stable
func headerToString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func getContentType(h http.Header) string {
    return h.Get("Content-Type") // standard: safe
}
```

---

## 10. Coding Patterns

### Pattern 1: Arena-Style String Building

```go
// For high-throughput parsers: build all strings from one big []byte
type Arena struct {
    buf []byte
}

func (a *Arena) Alloc(s string) string {
    start := len(a.buf)
    a.buf = append(a.buf, s...)
    return unsafe.String(unsafe.SliceData(a.buf[start:]), len(s))
}
```

### Pattern 2: Reducing Allocations in JSON Paths

```go
// Instead of map[string]interface{}, use typed structs
// Avoids string allocations for field names at runtime

type Response struct {
    Status  string `json:"status"`
    Message string `json:"message"`
}
// json.Unmarshal into Response = zero extra string allocations for keys
```

### Pattern 3: Efficient String Set

```go
// map[string]struct{} uses no value space
seen := make(map[string]struct{})
seen["hello"] = struct{}{}
_, exists := seen["hello"]
```

---

## 11. Clean Code

- Separate "safe external API" (validated UTF-8) from "internal hot path" (trusted bytes)
- Document functions that use `unsafe` explicitly with WHY it is safe
- Never expose `unsafe`-derived byte slices to callers
- Use typed wrappers (e.g., `type SafeString string`) to enforce invariants

---

## 12. Product Use / Feature

- **DNS resolver** — interns domain name strings to reduce memory in large caches
- **HTTP/2 HPACK** — header table uses string deduplication
- **gRPC serializer** — zero-copy field extraction from protobuf wire format
- **Redis client** — converts network bytes to string keys without allocation in hot path

---

## 13. Error Handling

```go
// Wrap string errors with context
type StringError struct {
    Input  string
    Offset int
    Msg    string
}

func (e *StringError) Error() string {
    return fmt.Sprintf("at offset %d in %q: %s", e.Offset, e.Input, e.Msg)
}
```

---

## 14. Security

- `unsafe.String` and `unsafe.Slice` bypass Go's memory safety; one mistake causes silent memory corruption
- Never allow external input to determine lengths passed to `unsafe.Slice`
- Audit all `unsafe` string conversions in security-sensitive code paths
- Use `crypto/subtle.ConstantTimeCompare` for all secret comparisons

---

## 15. Performance Tips

```go
// Tip 1: Use strings.IndexByte for single-byte search (SIMD-optimized in stdlib)
i := strings.IndexByte(s, '/')

// Tip 2: Avoid repeated len() calls in loops — hoist to variable
n := len(s)
for i := 0; i < n; i++ { ... }

// Tip 3: Batch small string writes with a single Grow
var sb strings.Builder
sb.Grow(estimatedSize)

// Tip 4: Use strings.ContainsRune instead of strings.Contains(s, string(r))
ok := strings.ContainsRune(s, 'X')

// Tip 5: For read-only parsing, keep data as []byte throughout
// and only convert to string at the API boundary
```

---

## 16. Metrics

- **allocs/op** from `go test -benchmem` — aim for 0 in hot string paths
- **heap profile** from `pprof` — find unexpected string allocations
- **GC pause time** — high string allocation rate increases GC frequency
- **binary size** — constant string deduplication affects `.rodata` section size

---

## 17. Best Practices

1. Profile before optimizing — most string code does not need `unsafe`
2. Isolate `unsafe` string code in a single package with thorough tests
3. Use `strings.Clone` at API boundaries to prevent backing array leaks
4. Benchmark with realistic workloads, not microbenchmarks alone
5. Prefer `[]byte` internally and convert to `string` at the API surface
6. Use `go vet` and `staticcheck` to catch misuse of string APIs

---

## 18. Edge Cases

```go
// Empty string has a non-nil but zero-length pointer in some contexts
var s string
ptr := unsafe.StringData(s) // may be nil for empty string in Go 1.20+
_ = ptr

// string(nil []byte) is the empty string, not a panic
var b []byte
s := string(b)
fmt.Println(s == "") // true

// Modifying []byte after zero-copy string creation corrupts the string
b2 := []byte("hello")
s2 := unsafe.String(unsafe.SliceData(b2), len(b2))
b2[0] = 'H' // DANGER: s2 is now "Hello" — undefined behavior
```

---

## 19. Common Mistakes

### Mistake 1: Unsafe conversion with retained mutable slice

```go
b := []byte("hello")
s := unsafe.String(unsafe.SliceData(b), len(b))
b[0] = 'X' // CORRUPTS s — never modify b after zero-copy conversion
```

### Mistake 2: Long-lived substring retaining large arena

```go
// Parsing a 10MB config file and returning small extracted values
func extractKey(doc string) string {
    i := strings.Index(doc, "key=")
    return doc[i+4 : i+20] // retains the 10MB doc in memory!
}

// Fix
func extractKey(doc string) string {
    i := strings.Index(doc, "key=")
    return strings.Clone(doc[i+4 : i+20])
}
```

---

## 20. Misconceptions

| Misconception | Truth |
|--------------|-------|
| `unsafe` string conversion is always faster | Only helps in truly allocation-sensitive hot paths; profile first |
| String interning saves much memory in Go | Only useful for very high cardinality repeated strings; measure first |
| `go:noescape` suppresses all allocations | It only suppresses specific escape paths; complex code still escapes |

---

## 21. Tricky Points

```go
// The compiler may or may not intern identical string literals
s1 := "hello"
s2 := "hello"
// s1 and s2 may share the same backing bytes, but you cannot rely on this

// strings.Builder.String() shares the builder's internal buffer
// until the builder is modified again
var sb strings.Builder
sb.WriteString("hello")
s := sb.String()
sb.WriteString(" world") // s is now a dangling reference to old buffer!
// Fix: use s before modifying sb, or strings.Clone(sb.String())
```

---

## 22. Test

```go
package senior_test

import (
    "strings"
    "testing"
    "unsafe"
)

func BenchmarkZeroCopyVsStandard(b *testing.B) {
    data := []byte("benchmarking zero copy string conversion performance")
    b.Run("standard", func(b *testing.B) {
        b.ReportAllocs()
        for i := 0; i < b.N; i++ {
            _ = string(data)
        }
    })
    b.Run("unsafe", func(b *testing.B) {
        b.ReportAllocs()
        for i := 0; i < b.N; i++ {
            _ = unsafe.String(unsafe.SliceData(data), len(data))
        }
    })
}

func TestInternPool(t *testing.T) {
    var pool InternPool
    pool.pool = make(map[string]string)
    s1 := pool.Intern("hello")
    s2 := pool.Intern("hello")
    if s1 != s2 {
        t.Error("interned strings should be equal")
    }
}
```

---

## 23. Tricky Questions

**Q: When does `string([]byte)` NOT allocate?**
A: When used as a map key inline (e.g., `m[string(b)]`), the compiler avoids the allocation in Go 1.6+.

**Q: What is the risk of zero-copy `unsafe.String` from a `[]byte`?**
A: If the underlying `[]byte` is modified after the conversion, the string's content silently changes — this is undefined behavior.

**Q: How can a substring cause a memory leak?**
A: The substring header points into the original string's backing array. As long as the substring is live, the entire original array cannot be GC'd, even if the original string variable is gone.

**Q: Where do constant string literals live?**
A: In the `.rodata` section of the binary. They are never GC'd.

---

## 24. Cheat Sheet

```go
// Escape analysis
go build -gcflags="-m=2" ./...

// Zero-copy (Go 1.20+)
unsafe.String(unsafe.StringData(s), len(s))  // to string
unsafe.Slice(unsafe.SliceData(b), len(b))    // to []byte

// Avoid substring memory leak
strings.Clone(big[a:b])

// Map lookup without string alloc
m[string(byteSlice)]  // compiler optimizes this

// Intern frequently repeated strings
pool := make(map[string]string)
if v, ok := pool[s]; ok { s = v } else { pool[s] = s }

// Force stack allocation (benchmark only, use with care)
// Identify via: go build -gcflags="-m"
```

---

## 25. Self-Assessment

- [ ] I can explain where constant strings live in memory
- [ ] I know which `string([]byte)` conversions the compiler optimizes away
- [ ] I understand the memory leak risk of long-lived substrings
- [ ] I can write and interpret `go test -benchmem` output for strings
- [ ] I know when and how to safely use `unsafe` for zero-copy string ops
- [ ] I can design a string interning cache for high-cardinality data
- [ ] I understand GC pressure from string allocations

---

## 26. Summary

Senior-level string mastery combines deep knowledge of Go's compiler optimizations (escape analysis, string([]byte) in map lookups), memory model (.rodata, heap, GC interaction), and safe application of `unsafe` for zero-copy paths. The key discipline is profiling first — most string code performs well enough without unsafe tricks — and isolating dangerous optimizations with clear documentation and tests.

---

## 27. What You Can Build

- Zero-allocation HTTP/2 header parsers
- High-throughput log processors
- Custom string interning caches
- Memory-efficient DNS/routing tables
- Arena allocators for string-heavy parsers

---

## 28. Further Reading

- [Go compiler escape analysis docs](https://go.dev/doc/faq#stack_or_heap)
- [unsafe package docs](https://pkg.go.dev/unsafe)
- [Go memory model](https://go.dev/ref/mem)
- [Dave Cheney: Strings in Go](https://dave.cheney.net/2018/05/29/how-the-go-runtime-implements-maps-efficiently-without-generics)
- [pprof profiling guide](https://pkg.go.dev/runtime/pprof)

---

## 29. Postmortems

### Postmortem 1: Substring Memory Leak in Config Parser

**Incident:** A config reload function caused the process memory to grow by 50MB every hour.

**Root cause:** `extractValue(bigDoc)` returned `bigDoc[i:j]` — a substring that kept the 50MB raw config document alive in memory even after the reload.

**Fix:** `return strings.Clone(bigDoc[i:j])` — independent copy freed the large document after parsing.

**Lesson:** Never return raw substrings from large inputs at API boundaries.

---

### Postmortem 2: High GC Pause from String Concatenation

**Incident:** A log formatting function caused 10ms GC pauses during traffic spikes.

**Root cause:** Each log line used `+` to build a 200-character string from 12 fields, creating 11 intermediate allocations per log entry at 50K logs/sec.

**Fix:** Replaced with `strings.Builder` with a `Grow(200)` hint. Allocations dropped from 11 to 1 per log entry, reducing GC frequency by 80%.

---

## 30. Performance Optimization

```go
// Optimization 1: Move string constants out of hot functions
// BAD: string literal re-evaluated each call (though compiler may optimize)
func badPrefix(s string) bool {
    return strings.HasPrefix(s, "https://")
}

// GOOD: constant extracted
const httpsScheme = "https://"
func goodPrefix(s string) bool {
    return strings.HasPrefix(s, httpsScheme)
}

// Optimization 2: Reuse Builder across calls
type Formatter struct {
    sb strings.Builder
}

func (f *Formatter) Format(fields []string) string {
    f.sb.Reset()
    f.sb.Grow(128)
    for i, field := range fields {
        if i > 0 {
            f.sb.WriteByte(',')
        }
        f.sb.WriteString(field)
    }
    return f.sb.String()
}
```
