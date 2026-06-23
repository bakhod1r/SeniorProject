# Iterating Maps — Tasks

## Task 1: Count Character Frequency (Easy)

Given a string, return a map counting how many times each character appears.

```go
package main

import "fmt"

// TODO: implement CharFreq
func CharFreq(s string) map[rune]int {
    // Use for range over string to get runes
    // Increment map entry for each rune
}

func main() {
    freq := CharFreq("hello world")
    fmt.Println(freq['l']) // 3
    fmt.Println(freq['o']) // 2
    fmt.Println(freq[' ']) // 1
}
```

**Requirements:**
- Use `for range` over the string
- Use `rune` as key type
- Handle all Unicode characters

---

## Task 2: Invert a Map (Easy)

Write a function that inverts a `map[string]string` (swaps keys and values).

```go
package main

import "fmt"

// TODO: implement Invert
func Invert(m map[string]string) map[string]string {
    // Return a new map with keys and values swapped
    // Assume values are unique
}

func main() {
    capitals := map[string]string{
        "France":  "Paris",
        "Germany": "Berlin",
        "Japan":   "Tokyo",
    }
    inverted := Invert(capitals)
    fmt.Println(inverted["Paris"])   // France
    fmt.Println(inverted["Berlin"])  // Germany
    fmt.Println(inverted["Tokyo"])   // Japan
}
```

---

## Task 3: Sum All Values (Easy)

Write a function that returns the sum of all integer values in a map.

```go
package main

import "fmt"

// TODO: implement SumValues
func SumValues(m map[string]int) int {
    // Range over map and accumulate values
}

func main() {
    sales := map[string]int{
        "Alice": 1200,
        "Bob":   950,
        "Carol": 1400,
    }
    fmt.Println(SumValues(sales)) // 3550
    fmt.Println(SumValues(map[string]int{})) // 0
}
```

---

## Task 4: Filter Map by Value (Medium)

Return a new map containing only entries where the value satisfies a predicate.

```go
package main

import "fmt"

// TODO: implement FilterByValue
func FilterByValue(m map[string]int, pred func(int) bool) map[string]int {
    // Create new map
    // Range over m, include entry if pred(v) is true
}

func main() {
    scores := map[string]int{
        "Alice": 92, "Bob": 45, "Carol": 78,
        "Dave": 30, "Eve": 88,
    }
    passing := FilterByValue(scores, func(v int) bool { return v >= 60 })
    fmt.Println(passing) // map[Alice:92 Carol:78 Eve:88]

    high := FilterByValue(scores, func(v int) bool { return v >= 90 })
    fmt.Println(high) // map[Alice:92]
}
```

---

## Task 5: Group Items by Category (Medium)

Given a slice of items with categories, group them into a map.

```go
package main

import "fmt"

type Item struct {
    Name     string
    Category string
    Price    float64
}

// TODO: implement GroupByCategory
func GroupByCategory(items []Item) map[string][]Item {
    // Group items by their Category field
}

func main() {
    items := []Item{
        {"Apple", "fruit", 1.20},
        {"Carrot", "vegetable", 0.80},
        {"Banana", "fruit", 0.90},
        {"Broccoli", "vegetable", 2.50},
        {"Cherry", "fruit", 3.00},
    }
    groups := GroupByCategory(items)
    fmt.Println("Fruits:")
    for _, item := range groups["fruit"] {
        fmt.Printf("  %s: $%.2f\n", item.Name, item.Price)
    }
}
```

---

## Task 6: Top N Entries (Medium)

Return the N entries with the highest values from a map.

```go
package main

import "fmt"

type Entry struct {
    Key   string
    Value int
}

// TODO: implement TopN
func TopN(m map[string]int, n int) []Entry {
    // Convert map to slice of Entry
    // Sort by value descending
    // Return first n entries
    // Handle case where len(m) < n
}

func main() {
    scores := map[string]int{
        "Alice": 92, "Bob": 45, "Carol": 78,
        "Dave": 30, "Eve": 88, "Frank": 95,
    }
    top3 := TopN(scores, 3)
    for _, e := range top3 {
        fmt.Printf("%s: %d\n", e.Key, e.Value)
    }
    // Frank: 95
    // Alice: 92
    // Eve: 88
}
```

