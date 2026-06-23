# Arrays — Find the Bug

## Overview

Each exercise contains a buggy Go program. Identify the bug, understand the expected vs actual behavior, and fix it. Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard.

---

## Bug 1 🟢 — Off-by-One Index

**Title:** Loop accesses one element too many

**What it should do:** Print all 5 elements of the array.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    arr := [5]int{10, 20, 30, 40, 50}
    for i := 0; i <= len(arr); i++ {
        fmt.Println(arr[i])
    }
}
```

**Expected Output:**
```
10
20
30
40
50
```

**Actual Output:**
```
10
20
30
40
50
panic: runtime error: index out of range [5] with length 5
```

<details>
<summary>Hint</summary>
The loop condition uses `<=` instead of `<`. When `i = 5`, `arr[5]` is out of bounds for a `[5]int` array (valid indices are 0–4).
</details>

<details>
<summary>Bug Explanation</summary>
`len(arr)` returns 5. The condition `i <= len(arr)` allows `i` to reach 5. `arr[5]` is past the last valid index (4), causing a runtime panic.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func main() {
    arr := [5]int{10, 20, 30, 40, 50}
    for i := 0; i < len(arr); i++ { // < not <=
        fmt.Println(arr[i])
    }
    // Or better:
    for _, v := range arr {
        fmt.Println(v)
    }
}
```
</details>

---

## Bug 2 🟢 — Modifying a Copy Instead of the Original

**Title:** Function modification doesn't persist after return

**What it should do:** After calling `zero()`, all elements of `data` should be 0.

**Buggy Code:**
```go
package main

import "fmt"

func zero(arr [5]int) {
    for i := range arr {
        arr[i] = 0
    }
}

func main() {
    data := [5]int{1, 2, 3, 4, 5}
    zero(data)
    fmt.Println(data) // expected: [0 0 0 0 0]
}
```

**Expected Output:**
```
[0 0 0 0 0]
```

**Actual Output:**
```
[1 2 3 4 5]
```

<details>
<summary>Hint</summary>
Arrays in Go are value types. `zero(data)` passes a copy of `data`. Changes inside `zero` affect only the copy.
</details>

<details>
<summary>Bug Explanation</summary>
The function signature `zero(arr [5]int)` accepts the array by value. Go copies all 5 elements. Modifying `arr` inside the function has no effect on `data` in `main`.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func zero(arr *[5]int) {  // pointer to array
    for i := range arr {
        arr[i] = 0
    }
}

func main() {
    data := [5]int{1, 2, 3, 4, 5}
    zero(&data)              // pass address
    fmt.Println(data)        // [0 0 0 0 0]
}
```
</details>

---

## Bug 3 🟢 — Nil Comparison on Array

**Title:** Developer checks if array is nil

**What it should do:** Detect uninitialized array and handle gracefully.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    var arr [5]int
    if arr == nil {           // BUG: arrays cannot be nil
        fmt.Println("array is empty")
    } else {
        fmt.Println("array is initialized:", arr)
    }
}
```

**Expected Output:**
```
array is empty
```

**Actual Output:**
```
compile error: cannot compare [5]int to nil
```

<details>
<summary>Hint</summary>
Arrays in Go are never nil. They always have a value — uninitialized arrays are filled with zero values.
</details>

<details>
<summary>Bug Explanation</summary>
Only pointers, slices, maps, channels, functions, and interfaces can be nil. Arrays are value types and are always initialized (to zero values if not explicitly set).
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func main() {
    var arr [5]int
    // Arrays are always initialized — check for zero value instead
    isEmpty := true
    for _, v := range arr {
        if v != 0 {
            isEmpty = false
            break
        }
    }
    if isEmpty {
        fmt.Println("array contains only zero values:", arr)
    }
}
```
</details>

---

## Bug 4 🟢 — Using append on Array

**Title:** Developer tries to append to a fixed-size array

**What it should do:** Add a new element to the collection.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    arr := [3]int{1, 2, 3}
    arr = append(arr, 4)  // BUG
    fmt.Println(arr)
}
```

**Expected Output:**
```
[1 2 3 4]
```

**Actual Output:**
```
compile error: first argument to append must be a slice; have [3]int
```

<details>
<summary>Hint</summary>
`append` is a built-in function that only works on slices. Arrays have a fixed size and cannot grow.
</details>

