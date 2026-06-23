# Go Call by Value — Middle Level

## 1. Introduction

At the middle level you reason precisely about what gets copied at each call boundary, distinguish "shallow copy" from semantic ownership, design APIs that document mutation contracts, and use pointer parameters intentionally.

---

## 2. Prerequisites
- Junior-level pass-by-value material
- Understanding of pointers (2.7.1)
- Slices, maps, channels in detail
- Method receivers (value vs pointer)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Pass by value | Argument is copied into parameter |
| Reference type | Slice/map/channel/func/interface — small header, shared underlying data |
| Shallow copy | Top-level fields copied, nested pointers shared |
| Deep copy | All nested data duplicated |
| Aliasing | Two variables referring to the same underlying data |
| Mutation contract | Documented behavior about whether function mutates args |

---

## 4. Core Concepts

### 4.1 The Copy Is Always Shallow

`copy` here is not a deep clone. For a struct with a pointer field:

```go
type Container struct {
    items []int
    next  *Container
}

c1 := Container{items: []int{1, 2, 3}, next: &Container{}}
c2 := c1 // shallow copy

c2.items[0] = 99      // affects c1.items too (shared backing array)
c2.next.items = nil    // affects c1.next.items too (shared *Container)
c2.next = nil          // doesn't affect c1.next (changed local pointer)
```

Function call argument-passing is the same — shallow copy.

### 4.2 The Reference Type Trio Plus

Reference-like types: slice, map, channel, function value, interface.

| Type | Header size | What's shared |
|------|-------------|----------------|
| Slice | 24 B (3 words) | Backing array |
| Map | 8 B (1 word) | Hash table |
| Channel | 8 B | Channel struct (buffer, mutex, cond) |
| Function | 8-16 B | Code + capture struct |
| Interface | 16 B (2 words) | Concrete value |

The HEADER is copied; the underlying data is shared.

### 4.3 Mutation Contract

Document your function's mutation behavior:

```go
// Sort sorts s in place. The caller's slice is modified.
func Sort(s []int)

// AppendSorted returns a new slice; s is unchanged.
func AppendSorted(s []int, v int) []int

// Process modifies u's fields. The caller's struct is updated through the pointer.
func Process(u *User)
```

Without documentation, callers must guess.

### 4.4 When to Take a Pointer Parameter

Take a pointer when:
- You need to mutate the caller's variable.
- The struct is large (> 64 B) and copying would dominate.
- You need to return a sentinel "no change" by leaving alone.
- You need to satisfy a method-receiver contract (pointer receiver).

Take a value when:
- The type is small (primitive, small struct).
- You DON'T want to mutate.
- You're documenting "this function takes ownership of a snapshot".

### 4.5 Receiver Semantics Are Call-by-Value

A method's receiver is just an extra parameter. Value receiver = copy; pointer receiver = pointer-copy:

```go
type Counter struct{ n int }

func (c Counter) Show() { fmt.Println(c.n) }    // c is a copy
func (c *Counter) Inc()  { c.n++ }                // c is a pointer (copy of pointer)

c := Counter{n: 5}
c.Inc()           // works; takes &c automatically
c.Show()          // value receiver gets a copy
```

### 4.6 Interface Values Box Concrete Types

```go
type Stringer interface{ String() string }

type T struct{ Name string }
func (t T) String() string { return t.Name }

func use(s Stringer) { fmt.Println(s.String()) }

t := T{Name: "ada"}
use(t) // boxes t into an interface value
```

For a value receiver, the boxing copies `t` into the interface (small alloc). For a pointer receiver, only the pointer is boxed (no T copy).

---

## 5. Real-World Analogies

**A delivery service**: when you ship a box, the recipient gets a duplicate of the contents (pass by value). If you ship a key that opens a warehouse (pointer), they can rearrange the warehouse (mutate via pointer) but can't change which warehouse the key originally pointed to (caller's variable).

**A photocopy machine that handles documents (small) and full filing cabinets (big)**: copying small docs is cheap; copying a filing cabinet is expensive — better to share the cabinet (pass a pointer) and let the recipient access it.

---

## 6. Mental Models

### Model 1 — Three Possibilities for Mutation

```
1. Pass by value, no pointer:
   - callee modifies local copy.
   - caller doesn't see changes.

2. Pass pointer, modify *p:
   - callee modifies caller's variable through pointer.
   - caller sees changes.

3. Pass slice/map/channel:
   - element mutations: visible to caller.
   - header reassignment: NOT visible.
```

### Model 2 — Where the Copy Lives

```
small types: copy in registers (free).
medium structs: copy in caller frame (cheap).
large structs: copy in caller frame (slower).
references: header copy (cheap), data shared.
```

---

## 7. Pros & Cons