---

## Task 7: Map Merge with Conflict Resolution (Medium)

Merge two maps; when keys conflict, use a resolver function to decide the value.

```go
package main

import "fmt"

// TODO: implement MergeWith
func MergeWith(
    m1, m2 map[string]int,
    resolve func(key string, v1, v2 int) int,
) map[string]int {
    // Start with a copy of m1
    // Add all entries from m2
    // When key exists in both, use resolve(key, m1[key], m2[key])
}

func main() {
    sales1 := map[string]int{"Alice": 1000, "Bob": 500}
    sales2 := map[string]int{"Bob": 700, "Carol": 300}

    // Sum conflicts
    summed := MergeWith(sales1, sales2, func(k string, v1, v2 int) int {
        return v1 + v2
    })
    fmt.Println(summed) // map[Alice:1000 Bob:1200 Carol:300]

    // Max conflicts
    maxed := MergeWith(sales1, sales2, func(k string, v1, v2 int) int {
        if v1 > v2 { return v1 }
        return v2
    })
    fmt.Println(maxed) // map[Alice:1000 Bob:700 Carol:300]
}
```

---

## Task 8: Sorted Map Printer (Medium)

Print all map entries sorted by key alphabetically, with formatted output.

```go
package main

import "fmt"

// TODO: implement PrintSortedMap
func PrintSortedMap(m map[string]float64, format string) {
    // Collect and sort keys
    // Print each entry using fmt.Printf(format, key, value)
    // format example: "%-15s: $%.2f\n"
}

func main() {
    prices := map[string]float64{
        "Zebra Pen":     2.99,
        "Apple Watch":  399.00,
        "Go Book":       49.99,
        "Banana Stand": 12.50,
    }
    PrintSortedMap(prices, "%-15s: $%.2f\n")
    // Apple Watch    : $399.00
    // Banana Stand   : $12.50
    // Go Book        : $49.99
    // Zebra Pen      : $2.99
}
```

---

## Task 9: Build an Index (Hard)

Given a list of documents (id → text), build a word index: word → []documentID.

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

// TODO: implement BuildIndex
func BuildIndex(docs map[int]string) map[string][]int {
    // For each document, split text into words
    // For each word, add the document ID to index[word]
    // Normalize words to lowercase
    // Sort document IDs in each entry
}

func main() {
    docs := map[int]string{
        1: "Go is great",
        2: "Go is used everywhere",
        3: "Great code is great Go code",
    }
    index := BuildIndex(docs)
    fmt.Println("'go' appears in docs:", index["go"])       // [1 2 3]
    fmt.Println("'great' appears in docs:", index["great"]) // [1 3]
    fmt.Println("'everywhere' in docs:", index["everywhere"]) // [2]
}
```

---

## Task 10: Running Average by Group (Hard)

Calculate the running average value for each group as you process a stream of (group, value) pairs.

```go
package main

import "fmt"

type Record struct {
    Group string
    Value float64
}

// TODO: implement RunningAverage
// Returns map of group -> average value after processing all records
func RunningAverage(records []Record) map[string]float64 {
    // Track sum and count per group
    // Use two maps or a map of structs
    // Final result: sum/count per group
}

func main() {
    records := []Record{
        {"A", 10}, {"B", 20}, {"A", 30},
        {"B", 40}, {"A", 20}, {"C", 50},
        {"B", 10},
    }
    avgs := RunningAverage(records)
    fmt.Printf("A avg: %.2f\n", avgs["A"]) // 20.00
    fmt.Printf("B avg: %.2f\n", avgs["B"]) // 23.33
    fmt.Printf("C avg: %.2f\n", avgs["C"]) // 50.00
}
```

---

## Task 11: Concurrent Map Population (Hard)

Safely populate a map from multiple goroutines using sync.Mutex.

```go
package main

