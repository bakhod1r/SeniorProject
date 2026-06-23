# Pointer Receivers — Interview Questions

## Junior

### Q1: What is a pointer receiver?
**Answer:** A method receiver in the form `*T` — bound to a pointer. Inside the method, `t` is of type `*T` and directly affects the original value.

```go
func (c *Counter) Inc() { c.n++ }
```

### Q2: Difference between pointer and value receiver?
**Answer:**
- **Value** — a copy of the receiver is taken, mutations are local
- **Pointer** — receiver is a pointer, mutations reach the original

### Q3: When should you choose a pointer receiver?
**Answer:**
1. The type needs to be modified
2. The type is large — copying is expensive
3. The type contains a mutex/atomic (mandatory)
4. Constructor returns `*T`

### Q4: Does `c.Inc()` work (Inc is a pointer receiver, c is a value)?
**Answer:** Yes, if `c` is addressable. Go automatically does `(&c).Inc()`.

### Q5: Does a pointer receiver method panic on nil?
**Answer:** It depends. If the method doesn't dereference the receiver — it's safe. Otherwise — panic.

---

## Middle

### Q6: Difference between method set of T and *T?
**Answer:**
- T method set: only T receiver methods
- *T method set: both T and *T receiver methods

### Q7: What does `m["k"].PtrMethod()` (m is `map[string]T`) produce?
**Answer:** Compile error. Map elements are not addressable. Solution: a temporary variable or `map[K]*V`.

### Q8: What receiver for a type containing a mutex?
**Answer:** Pointer — always. With a value receiver, the mutex is copied and there's no synchronization. `go vet` issues a "passes lock by value" warning.

### Q9: Embedding and method promotion?
**Answer:** Methods of the embedded type are promoted to the outer type:
- `type S struct { Base }` — value embed; T methods promoted, *T methods when S is addressable
- `type S struct { *Base }` — pointer embed; all methods promoted

### Q10: In what context is a value/pointer needed for interface satisfaction?
**Answer:** The concrete type's method set must cover the interface's methods. If there are pointer receiver methods, only `*T` satisfies the interface.

```go
type I interface{ M() }
type S struct{}
func (s *S) M() {}
var _ I = S{}     // ERROR
var _ I = &S{}    // OK
```

---

## Senior

### Q11: Escape analysis and pointer receiver?
**Answer:** A pointer receiver by itself is not a reason to escape. The reason for escape is the lifetime of the pointer (return, interface, goroutine). Check with `go build -gcflags='-m=2'`.

### Q12: What conventions does the standard library follow?
**Answer:**
- `*http.Client`, `*sql.DB`, `*bytes.Buffer` — pointer (resource/state)
- `time.Time`, `time.Duration` — value (immutable)
- `bytes.Buffer.String()` — value, the rest are pointer (special case)

### Q13: What is the `noCopy` marker and when is it used?
**Answer:** A marker for `go vet`'s copy detection. It prevents copying of types like Mutex/sync.WaitGroup and similar:

```go
type noCopy struct{}
func (*noCopy) Lock() {}
func (*noCopy) Unlock() {}

type SafeThing struct{ _ noCopy; mu sync.Mutex; ... }
```

### Q14: Is changing a pointer receiver in a public API breaking?
**Answer:** Yes. Changing the receiver type from value→pointer or vice versa is a breaking change. The method set changes and callers' code breaks.

### Q15: How should you protect a pointer receiver for concurrent access?
**Answer:**
1. Mutex (simple)
2. Atomic primitives (lock-free)
3. Channel-based ownership (one goroutine works, others communicate via channel)

---

## Tricky / Curveball

### Q16: What does the following code produce?
```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

c := C{}
fn := c.Inc
fn(); fn(); fn()
fmt.Println(c.n)
```
- a) 0
- b) 1
- c) 3
- d) Panic

**Answer: c — 3**

`c.Inc` is a method value — the `&c` pointer is captured in the closure. Each `fn()` call modifies the original `c`.

### Q17: What does the following code produce?
```go
type C struct{ n int }
func (c C) Inc() { c.n++ }

c := C{}
fn := c.Inc
fn(); fn(); fn()
fmt.Println(c.n)
```
- a) 0
- b) 1
- c) 3
- d) Panic

**Answer: a — 0**

Value receiver — `c` is captured as a copy inside `fn`. Each `fn()` call only modifies the copy.

### Q18: Calling a pointer-receiver method on a nil pointer when the method doesn't use the receiver?
```go
type Logger struct{}
func (l *Logger) Format(msg string) string { return msg }

var l *Logger
fmt.Println(l.Format("hi"))
```

**Answer:** OK, no panic. `l` is not used.

### Q19: Does this code compile?
```go
type T struct{}
func (t T) A() {}
func (t *T) A() {}
```

**Answer:** No. `A` cannot be declared twice for the same type.

### Q20: Map[K]*V vs Map[K]V — when which?
**Answer:**
- `map[K]V` — value items (small, immutable)
- `map[K]*V` — when the value needs to be modified or is large

You cannot call a pointer receiver method on `map[K]V` (addressability).

---

## Coding Tasks

### Task 1: Implement a Counter

```go
type Counter struct{ n int }
func (c *Counter) Inc()     { c.n++ }
func (c *Counter) Dec()     { c.n-- }
func (c *Counter) Reset()   { c.n = 0 }
func (c Counter)  Value() int { return c.n }
```

### Task 2: SafeCounter (concurrent-safe)

```go
type SafeCounter struct {
    _  noCopy
    mu sync.Mutex
    n  int
}

func (c *SafeCounter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
func (c *SafeCounter) Value() int {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.n
}
```

### Task 3: Linked list

```go
type Node struct{ Value int; Next *Node }
type List struct{ Head *Node }

func (l *List) PushFront(v int) {
    l.Head = &Node{Value: v, Next: l.Head}
}

func (l *List) Reverse() {
    var prev *Node
    curr := l.Head
    for curr != nil {
        next := curr.Next
        curr.Next = prev
        prev = curr
        curr = next
    }
    l.Head = prev
}
```

### Task 4: Resource cleanup

```go
type DB struct{ conn *sql.DB }

func NewDB(dsn string) (*DB, error) {
    conn, err := sql.Open("postgres", dsn)
    if err != nil { return nil, err }
    return &DB{conn: conn}, nil
}

func (d *DB) Close() error { return d.conn.Close() }
```

### Task 5: Builder

```go
type Req struct{ url, method string }
type ReqBuilder struct{ r Req }

func New() *ReqBuilder              { return &ReqBuilder{r: Req{method: "GET"}} }
func (b *ReqBuilder) URL(u string) *ReqBuilder    { b.r.url = u; return b }
func (b *ReqBuilder) Method(m string) *ReqBuilder { b.r.method = m; return b }
func (b *ReqBuilder) Build() Req                  { return b.r }
```

---

## What Interviewers Look For

| Level  | Expected |
|--------|----------|
| Junior | Pointer/value difference, when needed, syntax |
| Middle | Method set, addressability, mutex|pointer pair |
| Senior | Escape, memory, std lib conventions, concurrency |
| Pro    | Library design, API stability, conventions |
