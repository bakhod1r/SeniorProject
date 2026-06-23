# for-range over Maps — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §For_range (map iteration)

---

## 1. Spec Reference

Map iteration via `for-range` is governed by the Go Language Specification at:

https://go.dev/ref/spec#For_range

The specification explicitly and deliberately leaves map iteration order unspecified. The relevant spec text states:

> "The iteration order over maps is not specified and is not guaranteed to be the same from one iteration to the next. If a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced. If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped. The choice may vary for each entry created and from one iteration to the next. If the map is nil, the number of iterations is 0."

This is one of the most important behavioral guarantees in the Go spec — the deliberate randomization of map iteration is a language-level contract, not an implementation detail.

---

## 2. Formal Grammar

```ebnf
ForStmt     = "for" [ Condition | ForClause | RangeClause ] Block .
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

For map iteration specifically:

```go
// All valid forms for map[K]V
for k, v := range m { }   // key and value (both new variables)
for k, v = range m { }    // key and value (both existing variables)
for k := range m { }      // key only
for k = range m { }       // key only (existing variable)
for range m { }           // neither (count or side-effects only)
for _, v := range m { }   // value only (discard key)
```

The range expression `m` must be of type `map[K]V`. The first iteration variable receives type `K`; the second receives type `V`.

---

## 3. Core Rules & Constraints

1. **Iteration order is never guaranteed.** The spec explicitly states it is not specified and not consistent between runs.
2. **Randomization is intentional.** The Go runtime has randomized map iteration since Go 1.0, specifically to prevent programs from accidentally depending on a particular order.
3. **Nil map range is safe.** Ranging over a nil map produces zero iterations — no panic.
4. **Deleting during iteration is safe.** Keys removed before being visited will not appear in subsequent iterations.
5. **Adding during iteration is indeterminate.** New keys added during iteration may or may not be visited — this is explicitly left unspecified.
6. **Concurrent access is a data race.** Reading and writing a map from multiple goroutines without synchronization is undefined behavior, detected by the Go race detector.
7. **Range evaluates the map expression once.** If you reassign the variable holding the map, iteration continues over the original map.
8. **Value is a copy.** `v` in `for k, v := range m` is a copy of `m[k]`. Modifying `v` does not change the map.
9. **Key is a copy.** `k` is also a copy of the key — for pointer or reference types, modifying the pointed-to value through `k` would affect the map's associated key, but reassigning `k` itself does not.

---

## 4. Type Rules

### Map type constraints for range

The map type `map[K]V` requires:
- `K` must be a **comparable** type (can be used as map key)
- `V` can be any type

Valid key types: `bool`, `int` (and variants), `float32`, `float64`, `complex64`, `complex128`, `string`, pointers, channel types, interface types, array types (if element is comparable), struct types (if all fields are comparable).

Invalid key types: `slice`, `map`, `func` (not comparable).

### Iteration variable types

```go
var m map[string][]int
for k, v := range m {
    // k is string
    // v is []int (a copy of the slice header — same underlying array)
}
```

Important: when `V` is a slice, map, or pointer, `v` is a shallow copy. Modifying `v`'s elements modifies the original data.

---

## 5. Behavioral Specification

### Randomized iteration order

The Go runtime randomizes map iteration by:
1. Choosing a random starting bucket.
2. Choosing a random starting offset within that bucket.
3. Traversing remaining buckets in a wrapping order from that point.

This means:

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}

// Run 1 might print: a b c
// Run 2 might print: c a b
// Run 3 might print: b c a
// All are valid and expected
for k := range m {
    fmt.Println(k)
}
```

**The randomization is seeded per map iteration start.** Even within a single program run, two consecutive range loops over the same map may produce different orders.

### Deletion during iteration

Per the spec: "if a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced."

```go
m := map[int]string{1: "a", 2: "b", 3: "c", 4: "d"}
for k := range m {
    if k%2 == 0 {
        delete(m, k) // safe to delete current or future keys
    }
}
// Result: only odd keys remain (but we may have visited even keys before deleting them)
```

The current key being iterated is always safe to delete. Future unvisited keys will not appear if deleted.

### Addition during iteration

Per the spec: "If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped."

