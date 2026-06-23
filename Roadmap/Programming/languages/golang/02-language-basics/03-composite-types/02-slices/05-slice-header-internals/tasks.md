# Slice Header Internals — Hands-on Tasks

Work through these in order. Each task has explicit acceptance criteria. You'll need Go 1.21+ and a willingness to read assembly for the later ones.

---

## Task 1: Inspect a slice header through `unsafe`

Prove to yourself that a slice header is three words by reading them directly.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{10, 20, 30, 40, 50}
    hdr := (*[3]uintptr)(unsafe.Pointer(&s))
    fmt.Printf("Data: 0x%x\nLen:  %d\nCap:  %d\n", hdr[0], hdr[1], hdr[2])
    fmt.Println("Size of header:", unsafe.Sizeof(s))
}
```

**Acceptance criteria**
- [ ] Output shows `Data` as a non-zero hex address.
- [ ] `Len` and `Cap` match `len(s)` and `cap(s)`.
- [ ] `unsafe.Sizeof(s)` is 24 (on 64-bit) or 12 (on 32-bit).
- [ ] Confirm the address `Data` equals `&s[0]`: `fmt.Printf("%p %p\n", unsafe.Pointer(uintptr(hdr[0])), &s[0])`.

---

## Task 2: Prove aliasing

Construct two slices that share a backing array and demonstrate mutation through one is visible through the other.

```go
package main

import "fmt"

func main() {
    arr := [...]int{1, 2, 3, 4, 5}
    a := arr[:]
    b := arr[2:]
    a[3] = 999
    fmt.Println("a:", a) // expect [1 2 3 999 5]
    fmt.Println("b:", b) // expect [3 999 5]
}
```

**Acceptance criteria**
- [ ] After mutating `a[3]`, the change is visible at `b[1]`.
- [ ] Add code that prints `&a[3]` and `&b[1]`; verify they're the same address.
- [ ] Repeat the experiment with `a := arr[:]; b := append(a[:3:3], 99)`. Now `b` should *not* alias `a`. Confirm.

---

## Task 3: Demonstrate that header copy is by value

```go
package main

import "fmt"

func reslice(s []int) {
    s = s[:1] // local s; doesn't affect caller
}

func mutate(s []int) {
    s[0] = 999 // affects caller — same backing array
}

func main() {
    s := []int{1, 2, 3}
    reslice(s)
    fmt.Println(s) // expect [1 2 3]
    mutate(s)
    fmt.Println(s) // expect [999 2 3]
}
```

**Acceptance criteria**
- [ ] `reslice` produces no observable change in `main`.
- [ ] `mutate` does produce a change.
- [ ] Add a `replace` function that does `s = []int{9, 9, 9}` — confirm it also has no observable effect.

---

## Task 4: Build a slice without `make`

Use `unsafe.Slice` to construct a slice from a raw pointer. (Use a Go-allocated array as the source so the GC is happy.)

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var arr [10]int
    for i := range arr { arr[i] = i * i }

    // Build a []int of length 5 starting at arr[3]
    s := unsafe.Slice(&arr[3], 5)
    fmt.Println(s) // [9 16 25 36 49]

    // Confirm aliasing
    s[0] = -1
    fmt.Println(arr[3]) // -1
}
```

**Acceptance criteria**
- [ ] The constructed slice contains the expected elements (squares 9..49).
- [ ] Mutating the slice mutates the source array (proves aliasing, not copy).
- [ ] Try `unsafe.Slice(&arr[3], 100)` — observe that Go allows it but accessing beyond `arr`'s bounds is undefined behaviour. Document the result.

---

## Task 5: Three-index slicing for safety

Write a function that returns the first half of a slice but prevents the caller from `append`-ing into the second half.

```go
package main

import "fmt"

func firstHalf(s []int) []int {
    n := len(s) / 2
    return s[:n:n] // bound cap to n
}

func main() {
    s := []int{1, 2, 3, 4, 5, 6}
    h := firstHalf(s)
    h = append(h, 999)
    fmt.Println("original:", s) // expect [1 2 3 4 5 6] — unchanged
    fmt.Println("h:", h)        // [1 2 3 999]
}
```

**Acceptance criteria**
- [ ] After the `append`, the original slice is unchanged.
- [ ] Compare with a version that uses `return s[:n]` (no third index) — confirm that the caller's `append` then overwrites `s[3]`.
- [ ] Print `&s[3]` and `&h[3]` (before and after the append in both variants) to see when they're the same address.

---

## Task 6: Demonstrate the retention bug

Show that a small slice retained from a large array prevents GC.

```go
package main

import (
    "fmt"
    "runtime"
)

func smallHeader(big []byte) []byte {
    return big[:8]
}

func main() {
    big := make([]byte, 100<<20) // 100 MiB
    var m runtime.MemStats
    runtime.GC(); runtime.ReadMemStats(&m)
    fmt.Println("After alloc:", m.HeapInuse>>20, "MiB")

    small := smallHeader(big)
    big = nil
    runtime.GC(); runtime.ReadMemStats(&m)
    fmt.Println("After 'release':", m.HeapInuse>>20, "MiB") // still ~100 MiB!
    _ = small
}
```

Then add a clone version:

```go
import "slices"
// inside main, replace the smallHeader call with:
small := slices.Clone(smallHeader(big))
```

**Acceptance criteria**
- [ ] First version: `HeapInuse` after the second GC is still ~100 MiB.
- [ ] Cloned version: `HeapInuse` after the second GC drops to ~0 MiB.
- [ ] Document the line of code that made the difference.

---

## Task 7: Measure `append` growth empirically