<details>
<summary>Bug Explanation</summary>
Arrays cannot grow. `append` requires a slice as its first argument. You must either use a slice from the beginning, or convert the array to a slice with `arr[:]` before appending.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func main() {
    // Option 1: Use a slice from the start
    s := []int{1, 2, 3}
    s = append(s, 4)
    fmt.Println(s) // [1 2 3 4]

    // Option 2: Convert array to slice then append
    arr := [3]int{1, 2, 3}
    s2 := arr[:]        // slice referencing the array
    s2 = append(s2, 4)  // new backing array allocated
    fmt.Println(s2)     // [1 2 3 4]
}
```
</details>

---

## Bug 5 🟡 — Range Loop Variable Modification

**Title:** Modifying loop variable doesn't change array

**What it should do:** Double every element in the array.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    nums := [5]int{1, 2, 3, 4, 5}
    for _, v := range nums {
        v *= 2   // BUG: modifying the loop variable
    }
    fmt.Println(nums) // expected: [2 4 6 8 10]
}
```

**Expected Output:**
```
[2 4 6 8 10]
```

**Actual Output:**
```
[1 2 3 4 5]
```

<details>
<summary>Hint</summary>
In `for _, v := range nums`, `v` is a copy of each element. Modifying `v` does not change the array.
</details>

<details>
<summary>Bug Explanation</summary>
The range loop creates a local copy of each element in `v`. Multiplying `v` only changes the local copy. The original array elements are unchanged.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func main() {
    nums := [5]int{1, 2, 3, 4, 5}
    for i := range nums {   // use index to access original
        nums[i] *= 2
    }
    fmt.Println(nums) // [2 4 6 8 10]
}
```
</details>

---

## Bug 6 🟡 — Comparing Arrays of Different Sizes

**Title:** Comparing two integer arrays of different sizes

**What it should do:** Compare two arrays for equality.

**Buggy Code:**
```go
package main

import "fmt"

func equal(a [3]int, b [4]int) bool {
    return a == b   // BUG: different types
}

func main() {
    a := [3]int{1, 2, 3}
    b := [4]int{1, 2, 3, 4}
    fmt.Println(equal(a, b))
}
```

**Expected Output:**
```
false
```

**Actual Output:**
```
compile error: invalid operation: a == b (mismatched types [3]int and [4]int)
```

<details>
<summary>Hint</summary>
`[3]int` and `[4]int` are entirely different types in Go. You cannot compare them with `==`.
</details>

<details>
<summary>Bug Explanation</summary>
In Go, the size is part of the type. `[3]int` and `[4]int` are distinct types. The `==` operator requires both operands to have the same type. There is no implicit conversion.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

// Compare as slices for flexible length comparison
func equalSlices(a, b []int) bool {
    if len(a) != len(b) {
        return false
    }
    for i := range a {
        if a[i] != b[i] {
            return false
        }
    }
    return true
}

func main() {
    a := [3]int{1, 2, 3}
    b := [4]int{1, 2, 3, 4}
    fmt.Println(equalSlices(a[:], b[:])) // false
}
```
</details>

---

## Bug 7 🟡 — Shared Slice Modification Surprise

**Title:** Modifying a slice affects the source array unexpectedly

**What it should do:** Create a "copy" of the first 3 elements and double them without affecting the original.

**Buggy Code:**
```go
package main

import "fmt"

func main() {
    original := [5]int{1, 2, 3, 4, 5}
    copy := original[:3]   // BUG: this is NOT a copy, it's a view
    for i := range copy {
        copy[i] *= 2
    }
    fmt.Println("original:", original) // expected: [1 2 3 4 5]
    fmt.Println("copy:    ", copy)     // expected: [2 4 6]
}
```

**Expected Output:**
```
original: [1 2 3 4 5]
copy:     [2 4 6]
```

**Actual Output:**
```
original: [2 4 6 4 5]
copy:     [2 4 6]
```

<details>
<summary>Hint</summary>
`original[:3]` creates a slice that shares the underlying array with `original`. It is not an independent copy.
</details>

<details>
<summary>Bug Explanation</summary>
A slice expression like `original[:3]` does not copy the data. It creates a slice header pointing to the same memory as `original`. Modifications through the slice change the original array.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func main() {
    original := [5]int{1, 2, 3, 4, 5}

    // True copy: use a new array or slice with copy()
    var copyArr [3]int
    copy(copyArr[:], original[:3])  // copy() copies elements

    for i := range copyArr {
        copyArr[i] *= 2
    }
    fmt.Println("original:", original) // [1 2 3 4 5] — unchanged
    fmt.Println("copy:    ", copyArr)  // [2 4 6]
}
```
</details>

---

## Bug 8 🟡 — Wrong Initial Value for Maximum Finding

**Title:** Maximum finding algorithm returns wrong result

**What it should do:** Find the maximum value in an array that contains negative numbers.

**Buggy Code:**
```go
package main

