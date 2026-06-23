# Go Pointers Basics — Tasks

## Instructions

Each task has a description, starter code, expected output, and an evaluation checklist. Use pointers for mutation; values for read-only.

---

## Task 1 — Increment Through Pointer

**Difficulty**: Beginner
**Topic**: `*T`, `&`, `*`

**Description**: Implement `incr(p *int)` that increments `*p`.

**Starter Code**:
```go
package main

import "fmt"

func incr(p *int) {
    // TODO
}

func main() {
    n := 5
    incr(&n)
    incr(&n)
    fmt.Println(n) // 7
}
```

**Expected Output**:
```
7
```

**Evaluation Checklist**:
- [ ] Takes `*int`
- [ ] Dereferences with `*p++`
- [ ] Caller mutates via `&n`

---

## Task 2 — Nil Check

**Difficulty**: Beginner

**Description**: Implement `safeDeref(p *int) int` returning `*p` or 0 if nil.

```go
func safeDeref(p *int) int {
    // TODO
    return 0
}

func main() {
    fmt.Println(safeDeref(nil))   // 0
    n := 42
    fmt.Println(safeDeref(&n))    // 42
}
```

**Evaluation Checklist**:
- [ ] Returns 0 for nil
- [ ] Returns *p otherwise
- [ ] No panic

---

## Task 3 — Constructor Pattern

**Difficulty**: Beginner

**Description**: Implement `NewPoint(x, y int) *Point` that allocates a Point.

```go
type Point struct{ X, Y int }
func NewPoint(x, y int) *Point {
    // TODO
    return nil
}

func main() {
    p := NewPoint(3, 4)
    fmt.Println(p) // &{3 4}
}
```

**Evaluation Checklist**:
- [ ] Returns `*Point`
- [ ] Allocates with `&Point{...}`
- [ ] Fields set correctly

---

## Task 4 — Mutate Struct Field

**Difficulty**: Intermediate

**Description**: Implement `(*User) SetName(name string)` to update the user.

```go
type User struct{ Name string; Age int }
// TODO: SetName method

func main() {
    u := &User{Name: "old", Age: 30}
    u.SetName("Ada")
    fmt.Println(u.Name) // Ada
}
```

**Evaluation Checklist**:
- [ ] Pointer receiver
- [ ] Sets u.Name
- [ ] Caller's u updated

---

## Task 5 — Optional Pointer Field

**Difficulty**: Intermediate

**Description**: A `Settings` struct with `*int Threshold` (nil = no threshold). Implement `Apply(value int) bool` returning true if value passes (value >= threshold or threshold is nil).

```go
type Settings struct{ Threshold *int }
func (s *Settings) Apply(value int) bool {
    // TODO
    return false
}

func main() {
    fmt.Println((&Settings{}).Apply(5))                    // true
    t := 10
    fmt.Println((&Settings{Threshold: &t}).Apply(5))       // false
    fmt.Println((&Settings{Threshold: &t}).Apply(15))      // true
}
```

**Evaluation Checklist**:
- [ ] Nil Threshold means no constraint
- [ ] Non-nil compares value >= *Threshold

---

## Task 6 — Linked List

**Difficulty**: Intermediate

**Description**: Build a singly linked list with `Push(v int)` and `String() string`.

```go
type Node struct { Value int; Next *Node }
type List struct { Head *Node }

func (l *List) Push(v int) {
    // TODO: prepend
}

func (l *List) String() string {
    // TODO
    return ""
}

func main() {
    l := &List{}
    l.Push(1); l.Push(2); l.Push(3)
    fmt.Println(l) // [3 2 1]
}
```

**Evaluation Checklist**:
- [ ] Push prepends
- [ ] String walks the list
- [ ] Empty list prints `[]`

---

## Task 7 — Generic ptrTo Helper

**Difficulty**: Intermediate

**Description**: Implement `ptrTo[T any](v T) *T`. Use it for optionals.

```go
func ptrTo[T any](v T) *T {
    // TODO
    return nil
}

func main() {
    p := ptrTo(42)
    s := ptrTo("hi")
    fmt.Println(*p, *s)
}
```

**Evaluation Checklist**:
- [ ] Generic
- [ ] Returns &v
- [ ] Works with any type

---

## Task 8 — Swap Two Variables

**Difficulty**: Intermediate

**Description**: Implement `swap(a, b *int)` that exchanges their values.

```go
func swap(a, b *int) {
    // TODO
}

func main() {
    x, y := 1, 2
    swap(&x, &y)
    fmt.Println(x, y) // 2 1
}
```

**Evaluation Checklist**:
- [ ] Uses *a and *b
- [ ] Tuple swap or temp variable
- [ ] Both caller variables updated

---

## Task 9 — Atomic Pointer

**Difficulty**: Advanced

**Description**: Use `atomic.Pointer[Config]` to share immutable configs between goroutines.

```go
import "sync/atomic"

type Config struct { Verbose bool }

var configPtr atomic.Pointer[Config]

func main() {
    configPtr.Store(&Config{Verbose: false})
    go func() {
        configPtr.Store(&Config{Verbose: true})
    }()
    
    // Read snapshot at any time:
    cfg := configPtr.Load()
    fmt.Println(cfg.Verbose)
}
```

**Evaluation Checklist**:
- [ ] Uses atomic.Pointer[Config]
- [ ] Store and Load methods
- [ ] No data race even with concurrent writers

---

## Task 10 — Pool Reusable Buffers

**Difficulty**: Advanced

**Description**: Use `sync.Pool` to reuse `*Buffer` instances.

```go
import "sync"

type Buffer struct { Data [1024]byte }
func (b *Buffer) Reset() { /* clear */ }

var pool = sync.Pool{
    New: func() any { return new(Buffer) },
}

func use() {
    b := pool.Get().(*Buffer)
    defer func() {
        b.Reset()
        pool.Put(b)
    }()
    // ... use b ...
}

func main() {
    for i := 0; i < 100; i++ { use() }
    fmt.Println("done")
}
```

**Evaluation Checklist**:
- [ ] Pool.Get returns *Buffer
- [ ] Reset before Put
- [ ] Repeated use doesn't leak