```go
m := map[int]int{1: 1}
for k, v := range m {
    if k < 5 {
        m[k+1] = v + 1 // new keys may or may not be visited
    }
}
// Final map could be {1:1, 2:2} or {1:1, 2:2, 3:3, ...} depending on runtime
// Do NOT rely on specific behavior here
```

### Nil map

```go
var m map[string]int // nil map
for k, v := range m {
    // this block never executes
    _ = k
    _ = v
}
// No panic, zero iterations
```

### Concurrent map access

```go
// THIS IS UNSAFE — data race:
m := make(map[string]int)
go func() {
    for range m { } // read
}()
go func() {
    m["x"] = 1     // write
}()
// The Go runtime detects concurrent map read/write and panics:
// "concurrent map read and map write"
// or "concurrent map iteration and map write"
```

Use `sync.RWMutex` or `sync.Map` for concurrent map access.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Range over nil map | Defined — zero iterations, no panic |
| Range over empty map | Defined — zero iterations |
| Delete current key during range | Defined — safe |
| Delete not-yet-visited key during range | Defined — that key is not produced |
| Delete already-visited key during range | Defined — has no effect on iteration |
| Add new key during range | **Indeterminate** — may or may not be visited |
| Concurrent write while ranging | **Undefined** — data race, runtime panic |
| Concurrent read while ranging | Defined (reads are safe without writes) |
| Modify value `v` from range | Defined — only affects local copy |
| Modify map value via `m[k] = ...` during range | Defined — new value visible to subsequent code |
| Reassign map variable `m = otherMap` during range | Defined — range continues over original map |

---

## 7. Edge Cases from Spec

### Shallow copy of value

```go
type Node struct{ Val int }
m := map[string]*Node{"a": {Val: 1}}

for k, v := range m {
    v.Val = 99 // modifies the Node that m["a"] points to
    _ = k
}
fmt.Println(m["a"].Val) // 99 — pointer copy still points to same Node
```

But:

```go
for k, v := range m {
    v = &Node{Val: 999} // only reassigns local v, does NOT change m[k]
    _ = k
}
fmt.Println(m["a"].Val) // still 99
```

### Deterministic order requires explicit sorting

```go
import "sort"

m := map[string]int{"banana": 2, "apple": 5, "cherry": 3}

keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)

for _, k := range keys {
    fmt.Printf("%s: %d\n", k, m[k])
}
// apple: 5
// banana: 2
// cherry: 3
```

### Map cleared during iteration

```go
m := map[int]int{1: 1, 2: 2, 3: 3}
visited := 0
for k := range m {
    visited++
    if visited == 1 {
        // clear all entries after visiting the first key
        for key := range m {
            delete(m, key)
        }
    }
}
fmt.Println("visited:", visited) // 1 — remaining keys were deleted before being visited
```

### Nested range over same map

```go
m := map[int]int{1: 10, 2: 20, 3: 30}
for k1 := range m {
    for k2 := range m {
        // Two independent iterations — each has its own random start
        // k1 and k2 may produce different orderings
        _ = k1
        _ = k2
    }
}
```

### sync.Map for concurrent use

```go
import "sync"

var sm sync.Map

// Safe concurrent write
sm.Store("key", 42)

// Safe concurrent range
sm.Range(func(k, v any) bool {
    fmt.Println(k, v)
    return true // return false to stop iteration
})
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `for-range` over maps introduced with randomized order |
| Go 1.0  | Randomization intentionally added to prevent order-dependent code |
| Go 1.6  | Runtime detects concurrent map read/write and panics (rather than silent corruption) |
| Go 1.9  | `sync.Map` added to standard library for concurrent-safe map |
| Go 1.21 | `clear(m)` builtin added — removes all keys from a map |

---

## 9. Implementation-Specific Behavior

### How map iteration randomization works internally

Go maps are implemented as hash tables with buckets. Each bucket holds up to 8 key-value pairs. The runtime's map iteration:

1. At the start of each `for range`, calls `mapiterinit` which picks a random starting bucket using `fastrand()`.
2. Also picks a random starting cell within that bucket.
3. Iterates through all buckets wrapping around.

This internal mechanism is **not part of the spec** and can change between Go versions.

### Map growth during iteration

If the map grows (rehashes) during iteration, the runtime adjusts the iterator state to handle the new bucket layout. This is why adding keys during iteration is indeterminate — the iterator may or may not encounter the new bucket where the added key landed.

### Memory layout

Go's map implementation uses a `hmap` struct internally. The `for range` uses a `hiter` struct to track iteration state. Both are **unexported** and subject to change.

---

## 10. Spec Compliance Checklist

- [ ] Map iteration order is never assumed to be stable or sorted
- [ ] Sorted iteration uses explicit key extraction + `sort` package
- [ ] Concurrent map access uses `sync.RWMutex` or `sync.Map`
- [ ] Nil maps are ranged over only when the nil case is intentional (zero iterations)
- [ ] New keys are not added during range when the program must visit them
- [ ] Value copy semantics are understood — `v` does not modify the map
- [ ] `clear(m)` (Go 1.21+) is used instead of manual delete loops when appropriate
- [ ] `sync.Map.Range` is used for concurrent-safe map iteration
- [ ] Race detector (`go test -race`) is used to catch concurrent map access bugs

---

## 11. Official Examples

### Basic map range

```go
package main