### Pros
- Simple semantics: every arg is a copy.
- No accidental mutation of caller state.
- Register ABI is efficient for small types.
- Clear ownership: function works on its own copy.

### Cons
- Large structs by value waste memory and time.
- Reference type semantics (header copy + shared data) confuse newcomers.
- Want mutation? Must explicitly use pointer.
- Aliasing through reference types can hide bugs.

---

## 8. Use Cases

1. Pure functions: take values, return computed values.
2. Mutating functions: take pointers.
3. Bulk processors: take slices (mutate elements in place).
4. Configuration: take values (immutable inputs).
5. Builder patterns: methods return modified copies.
6. Concurrent: pass values to avoid sharing state.

---

## 9. Code Examples

### Example 1 — Pure vs Mutating
```go
package main

import "fmt"

type Vec struct{ X, Y int }

// Pure: returns a new Vec
func Add(a, b Vec) Vec { return Vec{a.X + b.X, a.Y + b.Y} }

// Mutating: modifies the receiver
func (v *Vec) Translate(dx, dy int) {
    v.X += dx
    v.Y += dy
}

func main() {
    a := Vec{1, 2}
    b := Vec{3, 4}
    c := Add(a, b)
    fmt.Println(c) // {4 6}

    p := &Vec{1, 1}
    p.Translate(10, 10)
    fmt.Println(p) // &{11 11}
}
```

### Example 2 — Slice Aliasing Hazard
```go
package main

import "fmt"

func zeroFirst(s []int) {
    s[0] = 0
}

func main() {
    a := []int{1, 2, 3}
    b := a[1:] // b shares backing
    
    zeroFirst(b)
    fmt.Println(a) // [1 0 3] — a[1] zeroed!
}
```

### Example 3 — Map Mutation
```go
package main

import "fmt"

func incrementCounts(m map[string]int) {
    for k := range m {
        m[k]++
    }
}

func main() {
    m := map[string]int{"a": 1, "b": 2}
    incrementCounts(m)
    fmt.Println(m) // map[a:2 b:3]
}
```

### Example 4 — Defensive Copy
```go
package main

import "fmt"

func storeCopy(out *[]int, src []int) {
    *out = append([]int(nil), src...) // independent copy
}

func main() {
    src := []int{1, 2, 3}
    var stored []int
    storeCopy(&stored, src)
    src[0] = 99
    fmt.Println(stored) // [1 2 3]
}
```

### Example 5 — Reassigning Slice Param
```go
package main

import "fmt"

func resetSlice(s *[]int) {
    *s = []int{99} // replace caller's slice via pointer-to-slice
}

func main() {
    s := []int{1, 2, 3}
    resetSlice(&s)
    fmt.Println(s) // [99]
}
```

---

## 10. Coding Patterns

### Pattern 1 — Read-Only via Value
```go
func compute(input Config) Result { ... }
```

### Pattern 2 — Mutate via Pointer
```go
func (c *Config) Update(k, v string) { c.fields[k] = v }
```

### Pattern 3 — Functional (Return Modified Copy)
```go
func WithFilter(c Config, name string) Config {
    c.Filters = append([]string(nil), c.Filters...)
    c.Filters = append(c.Filters, name)
    return c
}
```

### Pattern 4 — Defensive Copy at Boundary
```go
func (s *Service) Set(items []Item) {
    s.items = append([]Item(nil), items...) // copy to avoid caller mutation
}
```

### Pattern 5 — In-Place Algorithm
```go
func reverse(s []int) {
    for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
        s[i], s[j] = s[j], s[i]
    }
}
```

---

## 11. Clean Code Guidelines

1. **Document mutation** — "modifies in place" or "returns a new value".
2. **Use pointer receivers consistently** for a type that has any pointer-receiver method.
3. **Defensive copy at boundary** when storing caller's data.
4. **Don't pass massive structs by value** in hot paths.
5. **Use `const` (or unexported zero-value vars) for true immutability** where appropriate.

---

## 12. Product Use / Feature Example

**A configuration struct that supports both read and mutate APIs**:

```go
package main

import "fmt"

type Config struct {
    addr   string
    port   int
    tags   []string
}

// Get returns a snapshot of the config.
func (c Config) Get() Config {
    return Config{
        addr: c.addr,
        port: c.port,
        tags: append([]string(nil), c.tags...), // independent
    }
}

// SetAddr modifies in place.
func (c *Config) SetAddr(addr string) {
    c.addr = addr
}

func main() {
    c := &Config{addr: "localhost", port: 8080}
    snap := c.Get()
    c.SetAddr("0.0.0.0")
    fmt.Println(snap.addr, c.addr) // localhost 0.0.0.0
}
```

The `Get` method returns a defensive copy (deep for `tags`); modifications to `c` don't affect the snapshot.

