# Pointer Receivers — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Method Set Mechanics](#method-set-mechanics)
3. [Addressability Deep Dive](#addressability-deep-dive)
4. [When Auto-Addressing Fails](#when-auto-addressing-fails)
5. [Receiver Choice Decision Tree](#receiver-choice-decision-tree)
6. [Pointer Receiver and Embedding](#pointer-receiver-and-embedding)
7. [Pointer Receiver and Interfaces](#pointer-receiver-and-interfaces)
8. [Concurrency Implications](#concurrency-implications)
9. [Memory Layout](#memory-layout)
10. [Patterns](#patterns)
11. [Test](#test)
12. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the junior level you learned the basics of pointer receivers. At the middle level we cover:
- Method set rules and interface satisfaction
- What addressability is and the situations where it breaks down
- Pointer receivers with embedding and interfaces
- Concurrency, memory layout, and the impact on escape analysis

This file is dedicated to studying these topics in depth.

---

## Method Set Mechanics

### Rule — formal

```
Method set of T:
    func (t T) M()   ← included
    func (t *T) M()  ← not included

Method set of *T:
    func (t T) M()   ← included
    func (t *T) M()  ← included
```

### Useful conclusions

1. **`*T` has a wider method set** — it contains both T's and *T's methods.
2. **For `T` to satisfy an interface, all methods must use a value receiver** — if even one method has a pointer receiver, T does not satisfy the interface.
3. **`*T` can always stand in for T** (in an interface context).

### Example

```go
type Animal struct{ name string }
func (a Animal)  Name() string  { return a.name }
func (a *Animal) Rename(n string) { a.name = n }

type Namer interface { Name() string }
type Renamer interface { Rename(string) }

var a Animal
var p *Animal = &a

var _ Namer = a       // OK — Name has a value receiver
var _ Renamer = a     // ERROR — Rename has a pointer receiver, not in T's method set
var _ Namer = p       // OK
var _ Renamer = p     // OK
```

---

## Addressability Deep Dive

Addressable values are those whose address (`&v`) you can take.

### Addressable

| Location | Example |
|-----|-------|
| Local variable | `var x int; &x` ✅ |
| Pointer dereference | `p := &x; &(*p)` ✅ |
| Slice element | `s := []int{1}; &s[0]` ✅ |
| Struct field | `&u.Name` ✅ |
| Array element (named array) | `a := [3]int{}; &a[0]` ✅ |

### NOT addressable

| Location | Example |
|-----|-------|
| Map element | `m := map[string]int{}; &m["k"]` ❌ |
| Function return value | `&f()` ❌ |
| Constants | `&5` ❌ |
| Type conversion | `&int(x)` ❌ |
| String index | `s := "abc"; &s[0]` ❌ |
| Channel receive | `&(<-ch)` ❌ |
| Selector via map | `&m["k"].field` ❌ |

### Reason — Map

Values inside a map **may move in memory** (rehashing). Holding a pointer would be unsafe — that is why Go made map elements NOT addressable.

### Slice OK, but be careful

```go
s := []int{1, 2, 3}
p := &s[0]
fmt.Println(*p)  // 1

s = append(s, 4, 5, 6, 7, 8)  // possible — may allocate a new backing array
fmt.Println(*p)  // still 1 (from the old array)
```

`append` often allocates a new array. The pointer still references the old array. Be careful.

---

## When Auto-Addressing Fails

### Cases

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

// 1. Map element
m := map[string]C{"k": {}}
m["k"].Inc()  // ERROR

// 2. Function return value
func makeC() C { return C{} }
makeC().Inc()  // ERROR

// 3. Constant / literal
C{}.Inc()    // ERROR

// 4. Type conversion result
type CI int
func (c *CI) Inc() {}
CI(5).Inc()  // ERROR
```

### Solutions

```go
// 1. Use a temporary
v := m["k"]
v.Inc()
m["k"] = v

// Or — map[K]*V
m2 := map[string]*C{"k": {}}
m2["k"].Inc()  // OK

// 2. Use a temporary
c := makeC()
c.Inc()

// 3. Use a temporary
c := C{}
c.Inc()
```

---

## Receiver Choice Decision Tree

```
                  ┌─ Does the method modify state?
       Yes →  POINTER RECEIVER
                  │
                  └─ No
                          ┌─ Does the type contain a mutex/atomic?
                Yes →  POINTER RECEIVER
                          │
                          └─ No
                                  ┌─ Is the type larger than 16 bytes?
                        Yes →  POINTER RECEIVER (saves memory)
                                  │
                                  └─ No
                                          ┌─ Should the type be immutable?
                                Yes →  VALUE RECEIVER
                                          │
                                          └─ Project convention: pointer
```

### Practical rules

1. **Stateful type (counter, server, cache)** → pointer
2. **Immutable value object (Money, Coordinate, Color)** → value
3. **Method on a built-in type (slice, map, function alias)** → usually value
4. **Mutex/sync** → pointer (mandatory)
5. **One type — one style** — all methods use the same kind of receiver

---

## Pointer Receiver and Embedding

### Embed value, how are methods promoted?

```go
type Base struct{ id int }
func (b Base)  ID() int       { return b.id }
func (b *Base) SetID(n int)   { b.id = n }

type User struct{ Base }      // value embed

var u User
u.ID()         // OK — Base value method
u.SetID(5)     // OK — Go automatically (&u.Base).SetID(5)
```

User's method set:
- `Base.ID()` — included
- `Base.SetID()` — included (when `u` is addressable)

### Embed pointer

```go
type User struct{ *Base }     // pointer embed

u := User{Base: &Base{}}
u.ID()
u.SetID(5)
```

When `*Base` is embedded, both value and pointer methods are promoted automatically.

### Checking interface satisfaction

```go
type IDer interface { ID() int }
type Setter interface { SetID(int) }

var _ IDer = User{Base: Base{}}      // OK
var _ Setter = User{Base: Base{}}    // ERROR — User's method set has no SetID (value embed, T method set)
var _ Setter = &User{Base: Base{}}   // OK — *User method set
```

---

## Pointer Receiver and Interfaces

### Passing a concrete type to an interface

```go
type Greeter interface { Greet() string }

type Person struct{ name string }
func (p *Person) Greet() string { return "Hi " + p.name }

p := Person{name: "Alice"}

// var g Greeter = p    // ERROR — Person's method set has no Greet
var g Greeter = &p     // OK
fmt.Println(g.Greet()) // Hi Alice
```

### Inside an interface value

An interface value internally holds `(type, value)`. If a method has a pointer receiver — the value must be a pointer.

```go
var g Greeter = &p
// internally: g = (type: *Person, value: pointer to p)
```

### Be careful with type assertion

```go
var g Greeter = &p
person := g.(Person)    // PANIC — actual type is *Person
person := g.(*Person)   // OK
```

---

## Concurrency Implications

### Pointer receiver under concurrency

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

c := &Counter{}
for i := 0; i < 1000; i++ {
    go c.Inc()  // RACE
}
```

`c.n++` is not atomic — race condition. `go run -race` will detect it.

### Solution 1: Mutex

```go
type SafeCounter struct {
    mu sync.Mutex
    n  int
}
func (c *SafeCounter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
```

### Solution 2: Atomic

```go
type AtomicCounter struct{ n atomic.Int64 }
func (c *AtomicCounter) Inc() { c.n.Add(1) }
func (c *AtomicCounter) Get() int64 { return c.n.Load() }
```

### Mutex with a value receiver — bug

```go
type X struct{ mu sync.Mutex; n int }
func (x X) Inc() {  // VALUE receiver — bad
    x.mu.Lock()
    defer x.mu.Unlock()
    x.n++
}
```

This code compiles, but `go vet` issues a "passes lock by value" warning. Each call copies `x` — the mutex too. There is no synchronization.

---

## Memory Layout

### Pointer size

On a 64-bit platform a pointer is 8 bytes. With a pointer receiver — 8 bytes are passed.

### When the receiver is a value

```go
type Big struct { data [1024]int }  // 8KB

func (b Big)  M() {}     // each call pushes 8KB onto the stack
func (b *Big) M() {}     // each call passes 8 bytes
```

### Heap escape

With a pointer receiver method, the receiver often escapes to the heap:

```go
type S struct{ n int }
func (s *S) M() *int { return &s.n }  // s.n escapes

s := S{}
p := s.M()  // s moves to the heap (a pointer to s.n leaks out)
```

Verify with `go build -gcflags='-m'`.

### Pointer receiver method body

```go
func (c *Counter) Inc() {
    c.n++   // = (*c).n++
}
```

The compiled code is just pointer arithmetic. No extra runtime overhead.

---

## Patterns

### Pattern 1: Constructor + pointer receiver

```go
type Server struct{ port int; quit chan struct{} }

func NewServer(port int) *Server {
    return &Server{port: port, quit: make(chan struct{})}
}

func (s *Server) Start() error { ... }
func (s *Server) Stop()       { close(s.quit) }
```

### Pattern 2: Internal state hide

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]any
}

func NewCache() *Cache {
    return &Cache{m: map[string]any{}}
}

func (c *Cache) Get(k string) (any, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}

func (c *Cache) Set(k string, v any) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[k] = v
}
```

### Pattern 3: Builder

```go
type ReqBuilder struct{ r Request }

func New() *ReqBuilder { return &ReqBuilder{} }
func (b *ReqBuilder) URL(u string) *ReqBuilder { b.r.URL = u; return b }
func (b *ReqBuilder) Method(m string) *ReqBuilder { b.r.Method = m; return b }
func (b *ReqBuilder) Build() Request { return b.r }
```

### Pattern 4: Interface embedding wrapper

```go
type Logger struct{ log *log.Logger }
type LoggingClient struct{ Client; logger *Logger }

func (lc *LoggingClient) Do(req *Request) (*Response, error) {
    lc.logger.log.Println("request:", req.URL)
    return lc.Client.Do(req)
}
```

---

## Test

### 1. Does `*T`'s method set contain `T`'s value methods?
**Answer:** Yes. `*T`'s method set is wider — it includes those of both `T` and `*T`.

### 2. Why does `m["k"].PtrMethod()` not work?
**Answer:** Map elements are not addressable. A pointer receiver method requires `&m["k"]`.

### 3. Which receiver should a type with a mutex use?
**Answer:** Pointer. Otherwise the mutex is copied on every call and synchronization is lost.

### 4. Is a pointer receiver method safe on nil?
**Answer:** It depends. If the method does not dereference the receiver — it is safe. Otherwise — panic.

### 5. Difference between embedding `*Base` and `Base`?
**Answer:** When `*Base` is embedded, the outer type's method set has both value AND pointer methods of Base. When `Base` is embedded by value, value methods are always present, while pointer methods are only available when the value is addressable.

---

## Cheat Sheet

```
METHOD SET RULES
─────────────────────────
T:   value methods only
*T:  value + pointer methods

ADDRESSABILITY
─────────────────────────
✓ Local var, struct field, slice element, pointer deref
✗ Map element, return value, constant, type conversion

AUTO-CONVERSIONS
─────────────────────────
v.PtrM()  →  (&v).PtrM()  if v addressable
p.ValM()  →  (*p).ValM()  always

INTERFACE
─────────────────────────
Pointer receiver method → only *T satisfies the interface
Value receiver method   → both T and *T

EMBED
─────────────────────────
type S struct{ Base }   → Base value embed
type S struct{ *Base }  → Base pointer embed (wider method set)

CONCURRENCY
─────────────────────────
mutex/atomic → always pointer receiver
go vet "passes lock by value" — warning
race detector — `go run -race`
```

---

## Summary

At the middle level, pointer receivers:
- **Method set** rules determine interface satisfaction
- **Addressability** limits how Go's auto-`&` works
- **Map element problem** — always remember it
- **Concurrency** — pointer is mandatory when a mutex/atomic is present
- **Embedding** — pointer vs value embed affects the method set
- **Interface satisfaction** — if the concrete type's method set satisfies the interface, you are OK

At the senior level we go deeper into dispatch mechanisms, escape analysis, and memory layout.