import "fmt"

func findMax(arr [5]int) int {
    max := 0   // BUG: initial value of 0 is wrong for negative arrays
    for _, v := range arr {
        if v > max {
            max = v
        }
    }
    return max
}

func main() {
    scores := [5]int{-5, -3, -10, -1, -7}
    fmt.Println("Max:", findMax(scores)) // expected: -1
}
```

**Expected Output:**
```
Max: -1
```

**Actual Output:**
```
Max: 0
```

<details>
<summary>Hint</summary>
Initializing `max` to `0` means any negative value will never replace it. Initialize `max` to the first element of the array.
</details>

<details>
<summary>Bug Explanation</summary>
When all values are negative, no value is greater than `0`. The function returns `0` instead of the actual maximum element `-1`.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import "fmt"

func findMax(arr [5]int) int {
    max := arr[0]  // start with first element
    for _, v := range arr[1:] {
        if v > max {
            max = v
        }
    }
    return max
}

func main() {
    scores := [5]int{-5, -3, -10, -1, -7}
    fmt.Println("Max:", findMax(scores)) // -1
}
```
</details>

---

## Bug 9 🔴 — Non-Constant-Time Comparison Timing Attack

**Title:** HMAC verification is vulnerable to timing attacks

**What it should do:** Securely verify that two 32-byte HMAC values match.

**Buggy Code:**
```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "fmt"
)

func verifyHMAC(provided, expected [32]byte) bool {
    return provided == expected  // BUG: timing-vulnerable comparison
}

func main() {
    key := []byte("secret-key")
    msg := []byte("hello")
    mac := hmac.New(sha256.New, key)
    mac.Write(msg)
    var expected [32]byte
    copy(expected[:], mac.Sum(nil))

    var provided [32]byte
    copy(provided[:], mac.Sum(nil))

    fmt.Println(verifyHMAC(provided, expected)) // true
}
```

**Expected Behavior:** Comparison takes the same time regardless of where the mismatch occurs.

**Actual Behavior:** The `==` operator short-circuits on the first differing byte, leaking timing information.

<details>
<summary>Hint</summary>
An attacker can measure response times to learn how many bytes of their guess match the secret. Use `crypto/subtle.ConstantTimeCompare` instead.
</details>

<details>
<summary>Bug Explanation</summary>
Go's `==` on arrays performs element-by-element comparison and stops at the first mismatch. If an attacker submits tokens and measures how long verification takes, they can learn how many leading bytes match the real secret, reconstructing it byte by byte (a timing oracle attack).
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "crypto/subtle"
    "fmt"
)

func verifyHMAC(provided, expected [32]byte) bool {
    // Always compares all 32 bytes regardless of where mismatch occurs
    return subtle.ConstantTimeCompare(provided[:], expected[:]) == 1
}

func main() {
    key := []byte("secret-key")
    msg := []byte("hello")
    mac := hmac.New(sha256.New, key)
    mac.Write(msg)
    var expected [32]byte
    copy(expected[:], mac.Sum(nil))
    var provided [32]byte
    copy(provided[:], mac.Sum(nil))
    fmt.Println(verifyHMAC(provided, expected)) // true
}
```
</details>

---

## Bug 10 🔴 — False Sharing in Concurrent Array Access

**Title:** Parallel counter array shows no throughput gain with more cores

**What it should do:** 8 goroutines increment their respective counters in parallel with linear scaling.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

type Counters struct {
    vals [8]int64  // BUG: 8 * 8 = 64 bytes = 1 cache line
}

func main() {
    c := Counters{}
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for n := 0; n < 1000000; n++ {
                atomic.AddInt64(&c.vals[idx], 1)
            }
        }(i)
    }
    wg.Wait()
    var total int64
    for _, v := range c.vals {
        total += v
    }
    fmt.Println("Total:", total) // 8000000 — correct but SLOW
}
```

**Expected Behavior:** Near-linear throughput scaling with 8 goroutines.

**Actual Behavior:** Little to no throughput improvement — all goroutines contend on the same cache line.

