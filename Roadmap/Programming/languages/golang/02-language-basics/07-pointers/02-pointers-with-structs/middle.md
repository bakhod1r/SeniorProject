# Go Pointers with Structs — Middle Level

## 1. Introduction

At the middle level you design APIs around `*Struct` consciously: choosing pointer vs value receivers, structuring constructors, designing linked types, and managing mutation contracts.

---

## 2. Prerequisites
- Junior-level material
- Method receivers
- Struct embedding

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Receiver consistency | Using same receiver type (value or pointer) for all methods on a type |
| Method set | Set of methods accessible on T vs *T |
| Embedded pointer | Struct field that's a pointer to another struct, with promoted methods |
| Linked type | Self-referential struct with `*T` field |
| Builder pattern | Methods returning `*T` for chained calls |

---

## 4. Core Concepts

### 4.1 Receiver Consistency
```go
type T struct{}
func (t *T) A() {}
func (t T) B()  {} // INCONSISTENT — T satisfies {B()} but not {A()}
```

Pick pointer or value receivers per type and stick to it. Mixed receivers cause interface-satisfaction surprises.

### 4.2 Method Set Rules

| Type | Methods accessible |
|------|---------------------|
| `T` | Methods with value receivers |
| `*T` | Methods with value AND pointer receivers |

Implication: if your type has any pointer-receiver method, only `*T` satisfies an interface requiring all methods.

### 4.3 Constructor Convention
```go
func NewT(...) *T { return &T{...} }
```

If T has methods (especially pointer-receiver), return `*T`. Callers store and use the pointer.

### 4.4 Builder / Method Chaining
```go
func (s *Server) WithAddr(a string) *Server { s.Addr = a; return s }

s := NewServer().
    WithAddr(":9000").
    WithMaxConn(500).
    WithTimeout(30 * time.Second)
```

### 4.5 Linked Structures
```go
type Tree struct {
    Value       int
    Left, Right *Tree
}
```

`*Tree` enables recursion through the structure.

### 4.6 Embedded Pointer for Composition
```go
type Logger struct{ Prefix string }
func (l *Logger) Log(msg string) { fmt.Println(l.Prefix, msg) }

type Service struct{ *Logger }

s := &Service{Logger: &Logger{Prefix: "SVC"}}
s.Log("started") // promoted method
```

---

## 5. Real-World Analogies

**A shared filing cabinet**: many handles (pointers), one cabinet. Mutations visible to all. Adding a folder via one handle is seen by all others.

**A board of directors**: each director has a reference to the same company. Decisions affect everyone.

---

## 6. Mental Models

```
*T value:   address pointing to a T struct in memory
caller:    p1 ─┐
              ├──► [T struct]   ← shared
fn param:   p2 ─┘
mutations through either p1 or p2 affect the same T.
```

---

## 7. Pros & Cons

### Pros
- Mutation across boundaries
- Sharing
- Linked structures
- Builder patterns
- Method receivers can mutate

### Cons
- Nil checks everywhere
- Aliasing-induced bugs
- Allocation per `&T{...}`
- Receiver inconsistency causes interface bugs

---

## 8. Use Cases

1. Constructors
2. Builders
3. Linked lists, trees, graphs
4. Service-style types with state
5. Cached/shared objects
6. Method-rich types

---

## 9. Code Examples

### Example 1 — Builder
```go
type Server struct{ Addr string; Port int; Timeout time.Duration }

func NewServer() *Server { return &Server{Port: 8080, Timeout: 30 * time.Second} }
func (s *Server) WithAddr(a string) *Server { s.Addr = a; return s }
func (s *Server) WithPort(p int) *Server    { s.Port = p; return s }

s := NewServer().WithAddr(":9000").WithPort(443)
fmt.Printf("%+v\n", s)
```

### Example 2 — Tree
```go
type Tree struct {
    V           int
    Left, Right *Tree
}

func (t *Tree) Insert(v int) *Tree {
    if t == nil { return &Tree{V: v} }
    if v < t.V {
        t.Left = t.Left.Insert(v)
    } else {
        t.Right = t.Right.Insert(v)
    }
    return t
}

var root *Tree
for _, v := range []int{5, 3, 8, 1, 4} {
    root = root.Insert(v)
}
```

### Example 3 — Embedded Pointer
```go
type Cache struct{ data map[string]string }
func (c *Cache) Get(k string) string { return c.data[k] }

type Service struct {
    *Cache
    Name string
}

s := &Service{Cache: &Cache{data: map[string]string{"a": "1"}}, Name: "svc"}
fmt.Println(s.Get("a")) // promoted
fmt.Println(s.Name)
```

### Example 4 — Receiver Consistency
```go
// Good — all pointer
type Counter struct{ n int }
func (c *Counter) Inc()    {}
func (c *Counter) Get() int { return c.n }
func (c *Counter) Reset()  {}

var i interface{ Inc(); Get() int; Reset() } = &Counter{}
```

If you mixed value/pointer receivers, the value Counter wouldn't satisfy the interface.

### Example 5 — Avoid Storing Pointer to Local
```go
type Service struct{ data *Big }

// Bad: localBig may not outlive the call
func (s *Service) Bad() {
    var localBig Big
    s.data = &localBig // localBig escapes; safe but not necessarily intended
}
```

---

## 10. Coding Patterns

### Pattern 1 — Constructor
```go
func New(...) *T { return &T{...} }
```

