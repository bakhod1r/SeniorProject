# Go Maps — Junior Level

## Table of Contents
1. What Is a Map?
2. Why Use Maps?
3. Declaring a Map
4. The nil Map Trap
5. Creating Maps with make()
6. Map Literals
7. Setting Values
8. Getting Values
9. Zero Value Behavior
10. Checking If a Key Exists (Comma-Ok)
11. Deleting a Key
12. Getting the Length
13. Iterating Over a Map
14. Iteration Order Is Random
15. Maps Are Reference Types
16. Key Type Rules
17. Value Type Rules
18. Nested Maps
19. Maps as Sets
20. Pre-sizing a Map
21. Maps and Functions
22. Comparing Maps
23. Printing a Map
24. Common Mistakes
25. Maps vs Slices
26. Maps vs Arrays
27. Real-World Use Case: Word Count
28. Real-World Use Case: Caching
29. Real-World Use Case: Grouping Data
30. Quick Reference Cheat Sheet

---

## 1. What Is a Map?

A **map** in Go is a built-in data structure that associates **keys** with **values**. Think of it as a dictionary where you look up a word (key) to get its definition (value).

Maps are sometimes called:
- Hash maps (in computer science)
- Dictionaries (in Python)
- Hash tables (in Java / C++)
- Associative arrays (in PHP)

```go
package main

import "fmt"

func main() {
    // A map that maps string keys to int values
    ages := map[string]int{
        "Alice": 30,
        "Bob":   25,
        "Carol": 35,
    }

    fmt.Println(ages["Alice"]) // 30
    fmt.Println(ages["Bob"])   // 25
}
```

**Key idea:** Maps give you O(1) average-time lookups. Instead of searching through a list, you go directly to the value using its key.

---

## 2. Why Use Maps?

Maps are useful when you need to:
- Look up values quickly by a unique identifier
- Count occurrences (e.g., word frequency)
- Group data by a category
- Cache computed results
- Implement sets

```go
// Without a map — slow linear search
func findAge(people []struct{ Name string; Age int }, name string) int {
    for _, p := range people {
        if p.Name == name {
            return p.Age
        }
    }
    return -1 // not found
}

// With a map — instant lookup
func main() {
    ages := map[string]int{"Alice": 30, "Bob": 25}
    fmt.Println(ages["Alice"]) // 30 — direct access
}
```

---

## 3. Declaring a Map

There are several ways to declare a map in Go:

```go
package main

import "fmt"

func main() {
    // Method 1: var declaration (creates a nil map)
    var m1 map[string]int
    fmt.Println(m1)        // map[]
    fmt.Println(m1 == nil) // true

    // Method 2: make() — creates an empty, usable map
    m2 := make(map[string]int)
    fmt.Println(m2)        // map[]
    fmt.Println(m2 == nil) // false

    // Method 3: map literal (empty)
    m3 := map[string]int{}
    fmt.Println(m3)        // map[]
    fmt.Println(m3 == nil) // false

    // Method 4: map literal with initial values
    m4 := map[string]int{
        "apple":  5,
        "banana": 3,
    }
    fmt.Println(m4) // map[apple:5 banana:3]
}
```

---

## 4. The nil Map Trap

This is one of the most common beginner mistakes in Go:

```go
package main

func main() {
    var m map[string]int // nil map

    // READING from nil map is safe — returns zero value
    v := m["key"] // v = 0, no panic
    _ = v

    // WRITING to nil map causes a PANIC
    m["key"] = 42 // panic: assignment to entry in nil map
}
```

**Rule:** Always initialize a map before writing to it.

```go
// Safe pattern
var m map[string]int
m = make(map[string]int) // now it's safe to write
m["key"] = 42
```

---

## 5. Creating Maps with make()

`make()` is the most common way to create a map you plan to fill dynamically:

```go
package main

import "fmt"

func main() {
    // Basic make — creates empty map
    scores := make(map[string]int)

    // Add values after creation
    scores["Alice"] = 95
    scores["Bob"] = 87
    scores["Carol"] = 92

    fmt.Println(scores) // map[Alice:95 Bob:87 Carol:92]

    // make with a size hint (for performance — covered later)
    bigMap := make(map[string]int, 1000)
    _ = bigMap
}
```

---

## 6. Map Literals

Map literals let you declare and initialize in one step:

```go
package main

import "fmt"

func main() {
    // String keys, int values
    population := map[string]int{
        "New York":    8336817,
        "Los Angeles": 3979576,
        "Chicago":     2693976,
    }

    // String keys, string values
    capitals := map[string]string{
        "USA":    "Washington D.C.",
        "France": "Paris",
        "Japan":  "Tokyo",
    }

    // Int keys, string values
    httpStatus := map[int]string{
        200: "OK",
        404: "Not Found",
        500: "Internal Server Error",
    }

    fmt.Println(population["New York"]) // 8336817
    fmt.Println(capitals["Japan"])      // Tokyo
    fmt.Println(httpStatus[404])        // Not Found
}
```

---

## 7. Setting Values

Use the bracket notation `m[key] = value`:

```go
package main

import "fmt"

func main() {
    inventory := make(map[string]int)

    // Set new values
    inventory["apples"] = 10
    inventory["bananas"] = 5
    inventory["oranges"] = 8

    // Update existing value
    inventory["apples"] = 15 // overwrites 10

    // Increment a value
    inventory["bananas"]++ // bananas = 6
    inventory["oranges"] += 2 // oranges = 10

    fmt.Println(inventory)
    // map[apples:15 bananas:6 oranges:10]
}
```

---

## 8. Getting Values

Use the bracket notation `v := m[key]`:

```go
package main

import "fmt"

func main() {
    colors := map[string]string{
        "sky":   "blue",
        "grass": "green",
        "sun":   "yellow",
    }

    // Get existing value
    fmt.Println(colors["sky"])   // blue
    fmt.Println(colors["grass"]) // green

    // Get non-existing value — returns zero value (empty string for string)
    fmt.Println(colors["ocean"]) // ""  (empty string, not an error)
}
```

---

## 9. Zero Value Behavior

When you access a key that doesn't exist, Go returns the **zero value** of the value type:

```go
package main

import "fmt"

func main() {
    var intMap map[string]int
    var strMap map[string]string
    var boolMap map[string]bool
    var sliceMap map[string][]int

    // All return zero values without panic (reading is safe)
    fmt.Println(intMap["missing"])   // 0
    fmt.Println(strMap["missing"])   // ""
    fmt.Println(boolMap["missing"])  // false
    fmt.Println(sliceMap["missing"]) // []

    // This can be a trap! 0 might be a valid value:
    scores := map[string]int{"Alice": 0}
    fmt.Println(scores["Alice"])   // 0 — Alice has score 0
    fmt.Println(scores["Bob"])     // 0 — Bob doesn't exist!
    // You can't tell the difference without comma-ok
}
```

---

## 10. Checking If a Key Exists (Comma-Ok)

Use the two-value form to check if a key exists:

```go
package main

import "fmt"

func main() {
    ages := map[string]int{
        "Alice": 30,
        "Bob":   0, // Bob exists but has age 0
    }

    // One-value form — can't tell if key exists
    age1 := ages["Alice"]  // 30
    age2 := ages["Bob"]    // 0
    age3 := ages["Carol"]  // 0
    fmt.Println(age1, age2, age3) // 30 0 0

    // Two-value (comma-ok) form — correctly detects presence
    alice, ok := ages["Alice"]
    fmt.Printf("Alice: %d, exists: %v\n", alice, ok) // Alice: 30, exists: true

    bob, ok := ages["Bob"]
    fmt.Printf("Bob: %d, exists: %v\n", bob, ok) // Bob: 0, exists: true

    carol, ok := ages["Carol"]
    fmt.Printf("Carol: %d, exists: %v\n", carol, ok) // Carol: 0, exists: false

    // Typical usage pattern
    if v, ok := ages["Alice"]; ok {
        fmt.Println("Alice's age:", v)
    } else {
        fmt.Println("Alice not found")
    }
}
```

---

## 11. Deleting a Key

Use the built-in `delete()` function:

```go
package main

import "fmt"

func main() {
    fruits := map[string]int{
        "apple":  5,
        "banana": 3,
        "cherry": 8,
    }

    fmt.Println("Before:", fruits)
    // Before: map[apple:5 banana:3 cherry:8]

    // Delete a key that exists
    delete(fruits, "banana")
    fmt.Println("After deleting banana:", fruits)
    // After deleting banana: map[apple:5 cherry:8]

    // Delete a key that doesn't exist — safe, no error
    delete(fruits, "mango") // no panic, just a no-op

    fmt.Println("After deleting mango:", fruits)
    // After deleting mango: map[apple:5 cherry:8]
}
```

---

## 12. Getting the Length

Use the built-in `len()` function:

```go
package main

import "fmt"

func main() {
    m := map[string]int{
        "a": 1,
        "b": 2,
        "c": 3,
    }

    fmt.Println(len(m)) // 3

    m["d"] = 4
    fmt.Println(len(m)) // 4

    delete(m, "a")
    fmt.Println(len(m)) // 3

    // nil map has length 0
    var nilMap map[string]int
    fmt.Println(len(nilMap)) // 0
}
```

