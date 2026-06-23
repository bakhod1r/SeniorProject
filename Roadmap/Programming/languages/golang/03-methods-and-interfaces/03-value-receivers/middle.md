# Value Receivers — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Copying Semantics](#copying-semantics)
3. [Hidden Mutations via Reference Fields](#hidden-mutations-via-reference-fields)
4. [Method Set Implications](#method-set-implications)
5. [Value Receiver in Concurrency](#value-receiver-in-concurrency)
6. [Comparability and Hashability](#comparability-and-hashability)
7. [Receiver Choice Decision Tree](#receiver-choice-decision-tree)
8. [Patterns](#patterns)
9. [Test](#test)
10. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the junior level, we covered the basics of value receivers. At the middle level, we study the nuances:
- Copying mechanics and memory semantics
- Hidden mutations through reference fields (slice, map, pointer)
- Method set and interface satisfaction
- The importance of value receivers in concurrency
- Comparability and the `==` operator

---

## Copying Semantics

### Method invocation — a copy each time

```go
type Big struct{ data [1024]int }  // 8KB

func (b Big) Sum() int {
    sum := 0
    for _, v := range b.data { sum += v }
    return sum
}

big := Big{}
big.Sum()  // 8KB is copied to the stack on each call
```

### Compiler optimization

The compiler sometimes optimizes away the copy (via escape analysis):
- If the method body is small — it gets inlined and there's no copy.
- If the receiver fields aren't used — partial copy is possible.

Check with `go build -gcflags='-m'`.

### Stack vs heap

When a value receiver method is called:
- The receiver copy is usually on the stack
- Reasons for heap escape: return value, interface, goroutine

---

## Hidden Mutations via Reference Fields

### Slice field

```go
type Box struct{ items []int }

func (b Box) ZeroFirst() {
    b.items[0] = 0   // SLICE INDEX — underlying array
}

box := Box{items: []int{1, 2, 3}}
box.ZeroFirst()
fmt.Println(box.items)  // [0 2 3] — IT AFFECTED THE ORIGINAL!
```

Even though the slice header `b.items` is copied, the underlying array is the same — accessing it by index works.

### But append stays local

```go
func (b Box) Add(x int) {
    b.items = append(b.items, x)  // modifies the LOCAL header
}

box := Box{items: []int{1}}
box.Add(99)
fmt.Println(box.items)  // [1] — unchanged
```

`append` returns a slice header — but if we don't propagate it to the caller, it's lost.

### Map field

```go
type Cache struct{ m map[string]string }

func (c Cache) Set(k, v string) {
    c.m[k] = v   // AFFECTS THE ORIGINAL MAP
}

c := Cache{m: map[string]string{}}
c.Set("a", "1")
fmt.Println(c.m["a"])  // "1" — it took effect
```

The map header is a copy, but the actual map data is shared.

### Pointer field

```go
type Holder struct{ p *int }

func (h Holder) ZeroIt() { *h.p = 0 }   // affects the original via the pointer

n := 5
h := Holder{p: &n}
h.ZeroIt()
fmt.Println(n)  // 0
```

### Conclusion

A value receiver is not "fully immutable" — mutations can occur through reference fields. Keep this in mind.

---

## Method Set Implications

### Method set — again

```
T method set:    value receiver methods
*T method set:   value AND pointer receiver methods
```

### Interface satisfaction

```go
type I interface { M() }

type S struct{}
func (s S) M() {}    // value receiver

var _ I = S{}     // OK
var _ I = &S{}    // OK
```

Value receiver — both `T` and `*T` satisfy the interface.

### Assigning a pointer receiver method to a value type

```go
type S struct{}
func (s *S) M() {}    // pointer receiver

var _ I = S{}     // ERROR — M is in *T method set
var _ I = &S{}    // OK
```

### Mixed receivers — difficulty

```go
type S struct{}
func (s S)  Read()  {}      // value
func (s *S) Write() {}      // pointer

type Reader interface { Read() }
type Writer interface { Write() }
type ReadWriter interface { Read(); Write() }

var _ Reader = S{}            // OK
var _ Writer = S{}            // ERROR
var _ ReadWriter = S{}        // ERROR
var _ Writer = &S{}           // OK
var _ ReadWriter = &S{}       // OK
```

Mixed receivers — the caller must use `*T`. Avoid this if possible.

---

## Value Receiver in Concurrency

### Concurrent safety (immutable)

```go
type Config struct{ Port int; Debug bool }

func (c Config) HasDebug() bool { return c.Debug }

// If 1000 goroutines call concurrently — safe
// Each goroutine works with its own copy
```

Immutable value receiver — safe for concurrent use, no sync needed.

### But: be careful with reference fields

```go
type Holder struct{ data *atomic.Int64 }

// Method has a value receiver — Holder is copied, but the pointer is the same
func (h Holder) Inc() { h.data.Add(1) }
```

This is OK because `atomic.Int64` is thread-safe. But with a plain slice or map — race.

### Mutex value receiver — ERROR

```go
type X struct{ mu sync.Mutex }

func (x X) Lock() { x.mu.Lock() }   // BAD — the mutex is copied on each call
```

`go vet` issues a "passes lock by value" warning.

---

## Comparability and Hashability

### The `==` operator

A type written with value receiver methods is often **comparable**:

```go
type Color struct{ R, G, B uint8 }

a := Color{255, 0, 0}
b := Color{255, 0, 0}
fmt.Println(a == b)  // true
```

### As a map key

A comparable type can be a map key:

```go
counts := map[Color]int{}
counts[Color{255, 0, 0}]++
```

### Non-comparable types

| Type | Comparable? |
|-----|-------------|
| Slice | No (except checking against nil) |
| Map | No |
| Function | No |
| Struct (only comparable fields) | Yes |
| Struct (with slice/map/func field) | No |

```go
type S struct{ items []int }
// var m map[S]int  // COMPILE ERROR — S not comparable
```

### Hashable

A comparable type is automatically hashable — Go's map can use it.

---

## Receiver Choice Decision Tree

```
What is the method doing?
│
├── Mutates
│       └── POINTER
│
├── Read-only
│       │
│       ├── Type has mutex/sync?
│       │       └── POINTER (mandatory)
│       │
│       ├── Type is large (>32 bytes)?
│       │       └── POINTER (memory)
│       │
│       └── Otherwise
│               └── VALUE (immutable, simple)
│
└── Mixed logic?
        └── Pick one and stay consistent
```

### Practical rules

1. **Money, Color, Coordinate, ID** — value
2. **`time.Time`, `time.Duration`** — value (Go std)
3. **`bytes.Buffer`, `strings.Builder`** — pointer (Go std)
4. **`http.Client`, `sql.DB`** — pointer (Go std)
5. **Stringer/`error` (simple)** — usually value

---

## Patterns

### Pattern 1: Immutable update (wither)

```go
type Config struct{ port int; debug bool }

func (c Config) WithPort(p int) Config { c.port = p; return c }
func (c Config) WithDebug() Config     { c.debug = true; return c }

cfg := Config{}.WithPort(8080).WithDebug()
```

### Pattern 2: Value object equality

```go
type Date struct{ year, month, day int }

func (d Date) Equals(other Date) bool {
    return d == other  // Go automatic field-by-field
}

func (d Date) Before(other Date) bool {
    if d.year != other.year { return d.year < other.year }
    if d.month != other.month { return d.month < other.month }
    return d.day < other.day
}
```

### Pattern 3: Stringer

```go
type Status int
const ( Pending Status = iota; Active; Closed )

func (s Status) String() string {
    return [...]string{"pending", "active", "closed"}[s]
}
```

### Pattern 4: Functional method chain

```go
type Pipeline struct{ ops []func(int) int }

func (p Pipeline) Then(op func(int) int) Pipeline {
    return Pipeline{ops: append(p.ops, op)}  // immutable
}

func (p Pipeline) Run(x int) int {
    for _, op := range p.ops { x = op(x) }
    return x
}
```

---

## Test

### 1. With `time.Time` value receiver, does `time.Now().Add(d)` change the value?
**Answer:** No. `Add` returns a new `Time` — the original `time.Now()` is unchanged.

### 2. `func (b Box) ZeroFirst() { b.items[0] = 0 }` — does it affect the original?
**Answer:** Yes. The slice header is a copy, but the underlying array is the same. `b.items[0] = 0` reaches the original.

### 3. Method set: if `S` has a value method `M()`, is `M` in the `*S` method set?
**Answer:** Yes. The `*T` method set is wider — it includes both `T` and `*T` methods.

### 4. Writing a type with `sync.Mutex` using a value receiver?
**Answer:** Wrong. The mutex is copied on each call — no synchronization. `go vet` warning.

### 5. If I do `c = C{...}` inside a value receiver, does the original change?
**Answer:** No. `c` is a local copy. Without returning from the method — the change is not preserved.

---

## Cheat Sheet

```
COPYING SEMANTICS
─────────────────
Method call → receiver copy
Usually on the stack
Compiler inline → no copy

REFERENCE FIELD MUTATIONS
─────────────────
Slice/Map/Pointer fields — affect the original
append stays local (must be returned)

METHOD SET
─────────────────
Value receiver:  in T and *T method set
Pointer receiver: only *T

CONCURRENCY
─────────────────
Immutable value → each goroutine has a copy, safe
With Mutex → POINTER receiver required

COMPARABILITY
─────────────────
Value type + comparable fields → == works
Slice/map/func field → not comparable
Map key → must be comparable

RECEIVER CHOICE
─────────────────
Mutate? → pointer
Read-only?
  - Has mutex? → pointer
  - Large? → pointer
  - Otherwise → value
```

---

## Summary

At the middle level, value receiver:
- Copying semantics and memory impact
- Hidden mutations through reference fields (slice, map, pointer)
- Method set rules — value receiver belongs to both T and *T
- Immutable value receiver is safe for concurrent use
- Value receiver on a type with a mutex — race condition
- Comparable type — `==` and map key

At the senior level, we'll examine hashability, escape, and value semantics in greater depth.