<details>
<summary>Hint</summary>
The 8 `int64` values fit exactly in one 64-byte cache line. Every atomic write by any goroutine forces all other CPUs to invalidate their cache line copy, causing massive cache coherence overhead.
</details>

<details>
<summary>Bug Explanation</summary>
CPU cache coherence protocols require that when one core writes to a cache line, all other cores holding that line must invalidate their copies. Even though goroutines touch different elements, they share a cache line, causing false sharing. Each write triggers a cross-CPU invalidation cycle.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

// Pad each counter to its own 64-byte cache line
type paddedInt64 struct {
    val int64
    _   [56]byte // 64 - 8 = 56 bytes padding
}

type Counters struct {
    vals [8]paddedInt64 // each on its own cache line
}

func main() {
    c := Counters{}
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            for n := 0; n < 1000000; n++ {
                atomic.AddInt64(&c.vals[idx].val, 1)
            }
        }(i)
    }
    wg.Wait()
    var total int64
    for _, v := range c.vals {
        total += v.val
    }
    fmt.Println("Total:", total) // 8000000 — now scales properly
}
```
</details>

---

## Bug 11 🔴 — Stack Overflow from Large Stack-Allocated Array

**Title:** Large array declaration inside HTTP handler causes crashes under load

**What it should do:** Handle HTTP requests with a temporary buffer.

**Buggy Code:**
```go
package main

import (
    "fmt"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    var buf [4 * 1024 * 1024]byte  // BUG: 4MB on goroutine stack
    n, _ := r.Body.Read(buf[:])
    fmt.Fprintf(w, "Read %d bytes", n)
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

**Expected Behavior:** Handles concurrent requests without crashing.

**Actual Behavior:** Under load with many concurrent requests, goroutines crash with stack overflow.

<details>
<summary>Hint</summary>
Go goroutine stacks start at 8KB. Declaring a 4MB array at function entry forces the goroutine to grow its stack by 4MB immediately. Under high concurrency, this exhausts available memory.
</details>

<details>
<summary>Bug Explanation</summary>
Each goroutine serving a request declares a 4MB array on its stack. With 100 concurrent requests, this requires 400MB of stack space just for buffers. This leads to stack growth panics or out-of-memory crashes. Additionally, each request wastes memory even for tiny bodies.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
)

// Reuse buffers across requests
var bufPool = sync.Pool{
    New: func() interface{} {
        buf := make([]byte, 4*1024*1024)
        return &buf
    },
}

func handler(w http.ResponseWriter, r *http.Request) {
    bufPtr := bufPool.Get().(*[]byte)
    defer bufPool.Put(bufPtr)
    buf := *bufPtr

    n, _ := r.Body.Read(buf)
    fmt.Fprintf(w, "Read %d bytes", n)
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```
</details>

---

## Bug 12 🔴 — Incorrect Array Index with Computed Offset

**Title:** Computed index causes panic when input is near boundary

**What it should do:** Look up a value using a computed index safely.

**Buggy Code:**
```go
package main

import "fmt"

var table = [10]string{
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine",
}

func lookup(n int) string {
    // BUG: no bounds check — if n < 0 or n >= 10, panics
    return table[n]
}

func main() {
    fmt.Println(lookup(5))   // "five"
    fmt.Println(lookup(-1))  // panic!
    fmt.Println(lookup(10))  // panic!
}
```

**Expected Output:**
```
five
invalid index: -1
invalid index: 10
```

**Actual Output:**
```
five
panic: runtime error: index out of range [-1] with length 10
```

<details>
<summary>Hint</summary>
User-supplied or computed indices must be validated before use. Go does not automatically return an error for out-of-bounds access — it panics.
</details>

<details>
<summary>Bug Explanation</summary>
The function `lookup` uses the parameter `n` directly as an array index without validating it. When `n` is negative or >= 10, Go panics at runtime. This is a common security issue when indices come from untrusted input.
</details>

<details>
<summary>Fixed Code</summary>

```go
package main

import (
    "fmt"
)

var table = [10]string{
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine",
}

func lookup(n int) (string, error) {
    if n < 0 || n >= len(table) {
        return "", fmt.Errorf("invalid index: %d", n)
    }
    return table[n], nil
}

func main() {
    if v, err := lookup(5); err == nil {
        fmt.Println(v)
    }
    if _, err := lookup(-1); err != nil {
        fmt.Println(err)
    }
    if _, err := lookup(10); err != nil {
        fmt.Println(err)
    }
}
```
</details>
