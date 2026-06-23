# Go Pointers with Structs — Junior Level

## 1. Introduction

### What is it?
A pointer to a struct (`*StructType`) is one of Go's most common patterns. It lets you:
- Mutate struct fields from inside a function or method.
- Share a single struct between multiple variables/functions.
- Build linked structures (lists, trees).
- Avoid copying large structs.

```go
type Point struct{ X, Y int }

p := &Point{X: 1, Y: 2}
p.X = 99           // Go auto-dereferences: same as (*p).X = 99
fmt.Println(p)     // &{99 2}
```

---

## 2. Prerequisites
- Pointers basics (2.7.1)
- Structs (2.3.5)
- Methods (intro)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| `*StructType` | Pointer to a struct |
| Auto-dereference | `p.field` works without explicit `*` |
| Constructor | Function returning `*T` |
| Pointer receiver | Method receiver of type `*T` |
| Field address | `&p.field` — pointer to a single field |
| Linked structure | Data structure where nodes hold pointers to other nodes |

---

## 4. Core Concepts

### 4.1 Allocating
```go
p1 := new(Point)        // *Point, zero-init
p2 := &Point{X: 1}      // *Point, with values
```

`&CompositeLiteral{...}` is the most common form.

### 4.2 Auto-Dereference
```go
p := &Point{X: 1, Y: 2}
fmt.Println(p.X)   // same as (*p).X
p.X = 99           // same as (*p).X = 99
```

You don't need `(*p)` syntax — Go inserts it.

### 4.3 Pointer Receivers
```go
func (p *Point) Translate(dx, dy int) {
    p.X += dx
    p.Y += dy
}

p := &Point{X: 0, Y: 0}
p.Translate(5, 10)
fmt.Println(p)  // &{5 10}
```

The method mutates `*p` (same struct as caller).

### 4.4 Calling Pointer Methods on Values
```go
p := Point{X: 1, Y: 2}  // value, not pointer
p.Translate(1, 1)        // Go takes &p automatically
fmt.Println(p)           // {2 3}
```

Works only if `p` is addressable.

### 4.5 Returning Pointer-to-Struct (Constructor)
```go
func NewPoint(x, y int) *Point {
    return &Point{X: x, Y: y}
}

p := NewPoint(3, 4)
```

Idiomatic factory pattern.

---

## 5. Real-World Analogies

**A house key**: many people can have a copy of the key; they all access the same house. Mutations (rearranging furniture) are visible to all.

**A medical record**: multiple doctors can hold a pointer to the same patient record. Updates by one are visible to others.

---

## 6. Mental Models

```
caller variable: p (*Point)
   │
   ▼
Memory at some address: { X: 99, Y: 2 }   ← the actual Point struct
   ▲
   │
function parameter q (*Point) — same address — same struct
```

Pointer-to-struct = address of where the struct lives.

---

## 7. Pros & Cons

### Pros
- Mutation across function calls
- Sharing without copying
- Foundation for linked structures
- Method receivers can mutate

### Cons
- Nil dereference panics
- Aliasing complications
- Indirection cost (small)

---

## 8. Use Cases

1. Mutator methods (`p.SetName(...)`)
2. Constructors (`NewT(...) *T`)
3. Linked lists, trees, graphs
4. Shared state
5. Avoiding copies of large structs

---

## 9. Code Examples

### Example 1 — Simple
```go
type User struct{ Name string }

func rename(u *User, name string) {
    u.Name = name
}

u := &User{Name: "Old"}
rename(u, "Ada")
fmt.Println(u.Name) // Ada
```

### Example 2 — Pointer Methods
```go
type Counter struct{ N int }
func (c *Counter) Inc() { c.N++ }

c := &Counter{}
c.Inc(); c.Inc(); c.Inc()
fmt.Println(c.N) // 3
```

### Example 3 — Linked List
```go
type Node struct {
    V    int
    Next *Node
}

head := &Node{V: 1, Next: &Node{V: 2, Next: &Node{V: 3}}}
for n := head; n != nil; n = n.Next {
    fmt.Println(n.V)
}
```

### Example 4 — Pointer to Struct Field
```go
p := &Point{X: 1, Y: 2}
xp := &p.X
*xp = 99
fmt.Println(p.X) // 99
```

### Example 5 — Constructor
```go
type Server struct{ Addr string; Port int }
func NewServer(addr string, port int) *Server {
    return &Server{Addr: addr, Port: port}
}
s := NewServer("localhost", 8080)
fmt.Printf("%+v\n", s)
```

---

## 10. Coding Patterns

### Pattern 1 — Constructor
```go
func New(args...) *T { return &T{...} }
```

### Pattern 2 — Builder
```go
func (s *Server) WithAddr(a string) *Server { s.Addr = a; return s }
s := NewServer().WithAddr(":9000").WithPort(443)
```

### Pattern 3 — Self-Referential
```go
type Node struct { Value int; Next *Node }
```

### Pattern 4 — Optional Field
```go
type User struct { Email *Email } // nil means no email
```

---

## 11. Clean Code Guidelines

1. Use `&T{...}` for initialized allocation.
2. Use pointer receivers for mutating methods.
3. Be consistent: if any method on T uses pointer receiver, all should.
4. Always nil-check at API boundaries.
5. Constructors return `*T` for types with methods.

---

## 12. Product Use / Feature Example

**A bank account with mutating operations**:

