# Slice to Array Conversion — Middle Level

## 1. Why Slice-to-Array Conversion Was Added

Before Go 1.17, converting a slice to an array required an explicit `copy` — clunky and error-prone for low-level code. The conversions were added to enable:
- Zero-copy interop with C APIs (via pointer conversion)
- Cleaner fixed-size type usage (checksums, UUIDs, cryptographic keys)
- Replacing `*(*[N]T)(unsafe.Pointer(&s[0]))` patterns

```go
// Pre-1.17 (unsafe):
arr := *(*[4]byte)(unsafe.Pointer(&s[0]))

// 1.17+ (safe pointer conversion):
arr := (*[4]byte)(s)

// 1.20+ (safe value conversion):
arr := [4]byte(s)
```

---

## 2. Pointer vs Value: Memory Semantics

```
Pointer conversion (*[N]T)(s):

  s header:  [ptr → 0xc000] [len=5] [cap=5]
                    │
                    ▼
  backing:   [10][20][30][40][50]
                    │
  ptr:       ──────►[10][20][30]  (ptr points into same array)

Value conversion [N]T(s):

  s header:  [ptr → 0xc000] [len=5] [cap=5]
                    │
                    ▼
  backing:   [10][20][30][40][50]

  arr copy:  [10][20][30]  ← independent memory
```

---

## 3. When to Use Pointer vs Value Conversion

| Scenario | Use | Reason |
|----------|-----|--------|
| C FFI / CGo | `(*[N]T)(s)` | Zero-copy; C side sees same memory |
| Checksums / hashes | `[N]T(s)` | Independent; safe to store/pass around |
| Read-only inspection | Either | Value is safer (no accidental mutation) |
| Mutation through fixed API | `(*[N]T)(s)` | Mutations visible in original slice |
| Network protocol parsing | `[N]T(s)` | Clear ownership; easier to reason about |

---

## 4. Safety Analysis: Pointer Conversion

```go
package main

import "fmt"

func mutateFirst3(arr *[3]int) {
    arr[0], arr[1], arr[2] = 0, 0, 0
}

func main() {
    s := []int{10, 20, 30, 40, 50}
    fmt.Println("Before:", s) // [10 20 30 40 50]

    mutateFirst3((*[3]int)(s))

    fmt.Println("After:", s)  // [0 0 0 40 50] ← mutation visible!
}
```

The pointer conversion creates an alias — the function sees the same memory as the slice. This is intentional in some cases (efficiency) and dangerous in others (unexpected mutations).

---

## 5. Panic-Safe Wrapper

```go
package main

import "fmt"

func toArray3(s []int) (arr [3]int, ok bool) {
    if len(s) < 3 {
        return [3]int{}, false
    }
    return [3]int(s), true
}

func toArrayPtr3(s []int) (ptr *[3]int, ok bool) {
    if len(s) < 3 {
        return nil, false
    }
    return (*[3]int)(s), true
}

func main() {
    short := []int{1, 2}
    long := []int{1, 2, 3, 4, 5}

    if arr, ok := toArray3(short); ok {
        fmt.Println(arr)
    } else {
        fmt.Println("short: too short") // printed
    }

    if arr, ok := toArray3(long); ok {
        fmt.Println(arr) // [1 2 3]
    }

    if ptr, ok := toArrayPtr3(long); ok {
        fmt.Println(*ptr) // [1 2 3]
    }
}
```

---

## 6. CGo Interoperability

```go
package main

/*
#include <stdint.h>
void process_fixed(uint8_t arr[4]) {
    // C function expecting fixed-size array
}
*/
import "C"
import "unsafe"

func callCWithSlice(s []byte) {
    if len(s) < 4 {
        panic("need at least 4 bytes")
    }
    // Convert to pointer-to-array for CGo
    arr := (*[4]C.uint8_t)(unsafe.Pointer(&s[0]))
    C.process_fixed(arr)
}
```

The pointer conversion is essential for CGo because C functions that expect `T[N]` parameters need the exact memory layout.

---

## 7. Fixed-Size Checksums and Cryptographic Keys

