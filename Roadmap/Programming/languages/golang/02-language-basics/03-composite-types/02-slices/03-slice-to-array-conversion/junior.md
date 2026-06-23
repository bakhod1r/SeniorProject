# Slice to Array Conversion — Junior Level

## 1. What is Slice to Array Conversion?

In Go, you can convert a slice into an array (or a pointer to an array). This allows you to work with a fixed-size view of slice data.

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Go 1.20+: convert slice to array (copy)
    arr := [3]int(s)
    fmt.Println(arr) // [1 2 3]
}
```

---

## 2. Two Conversion Methods

Go provides two ways to convert a slice to an array:

```go
package main

import "fmt"

func main() {
    s := []int{10, 20, 30, 40, 50}

    // Method 1 (Go 1.17+): pointer to array — SHARES memory
    ptr := (*[3]int)(s)
    fmt.Println(*ptr) // [10 20 30]

    // Method 2 (Go 1.20+): array value — COPIES elements
    arr := [3]int(s)
    fmt.Println(arr)  // [10 20 30]
}
```

The key difference: `ptr` shares memory with `s`; `arr` is an independent copy.

---

## 3. Go Version Requirements

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}

    // Go 1.17+: only pointer conversion available
    ptr := (*[3]int)(s)    // works in Go 1.17+
    _ = ptr

    // Go 1.20+: direct array value conversion added
    arr := [3]int(s)       // only works in Go 1.20+
    fmt.Println(arr)
}
```

Check your Go version with `go version` before using these features.

---

## 4. The Pointer Method (`(*[N]T)(slice)`)

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Get a *[3]int pointing to s's first 3 elements
    p := (*[3]int)(s)

    fmt.Println(p)    // &[1 2 3]
    fmt.Println(*p)   // [1 2 3]
    fmt.Println(p[0]) // 1
    fmt.Println(p[1]) // 2
    fmt.Println(p[2]) // 3
}
```

---

## 5. The Value Method (`[N]T(slice)`) — Go 1.20+

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Convert first 3 elements into an array (copy)
    arr := [3]int(s)

    fmt.Println(arr)       // [1 2 3]
    fmt.Printf("%T\n", arr) // [3]int
}
```

---

## 6. Memory Sharing vs Copying

The most important distinction:

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Pointer — SHARES memory
    ptr := (*[3]int)(s)
    ptr[0] = 999
    fmt.Println(s[0]) // 999 — s was modified!

    // Value — COPIES memory
    arr := [3]int(s)
    arr[0] = 777
    fmt.Println(s[0]) // still 999 — s was NOT modified
}
```

---

## 7. Panic Condition: Slice Too Short

Converting a slice to an array panics if the slice is shorter than the array:

```go
package main

import "fmt"

func main() {
    s := []int{1, 2} // only 2 elements

    // This PANICS: len(s)=2 < N=5
    // arr := [5]int(s)

    // This is SAFE: len(s)=2 >= N=2
    arr := [2]int(s)
    fmt.Println(arr) // [1 2]

    // This is SAFE: len(s)=2 >= N=1
    arr2 := [1]int(s)
    fmt.Println(arr2) // [1]
}
```

---

## 8. Zero-Length Array Conversion

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}

    // Converting to [0]T always succeeds (even on nil slice)
    arr := [0]int(s)
    fmt.Println(arr) // []
    fmt.Println(len(arr)) // 0

    // Also works on nil slice:
    var nilSlice []int
    arr2 := [0]int(nilSlice)
    fmt.Println(arr2) // []
}
```

---

## 9. Converting Byte Slices to Fixed Arrays

```go
package main

import "fmt"

func main() {
    b := []byte{0x48, 0x65, 0x6C, 0x6C, 0x6F} // "Hello"

    // Convert to [5]byte array
    arr := [5]byte(b)
    fmt.Println(arr)          // [72 101 108 108 111]
    fmt.Println(string(arr[:])) // Hello
}
```

---

## 10. Common Use Case: SHA256 Hash

```go
package main

import (
    "crypto/sha256"
    "fmt"
)

func main() {
    data := []byte("hello world")
    hashSlice := sha256.Sum256(data) // returns [32]byte, not []byte

    // If you have a []byte and need [32]byte:
    hashBytes := hashSlice[:]        // convert [32]byte → []byte
    arr := [32]byte(hashBytes)       // convert back to [32]byte
    fmt.Printf("%x\n", arr)
}
```

---

## 11. Passing Slice to Function Expecting Array Pointer

```go
package main

import "fmt"

func processFixed(arr *[4]int) {
    for i := range arr {
        arr[i] *= 2
    }
}

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Convert slice to *[4]int to call processFixed
    processFixed((*[4]int)(s))

    fmt.Println(s) // [2 4 6 8 5] — first 4 elements doubled
}
```

