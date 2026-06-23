# Go Specification: Maps

**Source:** https://go.dev/ref/spec#Map_types
**Section:** Types → Composite Types → Map Types

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Map_types
- **Related:** https://go.dev/ref/spec#Making_slices_maps_and_channels
- **Related:** https://go.dev/ref/spec#Index_expressions
- **Related:** https://go.dev/ref/spec#Deletion_of_map_elements
- **Related:** https://go.dev/ref/spec#Length_and_capacity
- **Related:** https://go.dev/ref/spec#Comparison_operators

Official definition from the spec:

> "A map is an unordered group of elements of one type, called the element type, indexed by a set of unique keys of another type, called the key type. The value of an uninitialized map is nil."

---

## 2. Formal Grammar (EBNF)

```ebnf
MapType     = "map" "[" KeyType "]" ElementType .
KeyType     = Type .
ElementType = Type .
```

- `KeyType` must be **comparable** (supports `==` and `!=`).
- `ElementType` can be any type, including maps, slices, functions.
- Both types are specified at compile time; map values are homogeneous by key and element type.

**Valid map type examples:**

```
map[string]int
map[int]string
map[string][]int        // map to slices
map[string]map[string]int  // nested maps
map[[2]int]string       // array as key (comparable)
map[interface{}]int     // any comparable type as key at runtime
```

**Invalid map key types:**

```
map[[]int]string        // compile error: slice is not comparable
map[map[string]int]bool // compile error: map is not comparable
map[func()]int          // compile error: func is not comparable
```

---

## 3. Core Rules & Constraints

### 3.1 Key Type Must Be Comparable

The key type must support the `==` and `!=` operators. This rules out slices, maps, and functions as key types.

```go
package main

import "fmt"

func main() {
    m := map[string]int{
        "a": 1,
        "b": 2,
    }
    fmt.Println(m)

    // Using struct as key (structs are comparable if all fields are comparable)
    type Point struct{ X, Y int }
    points := map[Point]string{
        {1, 2}: "one-two",
    }
    fmt.Println(points[Point{1, 2}])
}
```

### 3.2 Nil Map

The zero value of a map is `nil`. Reading from a nil map returns the zero value of the element type. Writing to a nil map causes a runtime panic.

```go
package main

import "fmt"

func main() {
    var m map[string]int
    fmt.Println(m == nil)    // true
    fmt.Println(m["key"])    // 0 — reading from nil map is safe
    // m["key"] = 1          // panic: assignment to entry in nil map
}
```

### 3.3 Map Is a Reference Type

Maps are reference types. Assigning a map to another variable gives both variables the same underlying hash table. Modifications through either variable are visible in both.

```go
package main

import "fmt"

func main() {
    a := map[string]int{"x": 1}
    b := a
    b["y"] = 2
    fmt.Println(a) // map[x:1 y:2] — a is affected
}
```

### 3.4 Maps Are Unordered

The iteration order over map keys is not defined by the spec and is intentionally randomized by the runtime. Never rely on iteration order.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"c": 3, "a": 1, "b": 2}
    for k, v := range m {
        fmt.Printf("%s: %d\n", k, v)
        // order not guaranteed
    }
}
```

### 3.5 Map Size Is Dynamic

Maps grow automatically as elements are added. There is no need to pre-specify size (though `make` accepts an optional size hint for performance).

---

## 4. Type Rules

### 4.1 Map Type Identity

Two map types are identical if they have identical key types and identical element types.

```go
// map[string]int and map[string]int  → identical
// map[string]int and map[string]int64 → NOT identical
// map[string]int and map[int]string  → NOT identical
```

### 4.2 Nil Comparison Only

Maps can only be compared to `nil`. Two maps cannot be compared with `==`.

```go
package main

import "fmt"

func main() {
    var m map[string]int
    fmt.Println(m == nil) // true
    // m2 := map[string]int{}
    // fmt.Println(m == m2) // compile error: map can only be compared to nil
}
```

### 4.3 Assignability

A map is assignable to another variable of the same map type. A nil map literal is assignable to any map type.

---

## 5. Behavioral Specification

### 5.1 Creating Maps

```go
package main

import "fmt"

func main() {
    // Using make
    m1 := make(map[string]int)

    // Using composite literal
    m2 := map[string]int{
        "alice": 30,
        "bob":   25,
    }

    // make with size hint (optional, improves performance)
    m3 := make(map[string]int, 100)

    m1["x"] = 1
    fmt.Println(m1, m2, m3)
}
```

### 5.2 Reading from a Map

Indexing a map with a key `m[k]` returns the element or the zero value if the key is absent.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1}

    // Single-value form
    v := m["a"]
    fmt.Println(v) // 1

    // Missing key returns zero value
    v2 := m["z"]
    fmt.Println(v2) // 0 — zero value for int
}
```