---

## 13. Error Handling

```go
func safeUpdate(u *User, name string) error {
    if u == nil {
        return fmt.Errorf("nil user")
    }
    if name == "" {
        return fmt.Errorf("empty name")
    }
    u.Name = name
    return nil
}
```

Always nil-check pointers received from external code.

---

## 14. Security Considerations

1. **Storing references to caller-provided slices** lets the caller mutate them later. Defensive copy or document.
2. **Sensitive data passed by value** is duplicated; both copies remain in memory.
3. **Methods with pointer receivers** can mutate state — be careful in concurrent contexts.
4. **Returning pointers to internal state** lets callers mutate it.

---

## 15. Performance Tips

1. **Small types: value pass via register**: ~free.
2. **Medium structs (< 256 B): value pass copies on stack**: small cost.
3. **Large structs (> 256 B): pass by pointer**: avoid stack copy.
4. **Slices/maps/channels: header copy is free**: pass by value typically fine.
5. **Defensive copy of large slices is expensive**: only copy when necessary.

---

## 16. Metrics & Analytics

```go
// Pass values to avoid mutation; explicit duration parameter
type Sample struct {
    Name     string
    Duration time.Duration
    Status   string
}

func record(s Sample) {
    // ... ship to backend ...
    fmt.Printf("[%s] %v %s\n", s.Name, s.Duration, s.Status)
}
```

---

## 17. Best Practices

1. Use values for small types and read-only inputs.
2. Use pointers for mutation, large structs, or method-receiver consistency.
3. Document mutation contract.
4. Defensive copy at API boundaries when storing caller data.
5. Be aware of slice/map aliasing via shared backing.
6. Profile to verify; don't optimize prematurely.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Caller Mutating Stored Slice
```go
type Cache struct{ items []int }
func (c *Cache) Set(items []int) { c.items = items } // BUG: aliases caller's slice
// Caller can mutate items later, corrupting cache.
```
Fix:
```go
func (c *Cache) Set(items []int) { c.items = append([]int(nil), items...) }
```

### Pitfall 2 — Mixing Receiver Types
```go
type T struct{}
func (t T) A()  { /* value receiver */ }
func (t *T) B() { /* pointer receiver */ }
// T satisfies an interface only if all methods have compatible receivers.
```

### Pitfall 3 — Returning a Pointer to Local Slice Element
```go
func first() *int {
    s := []int{1, 2, 3}
    return &s[0] // s escapes to heap; entire backing kept alive
}
```

### Pitfall 4 — Forgetting nil Map Initialization
```go
var m map[string]int
m["x"] = 1 // panic
m = map[string]int{}
m["x"] = 1 // OK
```

### Pitfall 5 — Channel Direction Restrictions
```go
ch := make(chan int)
go send(ch)        // takes chan<- int
go recv(ch)        // takes <-chan int
// Once converted to a directional channel, can't reverse.
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Trying to mutate caller's variable without pointer | Pass `*T` |
| Reassigning slice param expecting caller change | Return new slice or pass `*[]T` |
| Storing caller's slice without copy | Defensive copy with `append([]T(nil), s...)` |
| Passing huge struct by value in hot loop | Use pointer |
| Forgetting maps need `make` | Initialize first |

---

## 20. Common Misconceptions

**Misconception 1**: "Slices are passed by reference."
**Truth**: Slice HEADER is passed by value; data is shared. Subtle but important distinction.

**Misconception 2**: "Pointer pass is always faster."
**Truth**: For small types, value pass is faster (register, no indirection).

**Misconception 3**: "Returning a pointer is unsafe if the variable was local."
**Truth**: Go's escape analysis moves it to the heap. Safe.

**Misconception 4**: "Methods automatically know how to mutate the receiver."
**Truth**: Only pointer receivers can mutate. Value receivers operate on copies.

**Misconception 5**: "Passing an interface is by-reference."
**Truth**: The interface VALUE (itab + data) is copied. The data may be a pointer to shared content.

---

## 21. Tricky Points

1. Slice/map/channel/func/interface are passed by value — the header is what's copied.
2. Element mutations on slices/maps propagate; header reassignments don't.
3. Method receiver semantics depend on declaration: value receiver = copy.
4. `&x` inside a function gives the address of the local copy if `x` is a parameter (not the caller's address).
5. Interface boxing copies the concrete value (or just the pointer for *T receivers).

---

## 22. Test

```go
package main

import (
    "reflect"
    "testing"
)

func zero(s []int) {
    for i := range s { s[i] = 0 }
}

func TestZeroPropagates(t *testing.T) {
    s := []int{1, 2, 3}
    zero(s)
    if !reflect.DeepEqual(s, []int{0, 0, 0}) {
        t.Errorf("got %v, want all zero", s)
    }
}