---

## 12. Using `copy()` as an Alternative (Pre-Go 1.17)

Before Go 1.17, the way to get an array from a slice was:

```go
package main

import "fmt"

func main() {
    s := []int{10, 20, 30, 40, 50}

    // Old way (works in all Go versions)
    var arr [3]int
    copy(arr[:], s) // copy from slice to array
    fmt.Println(arr) // [10 20 30]

    // Modern way (Go 1.20+)
    arr2 := [3]int(s)
    fmt.Println(arr2) // [10 20 30]
}
```

---

## 13. Index Access via Pointer Conversion

```go
package main

import "fmt"

func main() {
    s := []byte("Go Programming")

    // Get pointer to array of first 2 bytes
    p := (*[2]byte)(s)

    fmt.Println(p[0]) // 71 ('G')
    fmt.Println(p[1]) // 111 ('o')
    fmt.Printf("%c%c\n", p[0], p[1]) // Go
}
```

---

## 14. Type Assertion After Conversion

```go
package main

import "fmt"

func main() {
    s := []int{5, 10, 15}

    arr := [3]int(s)

    // arr is of type [3]int, not []int
    fmt.Printf("Type: %T\n", arr) // [3]int
    fmt.Printf("Type: %T\n", s)   // []int

    // Arrays are comparable, slices are not
    arr2 := [3]int{5, 10, 15}
    fmt.Println(arr == arr2) // true
}
```

---

## 15. Array Pointer Modification Affects Original Slice

```go
package main

import "fmt"

func zero(arr *[3]int) {
    for i := range arr {
        arr[i] = 0
    }
}

func main() {
    s := []int{100, 200, 300, 400}

    // arr pointer shares memory with s
    zero((*[3]int)(s))

    fmt.Println(s) // [0 0 0 400] — first 3 zeroed via pointer
}
```

---

## 16. Reading Fixed-Size Network Header

```go
package main

import (
    "encoding/binary"
    "fmt"
)

func parseHeader(data []byte) (magic uint32, length uint16) {
    if len(data) < 6 {
        panic("data too short")
    }

    // Convert first 6 bytes to fixed array
    header := [6]byte(data[:6])

    magic = binary.BigEndian.Uint32(header[:4])
    length = binary.BigEndian.Uint16(header[4:6])
    return
}

func main() {
    packet := []byte{0x00, 0x00, 0x12, 0x34, 0x00, 0x05, 0x61, 0x62, 0x63}
    magic, length := parseHeader(packet)
    fmt.Printf("Magic: 0x%X, Length: %d\n", magic, length)
    // Magic: 0x1234, Length: 5
}
```

---

## 17. Sub-slice Then Convert

```go
package main

import "fmt"

func main() {
    data := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}

    // Take a sub-slice first, then convert
    sub := data[3:7] // [3, 4, 5, 6]
    arr := [4]int(sub)

    fmt.Println(arr) // [3 4 5 6]
}
```

---

## 18. String to Byte Array Conversion

```go
package main

import "fmt"

func main() {
    s := "Hello"
    b := []byte(s)

    // Convert []byte to [5]byte array
    arr := [5]byte(b)

    fmt.Println(arr)          // [72 101 108 108 111]
    fmt.Println(string(arr[:])) // Hello
}
```

---

## 19. Checking Length Before Conversion

```go
package main

import "fmt"

func toFixed4(s []int) ([4]int, bool) {
    if len(s) < 4 {
        return [4]int{}, false // can't convert safely
    }
    return [4]int(s), true
}

func main() {
    s1 := []int{1, 2, 3, 4, 5}
    if arr, ok := toFixed4(s1); ok {
        fmt.Println(arr) // [1 2 3 4]
    }

    s2 := []int{1, 2}
    if _, ok := toFixed4(s2); !ok {
        fmt.Println("slice too short") // printed
    }
}
```

---

## 20. Iterating Over a Converted Array

```go
package main

import "fmt"

func main() {
    s := []string{"alpha", "beta", "gamma"}

    arr := [3]string(s)

    for i, v := range arr {
        fmt.Printf("arr[%d] = %s\n", i, v)
    }
}
```

Output:
```
arr[0] = alpha
arr[1] = beta
arr[2] = gamma
```

---

## 21. Comparison: Slice vs Array

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}

    // Slices cannot be compared directly
    // s1 == s2  // compile error

    // Arrays CAN be compared
    arr1 := [3]int(s)
    arr2 := [3]int{1, 2, 3}

    fmt.Println(arr1 == arr2) // true
    fmt.Println(arr1 == [3]int{1, 2, 4}) // false
}
```

---

## 22. Converting Slice of Structs

```go
package main