### 5.3 Two-Value Index Form (Existence Check)

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1}

    v, ok := m["a"]
    fmt.Println(v, ok) // 1 true

    v2, ok2 := m["z"]
    fmt.Println(v2, ok2) // 0 false
}
```

### 5.4 Deleting from a Map

The built-in `delete(m, key)` removes the key-value pair. Deleting a nonexistent key is a no-op.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}
    delete(m, "b")
    fmt.Println(m) // map[a:1 c:3]

    delete(m, "z") // no-op: key doesn't exist
}
```

### 5.5 Length of Map

`len(m)` returns the number of key-value pairs in the map.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2}
    fmt.Println(len(m)) // 2
    delete(m, "a")
    fmt.Println(len(m)) // 1
}
```

### 5.6 Ranging Over Maps

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    m := map[string]int{"c": 3, "a": 1, "b": 2}

    // Collect keys for sorted output
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    for _, k := range keys {
        fmt.Printf("%s: %d\n", k, m[k])
    }
}
```

### 5.7 Maps in Concurrent Code

Maps are NOT safe for concurrent use. Reading and writing concurrently (even if only one goroutine writes) causes undefined behavior and is detected by the race detector. Use `sync.Mutex` or `sync.RWMutex` for concurrent access.

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var mu sync.RWMutex
    m := make(map[string]int)

    mu.Lock()
    m["key"] = 42
    mu.Unlock()

    mu.RLock()
    fmt.Println(m["key"])
    mu.RUnlock()
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Writing to Nil Map Panics

```go
package main

func main() {
    var m map[string]int
    m["x"] = 1 // panic: assignment to entry in nil map
}
```

### 6.2 Defined: Reading from Nil Map Is Safe

Returns zero value; no panic.

```go
package main

import "fmt"

func main() {
    var m map[string]int
    v := m["missing"]
    fmt.Println(v) // 0
}
```

### 6.3 Defined: Deleting from Nil Map Panics

```go
package main

func main() {
    var m map[string]int
    delete(m, "x") // panic: delete on nil map (Go 1.0-1.1 only — see below)
}
```

**Note:** As of Go 1.2+, `delete` on a nil map is a no-op (does not panic). The spec was updated.

### 6.4 Undefined: Concurrent Mutation

Concurrent writes to a map (or read + write) are undefined behavior. The runtime detects this with the race detector and panics with "concurrent map writes."

### 6.5 Defined: Iteration Order is Random

The spec guarantees that map iteration order is NOT specified. The runtime randomizes starting position to prevent programs from relying on ordering.

---

## 7. Edge Cases from Spec

### 7.1 Interface Key Types

An interface type can be used as a map key. However, if a concrete value stored in the interface is not comparable (e.g., a slice), a runtime panic occurs when used as a key.

```go
package main

import "fmt"

func main() {
    m := make(map[interface{}]int)
    m[42] = 1
    m["hello"] = 2
    m[[2]int{1, 2}] = 3 // array — comparable, valid
    fmt.Println(m)

    defer func() { recover() }()
    // m[[]int{1,2}] = 4 // panic at runtime: unhashable type []int
}
```

### 7.2 Map Size Hint Does Not Set Maximum

The optional size hint in `make(map[K]V, n)` is a performance hint, not a maximum. The map will grow beyond `n` if needed.

```go
package main

import "fmt"

func main() {
    m := make(map[int]int, 2)
    for i := 0; i < 100; i++ {
        m[i] = i * i // grows well beyond 2
    }
    fmt.Println(len(m)) // 100
}
```

### 7.3 Storing to Map Element Field Directly

You cannot take the address of a map value, and you cannot assign to a struct field through a map index.

```go
package main

import "fmt"

type Counter struct{ n int }

func main() {
    m := map[string]Counter{"a": {1}}

    // m["a"].n = 2 // compile error: cannot assign to struct field in map

    // Correct approach:
    c := m["a"]
    c.n = 2
    m["a"] = c
    fmt.Println(m["a"].n) // 2
}
```

### 7.4 clear() Built-in (Go 1.21+)

Go 1.21 added the `clear` built-in that deletes all entries from a map.

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2}
    clear(m) // Go 1.21+
    fmt.Println(len(m)) // 0
    fmt.Println(m == nil) // false — map still exists, just empty
}
```

### 7.5 maps.Clone (Go 1.21 stdlib)

To deep-copy a map, use `maps.Clone` from the `maps` package (Go 1.21+) or iterate manually.

```go
package main

import (
    "fmt"
    "maps"
)

