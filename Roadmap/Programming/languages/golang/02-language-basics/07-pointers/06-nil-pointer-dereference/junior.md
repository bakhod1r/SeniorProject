# Go Nil Pointer Dereference — Junior Level

## 1. Introduction

### What is it?
A **nil pointer dereference** happens when your program tries to follow a pointer that has not been set to point to anything — a `nil` pointer. The Go runtime detects this and raises a panic with the message:

```
panic: runtime error: invalid memory address or nil pointer dereference
```

In Go, every pointer type has a zero value of `nil`. Reading or writing through such a pointer is illegal, and the runtime stops your program with a panic the moment it tries.

### How to use it?
The simplest demonstration:

```go
package main

import "fmt"

func main() {
    var p *int       // p is nil — declared but never assigned
    fmt.Println(*p)  // panic: nil pointer dereference
}
```

The variable `p` has type `*int`. Its zero value is `nil`. The expression `*p` asks the runtime to load an integer from the address stored in `p`. That address is 0 (the nil sentinel). The CPU traps, the runtime catches the trap, and turns it into a Go panic.

You will see this same panic in many disguises:
- `p.Field` when `p` is `nil` and the field access would dereference.
- `p.Method()` when `p` is `nil` and `Method` reads any field.
- A function variable `var f func(); f()`.
- A returned typed `*MyStruct` that is `nil`, dressed up as an `error` interface, then dereferenced inside a wrapper.

This document walks through the basics. By the end you will know how to spot, predict, and defend against nil pointer panics.

---

## 2. Prerequisites
- Pointers basics (2.7.1) — `&x`, `*p`, pointer types
- Pointers with structs (2.7.2) — `s.Field` shorthand
- Functions and methods (2.6 series)
- `panic` and `recover` (will be discussed at length in error handling)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| nil | The zero value for pointer, interface, channel, map, slice, and function types |
| pointer | A typed reference to a memory address |
| dereference | The act of reading or writing through a pointer (`*p`, `p.x`, `p.M()`) |
| nil pointer dereference | Following a nil pointer; the runtime panics |
| panic | A runtime error that unwinds the call stack |
| recover | A built-in that, when called inside a deferred function, stops a panic |
| typed nil | An interface value whose type tag is non-nil but whose data pointer is nil |
| nil-safe method | A method that may be called on a nil receiver without crashing |
| SIGSEGV | Unix signal raised when a process touches a forbidden address |
| `runtime.PanicNilError` | The typed panic value used by Go 1.21+ for nil dereferences |

---

## 4. Core Concepts

### 4.1 Every Pointer Has a Zero Value of `nil`
```go
var p *int      // p == nil
var s *string   // s == nil
var u *User     // u == nil

if p == nil {
    fmt.Println("p is nil")
}
```

You only get a real address by taking it from another value (`&x`) or from `new(T)` / a constructor.

### 4.2 What Counts as a Dereference
Any operation that needs to read from the address inside the pointer:

```go
*p           // direct dereference of *int
p.Field      // automatic dereference of *Struct → Field
p.Method()   // automatic dereference if Method has a value receiver, or
             // for a pointer receiver method that touches fields
(*p).Field   // explicit form, identical effect
&(*p)        // even taking the address requires a load? No — see 4.4
```

### 4.3 What Does NOT Dereference
A few operations work even on a nil pointer because they do not actually load anything:

```go
p == nil          // comparison; no load
fmt.Println(p)    // prints "<nil>"; uses fmt's reflection without a load
var q *int = p    // copies the pointer value (still nil)
```

You can even pass nil pointers around freely. The crash happens only when somebody dereferences.

### 4.4 Methods on Nil Receivers Can Be Valid
A method with a pointer receiver can be invoked on a nil pointer **as long as the method body does not touch any fields**:

```go
type List struct {
    head *Node
    n    int
}

func (l *List) Len() int {
    if l == nil {
        return 0
    }
    return l.n
}

var l *List
fmt.Println(l.Len()) // prints 0 — no panic
```

This is called a **nil-safe method**. The compiler does not insert an automatic nil check before calling a pointer-receiver method, so the call itself is fine. Only when the body says `l.n` does the load happen.

### 4.5 Nil Map, Nil Slice, Nil Channel — Different Stories
Confusingly, Go has several nil-able types with different rules:

```go
var m map[string]int
v := m["k"]      // OK — reading a nil map returns the zero value
m["k"] = 1       // PANIC — writing a nil map panics with a different message

var s []int
fmt.Println(len(s))  // 0 — nil slices have length zero
s = append(s, 1)     // OK — append handles nil slice as empty
v := s[0]            // PANIC — index out of range, NOT nil pointer

var ch chan int
ch <- 1              // blocks forever
<-ch                 // blocks forever; nil channels are receive/send blocking

var p *int
*p                   // PANIC — nil pointer dereference
```

The error messages differ. Get used to reading them.

### 4.6 Typed Nil Inside an Interface
This is the famous Go gotcha:

```go
type MyErr struct{}
func (*MyErr) Error() string { return "boom" }

func may() error {
    var e *MyErr // nil
    return e     // wrapping nil *MyErr in error interface
}

func main() {
    err := may()
    if err != nil {
        fmt.Println("got error:", err.Error()) // panic if MyErr.Error reads fields
    }
}
```

`err != nil` is **true** because the interface value carries a non-nil type tag (`*MyErr`) even though the data pointer is nil. Calling `err.Error()` on this interface dispatches to `(*MyErr).Error`, which receives a nil receiver. If the method touches a field, you get a panic.

You will see this bug enough times to recognize it on sight.

---

## 5. Real-World Analogies

**A locker key for a locker that does not exist.** You hold a key (the pointer) but the locker (the value) was never built. Trying to open it gets you nothing — and the building's security system flags an alarm (the panic).

**A phone number with no contact behind it.** You can copy the number around, save it, share it. The crash is when you actually call.

**An empty parking spot number.** Spot 0 means "no spot assigned". Looking up "where is the car at spot 0" is a category error.

---

## 6. Mental Models

### Model 1 — The pointer is just a number
```
*int p          ┌────────────┐
  value: 0  →   │ address 0  │ ← forbidden region; CPU traps
                └────────────┘
```

When the CPU is asked to load from address 0 (or any low-memory page), it raises a fault. The Go runtime translates that fault into a panic.

### Model 2 — Two-level access
```
   p  →  ?      ?  →  data
   ↑           ↑
   nil         (would be the value)
```

`*p` is two arrows. If the first one (`p`) does not exist as a real object, the second arrow cannot be drawn. The CPU stops at the first hop.

---

## 7. Pros & Cons

### Pros (of having nil at all)
- Cheap default state — no allocation needed.
- Sentinel for "not yet built" cases.
- Compatible with C interop.
- Allows nil-safe methods for clean APIs.

### Cons (of nil dereference panics)
- Crashes are runtime, not compile-time.
- Stack trace points to the dereference, not the missing assignment.
- The typed-nil-in-interface bug is subtle.
- Recovery is possible but limited.

---

## 8. Use Cases

This whole topic is about defending against the panic, but here is when nil pointers themselves are useful:

1. Optional fields in structs (`*string` to mean "absent vs present").
2. Linked list / tree leaves (`next *Node = nil`).
3. Lazy initialization (`if cache == nil { cache = make(...) }`).
4. Default arguments to functions.
5. Sentinel error checks.

The danger comes when you forget which pointers are populated.

---

## 9. Code Examples

### Example 1 — Direct dereference panic
```go
package main

import "fmt"

func main() {
    var p *int
    fmt.Println(*p) // panic: runtime error: invalid memory address or nil pointer dereference
}
```

### Example 2 — Field access panic
```go
package main

type User struct {
    Name string
}

func main() {
    var u *User
    _ = u.Name // panic — u.Name dereferences u
}
```

### Example 3 — Method on nil receiver that touches a field
```go
package main

type Counter struct {
    n int
}

func (c *Counter) Get() int {
    return c.n // dereferences c
}

func main() {
    var c *Counter
    _ = c.Get() // panic
}
```

### Example 4 — Nil-safe method, no panic
```go
package main

import "fmt"

type Counter struct {
    n int
}

func (c *Counter) Safe() int {
    if c == nil {
        return 0
    }
    return c.n
}

func main() {
    var c *Counter
    fmt.Println(c.Safe()) // 0 — no panic
}
```

### Example 5 — Typed nil inside an interface
```go
package main

import "fmt"

type MyErr struct{ msg string }

func (e *MyErr) Error() string { return e.msg }

func produce() error {
    var e *MyErr
    return e // typed nil
}

func main() {
    err := produce()
    fmt.Println(err == nil) // false — interface non-nil
    fmt.Println(err.Error()) // panic — reads e.msg with e == nil
}
```