import "fmt"

func main() {
    scores := map[string]int{
        "Alice": 95,
        "Bob":   82,
        "Carol": 91,
    }

    // Order is NOT deterministic
    for name, score := range scores {
        fmt.Printf("%s scored %d\n", name, score)
    }
}
```

### Keys only

```go
package main

import "fmt"

func main() {
    exists := map[string]bool{
        "go":    true,
        "java":  true,
        "rust":  true,
    }

    for lang := range exists {
        fmt.Println(lang)
    }
}
```

### Safe deletion during range

```go
package main

import "fmt"

func removeExpired(sessions map[string]int, cutoff int) {
    for id, expiry := range sessions {
        if expiry < cutoff {
            delete(sessions, id) // safe: spec guarantees this is fine
        }
    }
}

func main() {
    sessions := map[string]int{
        "abc": 100,
        "def": 200,
        "ghi": 50,
    }
    removeExpired(sessions, 150)
    fmt.Println(sessions) // map[def:200]
}
```

### Deterministic sorted iteration

```go
package main

import (
    "fmt"
    "sort"
)

func printSorted(m map[string]int) {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Strings(keys)
    for _, k := range keys {
        fmt.Printf("  %s: %d\n", k, m[k])
    }
}

func main() {
    inventory := map[string]int{
        "apples":  10,
        "bananas": 5,
        "oranges": 8,
    }
    printSorted(inventory)
    // apples: 10
    // bananas: 5
    // oranges: 8
}
```

### Nil map range (safe)

```go
package main

import "fmt"

func countItems(m map[string]int) int {
    count := 0
    for range m { // works even if m is nil
        count++
    }
    return count
}

func main() {
    fmt.Println(countItems(nil))                             // 0
    fmt.Println(countItems(map[string]int{"a": 1, "b": 2})) // 2
}
```

### Concurrent-safe iteration with sync.Map

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var m sync.Map

    // Store values
    m.Store("host", "localhost")
    m.Store("port", 8080)
    m.Store("debug", true)

    // Concurrent-safe range
    m.Range(func(key, value any) bool {
        fmt.Printf("%v = %v\n", key, value)
        return true // continue iteration
    })
}
```

### Counting with map range (avoiding value)

```go
package main

import "fmt"

func main() {
    wordCount := map[string]int{
        "the":  50,
        "go":   30,
        "func": 20,
    }

    total := 0
    for range wordCount {
        total++
    }
    fmt.Println("unique words:", total) // 3

    // Or more directly:
    fmt.Println("unique words:", len(wordCount)) // 3
}
```

---

## 12. Related Spec Sections

| Section | URL |
|---------|-----|
| For range | https://go.dev/ref/spec#For_range |
| Map types | https://go.dev/ref/spec#Map_types |
| Map literals | https://go.dev/ref/spec#Composite_literals |
| Index expressions (map access) | https://go.dev/ref/spec#Index_expressions |
| Deletion of map elements | https://go.dev/ref/spec#Deletion_of_map_elements |
| Comparison operators (key constraints) | https://go.dev/ref/spec#Comparison_operators |
| sync.Map documentation | https://pkg.go.dev/sync#Map |
| Go blog: maps in action | https://go.dev/blog/maps |
| Go memory model (concurrent access) | https://go.dev/ref/mem |