func reset(s []int) {
    s = nil // local
}

func TestResetDoesNot(t *testing.T) {
    s := []int{1, 2, 3}
    reset(s)
    if len(s) != 3 {
        t.Errorf("expected unchanged length 3, got %d", len(s))
    }
}
```

---

## 23. Tricky Questions

**Q1**: Why does this print `[1 2 3 99]`?
```go
func add(s []int, v int) []int {
    s = append(s, v)
    return s
}

s := make([]int, 3, 10)
s[0], s[1], s[2] = 1, 2, 3
s = add(s, 99)
fmt.Println(s)
```
**A**: `add` returns the new slice, and the caller assigns it back. Critical: capacity 10 means append doesn't reallocate; the new element is in the same backing array. The returned header has length 4.

**Q2**: What does this print?
```go
type T struct{ N int }
func mod(t T) { t.N = 99 }
t := T{N: 1}
mod(t)
fmt.Println(t.N)
```
**A**: `1`. Struct is copied; mutation only on local copy.

**Q3**: What does this print?
```go
func mod(p *int) { p = nil }
x := 5
mod(&x)
fmt.Println(x)
```
**A**: `5`. The pointer is copied. Setting the local pointer to nil doesn't affect the caller's pointer; caller's `x` is unchanged anyway because nothing went through the pointer.

---

## 24. Cheat Sheet

```go
// Read only
func use(n int) { _ = n }

// Mutate primitive: pointer
func incr(p *int) { *p++ }

// Mutate struct: pointer
func grow(u *User) { u.Age++ }

// Mutate slice elements
func zero(s []int) { for i := range s { s[i] = 0 } }

// Mutate slice header (length/cap): pointer-to-slice
func reset(sp *[]int) { *sp = nil }

// Map mutation (header shared with caller)
func add(m map[string]int) { m["x"] = 1 }

// Defensive copy
func (s *Cache) Set(items []int) {
    s.items = append([]int(nil), items...)
}

// Functional update (return new value)
func WithItem(c Config, item string) Config {
    c.Items = append([]string(nil), c.Items...)
    c.Items = append(c.Items, item)
    return c
}
```

---

## 25. Self-Assessment Checklist

- [ ] I distinguish "header copy" from "deep copy"
- [ ] I use pointers for mutation
- [ ] I document mutation contracts
- [ ] I defensively copy at API boundaries when storing caller data
- [ ] I avoid passing huge structs by value
- [ ] I understand slice/map/channel reference semantics
- [ ] I check for nil pointers
- [ ] I match receiver type consistency for a given type

---

## 26. Summary

Go is pass-by-value: every argument is a copy. For "reference types" (slice, map, channel, func, interface), the COPY is a small header that points to shared underlying data — element mutations propagate, header reassignments don't. Use pointers when you need to mutate the caller's variable or when the type is large enough that copying would dominate. Document mutation contracts explicitly. Defensive copy at boundaries to prevent caller-side mutation.

---

## 27. What You Can Build

- Functions with clear immutability (value params)
- Mutator methods (pointer receivers)
- Builder patterns returning modified copies
- Caches with defensive-copy storage
- Sort/filter/map functions on slices
- Maps as shared state with safe mutation

---

## 28. Further Reading

- [Go Spec — Calls](https://go.dev/ref/spec#Calls)
- [Effective Go — Pointers vs values](https://go.dev/doc/effective_go#pointers_vs_values)
- [Dave Cheney — There is no "pass-by-reference" in Go](https://dave.cheney.net/2017/04/29/there-is-no-pass-by-reference-in-go)
- [Go Blog — Slice internals](https://go.dev/blog/slices-intro)

---

## 29. Related Topics

- 2.7 Pointers
- 2.7.3 With Maps & Slices
- Chapter 3 Methods (receiver semantics)
- 2.6.1 Functions Basics

---

## 30. Diagrams & Visual Aids

### Decision tree

```mermaid
flowchart TD
    A[Function takes parameter] --> B{Need to mutate?}
    B -->|yes| C[Use pointer]
    B -->|no| D{Type size?}
    D -->|small or primitive| E[Pass by value]
    D -->|large struct| F[Pass pointer for performance]
    D -->|reference type slice/map/chan| G[Pass by value (header is small)]
```

### Copying behavior summary

```
Type           | Copy size      | What's shared
---------------+----------------+-----------------
int, bool      | 1 word         | nothing
small struct   | N fields       | nothing
large struct   | N fields       | nothing (slow)
*T             | 1 word         | the pointee
[]T            | 3 words        | backing array
map[K]V        | 1 word         | hash table
chan T         | 1 word         | channel
func           | 1+ words       | code + captures
interface      | 2 words        | concrete value
[N]T (array)   | N elements     | nothing
```