### Example 6 — Map of pointers, missing key
```go
package main

type User struct{ Name string }

func main() {
    m := map[string]*User{"alice": {Name: "Alice"}}
    bob := m["bob"] // nil — key not present
    _ = bob.Name    // panic
}
```

### Example 7 — Nil function variable
```go
package main

func main() {
    var f func()
    f() // panic: runtime error: invalid memory address or nil pointer dereference
}
```

### Example 8 — Recovering from the panic
```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()

    var p *int
    _ = *p // panic, recovered above
    fmt.Println("never reaches here")
}
```

---

## 10. Coding Patterns

### Pattern 1 — Defensive nil check before use
```go
if u != nil {
    fmt.Println(u.Name)
}
```

### Pattern 2 — Early return on nil
```go
func process(u *User) {
    if u == nil {
        return
    }
    // safe from here on
}
```

### Pattern 3 — Nil-safe method
```go
func (l *List) Len() int {
    if l == nil {
        return 0
    }
    return l.n
}
```

### Pattern 4 — Constructor returns non-nil
```go
func NewUser(name string) *User {
    return &User{Name: name}
}
// callers receive a guaranteed non-nil pointer
```

### Pattern 5 — Document nil contract
```go
// Find returns the user if present, or nil if not.
// Callers must check the result.
func (s *Store) Find(id string) *User { ... }
```

---

## 11. Clean Code Guidelines

1. **Initialize at declaration when a value is required.** Avoid `var p *T` followed by use without an assignment.
2. **Document whether a returned pointer can be nil.**
3. **Prefer nil-safe methods over forcing callers to check.**
4. **Use constructors** to prevent uninitialized structs with nil sub-fields.
5. **Avoid deep chained access** without checks: `a.b.c.d.e` is a panic minefield.
6. **Return error alongside pointer** when nil might mean "absent": `(*User, error)`.

```go
// Good — explicit absence
func Lookup(id string) (*User, error) {
    if id == "" {
        return nil, errors.New("empty id")
    }
    return store[id], nil
}

// Worse — caller has no idea if nil is normal
func Lookup(id string) *User { return store[id] }
```

---

## 12. Product Use / Feature Example

A configuration loader that might find or not find a section:

```go
package main

import (
    "errors"
    "fmt"
)

type Section struct {
    Name string
    Vals map[string]string
}

type Config struct {
    sections map[string]*Section
}

func (c *Config) Section(name string) (*Section, bool) {
    s, ok := c.sections[name]
    return s, ok
}

func main() {
    c := &Config{sections: map[string]*Section{
        "db": {Name: "db", Vals: map[string]string{"host": "localhost"}},
    }}

    if s, ok := c.Section("auth"); ok {
        fmt.Println(s.Vals["secret"])
    } else {
        fmt.Println("auth section missing")
    }

    s, ok := c.Section("db")
    if !ok {
        // would panic if we forgot ok
        return
    }
    if s == nil {
        fmt.Println("nil section recorded")
        return
    }
    fmt.Println(s.Vals["host"])

    _ = errors.New("placeholder for use of errors import")
}
```

The two-return-value idiom (`value, ok`) makes "absent" explicit.

---

## 13. Error Handling

When you see a nil pointer panic in production logs, the stack trace shows the line that dereferenced — not the line that forgot to assign. To fix:

1. Read the panic message — confirm it is `invalid memory address or nil pointer dereference`.
2. Find the named line in the trace.
3. Identify which pointer in that expression is nil.
4. Trace back to the source of that pointer.
5. Add a nil check, or fix the missing assignment, or change the API to make absence impossible.

You can recover, but recover is for boundaries (HTTP handlers, goroutine wrappers), not as a substitute for fixing the bug.

```go
func wrap(h func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("handler panic: %v", r)
        }
    }()
    h()
    return nil
}
```

---

## 14. Security Considerations

1. **Crashing on malformed input is fine if intentional**, but a nil deref from untrusted data is a denial-of-service vector.
2. **Validate every external input** before using its parsed pointer fields.
3. **Don't log sensitive captures** in panic recovery handlers.
4. **Memory safety**: Go's nil deref does NOT lead to memory corruption (unlike C). The runtime stops cleanly. This is a security feature, not a flaw.

---

## 15. Performance Tips

1. **Nil checks are cheap** — one compare, one branch. The CPU's branch predictor handles them well.
2. **The compiler removes redundant nil checks** via SSA passes when it can prove safety.
3. **Avoid recover loops** — recover is expensive (stack scan) and should sit at process boundaries.
4. **Constructors that always return non-nil** save downstream nil checks.

