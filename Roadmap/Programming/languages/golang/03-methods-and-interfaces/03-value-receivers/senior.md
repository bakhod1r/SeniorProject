# Value Receivers — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Memory Layout and Copy Cost](#memory-layout-and-copy-cost)
3. [Escape Analysis with Value Receivers](#escape-analysis-with-value-receivers)
4. [Standard Library Patterns](#standard-library-patterns)
5. [Immutability as a Discipline](#immutability-as-a-discipline)
6. [Comparable Types and Map Keys](#comparable-types-and-map-keys)
7. [Inline Optimization](#inline-optimization)
8. [Generic Value Types](#generic-value-types)
9. [Anti-patterns](#anti-patterns)
10. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the senior level, value receivers cover:
- Memory layout and copy cost mechanics
- Interaction with escape analysis
- The conventions the standard library follows
- Immutability as a discipline
- Generic types combined with value receivers

---

## Memory Layout and Copy Cost

### Struct memory layout

```go
type Point struct {
    X int  // 8 bytes
    Y int  // 8 bytes
}
// total: 16 bytes
```

When passed to a method — a 16-byte copy. That is a register-level copy on modern CPUs.

### Padding

```go
type Bad struct {
    a bool   // 1 byte + 7 padding
    b int64  // 8 bytes
    c bool   // 1 byte + 7 padding
}
// total: 24 bytes

type Good struct {
    b int64  // 8 bytes
    a bool   // 1 byte
    c bool   // 1 byte + 6 padding
}
// total: 16 bytes
```

Field order matters — minimizing padding reduces copy cost.

### Cache line

A CPU cache line is 64 bytes. If a type is ≤ 64 bytes, it fits into a single cache line and reads are very fast.

### Benchmark

```go
type Small struct{ X, Y int }     // 16 bytes
type Medium struct{ d [8]int64 }  // 64 bytes
type Big struct{ d [128]int64 }   // 1024 bytes

func (s Small)  V() int { return s.X + s.Y }
func (s *Small) P() int { return s.X + s.Y }

func (m Medium)  V() int { return m.d[0] }
func (m *Medium) P() int { return m.d[0] }

func (b Big)  V() int { return b.d[0] }
func (b *Big) P() int { return b.d[0] }
```

Typical results:
- Small: V faster (no deref)
- Medium: V vs P about the same
- Big: P faster (8KB copy is expensive)

---

## Escape Analysis with Value Receivers

### Receiver value typically lives on the stack

```go
func main() {
    p := Point{3, 4}  // stack
    p.DistSq()        // p is stack-copied into the method body
}
```

`go build -gcflags='-m'` reports: "p does not escape".

### A value returned from a method escapes to the caller

```go
func (m Money) Add(o Money) Money {
    return Money{m.cents + o.cents}  // return value goes to the caller's stack
}

func main() {
    a := Money{100}
    b := Money{50}
    c := a.Add(b)  // c on the stack
}
```

Nothing escapes to the heap.

### Interface escape

```go
type Stringer interface { String() string }

type S struct{ name string }
func (s S) String() string { return s.name }

func main() {
    s := S{name: "x"}
    var i Stringer = s   // s escapes to the heap (interface value)
    i.String()
}
```

The value is stored inside the interface — typically on the heap.

---

## Standard Library Patterns

### `time.Time` — value semantics

```go
type Time struct {
    wall uint64
    ext  int64
    loc  *Location
}

func (t Time) Add(d Duration) Time { ... }
func (t Time) Before(u Time) bool  { ... }
func (t Time) Format(layout string) string { ... }
```

`Time` is 24 bytes — value receiver is preferred. It is immutable — `Add` returns a new `Time`.

### `time.Duration` — alias

```go
type Duration int64
func (d Duration) Hours() float64 { return float64(d) / float64(Hour) }
func (d Duration) String() string { ... }
```

An alias for a built-in type — value receiver is natural.

### `net.IP` — slice alias

```go
type IP []byte

func (ip IP) String() string { ... }
func (ip IP) To4() IP { ... }
```

Slice value receiver — the header is copied (24 bytes), but the underlying bytes are shared.

### `image/color.Color`

```go
type Color interface {
    RGBA() (r, g, b, a uint32)
}

type RGBA struct { R, G, B, A uint8 }
func (c RGBA) RGBA() (r, g, b, a uint32) { ... }
```

Value receiver — small struct, immutable.

### `math/big.Int` — pointer

```go
type Int struct{ neg bool; abs nat }

func (z *Int) Add(x, y *Int) *Int { ... }
```

`big.Int` is mutable — pointer receiver. It is a state accumulator.

---

## Immutability as a Discipline

### Why immutability matters

1. **Thread safety** — no synchronization needed
2. **Reasoning** — the value never changes
3. **Equality** — `==` is reliable
4. **Hashability** — can be used as a map key

### Discipline tips

**1. `With*` prefix for immutable updates:**

```go
type Config struct{ port int; debug bool }

func (c Config) WithPort(p int) Config { c.port = p; return c }
```

**2. Be careful with reference fields:**

```go
type Box struct{ items []int }

// BAD — items shared, mutation is dangerous
func (b Box) GetItems() []int { return b.items }

// GOOD — defensive copy
func (b Box) GetItems() []int {
    out := make([]int, len(b.items))
    copy(out, b.items)
    return out
}
```

**3. The constructor controls the inputs:**

```go
func NewBox(items []int) Box {
    cp := make([]int, len(items))
    copy(cp, items)
    return Box{items: cp}
}
```

**4. Documentation — "immutable":**

```go
// Money represents a monetary amount.
//
// Money is immutable. All methods return new Money instances.
type Money struct { ... }
```

---

## Comparable Types and Map Keys

### Comparable rules

A value type is comparable when:
1. All of its fields are comparable
2. It has no slice/map/function fields

```go
type Coord struct{ X, Y int }       // comparable
type Tagged struct{ Coord; tag string } // comparable

type Bag struct{ items []int }   // NOT comparable (slice)
```

### As a map key

```go
type Vec3 struct{ X, Y, Z float64 }

cache := map[Vec3]string{}
cache[Vec3{1, 2, 3}] = "north"
```

### When custom equality is needed

```go
type FuzzyVec struct { X, Y float64 }

// `==` gives exact equality
// A method for fuzzy comparison
func (a FuzzyVec) ApproxEqual(b FuzzyVec, eps float64) bool {
    return math.Abs(a.X-b.X) < eps && math.Abs(a.Y-b.Y) < eps
}
```

### Generic comparable constraint (Go 1.18+)

```go
func Find[T comparable](items []T, target T) int {
    for i, v := range items {
        if v == target { return i }
    }
    return -1
}
```

---

## Inline Optimization

### Inline candidates

The compiler can inline value receiver methods:

```go
func (p Point) X() int { return p.x }   // inline
```

**Helps inlining:**
- Small method body
- No defer (Go 1.13+ has open-coded defer)
- No recover
- No side effects

**Breaks inlining:**
- defer (older Go)
- recover
- Spawning a goroutine
- Large body

```bash
go build -gcflags='-m' main.go
# can inline (Point).X
# inlining call to (Point).X
```

### Forced inline (does not exist)

Go has no `inline` keyword. The compiler decides on its own. There is `//go:noinline` (to disable inlining), but no way to force inlining.

---

## Generic Value Types

### Value receiver on a generic type

```go
type Pair[A, B any] struct { First A; Second B }

func (p Pair[A, B]) Swap() Pair[B, A] {
    return Pair[B, A]{First: p.Second, Second: p.First}
}
```

The type parameter list is repeated on the receiver.

### Constraint with comparable

```go
type Set[T comparable] struct { m map[T]struct{} }

func (s Set[T]) Has(x T) bool {
    _, ok := s.m[x]
    return ok
}
```

`comparable` constraint — enables `==`.

### Generic shape & monomorphization

For value types, generics produce one instantiation per shape:
- Pointer/interface type → one shared dispatch
- Scalar/struct type → a separate instantiation (faster)

```go
type Box[T any] struct { val T }
func (b Box[T]) Get() T { return b.val }

// Box[int] — separate instantiation
// Box[*Node] — separate instantiation (but pointer shape is widely shared)
```

---

## Anti-patterns

### 1. Mutating in a value receiver

```go
// BAD — has no effect
func (c C) Inc() { c.n++ }
```

### 2. Mutex on a value receiver

```go
// BAD
type X struct { mu sync.Mutex }
func (x X) M() { x.mu.Lock() }
```

### 3. Large type on a value receiver

```go
// BAD — expensive on every call
type Big struct { data [10000]int }
func (b Big) Process() { ... }
```

### 4. Mixed receivers

```go
// BAD — inconsistent method set
type S struct{}
func (s S)  Get() int  { ... }
func (s *S) Set(x int) { ... }
```

### 5. Forgetting defensive copy

```go
type Box struct { items []int }
func (b Box) Items() []int { return b.items }   // risk of shared mutation

// GOOD
func (b Box) Items() []int {
    out := make([]int, len(b.items))
    copy(out, b.items)
    return out
}
```

---

## Cheat Sheet

```
SENIOR-LEVEL VALUE RECEIVER
─────────────────────────────
Memory layout — mind the padding
Copy cost — small/medium/big
Escape — interface/return/goroutine
Standard library — Time, Duration, IP, RGBA value; Buffer, Builder pointer

IMMUTABILITY DISCIPLINE
─────────────────────────────
With* prefix — immutable update
Defensive copy — slice/map fields
Constructor — copy the input
Documentation — write "Immutable"

COMPARABILITY
─────────────────────────────
All comparable fields → struct is comparable
Slice/map/func field → not comparable
Map key requires comparable

INLINE
─────────────────────────────
Small body is preferred for inlining
defer/recover/goroutine break inlining
Check with go build -gcflags='-m'

GENERIC
─────────────────────────────
Type parameter list is repeated on the receiver
comparable constraint — for ==
Monomorphization is per shape
```

---

## Summary

At the senior level, value receivers cover:
- Memory layout and copy cost — type size matters
- Escape analysis — interface/return values escape to the heap
- Standard library — small/immutable values use values, big/stateful types use pointers
- Immutability — discipline and defensive copy
- Comparability — `==` and map keys
- Inline — a small body is preferred
- Generics — type parameter list on the receiver

A value receiver is one of Go's simple yet powerful tools. Used correctly, it simplifies reading, testing, and concurrency in code.