Write a benchmark or program that prints `cap(s)` after each `append` from 0 to 2000 elements. Observe the growth steps.

```go
package main

import "fmt"

func main() {
    var s []int
    prev := 0
    for i := 0; i < 2000; i++ {
        s = append(s, i)
        if cap(s) != prev {
            fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
            prev = cap(s)
        }
    }
}
```

**Acceptance criteria**
- [ ] Output shows the growth steps (e.g., 1, 2, 4, 8, 16, 32, ...).
- [ ] Identify where the doubling slows down (around cap ~256 on Go 1.18+).
- [ ] Compare with `make([]int, 0, 2000)` — should show only the initial allocation.

---

## Task 8: Prove the typed-nil interface bug

```go
package main

import "fmt"

func returnsErrorButShouldnt() error {
    var s []int
    if false {
        s = []int{1}
    }
    return wrapSlice(s)
}

func wrapSlice(s []int) error {
    if s == nil {
        return nil
    }
    return &sliceError{s}
}

type sliceError struct{ s []int }
func (e *sliceError) Error() string { return fmt.Sprint(e.s) }

func main() {
    err := returnsErrorButShouldnt()
    fmt.Println(err == nil) // true — good
}
```

Now break it: return a typed-nil:

```go
func bad() error {
    var s *sliceError = nil
    return s // typed nil!
}

func main() {
    err := bad()
    fmt.Println(err == nil) // false — surprise!
}
```

**Acceptance criteria**
- [ ] First version returns `true` for `err == nil`.
- [ ] Second version returns `false`.
- [ ] Document the rule: returning a typed-nil pointer to a struct that satisfies an interface produces a non-nil interface.

---

## Task 9: Verify the cost of `len` is constant

Write a benchmark that confirms `len(s)` does not get slower as `s` grows.

```go
package main

import "testing"

func BenchmarkLen100(b *testing.B) {
    s := make([]int, 100)
    for i := 0; i < b.N; i++ {
        _ = len(s)
    }
}

func BenchmarkLen1M(b *testing.B) {
    s := make([]int, 1_000_000)
    for i := 0; i < b.N; i++ {
        _ = len(s)
    }
}
```

**Acceptance criteria**
- [ ] Both benchmarks report similar ns/op (within a factor of 2; they should be near-zero, dominated by loop overhead).
- [ ] Output `go test -bench=. -benchmem` and verify zero allocations.
- [ ] Generate assembly with `go test -bench=. -gcflags="-S" 2>&1 | grep -A 5 BenchmarkLen100` — find the `MOVQ` instruction that loads `Len`.

---

## Task 10: Convert slice to array (Go 1.17 / 1.20)

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4}

    // Go 1.17+: slice to *[N]T (aliases)
    p := (*[4]int)(s)
    p[0] = 999
    fmt.Println(s[0]) // 999 — aliased

    // Go 1.20+: slice to [N]T (copies)
    a := [4]int(s)
    a[0] = -1
    fmt.Println(s[0]) // 999 — not affected by a
}
```

**Acceptance criteria**
- [ ] Mutating `p[0]` mutates `s[0]` (proves aliasing).
- [ ] Mutating `a[0]` does NOT mutate `s[0]` (proves copy).
- [ ] Try `(*[5]int)(s)` with the same `s` of length 4 — observe the panic.

---

## Task 11: Build a defensive copy helper

Write a generic clone that never aliases its source.

```go
package main

import (
    "fmt"
    "slices"
)

func clone[T any](s []T) []T {
    return slices.Clone(s)
}

func main() {
    a := []int{1, 2, 3}
    b := clone(a)
    b[0] = 999
    fmt.Println(a) // [1 2 3]
    fmt.Println(b) // [999 2 3]
}
```

**Acceptance criteria**
- [ ] Mutations to `b` do not affect `a`.
- [ ] Use `unsafe.SliceData(a) != unsafe.SliceData(b)` to assert distinct backing arrays.
- [ ] Confirm `cap(b) == len(b)` (clone produces tight slice).

---

## Task 12: Demonstrate nil vs empty slice differences

```go
package main

import (
    "encoding/json"
    "fmt"
    "reflect"
)

func main() {
    var a []int
    b := []int{}

    fmt.Println("a == nil:", a == nil) // true
    fmt.Println("b == nil:", b == nil) // false

    fmt.Println("DeepEqual:", reflect.DeepEqual(a, b)) // false

    aj, _ := json.Marshal(a)
    bj, _ := json.Marshal(b)
    fmt.Println("a JSON:", string(aj)) // null
    fmt.Println("b JSON:", string(bj)) // []

    // both safe for append/range/len
    a = append(a, 1)
    b = append(b, 1)
    fmt.Println(len(a), len(b)) // 1 1
}
```

**Acceptance criteria**
- [ ] `a == nil` is true; `b == nil` is false.
- [ ] `reflect.DeepEqual(a, b)` is false.
- [ ] JSON outputs are `null` and `[]` respectively.
- [ ] Both can be safely `append`ed and ranged.

---

## What you've learned

After completing these 12 tasks you should be able to:

- Read a slice header byte-by-byte and predict what each field is.
- Distinguish header-by-value from array-by-reference in practical scenarios.
- Spot aliasing bugs and the retention bug in real code.
- Use three-index slicing to protect a backing array from caller mutation.
- Distinguish `nil`, empty, and typed-nil-interface cases with confidence.
- Build a slice without `make`, using `unsafe.Slice`.

---

## Further reading
- `unsafe.Slice` — https://pkg.go.dev/unsafe#Slice
- `slices.Clone` — https://pkg.go.dev/slices#Clone
- Go blog: "Go Slices: usage and internals" — https://go.dev/blog/slices-intro
