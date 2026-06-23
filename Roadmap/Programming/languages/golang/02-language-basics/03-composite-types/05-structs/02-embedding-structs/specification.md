# Go Specification: Embedding Structs

**Source:** https://go.dev/ref/spec#Struct_types
**Section:** Types → Composite Types → Struct Types → Embedded Fields

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Struct_types
- **Related:** https://go.dev/ref/spec#Selectors
- **Related:** https://go.dev/ref/spec#Method_sets
- **Related:** https://go.dev/ref/spec#Promoted_methods_and_fields
- **Related:** https://go.dev/ref/spec#Assignability

Official definition from the spec:

> "A field declared with a type but no explicit field name is called an embedded field. An embedded field must be specified as a type name T or as a pointer to a non-interface type name *T, and T itself may not be a pointer type."

On promotion:

> "A field or method f of an embedded field in a struct x is called promoted if x.f is a legal selector that denotes that field or method f."

---

## 2. Formal Grammar (EBNF)

```ebnf
StructType    = "struct" "{" { FieldDecl ";" } "}" .
FieldDecl     = (IdentifierList Type | EmbeddedField) [ Tag ] .
EmbeddedField = [ "*" ] TypeName [ TypeArgs ] .
```

Key rules:
- An embedded field is specified as `TypeName` (no identifier before it).
- May optionally be `*TypeName` (pointer to type).
- `TypeName` must not itself be a pointer type.
- An embedded field's name (for selector access) is the unqualified type name.

**Valid embedding examples:**

```go
struct { Animal }         // embed Animal by value
struct { *Animal }        // embed *Animal (pointer)
struct { io.Reader }      // embed an interface
struct { sync.Mutex }     // embed from another package
```

**Invalid embedding examples:**

```go
struct { *(*Animal) }     // compile error: T must not be a pointer type
struct { int }            // embedding a built-in type — valid in Go
```

---

## 3. Core Rules & Constraints

### 3.1 Promoted Fields

Fields of an embedded struct are **promoted** to the outer struct. They can be accessed directly without specifying the embedded type name.

```go
package main

import "fmt"

type Address struct {
    Street string
    City   string
    Zip    string
}

type Person struct {
    Name    string
    Age     int
    Address // embedded
}

func main() {
    p := Person{
        Name: "Alice",
        Age:  30,
        Address: Address{
            Street: "123 Main St",
            City:   "Springfield",
            Zip:    "12345",
        },
    }
    // Promoted field access
    fmt.Println(p.Street) // same as p.Address.Street
    fmt.Println(p.City)   // same as p.Address.City

    // Direct access still works
    fmt.Println(p.Address.Zip)
}
```

### 3.2 Promoted Methods

Methods of the embedded type are promoted to the outer struct. The outer struct satisfies any interfaces that the embedded type satisfies (unless methods are shadowed).

```go
package main

import "fmt"

type Logger struct{}

func (l Logger) Log(msg string) {
    fmt.Println("[LOG]", msg)
}

type Server struct {
    Logger       // promoted: Server now has Log method
    Host   string
    Port   int
}

func main() {
    s := Server{Host: "localhost", Port: 8080}
    s.Log("Server started") // calls s.Logger.Log
}
```

### 3.3 Embedded Field Name

The unqualified type name serves as the field name of the embedded field.

```go
package main

import (
    "fmt"
    "sync"
)

type SafeCounter struct {
    sync.Mutex           // field name is "Mutex"
    count int
}

func main() {
    c := SafeCounter{}
    c.Lock()             // promoted method
    c.count++
    c.Unlock()           // promoted method
    fmt.Println(c.count)

    // Direct access using field name
    c.Mutex.Lock()
    c.Mutex.Unlock()
}
```

### 3.4 Embedding Pointer Types

Embedding `*T` means the outer struct holds a pointer to T. The embedded pointer can be nil.

```go
package main

import "fmt"

type Base struct {
    ID int
}

func (b *Base) SetID(id int) { b.ID = id }

type Widget struct {
    *Base         // embedded pointer
    Label string
}

func main() {
    w := Widget{
        Base:  &Base{ID: 1},
        Label: "button",
    }
    w.SetID(99)             // promoted method
    fmt.Println(w.ID)       // 99
    fmt.Println(w.Base.ID)  // 99
}
```

### 3.5 Conflict Resolution and Shadowing