---

## 13. Iterating Over a Map

Use `for range` to loop over a map:

```go
package main

import "fmt"

func main() {
    scores := map[string]int{
        "Alice": 95,
        "Bob":   87,
        "Carol": 92,
    }

    // Iterate key-value pairs
    for name, score := range scores {
        fmt.Printf("%s: %d\n", name, score)
    }

    fmt.Println("---")

    // Iterate keys only
    for name := range scores {
        fmt.Println(name)
    }

    fmt.Println("---")

    // Iterate values only (using blank identifier)
    for _, score := range scores {
        fmt.Println(score)
    }
}
```

---

## 14. Iteration Order Is Random

**Never rely on map iteration order!** Go randomizes it intentionally:

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}

    // Each run may print in a different order
    fmt.Println("First iteration:")
    for k, v := range m {
        fmt.Printf("  %s: %d\n", k, v)
    }

    fmt.Println("Second iteration:")
    for k, v := range m {
        fmt.Printf("  %s: %d\n", k, v)
    }
    // The two iterations above might be in different orders!
}
```

To iterate in sorted order:

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    m := map[string]int{"banana": 2, "apple": 5, "cherry": 1}

    // Collect keys
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }

    // Sort keys
    sort.Strings(keys)

    // Iterate in sorted order
    for _, k := range keys {
        fmt.Printf("%s: %d\n", k, m[k])
    }
    // apple: 5
    // banana: 2
    // cherry: 1
}
```

---

## 15. Maps Are Reference Types

When you assign a map to a new variable, both variables point to the **same** underlying map:

```go
package main

import "fmt"

func main() {
    original := map[string]int{"a": 1, "b": 2}
    copy := original // NOT a copy — same map!

    copy["c"] = 3
    fmt.Println(original) // map[a:1 b:2 c:3] — modified!
    fmt.Println(copy)     // map[a:1 b:2 c:3]

    // To truly copy a map, you must do it manually
    trueCopy := make(map[string]int, len(original))
    for k, v := range original {
        trueCopy[k] = v
    }

    trueCopy["d"] = 4
    fmt.Println(original) // map[a:1 b:2 c:3] — NOT modified
    fmt.Println(trueCopy) // map[a:1 b:2 c:3 d:4]
}
```

---

## 16. Key Type Rules

Keys must be **comparable** types:

```go
package main

func main() {
    // Valid key types
    var m1 map[bool]string      // bool keys
    var m2 map[int]string       // int keys
    var m3 map[float64]string   // float64 keys (use with caution!)
    var m4 map[string]int       // string keys (most common)
    var m5 map[[3]int]string    // array keys (arrays are comparable)

    _ = m1; _ = m2; _ = m3; _ = m4; _ = m5

    // INVALID key types — these won't compile:
    // var bad1 map[[]int]string     // slices are NOT comparable
    // var bad2 map[map[string]int]string // maps are NOT comparable
    // var bad3 map[func()]string    // functions are NOT comparable

    // Struct keys work if all fields are comparable
    type Point struct{ X, Y int }
    var points map[Point]string
    points = map[Point]string{{1, 2}: "A", {3, 4}: "B"}
    _ = points
}
```

---

## 17. Value Type Rules

Values can be **any** type — including slices, maps, functions, and interfaces:

```go
package main

import "fmt"

func main() {
    // Map of slices
    graph := map[string][]string{
        "A": {"B", "C"},
        "B": {"C"},
        "C": {},
    }
    fmt.Println(graph["A"]) // [B C]

    // Map of maps (nested)
    matrix := map[string]map[string]int{
        "row1": {"col1": 1, "col2": 2},
        "row2": {"col1": 3, "col2": 4},
    }
    fmt.Println(matrix["row1"]["col2"]) // 2

    // Map of functions
    ops := map[string]func(int, int) int{
        "add": func(a, b int) int { return a + b },
        "mul": func(a, b int) int { return a * b },
    }
    fmt.Println(ops["add"](3, 4)) // 7
}
```

---

## 18. Nested Maps

Maps can contain other maps as values:

```go
package main

import "fmt"

func main() {
    // 2D lookup table: country -> city -> population
    data := map[string]map[string]int{}

    // Must initialize inner maps before use
    data["USA"] = map[string]int{}
    data["USA"]["New York"] = 8336817
    data["USA"]["Los Angeles"] = 3979576

    data["France"] = map[string]int{}
    data["France"]["Paris"] = 2161000

    fmt.Println(data["USA"]["New York"]) // 8336817
    fmt.Println(data["France"]["Paris"]) // 2161000

    // Accessing a missing outer key is safe (returns nil inner map)
    inner := data["Germany"] // nil map
    val := inner["Berlin"]   // 0, no panic (reading nil map is safe)
    fmt.Println(val)         // 0

    // But writing to a missing inner map panics:
    // data["Germany"]["Berlin"] = 3769000 // PANIC!
    // First initialize: data["Germany"] = make(map[string]int)
}
```

---

## 19. Maps as Sets

Go doesn't have a built-in set type. Use a map to simulate one:

```go
package main

import "fmt"

func main() {
    // Option 1: map[string]bool
    set1 := map[string]bool{
        "apple":  true,
        "banana": true,
    }
    set1["cherry"] = true
    fmt.Println(set1["apple"])  // true (in set)
    fmt.Println(set1["mango"])  // false (not in set)

    // Option 2: map[string]struct{} — uses zero memory for values
    set2 := map[string]struct{}{
        "apple":  {},
        "banana": {},
    }
    set2["cherry"] = struct{}{}

    // Check membership
    if _, exists := set2["apple"]; exists {
        fmt.Println("apple is in the set")
    }

    // Delete from set
    delete(set2, "banana")

    fmt.Println(len(set2)) // 2
}
```

**Why `struct{}`?** It uses zero bytes of memory, whereas `bool` uses 1 byte per entry.

---

## 20. Pre-sizing a Map

If you know (approximately) how many items you'll store, provide a size hint to `make()`:

```go
package main

import "fmt"

func main() {
    // Without hint — map grows dynamically (more allocations)
    m1 := make(map[string]int)

    // With hint — pre-allocates space (fewer allocations)
    m2 := make(map[string]int, 100)

    // Both work the same way; the hint only affects performance
    m2["key"] = 1
    fmt.Println(len(m1), len(m2)) // 0 1

    // The map can still grow beyond the hint
    for i := 0; i < 200; i++ {
        m2[fmt.Sprintf("key%d", i)] = i
    }
    fmt.Println(len(m2)) // 201
}
```

---

## 21. Maps and Functions

Maps are reference types, so passing a map to a function lets the function modify the original:

```go
package main

import "fmt"

func addItem(m map[string]int, key string, value int) {
    m[key] = value // modifies the original map
}

func countWords(text string) map[string]int {
    counts := make(map[string]int)
    word := ""
    for _, ch := range text + " " {
        if ch == ' ' {
            if word != "" {
                counts[word]++
                word = ""
            }
        } else {
            word += string(ch)
        }
    }
    return counts
}

func main() {
    inventory := map[string]int{"apple": 5}
    fmt.Println(inventory) // map[apple:5]

    addItem(inventory, "banana", 3)
    fmt.Println(inventory) // map[apple:5 banana:3]

    wc := countWords("hello world hello go")
    fmt.Println(wc) // map[go:1 hello:2 world:1]
}
```

---

## 22. Comparing Maps

Go does **not** support `==` for maps (except comparing to `nil`):

```go
package main

import "fmt"

func main() {
    m1 := map[string]int{"a": 1}
    m2 := map[string]int{"a": 1}

    // This doesn't compile:
    // fmt.Println(m1 == m2) // error: invalid operation

    // You can compare to nil
    var nilMap map[string]int
    fmt.Println(nilMap == nil) // true
    fmt.Println(m1 == nil)     // false

    // Manual comparison
    fmt.Println(mapsEqual(m1, m2)) // true
}

func mapsEqual(a, b map[string]int) bool {
    if len(a) != len(b) {
        return false
    }
    for k, v := range a {
        if bv, ok := b[k]; !ok || bv != v {
            return false
        }
    }
    return true
}
```

---

## 23. Printing a Map

`fmt.Println` and `fmt.Printf` can print maps:

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}

    fmt.Println(m)       // map[a:1 b:2 c:3]
    fmt.Printf("%v\n", m)  // map[a:1 b:2 c:3]
    fmt.Printf("%#v\n", m) // map[string]int{"a":1, "b":2, "c":3}

    // Note: print order may vary between runs
}
```

---

## 24. Common Mistakes

```go
package main

import "fmt"