import "fmt"

type Point struct{ X, Y int }

func main() {
    points := []Point{{1, 2}, {3, 4}, {5, 6}, {7, 8}}

    // Get first 2 as fixed array
    fixed := [2]Point(points)

    fmt.Println(fixed[0]) // {1 2}
    fmt.Println(fixed[1]) // {3 4}
}
```

---

## 23. Nil Slice Conversion

```go
package main

import "fmt"

func main() {
    var s []int // nil slice

    // [0]T conversion works even on nil
    arr0 := [0]int(s)
    fmt.Println(arr0) // []

    // Any non-zero array size panics:
    // arr1 := [1]int(s)  // PANIC: len(s)=0 < N=1
    _ = arr0
}
```

---

## 24. Use in `switch` Type Detection

```go
package main

import "fmt"

func describeSlice(s []byte) string {
    switch len(s) {
    case 4:
        arr := [4]byte(s)
        return fmt.Sprintf("IPv4: %d.%d.%d.%d", arr[0], arr[1], arr[2], arr[3])
    case 16:
        return "IPv6 address"
    default:
        return "unknown"
    }
}

func main() {
    ip4 := []byte{192, 168, 1, 1}
    fmt.Println(describeSlice(ip4)) // IPv4: 192.168.1.1
}
```

---

## 25. Converting Float Slice to Array

```go
package main

import "fmt"

func main() {
    coords := []float64{1.1, 2.2, 3.3, 4.4}

    // Extract 3D point as fixed array
    point3D := [3]float64(coords[:3])
    fmt.Println(point3D) // [1.1 2.2 3.3]

    // Extract 2D point
    point2D := [2]float64(coords[:2])
    fmt.Println(point2D) // [1.1 2.2]
}
```

---

## 26. Working with UUID

```go
package main

import "fmt"

type UUID [16]byte

func parseUUID(b []byte) (UUID, error) {
    if len(b) < 16 {
        return UUID{}, fmt.Errorf("need 16 bytes, got %d", len(b))
    }
    return UUID(b[:16]), nil
}

func main() {
    raw := make([]byte, 16)
    for i := range raw { raw[i] = byte(i) }

    id, err := parseUUID(raw)
    if err != nil {
        panic(err)
    }
    fmt.Printf("UUID: %x\n", id)
}
```

---

## 27. Runtime Panic vs Compile Error

```go
package main

func main() {
    s := []int{1, 2, 3}

    // This is a COMPILE-TIME error:
    // var arr [3]string = [3]string(s)  // type mismatch

    // This is a RUNTIME panic (no compile error!):
    // arr := [10]int(s)  // len(s)=3 < 10 → panics at runtime

    // This is SAFE at compile time AND runtime:
    arr := [3]int(s) // len(s)=3 >= 3
    _ = arr
}
```

---

## 28. Verify No Sharing After Value Conversion

```go
package main

import "fmt"

func main() {
    s := []int{10, 20, 30}

    // Value conversion — independent copy
    arr := [3]int(s)

    // Modify both
    s[0] = 999
    arr[1] = 888

    fmt.Println(s)   // [999 20 30] — arr change didn't affect s
    fmt.Println(arr) // [10 888 30] — s change didn't affect arr
}
```

---

## 29. Combining with `fmt.Sprintf`

```go
package main

import "fmt"

func ipToString(ip []byte) string {
    if len(ip) != 4 {
        return "invalid"
    }
    arr := [4]byte(ip)
    return fmt.Sprintf("%d.%d.%d.%d", arr[0], arr[1], arr[2], arr[3])
}

func main() {
    fmt.Println(ipToString([]byte{10, 0, 0, 1}))     // 10.0.0.1
    fmt.Println(ipToString([]byte{192, 168, 0, 1}))  // 192.168.0.1
    fmt.Println(ipToString([]byte{1, 2}))             // invalid
}
```

---

## 30. Summary: Slice to Array Conversion

| Method | Go Version | Memory | When to Use |
|--------|------------|--------|-------------|
| `(*[N]T)(s)` | 1.17+ | Shared | Zero-copy; when mutations needed |
| `[N]T(s)` | 1.20+ | Copied | Independent array; safe default |
| `copy(arr[:], s)` | Any | Copied | Maximum compatibility |

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Choose based on your need:
    // 1. Need to modify and see changes in original slice:
    ptr := (*[3]int)(s)
    ptr[0] = 99
    fmt.Println(s[0]) // 99

    // 2. Need independent copy:
    arr := [3]int(s)
    arr[0] = 77
    fmt.Println(s[0]) // still 99 (not 77)

    // 3. Maximum compatibility:
    var arr2 [3]int
    copy(arr2[:], s)
    fmt.Println(arr2) // [99 2 3]
}
```
