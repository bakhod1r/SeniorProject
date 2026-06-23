# Go Pointers with Maps & Slices — Tasks

## Instructions

Each task: description, starter code, expected output, evaluation checklist.

---

## Task 1 — Map of Pointers for Mutable Counters

**Difficulty**: Beginner

```go
type Counter struct{ N int }

func main() {
    m := map[string]*Counter{}
    // TODO: increment m["a"] three times, m["b"] once
    fmt.Println(m["a"].N, m["b"].N) // 3 1
}
```

**Evaluation**:
- [ ] Initialize entries with `&Counter{}`
- [ ] Mutate via `m[k].N++`

---

## Task 2 — Slice Element Pointer

**Difficulty**: Beginner

Implement `doubleAll(s []int)` that doubles every element via element pointer.

```go
func doubleAll(s []int) {
    for i := range s {
        // TODO: use &s[i]
    }
}

func main() {
    s := []int{1, 2, 3}
    doubleAll(s)
    fmt.Println(s) // [2 4 6]
}
```

---

## Task 3 — Pointer to Slice Reassignment

**Difficulty**: Intermediate

```go
func resetAndAppend(sp *[]int, vs ...int) {
    *sp = nil
    *sp = append(*sp, vs...)
}

func main() {
    s := []int{1, 2, 3}
    resetAndAppend(&s, 10, 20, 30)
    fmt.Println(s) // [10 20 30]
}
```

---

## Task 4 — Defensive Copy for Cache Set

**Difficulty**: Intermediate

```go
type Cache struct{ items []int }
func (c *Cache) Set(items []int) {
    // TODO: defensive copy
}

func main() {
    src := []int{1, 2, 3}
    c := &Cache{}
    c.Set(src)
    src[0] = 99
    fmt.Println(c.items) // [1 2 3]
}
```

---

## Task 5 — Avoid Stale Pointer

**Difficulty**: Intermediate

Identify and fix:
```go
s := make([]int, 3, 3)
s[0] = 1
p := &s[0]
s = append(s, 99)
*p = 999
fmt.Println(s, *p)
```

What's printed? Why? How do you make `*p = 999` actually modify `s[0]`?

**Solution**:
```go
// Reassign p after append:
s = append(s, 99)
p = &s[0]
*p = 999
fmt.Println(s) // [999 0 0 99]
```

---

## Task 6 — Concurrent-Safe Map

**Difficulty**: Advanced

Build a thread-safe wrapper around `map[string]int`:

```go
type SafeMap struct {
    mu sync.RWMutex
    m  map[string]int
}

func (s *SafeMap) Get(k string) (int, bool) {
    // TODO
    return 0, false
}

func (s *SafeMap) Set(k string, v int) {
    // TODO
}

func (s *SafeMap) Inc(k string) {
    // TODO
}
```

Demonstrate concurrent access from 100 goroutines.

---

## Task 7 — Slice of Pointers Polymorphism

**Difficulty**: Advanced

```go
type Shape interface{ Area() float64 }
type Circle struct{ R float64 }
type Square struct{ S float64 }
func (c *Circle) Area() float64 { return 3.14 * c.R * c.R }
func (s *Square) Area() float64 { return s.S * s.S }

shapes := []Shape{&Circle{R: 2}, &Square{S: 3}}
for _, s := range shapes {
    fmt.Println(s.Area())
}
```

---

## Task 8 — Pre-Allocate for Performance

**Difficulty**: Advanced

Benchmark two versions of building a 10000-element slice:

```go
func noPreAlloc() []int {
    var s []int
    for i := 0; i < 10000; i++ { s = append(s, i) }
    return s
}

func preAlloc() []int {
    s := make([]int, 0, 10000)
    for i := 0; i < 10000; i++ { s = append(s, i) }
    return s
}
```

Run `go test -bench=.` and compare. Pre-allocated is ~2-3× faster.

---

## Task 9 — Atomic Pointer Map Snapshot

**Difficulty**: Advanced

```go
import "sync/atomic"

type Snapshot struct{ data map[string]int }
var snapshot atomic.Pointer[Snapshot]

func reload() {
    s := &Snapshot{data: loadFromDisk()}
    snapshot.Store(s)
}

func get(k string) int {
    return snapshot.Load().data[k]
}
```

Build a config-reload system using atomic.Pointer.

---

## Task 10 — Subslice Copy to Avoid Pinning

**Difficulty**: Advanced

```go
func extractFirst10(big []byte) []byte {
    // TODO: return independent 10-byte slice (not subslice)
    return nil
}

func main() {
    big := make([]byte, 1<<20) // 1 MB
    first := extractFirst10(big)
    big = nil
    runtime.GC()
    // first holds only 10 bytes; the 1 MB is freed
}
```
