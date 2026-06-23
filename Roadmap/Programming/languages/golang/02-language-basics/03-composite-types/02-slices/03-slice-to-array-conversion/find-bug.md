# Slice to Array Conversion — Find the Bug

## Bug 1 🟢 — Panic on Short Slice

```go
package main

import "fmt"

func getKey(data []byte) [16]byte {
    return [16]byte(data) // assumes data is at least 16 bytes
}

func main() {
    shortData := []byte{1, 2, 3, 4} // only 4 bytes!
    key := getKey(shortData)
    fmt.Printf("%x\n", key)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What happens when the slice is shorter than the array size N in a conversion?

</details>

<details>
<summary>Solution</summary>

**Bug:** `[16]byte(data)` panics at runtime because `len(data) = 4 < 16`. There's no compile-time protection.

**Fix:** Validate length before conversion:

```go
func getKey(data []byte) ([16]byte, error) {
    if len(data) < 16 {
        return [16]byte{}, fmt.Errorf("need 16 bytes, got %d", len(data))
    }
    return [16]byte(data[:16]), nil
}

func main() {
    shortData := []byte{1, 2, 3, 4}
    key, err := getKey(shortData)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("%x\n", key)
}
```

</details>

---

## Bug 2 🟢 — Wrong Form: Value Instead of Pointer

```go
package main

import "fmt"

func zero4(s []int) {
    arr := [4]int(s[:4]) // value conversion — copies!
    for i := range arr {
        arr[i] = 0 // modifies local copy, not s!
    }
}

