# Go Pointers Basics — Middle Level

## 1. Introduction

At the middle level, you reason precisely about pointers as **typed memory addresses with escape analysis**: when they're stack vs heap, when to use them vs values, the safety they provide vs the complexity they add, and the patterns they enable (sharing, optional values, linked structures).

---

## 2. Prerequisites
- Junior-level pointers material
- Call by value (2.6.7)
- Basic understanding of memory and the stack/heap distinction

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Escape | When a variable's lifetime exceeds its enclosing function |
| Stack allocation | Variable stored in the goroutine stack frame |
| Heap allocation | Variable stored on the GC-managed heap |
| Aliasing | Multiple pointers/references to the same memory |
| `unsafe.Pointer` | Untyped pointer for low-level operations |
| `uintptr` | Integer type capable of holding a pointer value |
| Pointer receiver | Method receiver of pointer type (`*T`) |
| Constructor | Function returning a pointer to a freshly-allocated value |

---

## 4. Core Concepts

### 4.1 Pointers and Escape Analysis

The compiler decides per-allocation:
- If a pointer to a local doesn't escape, the local stays on the stack.
- If it escapes (returned, stored in global, captured by escaping closure), heap-allocated.

```go
func stays() int {
    n := 5
    p := &n // p doesn't escape
    return *p // n stays on stack
}

func escapes() *int {
    n := 5
    return &n // n escapes; allocated on heap
}
```

Verify with `go build -gcflags="-m"`.

### 4.2 Pointer to Variable vs Pointer to Composite Literal

```go
n := 5
p1 := &n           // p1 points to n on the stack (or heap if n escapes)

p2 := &Point{X: 1} // composite literal allocates a new Point; p2 points to it
```

Both are addressable expressions; both yield valid pointers.

### 4.3 Pointer Receivers vs Value Receivers

```go
type Counter struct{ n int }

func (c Counter) Show() { fmt.Println(c.n) }    // value receiver — copy
func (c *Counter) Inc()  { c.n++ }                // pointer receiver — original
```

Choose pointer receivers when:
- The method mutates the receiver.
- The receiver is large (avoid copy).
- For consistency with other methods on the type.

Choose value receivers when:
- The method only reads.
- The type is small.
- Immutability is desired.

### 4.4 Method Set Rules

For interface satisfaction, the method set depends on receiver type:

| Receiver | Available on |
|----------|--------------|
| `func (T)` | T and *T |
| `func (*T)` | *T only (not on bare T) |

So if you have a value `t T` and an interface requires methods with `*T` receivers, you must use `&t`.

### 4.5 Pointer Comparison

```go
p1 := new(int)
p2 := new(int)
p3 := p1

fmt.Println(p1 == p2)  // false (different addresses)
fmt.Println(p1 == p3)  // true (same address)
fmt.Println(p1 == nil) // false
```

Pointers are comparable; equality is address equality.

### 4.6 `unsafe.Pointer` Bridge

```go
import "unsafe"

x := int64(42)
p := &x
up := unsafe.Pointer(p)        // *int64 → unsafe.Pointer
up2 := unsafe.Pointer(uintptr(up) + 4) // arithmetic via uintptr (DANGEROUS)
```

`unsafe.Pointer` allows casting between any pointer types and `uintptr`. Use only for low-level interop with C, runtime, or specific tricks. Most code should never use it.

---

## 5. Real-World Analogies

**A real-estate broker's listing**: the listing has a property address. The broker can pass the address to multiple agents. They all reach the same property. Modifying the property (renovating) is visible through any agent's reference.

**A library card**: the card grants access to a shared book. Multiple cards (pointers) can access the same book. Damaging the book affects everyone.

---

## 6. Mental Models

### Model 1 — Pointer as Address + Type

```
*int   = "pointer to a memory location holding an int"
*Point = "pointer to a memory location holding a Point struct"
```