If the outer struct has a field or method with the same name as a promoted one, the outer definition **shadows** the promoted name.

```go
package main

import "fmt"

type Inner struct {
    X int
}

type Outer struct {
    Inner
    X string // shadows Inner.X
}

func main() {
    o := Outer{Inner: Inner{X: 42}, X: "hello"}
    fmt.Println(o.X)       // "hello" — Outer.X
    fmt.Println(o.Inner.X) // 42 — must qualify to access
}
```

---

## 4. Type Rules

### 4.1 Embedding vs Inheritance

Go embedding is **composition**, not inheritance. The outer struct does not become the embedded type; it contains it. There is no is-a relationship at the type level.

```go
package main

import "fmt"

type Animal struct {
    Name string
}

func (a Animal) Speak() string {
    return a.Name + " speaks"
}

type Dog struct {
    Animal
    Breed string
}

func main() {
    d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Husky"}
    fmt.Println(d.Speak()) // "Rex speaks" — promoted

    // Dog is NOT an Animal in the type system:
    // var a Animal = d // compile error
    var a Animal = d.Animal // must extract
    fmt.Println(a)
}
```

### 4.2 Interface Satisfaction Through Embedding

If an embedded type implements an interface, the outer struct also implements that interface (unless the method is shadowed).

```go
package main

import "fmt"

type Stringer interface {
    String() string
}

type Base struct{ Val int }
func (b Base) String() string { return fmt.Sprintf("Base(%d)", b.Val) }

type Derived struct {
    Base
    Extra string
}

func printIt(s Stringer) {
    fmt.Println(s.String())
}

func main() {
    d := Derived{Base: Base{Val: 42}, Extra: "x"}
    printIt(d) // Derived satisfies Stringer via promoted Base.String
}
```

### 4.3 Method Set Rules for Embedding

The spec defines method set promotion:

- If `S` contains an embedded field `T`, the method set of `S` includes promoted methods with receiver `T`.
- The method set of `*S` includes promoted methods with receiver `T` or `*T`.
- If `S` contains an embedded field `*T`, both `S` and `*S` include promoted methods with receiver `T` or `*T`.

```go
package main

import "fmt"

type Walker struct{}
func (w Walker) Walk() { fmt.Println("walking") }
func (w *Walker) Run()  { fmt.Println("running") }

type Person struct {
    Walker
}

func main() {
    p := Person{}
    p.Walk()    // promoted: value receiver — available on value
    p.Run()     // promoted: pointer receiver — auto-addressed
    (&p).Walk() // also fine
    (&p).Run()  // fine
}
```

### 4.4 Ambiguous Selectors (Depth Ties)

If two embedded fields at the same depth have a field or method with the same name, access is ambiguous and causes a compile error.

```go
package main

type Left  struct{ X int }
type Right struct{ X int }

type Both struct {
    Left
    Right
}

func main() {
    b := Both{}
    _ = b.Left.X   // OK: qualified
    _ = b.Right.X  // OK: qualified
    // _ = b.X     // compile error: ambiguous selector b.X
}
```

---

## 5. Behavioral Specification

### 5.1 Mixin Pattern

Embedding enables the "mixin" pattern — adding reusable behavior by embedding a type.

```go
package main

import (
    "fmt"
    "time"
)

type Timestamps struct {
    CreatedAt time.Time
    UpdatedAt time.Time
}

func (t *Timestamps) Touch() {
    t.UpdatedAt = time.Now()
}

type Article struct {
    Timestamps
    Title   string
    Content string
}

type Comment struct {
    Timestamps
    Text string
}

func main() {
    a := Article{Title: "Go Embedding"}
    a.Touch()
    fmt.Println(a.UpdatedAt.IsZero()) // false
}
```

### 5.2 Decorator Pattern with Embedding

```go
package main

import "fmt"

type Writer interface {
    Write(data string)
}

type ConsoleWriter struct{}

func (cw ConsoleWriter) Write(data string) {
    fmt.Println(data)
}

type LoggingWriter struct {
    ConsoleWriter // embedded: promotes Write method
    prefix string
}

func (lw LoggingWriter) Write(data string) {
    // Override promoted Write
    lw.ConsoleWriter.Write(lw.prefix + ": " + data)
}

func main() {
    w := LoggingWriter{prefix: "INFO"}
    w.Write("hello") // INFO: hello
}
```

### 5.3 sync.Mutex Embedding Pattern