```go
package main

import (
    "crypto/sha256"
    "fmt"
)

type Checksum [32]byte

func checksumSlice(data []byte) Checksum {
    hash := sha256.Sum256(data)
    return hash // already [32]byte
}

func verifyChecksum(data []byte, expected []byte) bool {
    if len(expected) < 32 {
        return false
    }
    // Convert expected []byte to [32]byte for comparison
    expectedArr := [32]byte(expected)
    computed := sha256.Sum256(data)
    return computed == expectedArr // array comparison is valid!
}

func main() {
    data := []byte("hello world")
    hash := checksumSlice(data)
    fmt.Printf("Hash: %x\n", hash)

    // Simulate stored hash as []byte
    stored := hash[:]
    fmt.Println(verifyChecksum(data, stored)) // true
}
```

---

## 8. Network Protocol Parsing

```go
package main

import (
    "encoding/binary"
    "fmt"
)

type EthernetHeader struct {
    Dst  [6]byte
    Src  [6]byte
    Type uint16
}

func parseEthernet(packet []byte) (*EthernetHeader, error) {
    if len(packet) < 14 {
        return nil, fmt.Errorf("packet too short: %d bytes", len(packet))
    }

    return &EthernetHeader{
        Dst:  [6]byte(packet[0:6]),
        Src:  [6]byte(packet[6:12]),
        Type: binary.BigEndian.Uint16(packet[12:14]),
    }, nil
}

func main() {
    // Fake ethernet frame
    packet := []byte{
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // dst: broadcast
        0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, // src: some MAC
        0x08, 0x00, // type: IPv4
        0x45, 0x00, // ... IP header starts
    }

    hdr, _ := parseEthernet(packet)
    fmt.Printf("Dst: %X\n", hdr.Dst)
    fmt.Printf("Src: %X\n", hdr.Src)
    fmt.Printf("Type: 0x%04X\n", hdr.Type) // 0x0800
}
```

---

## 9. Evolution: History of Slice-to-Array Conversion

| Go Version | Feature | Notes |
|------------|---------|-------|
| < 1.17 | No direct conversion | Required `unsafe.Pointer` or `copy` |
| 1.17 | `(*[N]T)(slice)` added | Safe pointer conversion; panics if len < N |
| 1.20 | `[N]T(slice)` added | Safe value (copy) conversion |
| 1.21 | Better error messages on panic | Runtime improved panic messages |

Before 1.17:
```go
// Unsafe hack (pre-1.17)
arr := *(*[4]byte)(unsafe.Pointer(&s[0]))
```

After 1.17:
```go
arr := (*[4]byte)(s)  // safe, panics with good message if len < 4
```

---

## 10. Alternative Approaches

### `copy()` — All Go versions

```go
var arr [4]byte
copy(arr[:], s)  // copies min(len(arr), len(s)) bytes
```

### Manual assignment — Verbose but explicit

```go
arr := [4]byte{s[0], s[1], s[2], s[3]}
```

### `reflect` — For generic code

```go
import "reflect"
v := reflect.ValueOf(arr)
// Note: reflect conversion is much slower
```

---

## 11. Anti-Pattern: Unsafe Pointer Conversion

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{1, 2, 3, 4, 5}

    // ANTI-PATTERN: don't do this!
    arr := *(*[3]int)(unsafe.Pointer(&s[0]))
    // Problems:
    // 1. Non-idiomatic
    // 2. Bypasses Go's safety checks
    // 3. Undefined behavior if s is empty!

    // CORRECT: use the built-in conversion
    arr2 := [3]int(s)
    fmt.Println(arr, arr2)
}
```

---

## 12. Anti-Pattern: Forgetting Shared Memory

```go
package main

import "fmt"