Each pointer carries:
- The address (8 B on 64-bit).
- The type (compile-time only; doesn't take runtime space).

### Model 2 — Stack vs Heap Decision

```
Compile time:
  Does the pointer escape?
    - returned from function?
    - stored in global?
    - captured by escaping closure?
  → If yes: heap.
  → If no: stack.

Runtime:
  Stack: freed at function return.
  Heap: tracked by GC, freed when no pointers remain.
```

---

## 7. Pros & Cons

### Pros
- Mutation through function calls
- Sharing without copying
- Optional values via nil
- Linked data structures
- Method-receiver semantics

### Cons
- Nil dereference panics
- Aliasing bugs (concurrent or sequential)
- Indirection cost (small)
- Heap allocation when escaping (GC pressure)

---

## 8. Use Cases

1. Mutator functions and methods.
2. Constructors returning new objects.
3. Optional fields (nil = absent).
4. Linked lists, trees, graphs.
5. Caching/sharing expensive objects.
6. Method values bound to receivers.

---

## 9. Code Examples

### Example 1 — Constructor Pattern
```go
package main

import "fmt"

type Server struct {
    Addr string
    Port int
}

func NewServer(addr string, port int) *Server {
    return &Server{Addr: addr, Port: port}
}

func main() {
    s := NewServer("localhost", 8080)
    fmt.Println(s)
}
```

### Example 2 — Optional Field via Pointer
```go
package main

import "fmt"

type Config struct {
    Timeout *int // nil means "use default"
}

func handle(c *Config) {
    timeout := 30
    if c.Timeout != nil {
        timeout = *c.Timeout
    }
    fmt.Println("using timeout:", timeout)
}

func main() {
    handle(&Config{})              // 30
    t := 60
    handle(&Config{Timeout: &t})   // 60
}
```

### Example 3 — Linked List
```go
package main

import "fmt"

type Node struct {
    Value int
    Next  *Node
}

func print(n *Node) {
    for ; n != nil; n = n.Next {
        fmt.Print(n.Value, " ")
    }
    fmt.Println()
}

func main() {
    head := &Node{Value: 1, Next: &Node{Value: 2, Next: &Node{Value: 3}}}
    print(head) // 1 2 3
}
```

### Example 4 — Pointer Receivers Throughout
```go
package main

import "fmt"

type Counter struct{ n int }
func (c *Counter) Inc()       { c.n++ }
func (c *Counter) Get() int   { return c.n }
func (c *Counter) Reset()     { c.n = 0 }

func main() {
    c := &Counter{}
    c.Inc(); c.Inc(); c.Inc()
    fmt.Println(c.Get()) // 3
    c.Reset()
    fmt.Println(c.Get()) // 0
}
```

### Example 5 — Pointer in Interface
```go
package main

import "fmt"

type Shape interface{ Area() float64 }

type Circle struct{ R float64 }
func (c *Circle) Area() float64 { return 3.14 * c.R * c.R }

func main() {
    var s Shape = &Circle{R: 2}
    fmt.Println(s.Area()) // 12.56
}
```

`*Circle` satisfies `Shape` because of the pointer receiver. `Circle{}` value would NOT satisfy unless the method had a value receiver.

### Example 6 — Pointer Helper for Optionals
```go
package main

import "fmt"

func ptrTo[T any](v T) *T {
    return &v
}

type Settings struct {
    Enabled *bool
    Name    *string
}

func main() {
    s := Settings{
        Enabled: ptrTo(true),
        Name:    ptrTo("ada"),
    }
    fmt.Printf("enabled=%v name=%v\n", *s.Enabled, *s.Name)
}
```

---

## 10. Coding Patterns

### Pattern 1 — Constructor
```go
func New(args ...) *T { return &T{...} }
```

### Pattern 2 — Builder Returning *T
```go
func (b *Builder) WithX(x string) *Builder { b.x = x; return b }
b := New().WithX("a").WithY("b")
```

### Pattern 3 — Optional Pointer Field
```go
type Opts struct {
    Timeout *time.Duration // nil means default
}
```

### Pattern 4 — Mutating Helper
```go
func (s *Service) SetName(n string) { s.Name = n }
```

### Pattern 5 — Pointer to Pointer (rare)
```go
func setSlice(sp **[]int) { *sp = &[]int{99} }
```

---

## 11. Clean Code Guidelines

1. **Use pointers consistently** for a type that has any pointer-receiver method.
2. **Document what nil means** for optional pointer fields.
3. **Return pointers from constructors** (`func NewT() *T`).
4. **Avoid `**T`** unless absolutely necessary.
5. **Nil-check at API boundaries**.
6. **Prefer composite literals + `&`** over `new` when initializing.

---

## 12. Product Use / Feature Example

**A pluggable handler with optional configuration**:

```go
package main

import "fmt"

type Config struct {
    Verbose bool
    Logger  *Logger // optional; nil disables logging
}

type Logger struct {
    Prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Println("[" + l.Prefix + "]", msg)
}

func handle(cfg *Config) {
    if cfg.Verbose {
        fmt.Println("verbose mode on")
    }
    if cfg.Logger != nil {
        cfg.Logger.Log("handled")
    }
}

func main() {
    cfg := &Config{Verbose: true, Logger: &Logger{Prefix: "APP"}}
    handle(cfg)
}
```

The pointer to Logger is optional; nil bypasses logging.

---

## 13. Error Handling

```go
func get(id int) (*User, error) {
    if id <= 0 {
        return nil, fmt.Errorf("invalid id")
    }
    u, ok := users[id]
    if !ok {
        return nil, fmt.Errorf("not found")
    }
    return u, nil
}

u, err := get(1)
if err != nil { return err }
// safe: u is non-nil
```

---

## 14. Security Considerations

1. **Nil pointers from external data** can crash your program.
2. **Returning pointers to internal mutable state** lets callers modify it.
3. **Aliased pointers across goroutines** require synchronization.
4. **Wipe sensitive data** through pointers when done (`*p = SecretType{}`).

---

## 15. Performance Tips

1. **Pointer pass: 8 B**. Free.
2. **Value pass small types: free** (registers).
3. **Value pass large types: expensive** (memcpy).
4. **Pointer indirection: 1-2 cycles per dereference**.
5. **Heap allocation cost: ~25 ns + GC tracking**.
6. **Stack allocation: free**.

For hot paths, prefer values when small, pointers when large; verify with profile.

---

## 16. Metrics & Analytics

```go
type Metric struct {
    Name string
    Tags []string
    Value float64
}

func emit(m *Metric) {
    if m == nil { return }
    fmt.Printf("[%s] %v %f\n", m.Name, m.Tags, m.Value)
}
```

---

## 17. Best Practices

1. Use pointer receivers consistently per type.
2. Use constructors returning pointers.
3. Document nil semantics for optional fields.
4. Always nil-check at API boundaries.
5. Avoid `**T` and `unsafe.Pointer`.
6. Prefer `&T{...}` over `new(T)` when initializing fields.
7. Verify escape behavior with `-gcflags="-m"`.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Nil Receiver Method Call
```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

var t *T
t.Inc() // panic: nil pointer dereference
```

### Pitfall 2 — Returning Pointer to Local
Generally safe (escape analysis), but the local moves to the heap. Be aware:
```go
func make() *int {
    n := 5
    return &n // n on heap; per-call alloc
}
```

### Pitfall 3 — Pointer Receiver on Non-Addressable Value
```go
m := map[string]Counter{"a": {n: 1}}
// m["a"].Inc() // compile error: cannot call pointer method on m["a"]
```
Workaround: store pointers, or extract-mutate-restore.

### Pitfall 4 — Address of Loop Variable (Pre 1.22)
```go
for _, x := range items {
    ptrs = append(ptrs, &x) // pre-1.22: all same pointer
}
```

### Pitfall 5 — Aliasing
```go
p1 := &someVar
p2 := p1
*p1 = newValue
fmt.Println(*p2) // sees newValue (aliased)
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgetting nil check before deref | Add `if p != nil` |
| Mixing value and pointer receivers | Be consistent per type |
| Calling pointer method on non-addressable value | Store pointer or extract |
| Pre-1.22 loop var pointer capture | Shadow or upgrade |
| Returning unsafe pointer to internal state | Defensive copy |

---

## 20. Common Misconceptions

**Misconception 1**: "Pointers are unsafe like in C."
**Truth**: Go's pointers are typed, no arithmetic, GC-managed. Safe to return from functions.

**Misconception 2**: "Pointers always heap-allocate."
**Truth**: Only when they escape. Local pointers stay on the stack.

**Misconception 3**: "I should use pointers everywhere for performance."
**Truth**: For small types, value pass is faster.

**Misconception 4**: "`new(T)` is rarely useful."
**Truth**: It's idiomatic for zero-initialized values; `&T{}` for initialized.

**Misconception 5**: "Comparing pointers is the same as `reflect.DeepEqual`."
**Truth**: `==` compares addresses. To compare pointed-to values, dereference: `*p1 == *p2`.

---

## 21. Tricky Points

1. Pointer receiver methods can be called on values IF the value is addressable.
2. Method set: `T` has T-receiver methods; `*T` has both T- and *T-receiver methods.
3. Pointer-to-pointer is rare but legal for "modify the pointer itself" semantics.
4. `&T{}` and `new(T)` are equivalent for zero-init.
5. `unsafe.Pointer` defeats the type system; use sparingly.

---

## 22. Test

```go
package main

import "testing"

type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func TestNilCounter(t *testing.T) {
    defer func() {
        if r := recover(); r == nil {
            t.Error("expected panic on nil")
        }
    }()
    var c *Counter
    c.Inc()
}

func TestCounter(t *testing.T) {
    c := &Counter{}
    c.Inc()
    c.Inc()
    if c.n != 2 {
        t.Errorf("got %d, want 2", c.n)
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }
t := T{n: 1}
t.Inc()
fmt.Println(t.n)
```
**A**: `2`. `t` is addressable (local variable); Go automatically uses `&t`. Mutation persists.

**Q2**: Will this compile?
```go
func get() T { return T{} }
get().Inc() // ?
```
**A**: **No**. The result of a function call is not addressable; you can't take `&get().Inc()`. Workaround: assign to variable first.

**Q3**: What does this print?
```go
p1 := new(int)
p2 := new(int)
fmt.Println(p1 == p2)
fmt.Println(*p1 == *p2)
```
**A**: `false true`. Different addresses, both zero values.

---

## 24. Cheat Sheet

```go
// Type
var p *T

// Allocate
p := new(T)
p := &T{...}

// Take address
p := &x

// Dereference
v := *p
*p = newValue

// Nil check
if p != nil { use(p) }

// Method receiver
func (t *T) Mutate() { t.field = ... }
func (t T) Read() int { return t.field }

// Pointer in interface
var i Interface = &Concrete{}

// Optional (helper)
func ptrTo[T any](v T) *T { return &v }
```

---

## 25. Self-Assessment Checklist

- [ ] I use pointers for mutation
- [ ] I check for nil before dereferencing
- [ ] I use pointer receivers consistently per type
- [ ] I understand escape analysis basics
- [ ] I avoid `**T` unless necessary
- [ ] I use `&T{}` for initialized allocation
- [ ] I document nil semantics for optional fields
- [ ] I handle the loop-variable pointer pitfall

---

## 26. Summary

Pointers are typed addresses for variables. Use them for mutation, sharing, optional values, and linked data structures. The compiler handles allocation via escape analysis: pointers to escaping locals go to the heap. Be consistent with receiver types for a given type. Always nil-check at boundaries. Prefer values for small types; pointers for large ones.

---

## 27. What You Can Build

- Constructors and factories
- Linked structures (lists, trees)
- Pluggable optional features
- Mutator APIs
- Caches and shared state
- Method-rich types

---

## 28. Further Reading

- [Effective Go — Pointers vs values](https://go.dev/doc/effective_go#pointers_vs_values)
- [Go Spec — Pointer types](https://go.dev/ref/spec#Pointer_types)
- [Dave Cheney — Allocation efficiency](https://dave.cheney.net/2018/01/24/allocations-on-the-go-heap)
- [Go Blog — Profiling Go programs](https://go.dev/blog/pprof)

---

## 29. Related Topics

- 2.6.7 Call by Value
- 2.7.2 Pointers with Structs
- 2.7.3 With Maps & Slices
- 2.7.4 Memory Management
- Chapter 3 Methods

---

## 30. Diagrams & Visual Aids

### Pointer types

```
 type     | example     | size
----------|-------------|-----
*int      | &x for int x| 8 B
*Point    | &Point{}    | 8 B
*string   | &s          | 8 B
*[10]int  | &arr        | 8 B
**int     | &p where p *int | 8 B
```

### Method set

```
Type T {
    func (t T) M1()    -- in method set of T AND *T
    func (t *T) M2()   -- in method set of *T only
}
```

To satisfy an interface requiring M2, you must use `*T`.