func main() {
    // MISTAKE 1: Writing to nil map
    // var m map[string]int
    // m["key"] = 1 // PANIC

    // Fix:
    m := make(map[string]int)
    m["key"] = 1
    fmt.Println(m)

    // MISTAKE 2: Assuming iteration order
    // for k := range m { ... } // order not guaranteed

    // MISTAKE 3: Assuming map copy is deep
    original := map[string]int{"a": 1}
    alias := original
    alias["b"] = 2
    fmt.Println(original) // map[a:1 b:2] — unexpected!

    // MISTAKE 4: Not checking key existence
    scores := map[string]int{"Alice": 0}
    if scores["Bob"] == 0 {
        fmt.Println("Bob has score 0 OR Bob doesn't exist") // ambiguous!
    }
    if _, ok := scores["Bob"]; !ok {
        fmt.Println("Bob definitely doesn't exist") // correct
    }
}
```

---

## 25. Maps vs Slices

| Feature | Map | Slice |
|---------|-----|-------|
| Access by | Key (any comparable type) | Index (int 0 to n-1) |
| Order | Unordered | Ordered |
| Lookup time | O(1) average | O(n) for search |
| Memory | More overhead | Less overhead |
| Use when | Key-value association | Ordered list of items |

```go
// Use a slice when order matters
names := []string{"Alice", "Bob", "Carol"}
for i, name := range names {
    fmt.Printf("%d: %s\n", i, name)
}

// Use a map when you need fast lookup by key
ages := map[string]int{"Alice": 30, "Bob": 25}
fmt.Println(ages["Alice"]) // O(1) lookup
```

---

## 26. Maps vs Arrays

| Feature | Map | Array |
|---------|-----|-------|
| Size | Dynamic | Fixed at compile time |
| Keys | Any comparable type | Integer indices |
| Memory | Heap allocated | Stack or heap |
| nil | Can be nil | Cannot be nil |

---

## 27. Real-World Use Case: Word Count

```go
package main

import (
    "fmt"
    "strings"
)

func wordCount(text string) map[string]int {
    counts := make(map[string]int)
    words := strings.Fields(text) // splits by whitespace
    for _, word := range words {
        word = strings.ToLower(word)
        counts[word]++
    }
    return counts
}

func main() {
    text := "The quick brown fox jumps over the lazy dog the fox"
    counts := wordCount(text)

    // Print words that appear more than once
    for word, count := range counts {
        if count > 1 {
            fmt.Printf("%q appears %d times\n", word, count)
        }
    }
}
```

---

## 28. Real-World Use Case: Caching

```go
package main

import "fmt"

// Simple memoization cache
var fibCache = map[int]int{}

func fib(n int) int {
    if n <= 1 {
        return n
    }
    if v, ok := fibCache[n]; ok {
        return v // return cached result
    }
    result := fib(n-1) + fib(n-2)
    fibCache[n] = result // store in cache
    return result
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Printf("fib(%d) = %d\n", i, fib(i))
    }
}
```

---

## 29. Real-World Use Case: Grouping Data

```go
package main

import "fmt"

type Student struct {
    Name  string
    Grade string
    Score int
}

func groupByGrade(students []Student) map[string][]Student {
    groups := make(map[string][]Student)
    for _, s := range students {
        groups[s.Grade] = append(groups[s.Grade], s)
    }
    return groups
}

func main() {
    students := []Student{
        {"Alice", "A", 95},
        {"Bob", "B", 82},
        {"Carol", "A", 91},
        {"Dave", "C", 71},
        {"Eve", "B", 85},
    }

    groups := groupByGrade(students)

    for grade, students := range groups {
        fmt.Printf("Grade %s:\n", grade)
        for _, s := range students {
            fmt.Printf("  %s (%d)\n", s.Name, s.Score)
        }
    }
}
```

---

## 30. Quick Reference Cheat Sheet

```go
// ---- DECLARATION ----
var m map[K]V               // nil map (read-safe, write panics)
m = make(map[K]V)           // empty, writeable
m = make(map[K]V, hint)     // with size hint
m = map[K]V{}               // empty literal
m = map[K]V{k1: v1, k2: v2} // literal with values

// ---- OPERATIONS ----
m[key] = value              // set / update
v := m[key]                 // get (zero value if missing)
v, ok := m[key]             // get + existence check
delete(m, key)              // delete (safe even if missing)
n := len(m)                 // count of key-value pairs

// ---- ITERATION ----
for k, v := range m { }    // keys and values
for k := range m { }       // keys only
for _, v := range m { }    // values only

// ---- SETS ----
set := map[T]struct{}{}
set[item] = struct{}{}
_, exists := set[item]
delete(set, item)

// ---- CHECKS ----
m == nil                    // is nil?
len(m) == 0                 // is empty?

// ---- VALID KEY TYPES ----
// bool, int, float, complex, string, pointer, channel
// array, interface, struct (if all fields comparable)
// NOT: slice, map, function
```

---

*Junior level complete. Next: middle.md for deeper "why" and "when" context.*
