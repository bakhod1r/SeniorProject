# Value Receivers — Interview Questions

## Junior

### Q1: What is a value receiver?
**Answer:** The receiver type has the form `T` (no asterisk). A copy of the receiver is passed to the method. The original value does not change.

### Q2: When should you choose a value receiver?
**Answer:**
- Immutable value object (Money, Color)
- Read-only operation
- Small type
- Built-in type alias

### Q3: What is `t` actually inside the method?
**Answer:** A **copy** of the receiver — a local variable. `t.field = ...` only modifies the copy.

### Q4: How does `c.Inc()` (Inc with value receiver) work?
**Answer:** Go passes a copy of `c` to the Inc method. Mutations inside the method stay local.

### Q5: Immutable update by returning from a method?
**Answer:** The method returns a new value:
```go
func (m Money) Add(o Money) Money {
    return Money{cents: m.cents + o.cents}
}
```

---

## Middle

### Q6: Does a slice field mutate through a value receiver?
**Answer:** The slice header is copied, but the underlying array is the same. Index access affects the original. Append, however, stays local.

```go
type Box struct{ items []int }
func (b Box) ZeroFirst() { b.items[0] = 0 }   // affects the original
func (b Box) Add(x int)  { b.items = append(b.items, x) }  // local
```

### Q7: Mutex with a value receiver — what happens?
**Answer:** On every call the mutex and fields are copied. No synchronization. Race condition. `go vet` warning.

### Q8: Does a value receiver method belong to both T and *T method sets?
**Answer:** Yes. A value receiver method is in both method sets.

### Q9: How does the `==` operator work with a value receiver?
**Answer:** If the struct is comparable (all fields comparable), `==` checks field by field.

### Q10: What is required for a map key?
**Answer:** A comparable type. A struct with slice/map/function fields cannot be a map key.

---

## Senior

### Q11: When does a value receiver escape?
**Answer:**
- A value returned from a method to the caller (often stays on the stack)
- Assignment to an interface — heap escape
- Passing to a goroutine — heap escape

### Q12: Which receiver does `time.Time` use and why?
**Answer:** Value. `Time` is immutable — `Add`, `Sub` return a new `Time`. 24 bytes — small. Concurrent safe.

### Q13: Which receiver does `bytes.Buffer` use?
**Answer:** Pointer. State accumulator — `Write` mutates. It has a `noCopy` marker.

### Q14: Why use a defensive copy with a value receiver?
**Answer:** Slice/map fields are shared — the caller can affect the original. Defensive copy:
```go
func (b Box) Items() []int {
    out := make([]int, len(b.items))
    copy(out, b.items)
    return out
}
```

### Q15: Inlining and value receivers?
**Answer:** Small value receiver methods are good candidates for inlining. `go build -gcflags='-m'` shows it.

---

## Tricky

### Q16: What does the following code print?
```go
type C struct{ items []int }
func (c C) Modify() { c.items[0] = 99 }

c := C{items: []int{1, 2, 3}}
c.Modify()
fmt.Println(c.items)
```
- a) [1 2 3]
- b) [99 2 3]

**Answer: b** — the slice's underlying array is shared.

### Q17: What does the following code print?
```go
type C struct{ items []int }
func (c C) Append(x int) { c.items = append(c.items, x) }

c := C{items: []int{1}}
c.Append(99)
fmt.Println(c.items)
```
- a) [1]
- b) [1 99]

**Answer: a** — the appended slice header stays local.

### Q18: Does `time.Now().Add(time.Hour)` modify the original `time.Now()`?
**Answer:** No. `Add` returns a new `Time`.

### Q19: Does `Box{items: []int}` work as a map key?
**Answer:** No. A struct with a slice field is not comparable — it cannot be a map key.

### Q20: Recursive method with a value receiver?
**Answer:** Possible, but a copy is taken on every call. For linked list traversal, a pointer receiver is better.

---

## Coding Tasks

### Task 1: Money type

```go
type Currency string

type Money struct {
    cents    int64
    currency Currency
}

func (m Money) Add(o Money) (Money, error) {
    if m.currency != o.currency {
        return Money{}, errors.New("currency mismatch")
    }
    return Money{cents: m.cents + o.cents, currency: m.currency}, nil
}

func (m Money) Format() string {
    return fmt.Sprintf("%.2f %s", float64(m.cents)/100, m.currency)
}
```

### Task 2: Vec2

```go
type Vec2 struct{ X, Y float64 }

func (v Vec2) Add(o Vec2) Vec2     { return Vec2{v.X + o.X, v.Y + o.Y} }
func (v Vec2) Scale(s float64) Vec2 { return Vec2{v.X * s, v.Y * s} }
func (v Vec2) Length() float64      { return math.Hypot(v.X, v.Y) }
```

### Task 3: Stringer

```go
type Status int
const ( Pending Status = iota; Active; Closed )

func (s Status) String() string {
    return [...]string{"pending", "active", "closed"}[s]
}
```

### Task 4: Specification

```go
type AgeAbove struct{ Min int }
func (s AgeAbove) IsSatisfiedBy(u User) bool { return u.Age >= s.Min }

type And struct{ A, B Specification }
func (s And) IsSatisfiedBy(u User) bool {
    return s.A.IsSatisfiedBy(u) && s.B.IsSatisfiedBy(u)
}
```

### Task 5: Wither

```go
type Config struct{ port int; debug bool }

func (c Config) WithPort(p int)  Config { c.port = p; return c }
func (c Config) WithDebug() Config      { c.debug = true; return c }

cfg := Config{}.WithPort(8080).WithDebug()
```