func main() {
    original := map[string]int{"a": 1, "b": 2}
    clone := maps.Clone(original)
    clone["c"] = 3
    fmt.Println(original) // map[a:1 b:2] — unchanged
    fmt.Println(clone)    // map[a:1 b:2 c:3]
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Map type introduced |
| Go 1.2     | `delete` on nil map changed from panic to no-op |
| Go 1.6     | Concurrent map access detection (panic on concurrent write) |
| Go 1.9     | `sync.Map` added to standard library |
| Go 1.18    | Generics enabled type-safe map utilities |
| Go 1.21    | `clear(m)` built-in added; `maps` package added to stdlib |

---

## 9. Implementation-Specific Behavior

### 9.1 Hash Table Implementation

The gc compiler implements maps as hash tables. The specific hash function, bucket structure, and load factor are implementation-defined and subject to change between Go versions.

### 9.2 Iteration Randomization

Starting in Go 1.0, the runtime randomizes the starting point of map iteration to prevent programs from depending on ordering. This is a deliberate design decision.

### 9.3 Growth Strategy

Maps grow by doubling the number of buckets when the load factor exceeds a threshold (~6.5 elements per bucket in gc). Rehashing is done incrementally.

### 9.4 Memory Layout

Map values cannot be addressed (no `&m[key]`). Values are stored by value in buckets. This is why you must read-modify-write struct fields in maps.

### 9.5 Concurrent Access Panic

Since Go 1.6, the runtime detects concurrent map writes and panics with "concurrent map writes." This detection uses a lock-free flag in the map header and is checked on every map operation.

---

## 10. Spec Compliance Checklist

- [ ] Key type must be comparable (supports `==`)
- [ ] Zero value of map is nil
- [ ] Reading from nil map returns zero value (no panic)
- [ ] Writing to nil map panics
- [ ] `delete` on nil map is no-op (Go 1.2+)
- [ ] Map is a reference type (assignment copies the reference, not the data)
- [ ] Iteration order is not specified (must not rely on ordering)
- [ ] `make(map[K]V)` creates a non-nil empty map
- [ ] Two-value form `v, ok := m[k]` distinguishes zero-value from absent key
- [ ] Cannot take address of map element (`&m[k]` is compile error)
- [ ] Cannot assign to struct field of map value directly
- [ ] Concurrent map access is undefined (use mutex or sync.Map)
- [ ] `len(m)` returns current number of key-value pairs
- [ ] `clear(m)` removes all entries (Go 1.21+)

---

## 11. Official Examples

### Example 1: Basic Map Operations

```go
package main

import "fmt"

func main() {
    m := make(map[string]int)

    m["k1"] = 7
    m["k2"] = 13

    fmt.Println("map:", m)

    v1 := m["k1"]
    fmt.Println("v1:", v1)

    v3 := m["k3"]
    fmt.Println("v3:", v3) // 0 — zero value

    fmt.Println("len:", len(m))

    delete(m, "k2")
    fmt.Println("map:", m)

    _, prs := m["k2"]
    fmt.Println("prs:", prs) // false

    n := map[string]int{"foo": 1, "bar": 2}
    fmt.Println("map:", n)
}
```

### Example 2: Checking Map Membership

```go
package main

import "fmt"

func main() {
    m := map[string]string{
        "name": "Alice",
        "city": "NYC",
    }

    if v, ok := m["name"]; ok {
        fmt.Println("Found:", v)
    }

    if _, ok := m["missing"]; !ok {
        fmt.Println("Not found")
    }
}
```

### Example 3: Counting Word Frequencies

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    text := "the quick brown fox jumps over the lazy dog the fox"
    words := strings.Fields(text)

    freq := make(map[string]int)
    for _, w := range words {
        freq[w]++
    }

    fmt.Println("the:", freq["the"])
    fmt.Println("fox:", freq["fox"])
}
```

### Example 4: Map with Struct Values

```go
package main

import "fmt"

type Person struct {
    Age  int
    City string
}

func main() {
    people := map[string]Person{
        "Alice": {30, "New York"},
        "Bob":   {25, "London"},
    }

    if p, ok := people["Alice"]; ok {
        fmt.Printf("Alice: age=%d, city=%s\n", p.Age, p.City)
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Making maps | https://go.dev/ref/spec#Making_slices_maps_and_channels | `make(map[K]V)` and `make(map[K]V, n)` |
| Index expressions | https://go.dev/ref/spec#Index_expressions | `m[k]`, two-value form |
| Deletion | https://go.dev/ref/spec#Deletion_of_map_elements | `delete(m, k)` built-in |
| Length and capacity | https://go.dev/ref/spec#Length_and_capacity | `len(m)` |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | Key type comparability requirement |
| For range | https://go.dev/ref/spec#For_range | Iterating over maps |
| Composite literals | https://go.dev/ref/spec#Composite_literals | `map[K]V{k1: v1, ...}` syntax |
| Type identity | https://go.dev/ref/spec#Type_identity | When two map types are identical |
| Clear built-in | https://go.dev/ref/spec#Clear | `clear(m)` — Go 1.21+ |
