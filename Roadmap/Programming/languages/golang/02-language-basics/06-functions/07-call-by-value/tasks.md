# Go Call by Value — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use pointers when mutation is needed; values for read-only.

---

## Task 1 — Mutate via Pointer

**Difficulty**: Beginner
**Topic**: Pointer parameter for mutation

**Description**: Implement `incrementBy(p *int, by int)` that adds `by` to `*p`.

**Starter Code**:
```go
package main

import "fmt"

func incrementBy(p *int, by int) {
    // TODO
}

func main() {
    n := 10
    incrementBy(&n, 5)
    fmt.Println(n) // 15
}
```

**Expected Output**:
```
15
```

**Evaluation Checklist**:
- [ ] Takes `*int` parameter
- [ ] Dereferences with `*p += by`
- [ ] Caller passes `&n`
- [ ] Caller's variable is mutated

---

## Task 2 — Slice Element Mutation

**Difficulty**: Beginner
**Topic**: Slice header copied; data shared

**Description**: Implement `negateAll(s []int)` that negates every element of `s`. The caller's slice should reflect the changes.

**Starter Code**:
```go
package main

import "fmt"

func negateAll(s []int) {
    // TODO
}

func main() {
    s := []int{1, -2, 3, -4}
    negateAll(s)
    fmt.Println(s) // [-1 2 -3 4]
}
```

**Expected Output**:
```
[-1 2 -3 4]
```

**Evaluation Checklist**:
- [ ] Takes `[]int` (not `*[]int`)
- [ ] Modifies elements via index
- [ ] Caller sees the negation
- [ ] Works for empty slice (no panic)

---

## Task 3 — Slice Reassignment Doesn't Propagate

**Difficulty**: Beginner
**Topic**: Local header reassignment

**Description**: Show that `s = nil` inside a function doesn't affect the caller's slice. Print before and after.

**Starter Code**:
```go
package main

import "fmt"

func tryClear(s []int) {
    // TODO: try to set s to nil
}

func main() {
    s := []int{1, 2, 3}
    fmt.Println("before:", s)
    tryClear(s)
    fmt.Println("after:", s) // unchanged
}
```

**Expected Output**:
```
before: [1 2 3]
after: [1 2 3]
```

**Evaluation Checklist**:
- [ ] `tryClear` reassigns `s = nil`
- [ ] Caller's slice is unchanged
- [ ] Output documents the surprise

---

## Task 4 — Return Modified Slice

**Difficulty**: Beginner
**Topic**: Returning a new slice for "reassignment"

**Description**: Implement `addAndReturn(s []int, v int) []int` that returns `s` with `v` appended. Caller assigns the result.

**Starter Code**:
```go
package main

import "fmt"

func addAndReturn(s []int, v int) []int {
    // TODO
    return nil
}

func main() {
    s := []int{1, 2, 3}
    s = addAndReturn(s, 99)
    fmt.Println(s) // [1 2 3 99]
}
```

**Expected Output**:
```
[1 2 3 99]
```

**Evaluation Checklist**:
- [ ] Returns the new slice
- [ ] Caller reassigns: `s = addAndReturn(s, v)`
- [ ] Uses `append`

---

## Task 5 — Map Mutation

**Difficulty**: Beginner
**Topic**: Map handle copied; data shared

**Description**: Implement `setIfAbsent(m map[string]int, k string, v int)` that sets `m[k] = v` only if `k` is not already present.

**Starter Code**:
```go
package main

import "fmt"

func setIfAbsent(m map[string]int, k string, v int) {
    // TODO
}

func main() {
    m := map[string]int{"a": 1}
    setIfAbsent(m, "a", 99) // no change
    setIfAbsent(m, "b", 2)
    fmt.Println(m) // map[a:1 b:2]
}
```

**Expected Output**:
```
map[a:1 b:2]
```

**Evaluation Checklist**:
- [ ] Uses comma-ok to check existence
- [ ] Sets only when absent
- [ ] Caller sees the new key
- [ ] Existing keys unchanged

---

## Task 6 — Defensive Copy on Set

**Difficulty**: Intermediate
**Topic**: Aliasing prevention via copy

**Description**: Implement `Cache` with a `Set(items []int)` method that defensively copies the input. Verify caller-side mutation doesn't affect the cache.

**Starter Code**:
```go
package main

import "fmt"

type Cache struct {
    items []int
}

func (c *Cache) Set(items []int) {
    // TODO: copy items
}

func main() {
    c := &Cache{}
    src := []int{1, 2, 3}
    c.Set(src)
    src[0] = 99
    fmt.Println("src:", src)        // [99 2 3]
    fmt.Println("cache:", c.items)  // [1 2 3]
}
```

**Expected Output**:
```
src: [99 2 3]
cache: [1 2 3]
```

**Evaluation Checklist**:
- [ ] Uses `append([]int(nil), items...)` or equivalent
- [ ] Cache items independent of caller's slice
- [ ] Caller can mutate src without affecting cache

---

## Task 7 — Pointer Receiver Mutation

**Difficulty**: Intermediate
**Topic**: Method receiver semantics