```go
type Account struct {
    Balance int
}

func NewAccount(initial int) *Account {
    return &Account{Balance: initial}
}

func (a *Account) Deposit(amount int)    { a.Balance += amount }
func (a *Account) Withdraw(amount int)   {
    if amount > a.Balance {
        panic("insufficient funds")
    }
    a.Balance -= amount
}

a := NewAccount(100)
a.Deposit(50)
a.Withdraw(30)
fmt.Println(a.Balance) // 120
```

---

## 13. Error Handling

```go
func (a *Account) WithdrawSafe(amount int) error {
    if a == nil {
        return fmt.Errorf("nil account")
    }
    if amount > a.Balance {
        return fmt.Errorf("insufficient")
    }
    a.Balance -= amount
    return nil
}
```

---

## 14. Security Considerations

1. Nil-check pointers from external sources.
2. Don't expose internal pointers if callers shouldn't mutate.
3. Defensive copy when storing caller-provided pointers.

---

## 15. Performance Tips

1. Pointer pass: 8 B (free).
2. Value pass small struct (≤ 64 B): also free (registers).
3. Value pass large struct: expensive copy.
4. Pointer dereference: 1-2 cycles.

For large structs, prefer pointers.

---

## 16. Metrics & Analytics

```go
type Sample struct{ Name string; Value float64 }
func (s *Sample) Record() {
    fmt.Printf("[%s] %f\n", s.Name, s.Value)
}
```

---

## 17. Best Practices

1. Pointer receivers for mutating methods.
2. Consistent receiver type per type.
3. Use `&T{...}` for allocation + initialization.
4. Always nil-check.
5. Document what nil means for pointer fields.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Nil Dereference
```go
var p *Point
p.X // panic
```

### Pitfall 2 — Pointer Receiver on Map Value
```go
m := map[string]Counter{"a": {}}
// m["a"].Inc() // compile error
```

Store pointers: `map[string]*Counter`.

### Pitfall 3 — Address of Loop Variable (Pre 1.22)
```go
for _, p := range points {
    ptrs = append(ptrs, &p) // pre-1.22: same pointer
}
```

### Pitfall 4 — Returning Pointer to Local
Safe (escape analysis), but understand it allocates.

### Pitfall 5 — Mixing Receiver Types
```go
type T struct{}
func (t T) A()  {}
func (t *T) B() {}
// T satisfies interface {A()} but not {A(); B()}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgetting `&` for constructor | `&T{...}` |
| Mixing receiver types | Be consistent |
| Pointer method on map value | Use `map[K]*V` |
| Nil dereference | Check first |

---

## 20. Common Misconceptions

**1**: "Always use pointer-to-struct for performance."
**Truth**: For small structs, value pass is fine.

**2**: "`new(Point)` is different from `&Point{}`."
**Truth**: Equivalent for zero-initialization.

**3**: "Auto-dereference works for any operator."
**Truth**: Only for `.field` and method calls. `*p` syntax still needed for explicit dereference in expressions.

---

## 21. Tricky Points

1. Pointer receivers can be called on addressable values.
2. Field access through pointer is auto-dereferenced.
3. Pointers to struct fields are valid (`&p.X`).
4. Embedded pointer fields enable composition.
5. Self-referential structs require pointer field.

---

## 22. Test

```go
type Counter struct{ N int }
func (c *Counter) Inc() { c.N++ }

func TestInc(t *testing.T) {
    c := &Counter{}
    c.Inc(); c.Inc()
    if c.N != 2 {
        t.Errorf("got %d, want 2", c.N)
    }
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
type T struct{ N int }
func (t *T) Inc() { t.N++ }

t := T{N: 1}
t.Inc()
fmt.Println(t.N)
```
**A**: `2`. `t` is addressable; Go takes `&t` automatically.

**Q2**: Will this compile?
```go
m := map[string]Point{"a": {X: 1}}
m["a"].X = 99
```
**A**: **No**. Map value not addressable.

---

## 24. Cheat Sheet

```go
// Allocate
p := &T{...}
p := new(T)

// Auto-deref
p.field = ...
p.method()

// Pointer to field
fp := &p.field

// Constructor
func New() *T { return &T{...} }

// Pointer receiver
func (t *T) Mutate() { t.field = ... }
```

---

## 25. Self-Assessment Checklist

- [ ] I can allocate `&Struct{}`
- [ ] I use auto-dereference
- [ ] I write pointer receiver methods
- [ ] I write constructors
- [ ] I build linked structures
- [ ] I nil-check at boundaries

---

## 26. Summary

`*Struct` is the bridge between functions and shared/mutable struct state. Use `&T{...}` to allocate. Auto-dereference makes `p.field` and `p.Method()` work. Use pointer receivers for mutation. Required for self-referential types. Always nil-check.

---

## 27. What You Can Build

- Object-style data types
- Linked lists, trees
- Constructors
- Builders
- Caches and registries

---

## 28. Further Reading

- [Go Tour — Pointers](https://go.dev/tour/moretypes/1)
- [Effective Go — Allocation](https://go.dev/doc/effective_go#allocation_new)

---

## 29. Related Topics

- 2.7.1 Pointers Basics
- 2.7.3 With Maps & Slices
- Chapter 3 Methods

---

## 30. Diagrams & Visual Aids

### Pointer-to-struct mechanics

```
p (*Point)
   │
   ▼
[ X: 1 | Y: 2 ]   ← the Point struct

p.X     auto-deref → reads X
p.X = 9 auto-deref → writes X
&p.X    → pointer to X field
```