func main() {
    cache := []int{1, 2, 3, 4, 5}

    // BUG: thinks arr is independent
    arr := (*[3]int)(cache) // pointer — shares memory!
    arr[0] = 999            // accidentally mutates cache!

    fmt.Println(cache) // [999 2 3 4 5] — unexpected!

    // FIX: use value conversion for independence
    arr2 := [3]int(cache) // copy
    arr2[0] = 777
    fmt.Println(cache) // unchanged
}
```

---

## 13. Debugging: Verifying Memory Sharing

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{1, 2, 3, 4, 5}

    ptr := (*[3]int)(s)
    arr := [3]int(s)

    sPtr := uintptr(unsafe.Pointer(&s[0]))
    pPtr := uintptr(unsafe.Pointer(&ptr[0]))
    aPtr := uintptr(unsafe.Pointer(&arr[0]))

    fmt.Printf("s addr:   0x%x\n", sPtr)
    fmt.Printf("ptr addr: 0x%x (same=%v)\n", pPtr, sPtr == pPtr)
    fmt.Printf("arr addr: 0x%x (same=%v)\n", aPtr, sPtr == aPtr)
    // ptr addr: same=true (shared!)
    // arr addr: same=false (copied!)
}
```

---

## 14. Language Comparison

| Language | Slice to Fixed Array |
|----------|---------------------|
| Go | `[N]T(slice)` (1.20+) or `(*[N]T)(slice)` (1.17+) |
| Rust | `slice[..N].try_into().unwrap()` → `[T;N]` |
| C++ | `std::copy(vec.begin(), vec.begin()+N, arr)` |
| Python | `tuple(lst[:N])` (converts to fixed-size tuple) |
| Java | `Arrays.copyOf(list.toArray(), N)` |

Go's approach is notable for providing **zero-copy** semantics (pointer form) and **value-copy** semantics with the same clean syntax.

---

## 15. Interplay with `encoding/binary`

```go
package main

import (
    "encoding/binary"
    "fmt"
)

func decodeUint32BE(b []byte) uint32 {
    if len(b) < 4 {
        panic("need 4 bytes")
    }
    arr := [4]byte(b[:4])
    return binary.BigEndian.Uint32(arr[:])
}

func decodeUint32BEOld(b []byte) uint32 {
    return binary.BigEndian.Uint32(b[:4]) // also valid
}

func main() {
    data := []byte{0x00, 0x01, 0x86, 0xA0} // 100000
    fmt.Println(decodeUint32BE(data))       // 100000
    fmt.Println(decodeUint32BEOld(data))    // 100000
}
```

---

## 16. Generics and Slice-to-Array Conversion (Go 1.20+)

```go
package main

import "fmt"

// Generic function: take first N elements as array
// (N must be known at compile time — can't use as generic constraint)
func first3[T any](s []T) [3]T {
    if len(s) < 3 {
        panic("slice too short")
    }
    return [3]T(s)
}

func main() {
    ints := []int{10, 20, 30, 40}
    arr := first3(ints)
    fmt.Println(arr) // [10 20 30]

    strs := []string{"a", "b", "c", "d"}
    arr2 := first3(strs)
    fmt.Println(arr2) // [a b c]
}
```

Note: The array size `N` is a compile-time constant; it can't be a generic type parameter.

---

## 17. Benchmark: Conversion Methods

```go
package main

import "testing"

var s = make([]int, 1000)
var result [8]int

func BenchmarkCopyMethod(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var arr [8]int
        copy(arr[:], s)
        result = arr
    }
}

func BenchmarkValueConversion(b *testing.B) {
    for i := 0; i < b.N; i++ {
        result = [8]int(s)
    }
}

func BenchmarkPointerConversion(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ptr := (*[8]int)(s)
        _ = ptr
    }
}
```

Expected results:
```
BenchmarkCopyMethod-8        500000000    2.5 ns/op
BenchmarkValueConversion-8   500000000    2.3 ns/op  (compiler optimizes to memcpy)
BenchmarkPointerConversion-8 1000000000   0.8 ns/op  (zero-copy!)
```

---

## 18. Use Case: AES Key Management

```go
package main

import (
    "crypto/aes"
    "fmt"
)

type AES128Key [16]byte
type AES256Key [32]byte

func newAES128Cipher(keyBytes []byte) (interface{}, error) {
    if len(keyBytes) != 16 {
        return nil, fmt.Errorf("AES-128 needs 16 bytes, got %d", len(keyBytes))
    }
    key := AES128Key(keyBytes) // safe conversion
    return aes.NewCipher(key[:])
}

func main() {
    key := make([]byte, 16)
    for i := range key { key[i] = byte(i) }

    cipher, err := newAES128Cipher(key)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("Cipher created: %T\n", cipher)
}
```

---