---

## 16. Metrics & Analytics

Track nil pointer panics in production:

```go
import (
    "log"
    "runtime/debug"
)

func recoverAndCount(name string) {
    if r := recover(); r != nil {
        // increment metric: nil_panics{handler=name}
        log.Printf("[%s] PANIC: %v\n%s", name, r, debug.Stack())
        panic(r) // optionally re-panic
    }
}
```

A spike in this metric usually indicates a recently shipped change with insufficient nil checking.

---

## 17. Best Practices

1. Initialize pointers immediately when a value is required.
2. Use constructors for non-trivial structs.
3. Document nil-permitted parameters and returns.
4. Provide nil-safe methods where natural.
5. Use `(value, ok)` or `(value, error)` for "absent" cases.
6. Run with `-race`; race detectors often surface latent nil paths.
7. Use static checkers: `staticcheck`, `nilness`, `nilaway`.
8. Test with explicit nil inputs, not just typical inputs.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Chained access
```go
fmt.Println(user.Profile.Address.City) // panics if any link is nil
```
Fix: check each link, or refactor to flatter struct.

### Pitfall 2 — Map returning nil for missing key
```go
u := users["bob"] // u == nil if key absent
fmt.Println(u.Name) // panic
```
Fix: `u, ok := users["bob"]; if !ok { ... }`.

### Pitfall 3 — Typed nil interface
```go
var e *MyErr
var err error = e
err != nil // true!
```
Fix: return `error` directly (`return nil`) when no error, not a typed nil pointer.

### Pitfall 4 — Method on nil struct that reads fields
```go
type S struct{ x int }
func (s *S) X() int { return s.x }
var s *S
s.X() // panic
```
Fix: nil-safe method or check before calling.

### Pitfall 5 — Forgetting to assign in error path
```go
func load() (*Cfg, error) {
    cfg := &Cfg{}
    if err := decode(cfg); err != nil {
        return nil, err
    }
    return cfg, nil
}
// caller:
cfg, _ := load() // ignored err
fmt.Println(cfg.Host) // panic if load failed
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| `var p *T; *p` | Initialize before use |
| Ignoring err from constructor | Check err; do not use returned pointer if non-nil err |
| Returning typed nil as `error` | Return `nil` directly |
| Reading map without `, ok` | Use comma-ok form |
| Calling pointer-receiver method that reads fields on nil | Add nil guard |

---

## 20. Common Misconceptions

**Misconception 1**: "All methods on nil pointers panic."
**Truth**: Only methods that touch fields panic. Nil-safe methods are fine.

**Misconception 2**: "If `err != nil` then there is a real error."
**Truth**: A typed nil pointer wrapped in `error` makes `err != nil` true even when no error occurred.

**Misconception 3**: "Nil dereference can corrupt memory."
**Truth**: Go's runtime intercepts the trap and panics. No corruption.

**Misconception 4**: "Recover fixes nil dereferences."
**Truth**: Recover only stops the panic. The bug remains; you must fix it.

**Misconception 5**: "`fmt.Println(p)` will panic if p is nil."
**Truth**: It prints `<nil>`. Only loads through the pointer panic.

---

## 21. Tricky Points

1. `p.M()` may or may not panic depending on whether `M` reads fields.
2. `var s []int; s[0]` is "index out of range", not nil pointer.
3. `var m map[string]int; m["k"] = 1` is "assignment to entry in nil map", a different runtime panic.
4. `var f func(); f()` is a nil pointer dereference (the func value's code pointer is nil).
5. The typed-nil-in-interface bug appears when wrapping `*T` as `error` or any other interface.

---

## 22. Test

```go
package main

import (
    "strings"
    "testing"
)

type Box struct {
    v int
}

func (b *Box) Value() int {
    if b == nil {
        return 0
    }
    return b.v
}

func TestNilSafe(t *testing.T) {
    var b *Box
    if got := b.Value(); got != 0 {
        t.Errorf("got %d, want 0 from nil receiver", got)
    }
}

func TestPanicOnNil(t *testing.T) {
    defer func() {
        r := recover()
        if r == nil {
            t.Fatal("expected panic")
        }
        msg := getMessage(r)
        if !strings.Contains(msg, "nil pointer") {
            t.Errorf("unexpected panic: %v", r)
        }
    }()
    var b *Box
    _ = b.v // dereference; panics
}