**Description**: Implement `Counter` with `Inc()` (pointer receiver) and `Get() int` (pointer receiver). Verify mutations persist.

**Starter Code**:
```go
package main

import "fmt"

type Counter struct {
    n int
}

// TODO: Inc method
// TODO: Get method

func main() {
    c := &Counter{}
    c.Inc(); c.Inc(); c.Inc()
    fmt.Println(c.Get()) // 3
}
```

**Expected Output**:
```
3
```

**Evaluation Checklist**:
- [ ] `Inc` uses pointer receiver `*Counter`
- [ ] `Get` uses pointer receiver `*Counter` (consistent)
- [ ] Mutations persist across calls
- [ ] Counter starts at 0, ends at 3

---

## Task 8 — Functional Update (No Mutation)

**Difficulty**: Intermediate
**Topic**: Returning a modified value

**Description**: Implement `Config` with a `WithAddr(addr string) Config` method that returns a new config with `addr` set, without mutating the receiver.

**Starter Code**:
```go
package main

import "fmt"

type Config struct {
    Addr string
    Port int
}

func (c Config) WithAddr(addr string) Config {
    // TODO
    return c
}

func main() {
    c := Config{Addr: "localhost", Port: 8080}
    c2 := c.WithAddr("0.0.0.0")
    fmt.Println(c)  // {localhost 8080}
    fmt.Println(c2) // {0.0.0.0 8080}
}
```

**Expected Output**:
```
{localhost 8080}
{0.0.0.0 8080}
```

**Evaluation Checklist**:
- [ ] Value receiver
- [ ] Returns a NEW Config with modified Addr
- [ ] Original c is unchanged
- [ ] Demonstrates immutability pattern

---

## Task 9 — Slice via Pointer-to-Slice

**Difficulty**: Advanced
**Topic**: `*[]T` for header reassignment

**Description**: Implement `clearSlice(sp *[]int)` that sets the caller's slice to nil. Verify by checking the caller's slice afterward.

**Starter Code**:
```go
package main

import "fmt"

func clearSlice(sp *[]int) {
    // TODO
}

func main() {
    s := []int{1, 2, 3}
    fmt.Println("before:", s)
    clearSlice(&s)
    fmt.Println("after:", s, "nil?", s == nil)
}
```

**Expected Output**:
```
before: [1 2 3]
after: [] nil? true
```

**Evaluation Checklist**:
- [ ] Takes `*[]int`
- [ ] Dereferences to assign: `*sp = nil`
- [ ] Caller's slice is now nil
- [ ] Reflects how to truly "clear" a caller's slice

---

## Task 10 — Big Struct: Pointer for Performance

**Difficulty**: Advanced
**Topic**: Avoiding large value copies

**Description**: Define a 1 KB struct. Write two functions: `processVal(s State)` (value pass) and `processPtr(s *State)` (pointer pass). Benchmark them and compare.

**Starter Code**:
```go
package main

import (
    "fmt"
    "testing"
)

type State struct {
    Buffer [1024]byte
}

func processVal(s State) byte {
    return s.Buffer[0]
}

func processPtr(s *State) byte {
    return s.Buffer[0]
}

func main() {
    var s State
    fmt.Println("Run with: go test -bench=.")
    _ = processVal(s)
    _ = processPtr(&s)
}

func BenchmarkVal(b *testing.B) {
    var s State
    for i := 0; i < b.N; i++ {
        _ = processVal(s)
    }
}

func BenchmarkPtr(b *testing.B) {
    var s State
    for i := 0; i < b.N; i++ {
        _ = processPtr(&s)
    }
}
```

**Expected Behavior**:
- `BenchmarkVal` shows ~50-200 ns/op (depends on cache, ABI).
- `BenchmarkPtr` shows ~1 ns/op (pointer pass).

**Evaluation Checklist**:
- [ ] Demonstrates the cost difference
- [ ] Both functions work correctly
- [ ] Benchmark shows pointer is faster for large struct
- [ ] Document conclusion: use pointer for big structs in hot paths

---

## Bonus Task — Slice Aliasing Demo

**Difficulty**: Advanced
**Topic**: Subslice aliasing

**Description**: Show that a sub-slice shares backing with its parent, and modifications through one are visible through the other.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    a := []int{1, 2, 3, 4, 5}
    b := a[1:4]  // b shares array with a
    
    b[0] = 999
    fmt.Println("a:", a)
    fmt.Println("b:", b)
    
    // What if b grows beyond its cap?
    b = append(b, 99)
    fmt.Println("a after b grows:", a)
}
```

**Expected Output** (cap of `b` = 4 since it's `a[1:4]` with `a`'s cap 5; appending 1 element fits):
```
a: [1 999 3 4 5]
b: [999 3 4]
a after b grows: [1 999 3 4 99]
```

The append wrote past `b`'s length but within shared backing — `a[4]` is now 99.

**Evaluation Checklist**:
- [ ] Demonstrates element-mutation aliasing
- [ ] Demonstrates append-within-cap aliasing
- [ ] Comments explain WHY this happens
- [ ] Documents the surprise for future readers