The most common embedding in Go standard library usage:

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    sync.RWMutex
    data map[string]string
}

func NewCache() *Cache {
    return &Cache{data: make(map[string]string)}
}

func (c *Cache) Set(key, val string) {
    c.Lock()
    defer c.Unlock()
    c.data[key] = val
}

func (c *Cache) Get(key string) (string, bool) {
    c.RLock()
    defer c.RUnlock()
    v, ok := c.data[key]
    return v, ok
}

func main() {
    cache := NewCache()
    cache.Set("greeting", "hello")
    if v, ok := cache.Get("greeting"); ok {
        fmt.Println(v) // hello
    }
}
```

### 5.4 Embedding in Composite Literals

```go
package main

import "fmt"

type Point struct{ X, Y int }
type Circle struct {
    Point  // embedded
    Radius float64
}

func main() {
    // Two ways to initialize
    c1 := Circle{Point: Point{X: 1, Y: 2}, Radius: 5.0}
    c2 := Circle{Point{3, 4}, 7.0}

    fmt.Println(c1.X, c1.Y, c1.Radius)
    fmt.Println(c2.Point.X, c2.Point.Y)
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Nil Embedded Pointer

If an embedded pointer field is nil and you call a method on it, the behavior depends on whether the method dereferences the receiver. Calling a nil pointer's method can panic.

```go
package main

import "fmt"

type Base struct{ Val int }
func (b *Base) GetVal() int {
    if b == nil {
        return -1
    }
    return b.Val
}

type Outer struct {
    *Base
}

func main() {
    o := Outer{} // Base is nil
    fmt.Println(o.GetVal()) // -1 — handled nil receiver
}
```

### 6.2 Defined: Method at Outer Depth Wins

When a method exists at both the outer struct level and the embedded level, the outer method always wins (no ambiguity).

### 6.3 Defined: Identical Depth Ambiguity is Compile Error

If two embedded fields at the same depth both promote a field/method with the same name, accessing that field unqualified is a **compile error**.

---

## 7. Edge Cases from Spec

### 7.1 Embedding an Interface

A struct can embed an interface type. This means the struct satisfies that interface (but calling the method panics at runtime if no concrete method is set).

```go
package main

import "fmt"

type Speaker interface {
    Speak() string
}

type Robot struct {
    Speaker // embedded interface
    Name    string
}

type Dog struct{ name string }
func (d Dog) Speak() string { return "Woof from " + d.name }

func main() {
    r := Robot{
        Speaker: Dog{name: "Rex"},
        Name:    "R2D2",
    }
    fmt.Println(r.Speak()) // Woof from Rex
}
```

### 7.2 Embedding With Type Parameters (Generics, Go 1.18+)

```go
package main

import "fmt"

type Pair[T any] struct {
    First  T
    Second T
}

type NamedPair[T any] struct {
    Pair[T]   // embedded generic type
    Name string
}

func main() {
    np := NamedPair[int]{Pair: Pair[int]{1, 2}, Name: "coords"}
    fmt.Println(np.First, np.Second, np.Name)
}
```

### 7.3 Depth-Based Promotion

Promoted fields at a shallower depth take precedence over deeper ones with the same name.

```go
package main

import "fmt"

type Inner struct{ X int }
type Middle struct {
    Inner
    X string // at depth 1 — shadows Inner.X at depth 2
}
type Outer struct {
    Middle
}

func main() {
    o := Outer{Middle: Middle{Inner: Inner{X: 99}, X: "hello"}}
    fmt.Println(o.X)        // "hello" — Middle.X (depth 1) wins over Inner.X (depth 2)
    fmt.Println(o.Inner.X)  // 99
}
```

### 7.4 Embedding Does Not Create Circular Types

A struct cannot embed itself (direct or indirect cycles are not allowed).

```go
// type Node struct { Node } // compile error: invalid recursive type
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Struct embedding introduced |
| Go 1.18    | Embedding works with generic types (`Pair[T]`) |
| Go 1.21    | No changes to embedding semantics |

**Note:** Struct embedding semantics have been stable since Go 1.0.

---

## 9. Implementation-Specific Behavior

### 9.1 Memory Layout

When a struct embeds another struct by value, the embedded struct's fields are laid out contiguously within the outer struct. There is no pointer indirection.

```go
package main

import (
    "fmt"
    "unsafe"
)

type Inner struct{ A, B int }
type Outer struct {
    Inner
    C int
}

func main() {
    o := Outer{}
    fmt.Println(unsafe.Offsetof(o.Inner)) // 0
    fmt.Println(unsafe.Offsetof(o.C))     // 16 (after 2 ints)
}
```

### 9.2 Promoted Method Wrapper Generation

The gc compiler may generate wrapper methods to implement interface satisfaction through promoted methods. These wrappers have minimal overhead.

### 9.3 Interface Embedding: Size = 2 Words

When a struct embeds an interface, it stores a two-word interface value (type pointer + data pointer) in the struct. This is independent of the concrete type.

---

## 10. Spec Compliance Checklist

- [ ] Embedded field declared with type name only (no explicit identifier)
- [ ] Embedded field name is the unqualified type name
- [ ] Both `T` and `*T` embedding forms are valid
- [ ] `T` in `*T` embedding must not itself be a pointer type
- [ ] Fields of embedded type are promoted (accessible without qualifier)
- [ ] Methods of embedded type are promoted
- [ ] Outer struct fields/methods shadow same-name promoted ones
- [ ] Depth-based promotion: shallower wins over deeper
- [ ] Identical depth with same name: compile error (ambiguous selector)
- [ ] Method set of `S` includes promoted methods with value receivers
- [ ] Method set of `*S` includes promoted methods with value and pointer receivers
- [ ] Nil embedded pointer: method calls may panic (behavior defined by method)
- [ ] Embedded interface: struct satisfies the interface at compile time

---

## 11. Official Examples

### Example 1: Basic Field Promotion

```go
package main

import "fmt"

type Base struct {
    ID   int
    Name string
}

func (b Base) Describe() string {
    return fmt.Sprintf("ID=%d Name=%s", b.ID, b.Name)
}

type Employee struct {
    Base
    Department string
}

func main() {
    e := Employee{
        Base:       Base{ID: 1, Name: "Alice"},
        Department: "Engineering",
    }

    // Promoted field access
    fmt.Println(e.ID)          // 1
    fmt.Println(e.Name)        // Alice
    fmt.Println(e.Describe())  // ID=1 Name=Alice
    fmt.Println(e.Department)  // Engineering
}
```

### Example 2: Interface Satisfaction via Embedding

```go
package main

import (
    "fmt"
    "math"
)

type Geometry interface {
    Area() float64
    Perimeter() float64
}

type Rect struct {
    Width, Height float64
}

func (r Rect) Area() float64      { return r.Width * r.Height }
func (r Rect) Perimeter() float64 { return 2*(r.Width+r.Height) }

type Circle struct {
    Radius float64
}

func (c Circle) Area() float64      { return math.Pi * c.Radius * c.Radius }
func (c Circle) Perimeter() float64 { return 2 * math.Pi * c.Radius }

func measure(g Geometry) {
    fmt.Printf("Area: %.2f, Perimeter: %.2f\n", g.Area(), g.Perimeter())
}

func main() {
    r := Rect{Width: 3, Height: 4}
    c := Circle{Radius: 5}
    measure(r)
    measure(c)
}
```

### Example 3: sync.Mutex Embedding

```go
package main

import (
    "fmt"
    "sync"
)

type SafeMap struct {
    sync.Mutex
    m map[string]int
}

func (sm *SafeMap) Set(key string, val int) {
    sm.Lock()
    defer sm.Unlock()
    sm.m[key] = val
}

func (sm *SafeMap) Get(key string) int {
    sm.Lock()
    defer sm.Unlock()
    return sm.m[key]
}

func main() {
    sm := &SafeMap{m: make(map[string]int)}
    sm.Set("x", 42)
    fmt.Println(sm.Get("x")) // 42
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Struct types | https://go.dev/ref/spec#Struct_types | Full struct type definition including embedding |
| Selectors | https://go.dev/ref/spec#Selectors | How `x.f` resolves for promoted fields/methods |
| Method sets | https://go.dev/ref/spec#Method_sets | How embedding affects method sets |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Field name resolution rules |
| Type identity | https://go.dev/ref/spec#Type_identity | Tags in embedded structs affect type identity |
| Interface types | https://go.dev/ref/spec#Interface_types | Embedding interfaces in structs |
| Type parameters | https://go.dev/ref/spec#Type_parameter_declarations | Generic types can be embedded (Go 1.18+) |