func main() {
    s := []int{10, 20, 30, 40, 50}
    zero4(s)
    fmt.Println(s) // expected [0 0 0 0 50], got [10 20 30 40 50]
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Which conversion form shares memory with the original slice?

</details>

<details>
<summary>Solution</summary>

**Bug:** `[4]int(s[:4])` creates an independent copy. Modifying `arr` doesn't affect `s`.

**Fix:** Use pointer conversion to share memory:

```go
func zero4(s []int) {
    ptr := (*[4]int)(s[:4]) // pointer — shares memory!
    for i := range ptr {
        ptr[i] = 0 // modifies s!
    }
}

func main() {
    s := []int{10, 20, 30, 40, 50}
    zero4(s)
    fmt.Println(s) // [0 0 0 0 50] — correct
}
```

</details>

---

## Bug 3 🟢 — Using `new` Instead of Array Conversion

```go
package main

import "fmt"

func parseHeader(data []byte) *[8]byte {
    if len(data) < 8 { return nil }
    arr := new([8]byte)     // allocates NEW [8]byte
    copy(arr[:], data[:8])  // copies into it
    return arr
}

func main() {
    data := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    hdr := parseHeader(data)
    hdr[0] = 99

    fmt.Println(data[0]) // 1 — unchanged (intended or bug?)
    fmt.Println(*hdr)    // [99 2 3 4 5 6 7 8]
}
```

**What's wrong? (Context: the function is supposed to provide a zero-copy view)**

<details>
<summary>Hint</summary>

The function allocates a new array and copies. Is that necessary for a "zero-copy view"?

</details>

<details>
<summary>Solution</summary>

**Bug:** The function was supposed to be a zero-copy view into `data`, but it allocates a new `[8]byte` and copies. Modifications to the returned pointer don't affect `data`.

**Fix:** Use pointer conversion for true zero-copy:

```go
func parseHeader(data []byte) *[8]byte {
    if len(data) < 8 { return nil }
    return (*[8]byte)(data[:8]) // zero-copy! shares data's memory
}

func main() {
    data := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    hdr := parseHeader(data)
    hdr[0] = 99

    fmt.Println(data[0]) // 99 — modification visible in data!
    fmt.Println(*hdr)    // [99 2 3 4 5 6 7 8]
}
```

</details>

---

## Bug 4 🟡 — Memory Leak: Pointer Retains Large Buffer

```go
package main

import (
    "fmt"
    "sync"
)

type RecvBuffer struct {
    data []byte
    hdr  *[12]byte // cached header pointer
}

var cache []*[12]byte
var mu sync.Mutex

func process(data []byte) {
    if len(data) < 12 { return }

    // Cache the header pointer for "quick access"
    hdr := (*[12]byte)(data[:12])
    mu.Lock()
    cache = append(cache, hdr) // BUG: retains entire data!
    mu.Unlock()

    // data might be a 1MB network buffer...
    fmt.Println("Processed:", hdr[0])
}

func main() {
    for i := 0; i < 100; i++ {
        data := make([]byte, 1024*1024) // 1MB per iteration
        data[0] = byte(i)
        process(data)
    }
    // After loop: cache holds 100 pointers, each keeping 1MB alive = 100MB!
    fmt.Println("Cache size:", len(cache))
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What does a `*[12]byte` pointer keep alive in the GC? How large is the backing array it's pointing into?

</details>

<details>
<summary>Solution</summary>

**Bug:** Each `*[12]byte` pointer keeps its entire backing array alive. Since each backing array is 1MB, 100 cached pointers = 100MB of memory that cannot be GC'd. Only 1.2KB (100 × 12 bytes) is actually used.

**Fix:** Cache the value (copy), not the pointer:

```go
var cache [][12]byte // store values, not pointers

func process(data []byte) {
    if len(data) < 12 { return }

    hdr := [12]byte(data[:12]) // VALUE copy — only 12 bytes!
    // data's 1MB can be GC'd after this function returns

    mu.Lock()
    cache = append(cache, hdr)
    mu.Unlock()
    fmt.Println("Processed:", hdr[0])
}
```

Now 100 entries use only `100 × 12 = 1200 bytes` instead of 100MB.

</details>

---

## Bug 5 🟡 — Stale Pointer After Append

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 5)
    s[0], s[1], s[2] = 10, 20, 30

    // Get pointer to first 3 elements
    ptr := (*[3]int)(s)
    fmt.Println("ptr before:", *ptr) // [10 20 30]

    // Append beyond capacity — triggers reallocation!
    s = append(s, 40, 50, 60) // len=6, exceeds cap=5 → new backing array

    // ptr STILL points to OLD backing array!
    ptr[0] = 999 // writes to old (now orphaned) memory
    fmt.Println("s after modification:", s)
    // s[0] is still 10, not 999!
    fmt.Println("ptr value:", *ptr)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

When `append` exceeds capacity, what happens to the backing array? What does `ptr` point to now?

</details>

<details>
<summary>Solution</summary>

**Bug:** After `append` exceeds capacity, Go allocates a new backing array and copies elements. `s` now points to the new array. But `ptr` still points to the OLD backing array. Writing to `ptr[0]` modifies the old orphaned memory — it has no effect on `s`.

**Fix:** Never retain a pointer conversion across a potential reallocation:

```go
func main() {
    s := make([]int, 3, 5)
    s[0], s[1], s[2] = 10, 20, 30

    // Either: use ptr only before any append
    ptr := (*[3]int)(s)
    ptr[0] = 999 // safe here
    fmt.Println(s) // [999 20 30 40 50]

    // Then append
    s = append(s, 40, 50, 60)
    // NEVER use ptr again after this

    // Or: re-obtain ptr after appending
    ptr = (*[3]int)(s) // get new pointer to new backing array
    ptr[0] = 777
    fmt.Println(s[0]) // 777
}
```

</details>

---

## Bug 6 🟡 — Wrong Slice Bounds Before Conversion

```go
package main

import (
    "encoding/binary"
    "fmt"
)

func parseUint64s(data []byte, n int) []uint64 {
    result := make([]uint64, n)
    for i := 0; i < n; i++ {
        // BUG: wrong slice bounds — reads overlapping bytes!
        arr := [8]byte(data[i : i+8]) // should be i*8 : i*8+8
        result[i] = binary.BigEndian.Uint64(arr[:])
    }
    return result
}

func main() {
    // 3 uint64 values: 1, 2, 3
    data := make([]byte, 24)
    binary.BigEndian.PutUint64(data[0:8], 1)
    binary.BigEndian.PutUint64(data[8:16], 2)
    binary.BigEndian.PutUint64(data[16:24], 3)

    result := parseUint64s(data, 3)
    fmt.Println(result) // expected [1 2 3], got wrong values
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

For the second value (i=1), what bytes does `data[i:i+8]` = `data[1:9]` actually read?

</details>

<details>
<summary>Solution</summary>

**Bug:** The slice bounds `data[i : i+8]` for i=0,1,2 reads bytes `[0:8]`, `[1:9]`, `[2:10]` — overlapping! Each uint64 occupies 8 bytes, so the correct offset is `i*8`.

**Fix:** Use `i*8` as the stride:

```go
func parseUint64s(data []byte, n int) []uint64 {
    if len(data) < n*8 {
        panic("data too short")
    }
    result := make([]uint64, n)
    for i := 0; i < n; i++ {
        offset := i * 8 // correct stride!
        arr := [8]byte(data[offset : offset+8])
        result[i] = binary.BigEndian.Uint64(arr[:])
    }
    return result
}
```

</details>

---

## Bug 7 🟡 — Nil Pointer Dereference

```go
package main

import "fmt"

func safeGetPtr(data []byte) *[4]byte {
    if len(data) >= 4 {
        return (*[4]byte)(data)
    }
    return nil
}

func process(data []byte) {
    ptr := safeGetPtr(data)
    // BUG: no nil check before dereference!
    fmt.Printf("First byte: %d\n", ptr[0]) // panics if ptr is nil
}

func main() {
    process([]byte{1, 2, 3, 4, 5}) // OK
    process([]byte{1, 2})          // PANIC: nil pointer dereference
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

When `safeGetPtr` returns `nil`, what happens when you index it?

</details>

<details>
<summary>Solution</summary>

**Bug:** `safeGetPtr` returns `nil` for short slices, but the caller doesn't check for nil before indexing. `(*[4]byte)(nil)[0]` is a nil pointer dereference → panic.

**Fix 1:** Check nil in the caller:

```go
func process(data []byte) {
    ptr := safeGetPtr(data)
    if ptr == nil {
        fmt.Println("data too short")
        return
    }
    fmt.Printf("First byte: %d\n", ptr[0])
}
```

**Fix 2:** Use error return instead of nil pointer:

```go
func safeGetPtr(data []byte) (*[4]byte, error) {
    if len(data) < 4 {
        return nil, fmt.Errorf("need 4 bytes, got %d", len(data))
    }
    return (*[4]byte)(data), nil
}
```

</details>

---

## Bug 8 🔴 — Data Race via Shared Pointer

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    data := []byte{1, 2, 3, 4, 5, 6, 7, 8}
    ptr := (*[4]byte)(data[:4]) // shares data[0:4]

    var wg sync.WaitGroup

    // Goroutine 1: reads via ptr
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 1000; i++ {
            _ = ptr[0] // reads data[0]
        }
    }()

    // Goroutine 2: writes to data[0] (same memory as ptr[0])
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 1000; i++ {
            data[0] = byte(i) // BUG: concurrent write to same memory!
        }
    }()

    wg.Wait()
    fmt.Println("Done (but had data race!)")
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

`ptr[0]` and `data[0]` access the same memory. What does Go's memory model say about concurrent reads and writes to the same location?

</details>

<details>
<summary>Solution</summary>

**Bug:** `ptr` shares memory with `data`. Goroutine 1 reads `ptr[0]` = `data[0]` while goroutine 2 writes `data[0]`. This is a data race — undefined behavior. Run with `go run -race` to detect it.

**Fix 1:** Use a mutex for all accesses:

```go
var mu sync.RWMutex
go func() {
    for i := 0; i < 1000; i++ {
        mu.RLock()
        _ = ptr[0]
        mu.RUnlock()
    }
}()
go func() {
    for i := 0; i < 1000; i++ {
        mu.Lock()
        data[0] = byte(i)
        mu.Unlock()
    }
}()
```

**Fix 2:** Make independent copies:

```go
arr := [4]byte(data[:4]) // value copy — no shared memory
```

</details>

---

## Bug 9 🔴 — Conversion of Wrong Sub-slice

```go
package main

import (
    "encoding/binary"
    "fmt"
)

// Parse two uint32 values from offset 4 and 8
func parseTwo(data []byte) (a, b uint32) {
    if len(data) < 12 {
        panic("too short")
    }
    // BUG: both conversions start from the same position!
    arr1 := [4]byte(data[4:8])
    arr2 := [4]byte(data[4:8]) // should be data[8:12]!

    a = binary.BigEndian.Uint32(arr1[:])
    b = binary.BigEndian.Uint32(arr2[:])
    return
}

func main() {
    data := make([]byte, 12)
    binary.BigEndian.PutUint32(data[0:4], 100)
    binary.BigEndian.PutUint32(data[4:8], 200)
    binary.BigEndian.PutUint32(data[8:12], 300)

    a, b := parseTwo(data)
    fmt.Println(a, b) // expected 200 300, got 200 200
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Look at the slice bounds for both conversions. Are they the same?

</details>

<details>
<summary>Solution</summary>

**Bug:** Both `arr1` and `arr2` are converted from `data[4:8]` — the same 4 bytes. The second should be `data[8:12]`.

**Fix:**

```go
func parseTwo(data []byte) (a, b uint32) {
    if len(data) < 12 {
        panic("too short")
    }
    arr1 := [4]byte(data[4:8])   // correct
    arr2 := [4]byte(data[8:12])  // FIXED: different offset

    a = binary.BigEndian.Uint32(arr1[:])
    b = binary.BigEndian.Uint32(arr2[:])
    return
}
```

A related improvement using pointer form with BCE:
```go
_ = data[11] // BCE hint
arr1 := (*[4]byte)(data[4:8])
arr2 := (*[4]byte)(data[8:12])
```

</details>

---

## Bug 10 🔴 — Converting After Pool Return

```go
package main

import (
    "fmt"
    "sync"
)

var pool = sync.Pool{
    New: func() interface{} { return make([]byte, 64) },
}

type Result struct {
    key *[16]byte // points into pooled buffer!
}

func computeResult() Result {
    buf := pool.Get().([]byte)

    // Fill buffer
    for i := range buf[:16] {
        buf[i] = byte(i * 3)
    }

    // Get array pointer
    key := (*[16]byte)(buf[:16])

    // Return buffer to pool — BUG: key still points into buf!
    pool.Put(buf)

    return Result{key: key} // key points to recycled memory!
}

func main() {
    r := computeResult()
    // Another goroutine might have gotten buf from pool by now!
    fmt.Println(r.key[0]) // reads from potentially reused buffer!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

What happens to the pooled buffer after `pool.Put(buf)`? Can another goroutine use it? What does `r.key` point to?

</details>

<details>
<summary>Solution</summary>

**Bug:** `key` is a pointer into `buf`. After `pool.Put(buf)`, any goroutine can call `pool.Get()` and get the same `buf`. Now `key` and the new goroutine's buffer point to the same memory — use after reuse. This is a classic bug in pool-based code.

**Fix:** Copy data out before returning to pool:

```go
func computeResult() Result {
    buf := pool.Get().([]byte)

    for i := range buf[:16] {
        buf[i] = byte(i * 3)
    }

    // Make an independent copy BEFORE returning to pool
    key := [16]byte(buf[:16]) // value copy

    pool.Put(buf) // safe to return — key is independent

    return Result{key: &key} // key is on heap, not in pool
}

// Result using value, not pointer:
type Result struct {
    key [16]byte // value, no pointer into pool
}
```

</details>

---

## Bug 11 🔴 — Off-by-One in Fixed Header Parsing

```go
package main

import (
    "encoding/binary"
    "fmt"
)

// Header format: [4]byte magic, uint16 version, [4]byte checksum
// Total: 10 bytes

func parseHeader(data []byte) (magic [4]byte, version uint16, checksum [4]byte) {
    if len(data) < 10 {
        panic("too short")
    }

    magic    = [4]byte(data[0:4])
    // BUG: version is at bytes 4-5 (uint16 = 2 bytes)
    // checksum should start at byte 6, not 7!
    version  = binary.BigEndian.Uint16(data[4:6])
    checksum = [4]byte(data[7:11]) // BUG: off by one! should be data[6:10]

    return
}

func main() {
    data := make([]byte, 16)
    copy(data[0:4], "GOFL")
    binary.BigEndian.PutUint16(data[4:6], 42)
    copy(data[6:10], []byte{0xDE, 0xAD, 0xBE, 0xEF})

    magic, version, checksum := parseHeader(data)
    fmt.Printf("Magic: %s\n", magic)
    fmt.Printf("Version: %d\n", version)
    fmt.Printf("Checksum: %X\n", checksum)
    // checksum should be DEADBEEF but reads ADBEEF00 due to off-by-one
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Draw out the byte layout: magic at [0:4], version (uint16) at [4:6], checksum at ... ?

</details>

<details>
<summary>Solution</summary>

**Bug:** The checksum is at bytes [6:10], but the code reads `data[7:11]` — off by one. This reads the last byte of checksum at position 10 instead of the correct bytes 6-9.

**Fix:**

```go
func parseHeader(data []byte) (magic [4]byte, version uint16, checksum [4]byte) {
    if len(data) < 10 {
        panic("too short")
    }

    magic    = [4]byte(data[0:4])  // bytes 0-3
    version  = binary.BigEndian.Uint16(data[4:6]) // bytes 4-5
    checksum = [4]byte(data[6:10]) // FIXED: bytes 6-9

    return
}
```

Diagram:
```
Offset: 0    1    2    3    4    5    6    7    8    9
        [magic            ] [ver  ] [checksum         ]
```

</details>

---

## Bug 12 🔴 — Concurrent Map Write with Array Key

```go
package main

import (
    "fmt"
    "sync"
)

// Cache using [16]byte keys
var cache = make(map[[16]byte]string)
var wg sync.WaitGroup

func store(data []byte, value string) {
    if len(data) < 16 { return }
    key := [16]byte(data[:16])
    // BUG: no lock! concurrent writes to map
    cache[key] = value
}

func main() {
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            data := make([]byte, 16)
            data[0] = byte(id)
            store(data, fmt.Sprintf("value-%d", id))
        }(i)
    }
    wg.Wait()
    fmt.Println("Done:", len(cache))
}
```

**What's wrong?**

<details>
<summary>Hint</summary>

Go maps are not goroutine-safe. What happens with concurrent writes?

</details>

<details>
<summary>Solution</summary>

**Bug:** Multiple goroutines write to `cache` concurrently without synchronization. Go's runtime detects this and causes a fatal panic: `concurrent map writes`.

**Fix:** Protect the map with a mutex:

```go
var cache = make(map[[16]byte]string)
var mu sync.RWMutex

func store(data []byte, value string) {
    if len(data) < 16 { return }
    key := [16]byte(data[:16])
    mu.Lock()
    cache[key] = value
    mu.Unlock()
}

func lookup(data []byte) (string, bool) {
    if len(data) < 16 { return "", false }
    key := [16]byte(data[:16])
    mu.RLock()
    v, ok := cache[key]
    mu.RUnlock()
    return v, ok
}
```

Or use `sync.Map` for concurrent-safe access:
```go
var cache sync.Map // key: [16]byte, value: string
```

</details>