import (
    "fmt"
    "sync"
)

// TODO: implement concurrentBuild
// Launch one goroutine per item in input
// Each goroutine computes transform(item) and stores result[item] = result
// Use sync.Mutex to protect map
// Use sync.WaitGroup to wait for completion
func concurrentBuild(
    items []string,
    transform func(string) int,
) map[string]int {
    // your code here
}

func main() {
    items := []string{"apple", "banana", "cherry", "date"}
    result := concurrentBuild(items, func(s string) int { return len(s) })

    for _, item := range items {
        fmt.Printf("%s -> %d\n", item, result[item])
    }
    // apple -> 5
    // banana -> 6
    // cherry -> 6
    // date -> 4
}
```

---

## Task 12: Cache with Expiry (Expert)

Implement a simple TTL cache backed by a map.

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type TTLCache struct {
    mu    sync.Mutex
    items map[string]cacheItem
}

type cacheItem struct {
    value  interface{}
    expiry time.Time
}

// TODO: implement New, Set, Get, and Cleanup

// New creates a TTLCache that auto-cleans every cleanupInterval
func New(cleanupInterval time.Duration) *TTLCache {
    // your code here
}

// Set stores key with a TTL
func (c *TTLCache) Set(key string, value interface{}, ttl time.Duration) {
    // your code here
}

// Get retrieves a value; returns (value, true) if found and not expired
func (c *TTLCache) Get(key string) (interface{}, bool) {
    // your code here
}

// Cleanup removes all expired entries (iterate map, delete expired)
func (c *TTLCache) Cleanup() {
    // your code here
}

func main() {
    cache := New(500 * time.Millisecond)
    cache.Set("key1", "value1", 200*time.Millisecond)
    cache.Set("key2", "value2", 1*time.Second)

    if v, ok := cache.Get("key1"); ok {
        fmt.Println("key1:", v) // value1
    }
    time.Sleep(300 * time.Millisecond)
    if _, ok := cache.Get("key1"); !ok {
        fmt.Println("key1 expired") // expected
    }
    if v, ok := cache.Get("key2"); ok {
        fmt.Println("key2:", v) // value2
    }
}
```

---

## Bonus Task 13: MapReduce (Expert)

Implement a simple MapReduce framework using Go maps and goroutines.

```go
package main

import (
    "fmt"
    "sync"
)

// TODO: implement MapReduce
// mapper: converts input item to key-value pair
// reducer: combines values for same key
func MapReduce(
    inputs []string,
    mapper func(string) (string, int),
    reducer func(string, []int) int,
) map[string]int {
    // Phase 1: Map — run mapper on each input in parallel
    // Use a map[string][]int to group intermediate results
    // Phase 2: Reduce — run reducer for each key
    // Return final map[string]int
}

func main() {
    docs := []string{
        "the cat sat on the mat",
        "the cat in the hat",
        "the dog sat on the log",
    }

    // Word count via MapReduce
    result := MapReduce(
        docs,
        func(doc string) (string, int) {
            // Note: for simplicity, return only first word
            // In real MapReduce, mapper emits multiple pairs
            return doc[:3], 1
        },
        func(key string, vals []int) int {
            sum := 0
            for _, v := range vals { sum += v }
            return sum
        },
    )
    fmt.Println(result)
}
```

---

## Solutions Reference

| Task | Key Techniques |
|---|---|
| 1 | `for range` string, `rune` map key |
| 2 | Range + swap key/value |
| 3 | Range + accumulate |
| 4 | Range + predicate + new map |
| 5 | Range slice + append to map slice |
| 6 | Range + sort.Slice + head N |
| 7 | Range m2 over m1 copy + resolver |
| 8 | Collect keys + sort.Strings + range |
| 9 | Nested range (docs then words) |
| 10 | Two-map tracking (sum, count) |
| 11 | Goroutines + WaitGroup + Mutex |
| 12 | Map with struct values + cleanup loop |
| 13 | Parallel map + merge + reduce loop |