## 19. Immutability Through Value Copy

```go
package main

import "fmt"

type Config struct {
    Endpoints [3]string
}

func NewConfig(endpoints []string) Config {
    if len(endpoints) < 3 {
        panic("need 3 endpoints")
    }
    // Value conversion makes Config independent of endpoints slice
    return Config{
        Endpoints: [3]string(endpoints),
    }
}

func main() {
    endpoints := []string{"a.example.com", "b.example.com", "c.example.com", "d.example.com"}
    cfg := NewConfig(endpoints)

    // Modifying original slice doesn't affect cfg
    endpoints[0] = "CHANGED"
    fmt.Println(cfg.Endpoints[0]) // a.example.com — unchanged
}
```

---

## 20. Bounds Checking: Compile Time vs Runtime

```go
package main

func main() {
    s := make([]int, 5)

    // Compile-time: N is known, but len(s) is NOT known at compile time
    // So this check is RUNTIME:
    arr := [5]int(s) // runtime check: len(s) >= 5 ✓

    // However, if s is provably too short, compiler may warn:
    // arr2 := [10]int(s) // runtime panic (no compile error!)

    _ = arr
}
```

---

## 21. Combining with Struct Embedding

```go
package main

import "fmt"

type IPAddress [4]byte

func (ip IPAddress) String() string {
    return fmt.Sprintf("%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3])
}

func parseIP(s []byte) IPAddress {
    return IPAddress(s[:4]) // clear conversion
}

func main() {
    raw := []byte{192, 168, 1, 100}
    ip := parseIP(raw)
    fmt.Println(ip) // 192.168.1.100
}
```

---

## 22. Edge Case: Empty Slice to [0]T

```go
package main

import "fmt"

func main() {
    // All of these work (N=0):
    var nilSlice []int
    empty := []int{}
    sized := []int{1, 2, 3}

    arr1 := [0]int(nilSlice)
    arr2 := [0]int(empty)
    arr3 := [0]int(sized) // also works! only first 0 elements copied

    fmt.Println(arr1, arr2, arr3) // [] [] []
}
```

---

## 23. Conversion in Table-Driven Tests

```go
package main

import (
    "fmt"
    "testing"
)

func parseIPv4(b []byte) ([4]byte, error) {
    if len(b) < 4 {
        return [4]byte{}, fmt.Errorf("need 4 bytes")
    }
    return [4]byte(b), nil
}

func TestParseIPv4(t *testing.T) {
    tests := []struct{
        input []byte
        want  [4]byte
        err   bool
    }{
        {[]byte{127,0,0,1}, [4]byte{127,0,0,1}, false},
        {[]byte{1,2},       [4]byte{},           true},
    }

    for _, tc := range tests {
        got, err := parseIPv4(tc.input)
        if (err != nil) != tc.err {
            t.Errorf("unexpected error: %v", err)
        }
        if !tc.err && got != tc.want {
            t.Errorf("got %v, want %v", got, tc.want)
        }
    }
    fmt.Println("Tests passed")
}

func main() {
    TestParseIPv4(&testing.T{})
}
```

---

## 24. Slice Pointer as Function Parameter

```go
package main

import "fmt"

// processBlock operates on a fixed 8-byte block
func processBlock(block *[8]byte) {
    for i := range block {
        block[i] ^= 0xFF // XOR each byte
    }
}

func processStream(data []byte) {
    for i := 0; i+8 <= len(data); i += 8 {
        chunk := data[i : i+8]
        processBlock((*[8]byte)(chunk))
    }
}

func main() {
    data := make([]byte, 32)
    for i := range data { data[i] = byte(i) }

    processStream(data)
    fmt.Println(data[:8]) // [255 254 253 252 251 250 249 248]
}
```

---

## 25. Anti-Pattern: Converting After Append

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 5)
    s[0], s[1], s[2] = 1, 2, 3

    // Take a pointer to first 3 elements
    ptr := (*[3]int)(s)

    // DANGER: after append, s might reallocate!
    s = append(s, 100, 200, 300) // fits in cap=5, no realloc
    s = append(s, 400)           // exceeds cap! new backing array

    // ptr still points to OLD backing array — dangling pointer!
    fmt.Println(*ptr) // reads old memory — undefined behavior!

    // SAFE: only use ptr while s hasn't been reallocated
}
```

---

## 26. Best Practice: Document Memory Sharing

```go
package main