func getMessage(r any) string {
    if e, ok := r.(error); ok {
        return e.Error()
    }
    if s, ok := r.(string); ok {
        return s
    }
    return ""
}
```

---

## 23. Tricky Questions

**Q1**: What does this print?
```go
var p *int
fmt.Println(p == nil)
fmt.Println(p)
```
**A**: `true` then `<nil>`. No panic — neither operation dereferences.

**Q2**: What does this print?
```go
type T struct{ v int }
func (t *T) Show() {
    if t == nil { fmt.Println("nil"); return }
    fmt.Println(t.v)
}
var t *T
t.Show()
```
**A**: `nil`. The method is invoked on a nil receiver but does not crash because the body checks first.

**Q3**: Is `err != nil` true here?
```go
type E struct{}
func (*E) Error() string { return "" }
var e *E
var err error = e
fmt.Println(err != nil)
```
**A**: `true`. Interface is non-nil because it carries the type tag `*E` even though the data is nil.

---

## 24. Cheat Sheet

```go
// Detect
if p == nil { /* not safe to dereference */ }

// Defend
func (s *S) M() int {
    if s == nil { return 0 }
    return s.x
}

// Avoid typed nil interface
func mayFail() error {
    if cond {
        return &MyErr{...}
    }
    return nil // not (*MyErr)(nil)
}

// Map miss
v, ok := m["k"]
if !ok || v == nil { /* handle */ }

// Recover at boundary
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v", r)
    }
}()
```

---

## 25. Self-Assessment Checklist

- [ ] I can describe what triggers a nil pointer panic
- [ ] I know which operations dereference a pointer
- [ ] I can write a nil-safe method
- [ ] I understand the typed-nil-in-interface bug
- [ ] I know nil map vs nil slice vs nil pointer differences
- [ ] I can recover from a panic at a boundary
- [ ] I prefer constructors and `(value, ok)` returns
- [ ] I read the runtime panic message to diagnose

---

## 26. Summary

A nil pointer dereference is the runtime panic Go raises when your code follows a pointer that has not been set. Every pointer type has a zero value of `nil`; reading or writing through it triggers the panic. Methods with pointer receivers can be invoked on nil receivers safely **if** they do not touch fields — these are "nil-safe methods". The most subtle bug is the typed nil wrapped in an interface: `err != nil` is true even though no real error exists. Fixes are straightforward: nil-check before use, document nil contracts, return `(value, ok)` or `(value, error)` for absence, and use constructors that guarantee non-nil. Recovery is for boundaries, not for masking bugs.

---

## 27. What You Can Build

- A robust HTTP handler that recovers from any nil deref.
- A linked list with a nil-safe `Len`, `Empty`, and `Reverse`.
- A configuration loader that distinguishes "absent" from "error".
- A test suite that explicitly passes nil to functions to catch regressions.
- A linter wrapper that runs `staticcheck` SA5011 on every commit.

---

## 28. Further Reading

- [Go Spec — Pointer types](https://go.dev/ref/spec#Pointer_types)
- [Runtime errors](https://pkg.go.dev/runtime#hdr-Runtime_errors)
- [`runtime.PanicNilError`](https://pkg.go.dev/runtime#PanicNilError)
- [Go FAQ — Why does my nil error variable not equal nil?](https://go.dev/doc/faq#nil_error)
- [Effective Go — Allocation with new](https://go.dev/doc/effective_go#allocation_new)

---

## 29. Related Topics

- 2.7.1 Pointers Basics
- 2.7.2 Pointers with Structs
- 2.7.3 With Maps and Slices
- 2.7.4 Memory Management
- 2.8 Error Handling Basics
- 2.6.1 Functions Basics

---

## 30. Diagrams & Visual Aids

### Pointer pointing to nothing
```
   p (*int)
   ┌─────────┐
   │  nil    │
   └────┬────┘
        ▼
       ╳ no object
```

### Method dispatch flow
```
  call l.Len()
        │
        ▼
  is l nil? — yes ──→ if body checks: return 0
        │              if body reads field: PANIC
        │
        no ──→ load fields, run body
```

### Typed nil in interface
```
  err (interface{})
  ┌──────────────────┐
  │ type:  *MyErr    │  ← non-nil
  │ data:  nil       │  ← but pointer inside is nil
  └──────────────────┘
       err == nil → false
       err.Error() → dispatched to (*MyErr).Error with nil receiver
```