### Pattern 2 — Builder With Validation
```go
func (s *Server) Build() (*Server, error) {
    if s.Port < 1 { return nil, fmt.Errorf("invalid port") }
    return s, nil
}
```

### Pattern 3 — Self-Referential
```go
type Node struct{ V int; Next *Node }
```

### Pattern 4 — Embed Pointer for Inheritance-Like
```go
type Base struct{ ID int }
type Sub struct { *Base; Name string }
```

---

## 11. Clean Code Guidelines

1. Receiver consistency.
2. Constructors return `*T`.
3. Document nil semantics.
4. Use embedded pointer fields when "is-a" + "has-a" hybrid makes sense.
5. Avoid pointer chains > 3 levels (`a.b.c.d.e`).

---

## 12. Product Use / Feature Example

**A pluggable HTTP middleware chain**:

```go
type Middleware struct {
    Name    string
    Handler func(string) string
    Next    *Middleware
}

func (m *Middleware) Handle(in string) string {
    if m == nil { return in }
    return m.Next.Handle(m.Handler(in))
}

upper := &Middleware{Name: "upper", Handler: func(s string) string { return strings.ToUpper(s) }}
trim  := &Middleware{Name: "trim",  Handler: strings.TrimSpace}
upper.Next = trim

fmt.Println(upper.Handle("  hello  ")) // "HELLO"
```

---

## 13. Error Handling

```go
func (a *Account) Withdraw(amount int) error {
    if a == nil { return fmt.Errorf("nil account") }
    if amount > a.Balance { return fmt.Errorf("insufficient") }
    a.Balance -= amount
    return nil
}
```

---

## 14. Security Considerations

1. Nil-check at API boundaries.
2. Defensive copy when storing caller pointers.
3. Don't expose internal mutable state via pointer accessor.

---

## 15. Performance Tips

1. Pointer pass: 8 B (free).
2. `&T{...}` allocates; use sparingly in hot paths.
3. `sync.Pool` for reusable structs.
4. Methods on `*T` are slightly more expensive than on `T` (extra deref).

---

## 16. Metrics & Analytics

```go
type Span struct {
    Name  string
    Tags  []string
    Start time.Time
}

func (s *Span) End() {
    fmt.Printf("[%s] %v\n", s.Name, time.Since(s.Start))
}
```

---

## 17. Best Practices

1. Receiver consistency.
2. Constructors for any non-trivial type.
3. Document mutation contracts.
4. Always nil-check.
5. Use embedded pointers for composition.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Mixed Receivers Cause Interface Failure
Discussed.

### Pitfall 2 — Map Storing Struct Values
```go
m := map[string]Counter{"a": {}}
// m["a"].Inc() // error: not addressable
```
Use `map[string]*Counter`.

### Pitfall 3 — Nil Receiver Method
Some patterns work:
```go
func (l *Logger) Log(s string) {
    if l == nil { return } // safe no-op
    // ...
}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Mixing receiver types | Be consistent |
| Map value mutation | Store pointers |
| Nil method panics | Check first or design no-op behavior |
| Builder w/o validation | Add Build() error |

---

## 20. Common Misconceptions

**1**: "Pointer receivers are always faster."
**Truth**: For small types, value receiver may inline better.

**2**: "Auto-dereference works for everything."
**Truth**: Only `.field` and method calls.

---

## 21. Tricky Points

1. Embedded pointer methods are promoted.
2. Method set differs between T and *T.
3. Nil receiver methods can be designed to be safe.
4. Self-referential types need pointer fields.

---

## 22. Test

```go
func TestBuilder(t *testing.T) {
    s := NewServer().WithPort(9000)
    if s.Port != 9000 { t.Fail() }
}
```

---

## 23. Tricky Questions

**Q1**: Why does this fail?
```go
type T struct{}
func (t *T) M() {}

func main() {
    type I interface{ M() }
    var i I = T{} // ?
}
```
**A**: Compile error. `T` doesn't have method `M` — only `*T` does. Use `&T{}`.

---

## 24. Cheat Sheet

```go
// Constructor
func New() *T { return &T{} }

// Builder
func (t *T) WithX(x int) *T { t.x = x; return t }

// Pointer receiver
func (t *T) Mutate() { t.f = ... }

// Embedded pointer
type Sub struct{ *Base; ... }

// Self-referential
type Node struct{ V int; Next *Node }
```

---

## 25. Self-Assessment Checklist

- [ ] I keep receiver types consistent
- [ ] I write constructors
- [ ] I build linked types
- [ ] I use embedded pointers for composition
- [ ] I nil-check
- [ ] I document mutation contracts

---

## 26. Summary

Pointers to structs enable mutation, sharing, linked types, and method-rich types. Receiver consistency is critical for interface satisfaction. Constructors return `*T`. Builders chain through `*T` returns. Self-referential types use `*T` fields. Embedded pointer fields enable composition with method promotion.

---

## 27. What You Can Build

- Service-style types
- Builders
- Trees, lists, graphs
- Middleware chains
- Caches and registries

---

## 28. Further Reading

- [Effective Go — Methods](https://go.dev/doc/effective_go#methods)
- [Go Spec — Method declarations](https://go.dev/ref/spec#Method_declarations)

---

## 29. Related Topics

- 2.7.1 Pointers Basics
- Chapter 3 Methods
- Struct embedding (2.3.5.2)

---

## 30. Diagrams & Visual Aids

### Method set
```
type T struct{}
func (t T)  A() {}
func (t *T) B() {}

T  has: {A}
*T has: {A, B}
```