import "fmt"

// parseHeader extracts the 8-byte header.
// The returned pointer SHARES memory with data.
// Do not modify header after data is modified or freed.
func parseHeader(data []byte) *[8]byte {
    if len(data) < 8 {
        return nil
    }
    return (*[8]byte)(data)
}

// parseHeaderCopy extracts the 8-byte header as an independent copy.
// Safe to use after data changes.
func parseHeaderCopy(data []byte) ([8]byte, bool) {
    if len(data) < 8 {
        return [8]byte{}, false
    }
    return [8]byte(data), true
}

func main() {
    packet := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

    hdr := parseHeader(packet)
    fmt.Println(*hdr) // [1 2 3 4 5 6 7 8]

    hdrCopy, _ := parseHeaderCopy(packet)
    packet[0] = 99
    fmt.Println((*hdr)[0]) // 99  — shared!
    fmt.Println(hdrCopy[0]) // 1  — independent!
}
```

---

## 27. Pattern: Rotating Fixed Window

```go
package main

import "fmt"

func windowSums(data []int, n int) []int {
    if len(data) < n {
        return nil
    }
    results := make([]int, 0, len(data)-n+1)
    for i := 0; i+n <= len(data); i++ {
        window := [3]int(data[i : i+3]) // fixed-size window
        sum := window[0] + window[1] + window[2]
        results = append(results, sum)
    }
    return results
}

func main() {
    data := []int{1, 2, 3, 4, 5, 6}
    fmt.Println(windowSums(data, 3)) // [6 9 12 15]
}
```

---

## 28. Conversion in Map Keys

```go
package main

import "fmt"

func main() {
    // Slices cannot be map keys — arrays can!
    cache := make(map[[4]byte]string)

    // Convert slice to array to use as key
    addEntry := func(key []byte, value string) {
        if len(key) >= 4 {
            cache[[4]byte(key[:4])] = value
        }
    }

    addEntry([]byte{1, 2, 3, 4, 5}, "first")
    addEntry([]byte{5, 6, 7, 8, 9}, "second")

    lookup := func(key []byte) string {
        if len(key) < 4 {
            return ""
        }
        return cache[[4]byte(key[:4])]
    }

    fmt.Println(lookup([]byte{1, 2, 3, 4}))   // first
    fmt.Println(lookup([]byte{5, 6, 7, 8}))   // second
    fmt.Println(lookup([]byte{9, 9, 9, 9}))   // (empty)
}
```

---

## 29. Conversion with `io.Reader`

```go
package main

import (
    "fmt"
    "io"
    "strings"
)

func readExact(r io.Reader, n int) ([]byte, error) {
    buf := make([]byte, n)
    _, err := io.ReadFull(r, buf)
    return buf, err
}

func main() {
    r := strings.NewReader("ABCDEFGHIJ")

    chunk, err := readExact(r, 4)
    if err != nil {
        panic(err)
    }

    // Convert to [4]byte for safe storage
    header := [4]byte(chunk)
    fmt.Printf("Header: %s\n", string(header[:])) // ABCD
}
```

---

## 30. Summary: Choosing the Right Conversion

```go
package main

import "fmt"

func main() {
    s := []byte{1, 2, 3, 4, 5, 6, 7, 8}

    // 1. Zero-copy read — use pointer, no modification needed
    view := (*[4]byte)(s[:4])
    _ = view[0] // read only

    // 2. Mutation that should affect original — use pointer
    mod := (*[4]byte)(s)
    mod[0] = 99 // modifies s[0]

    // 3. Independent copy for long-term storage — use value
    stored := [4]byte(s[:4])
    _ = stored // s can change without affecting stored

    // 4. Map key or comparable type — use value (slices aren't comparable)
    keys := make(map[[4]byte]bool)
    keys[[4]byte(s[:4])] = true

    // 5. Pre-1.17 code — use copy
    var arr [4]byte
    copy(arr[:], s)
    _ = arr

    fmt.Println("All conversions demonstrated")
}
```
