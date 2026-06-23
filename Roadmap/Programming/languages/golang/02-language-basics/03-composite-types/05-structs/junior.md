# Structs in Go — Junior Level

## Overview

A **struct** is Go's primary way to group related data together. Where other languages have classes, Go has structs. Structs are simple, composable, and form the foundation of every Go program's data model.

---

## 1. What Is a Struct?

A struct is a collection of named fields, each with its own type. Think of it as a custom data type that bundles related information.

```go
// Defining a struct type
type Person struct {
    Name string
    Age  int
}
```

Once defined, you can create values of type `Person` anywhere in the package (or externally if exported).

---

## 2. Declaring and Creating Structs

There are several ways to create a struct value:

```go
type Point struct {
    X float64
    Y float64
}

// Method 1: Struct literal with field names (recommended)
p1 := Point{X: 3.0, Y: 4.0}

// Method 2: Struct literal by position (fragile — avoid in most cases)
p2 := Point{3.0, 4.0}

// Method 3: Declare then assign
var p3 Point
p3.X = 1.0
p3.Y = 2.0

// Method 4: Using new() — returns a pointer
p4 := new(Point)
p4.X = 5.0
p4.Y = 6.0
```

---

## 3. Accessing Fields

Use the dot (`.`) operator to access or set fields:

```go
type Rectangle struct {
    Width  float64
    Height float64
}

rect := Rectangle{Width: 10.0, Height: 5.0}

fmt.Println(rect.Width)   // 10
fmt.Println(rect.Height)  // 5

area := rect.Width * rect.Height
fmt.Println("Area:", area) // Area: 50

rect.Width = 20.0 // modify a field
fmt.Println(rect.Width) // 20
```

---

## 4. Zero Values

Every struct field has a zero value based on its type. An uninitialized struct has all fields set to zero:

```go
type Config struct {
    Host    string
    Port    int
    Enabled bool
    Timeout float64
}

var cfg Config
fmt.Println(cfg.Host)    // ""
fmt.Println(cfg.Port)    // 0
fmt.Println(cfg.Enabled) // false
fmt.Println(cfg.Timeout) // 0
```

This is useful — you can often use zero values as sensible defaults.

---

## 5. Struct Literals — Named vs Positional

```go
type Color struct {
    R, G, B uint8
}

// Named fields — order doesn't matter, self-documenting
c1 := Color{R: 255, G: 128, B: 0}

// Positional — must match field declaration order exactly
c2 := Color{255, 128, 0}

// Partial named — unspecified fields get zero values
c3 := Color{R: 255} // G=0, B=0
```

**Always prefer named fields** in production code. Positional literals break silently if you add or reorder fields.

---

## 6. Structs Are Value Types

When you assign a struct to a new variable, Go copies the entire struct:

```go
type Point struct{ X, Y int }

a := Point{X: 1, Y: 2}
b := a       // b is a copy
b.X = 99     // modifying b does NOT affect a

fmt.Println(a) // {1 2} — unchanged
fmt.Println(b) // {99 2}
```

This is different from languages where objects are reference types. In Go, struct assignment always copies.

---

## 7. Pointer to Struct

To modify a struct inside a function, or to avoid copying large structs, use a pointer:

```go
type Counter struct {
    Value int
}

func increment(c *Counter) {
    c.Value++ // modifies the original
}

func main() {
    c := Counter{Value: 10}
    increment(&c)
    fmt.Println(c.Value) // 11
}
```

Go automatically dereferences struct pointers when accessing fields — you write `c.Value`, not `(*c).Value` (though both work):

```go
p := &Point{X: 1, Y: 2}
fmt.Println(p.X)    // 1 (auto-deref)
fmt.Println((*p).X) // 1 (explicit deref — same result)
```

---

## 8. Methods on Structs

Go doesn't have classes, but you can define methods on struct types:

```go
type Rectangle struct {
    Width  float64
    Height float64
}

// Method with value receiver
func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

// Method with value receiver
func (r Rectangle) Perimeter() float64 {
    return 2 * (r.Width + r.Height)
}

func main() {
    rect := Rectangle{Width: 10, Height: 5}
    fmt.Println(rect.Area())      // 50
    fmt.Println(rect.Perimeter()) // 30
}
```

The `(r Rectangle)` part is the **receiver** — it tells Go which type the method belongs to.

---

## 9. Value Receiver vs Pointer Receiver

```go
type Temperature struct {
    Celsius float64
}

// Value receiver — reads data but can't modify the original
func (t Temperature) Fahrenheit() float64 {
    return t.Celsius*9/5 + 32
}

// Pointer receiver — can modify the original
func (t *Temperature) SetCelsius(c float64) {
    t.Celsius = c
}

func main() {
    temp := Temperature{Celsius: 100}
    fmt.Println(temp.Fahrenheit()) // 212

    temp.SetCelsius(37)
    fmt.Println(temp.Celsius) // 37
}
```

**Rule of thumb:**
- Use pointer receivers when the method needs to modify the struct
- Use value receivers when the method only reads data
- Be consistent within a type (don't mix receiver types unless necessary)

---

## 10. Struct Composition (Nested Structs)

Structs can contain other structs:

```go
type Address struct {
    Street string
    City   string
    State  string
    Zip    string
}

type Person struct {
    Name    string
    Age     int
    Address Address // nested struct
}

func main() {
    p := Person{
        Name: "Alice",
        Age:  30,
        Address: Address{
            Street: "123 Main St",
            City:   "Springfield",
            State:  "IL",
            Zip:    "62701",
        },
    }

    fmt.Println(p.Name)           // Alice
    fmt.Println(p.Address.City)   // Springfield
    fmt.Println(p.Address.State)  // IL
}
```

---

## 11. Anonymous Fields (Embedding)

You can embed a struct type without giving it an explicit field name:

```go
type Animal struct {
    Name string
}

func (a Animal) Speak() string {
    return a.Name + " makes a sound"
}

type Dog struct {
    Animal          // embedded — no field name
    Breed string
}

func main() {
    d := Dog{
        Animal: Animal{Name: "Rex"},
        Breed:  "Labrador",
    }

    fmt.Println(d.Name)    // Rex — accessed directly!
    fmt.Println(d.Speak()) // Rex makes a sound — method promoted!
    fmt.Println(d.Breed)   // Labrador
}
```

Embedded fields "promote" their methods and fields to the outer struct. This is Go's way of achieving inheritance-like behavior.

---

## 12. Comparing Structs

Structs are comparable with `==` and `!=` if all their fields are comparable:

```go
type Point struct{ X, Y int }

p1 := Point{1, 2}
p2 := Point{1, 2}
p3 := Point{3, 4}

fmt.Println(p1 == p2) // true
fmt.Println(p1 == p3) // false
fmt.Println(p1 != p3) // true
```

Structs with uncomparable fields (like slices or maps) cannot be compared with `==`:

```go
type Data struct {
    Values []int // slice — not comparable!
}

d1 := Data{Values: []int{1, 2, 3}}
d2 := Data{Values: []int{1, 2, 3}}
// d1 == d2 // compile error: invalid operation
```

To compare structs with slice fields, use `reflect.DeepEqual` or write a custom comparison function.

---

## 13. Struct as Function Parameter and Return Value

Structs can be passed to and returned from functions:

```go
type Employee struct {
    ID     int
    Name   string
    Salary float64
}

func createEmployee(id int, name string, salary float64) Employee {
    return Employee{
        ID:     id,
        Name:   name,
        Salary: salary,
    }
}

func raiseSalary(e Employee, percent float64) Employee {
    e.Salary *= (1 + percent/100) // modifies the copy
    return e
}

func main() {
    emp := createEmployee(1, "Alice", 50000)
    fmt.Println(emp.Salary) // 50000

    raised := raiseSalary(emp, 10)
    fmt.Println(raised.Salary) // 55000
    fmt.Println(emp.Salary)    // 50000 — original unchanged
}
```

---

## 14. Slice of Structs

One of the most common patterns in Go:

```go
type Student struct {
    Name  string
    Grade int
}

students := []Student{
    {Name: "Alice", Grade: 90},
    {Name: "Bob", Grade: 85},
    {Name: "Charlie", Grade: 92},
}

// Iterate over slice of structs
for _, s := range students {
    fmt.Printf("%s: %d\n", s.Name, s.Grade)
}

// Find best student
best := students[0]
for _, s := range students {
    if s.Grade > best.Grade {
        best = s
    }
}
fmt.Println("Best:", best.Name) // Charlie
```

---

## 15. Map with Struct Values

```go
type Score struct {
    Points int
    Rank   string
}

scores := map[string]Score{
    "Alice": {Points: 1500, Rank: "Gold"},
    "Bob":   {Points: 1200, Rank: "Silver"},
}

fmt.Println(scores["Alice"].Points) // 1500
fmt.Println(scores["Bob"].Rank)     // Silver

// To modify a struct in a map, you must replace it entirely:
s := scores["Alice"]
s.Points = 1600
scores["Alice"] = s
// OR use a map of pointers: map[string]*Score
```

---

## 16. Constructor Functions

Go doesn't have constructors, but the convention is to write a `New...` function:

```go
type Stack struct {
    items []int
    max   int
}

func NewStack(maxSize int) *Stack {
    return &Stack{
        items: make([]int, 0, maxSize),
        max:   maxSize,
    }
}

func (s *Stack) Push(v int) bool {
    if len(s.items) >= s.max {
        return false // full
    }
    s.items = append(s.items, v)
    return true
}

func (s *Stack) Pop() (int, bool) {
    if len(s.items) == 0 {
        return 0, false // empty
    }
    last := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return last, true
}

func main() {
    stack := NewStack(3)
    stack.Push(1)
    stack.Push(2)
    stack.Push(3)
    stack.Push(4) // false — full

    v, ok := stack.Pop()
    fmt.Println(v, ok) // 3 true
}
```

---

## 17. String Method (Stringer Interface)

Implement the `fmt.Stringer` interface to control how your struct prints:

```go
import "fmt"

type Point struct {
    X, Y float64
}

// Implement fmt.Stringer
func (p Point) String() string {
    return fmt.Sprintf("(%.2f, %.2f)", p.X, p.Y)
}

func main() {
    p := Point{X: 3.14159, Y: 2.71828}
    fmt.Println(p)       // (3.14, 2.72)
    fmt.Printf("%v\n", p) // (3.14, 2.72)
    fmt.Printf("%s\n", p) // (3.14, 2.72)
}
```

---

## 18. Struct Tags (Introduction)

Struct tags are metadata attached to fields, used by encoding packages:

```go
import "encoding/json"

type User struct {
    ID       int    `json:"id"`
    Username string `json:"username"`
    Password string `json:"-"` // "-" means skip this field
    IsAdmin  bool   `json:"is_admin,omitempty"`
}

user := User{ID: 1, Username: "alice", Password: "secret", IsAdmin: false}
data, _ := json.Marshal(user)
fmt.Println(string(data))
// {"id":1,"username":"alice"}
// Note: password is excluded, is_admin is omitted (omitempty + false)
```

---

## 19. Anonymous Structs

For one-off data structures, you don't need to define a named type:

```go
// Anonymous struct — useful for test data or local grouping
config := struct {
    Host string
    Port int
}{
    Host: "localhost",
    Port: 8080,
}
fmt.Println(config.Host, config.Port)

// Slice of anonymous structs — common in tests
testCases := []struct {
    input    string
    expected int
}{
    {"hello", 5},
    {"world!", 6},
    {"", 0},
}

for _, tc := range testCases {
    if got := len(tc.input); got != tc.expected {
        fmt.Printf("FAIL: len(%q) = %d, want %d\n", tc.input, got, tc.expected)
    }
}
```

---

## 20. Exported vs Unexported Fields

Capitalized field names are exported (visible outside the package); lowercase fields are unexported:

```go
package accounts

type Account struct {
    ID       int    // exported — accessible from other packages
    Username string // exported
    password string // unexported — only accessible within this package
    balance  float64 // unexported
}

func NewAccount(id int, username, password string) *Account {
    return &Account{
        ID:       id,
        Username: username,
        password: password, // can set from within the package
        balance:  0.0,
    }
}

func (a *Account) GetBalance() float64 {
    return a.balance // methods can access unexported fields
}
```

---

## 21. Struct Memory Layout

Understanding how structs are laid out in memory helps with performance:

```go
// Fields are stored in declaration order
type Efficient struct {
    A int64   // 8 bytes
    B int64   // 8 bytes
    C int32   // 4 bytes
    D int32   // 4 bytes
    // Total: 24 bytes
}

type Inefficient struct {
    A int32   // 4 bytes
    B int64   // 8 bytes (needs 8-byte alignment, 4 bytes padding inserted)
    C int32   // 4 bytes
    // Total: 24 bytes (with padding!) — worse than Efficient
}
```

For now, just know that field order can affect struct size due to alignment.

---

## 22. Checking Struct Size

Use `unsafe.Sizeof` to see a struct's size in bytes:

```go
import (
    "fmt"
    "unsafe"
)

type Small struct {
    A int32
    B int32
}

type Large struct {
    Data [1024]byte
    N    int
}

fmt.Println(unsafe.Sizeof(Small{})) // 8
fmt.Println(unsafe.Sizeof(Large{})) // 1032
```

---

## 23. Struct in Switch Statements

```go
type Shape interface {
    Area() float64
}

type Circle struct{ Radius float64 }
type Rect struct{ W, H float64 }

func (c Circle) Area() float64 { return 3.14159 * c.Radius * c.Radius }
func (r Rect) Area() float64   { return r.W * r.H }

func describe(s Shape) {
    switch v := s.(type) {
    case Circle:
        fmt.Printf("Circle with radius %.2f, area=%.2f\n", v.Radius, v.Area())
    case Rect:
        fmt.Printf("Rectangle %gx%g, area=%.2f\n", v.W, v.H, v.Area())
    default:
        fmt.Printf("Unknown shape: %T\n", v)
    }
}

func main() {
    describe(Circle{Radius: 5})
    describe(Rect{W: 3, H: 4})
}
```

---

## 24. Common Patterns: Options Struct

Instead of many function parameters, use an options struct:

```go
type ServerOptions struct {
    Host    string
    Port    int
    Timeout int
    MaxConn int
}

func StartServer(opts ServerOptions) error {
    if opts.Host == "" {
        opts.Host = "localhost" // default
    }
    if opts.Port == 0 {
        opts.Port = 8080 // default
    }
    fmt.Printf("Starting server at %s:%d\n", opts.Host, opts.Port)
    return nil
}

func main() {
    StartServer(ServerOptions{Port: 9090})               // only set what you need
    StartServer(ServerOptions{Host: "0.0.0.0", Port: 80})
    StartServer(ServerOptions{}) // all defaults
}
```

---

## 25. Struct Embedding vs. Composition

```go
// Composition: explicit field
type Engine struct{ Horsepower int }
type Car struct {
    Engine Engine // explicit field
    Brand  string
}

car := Car{Engine: Engine{200}, Brand: "Toyota"}
fmt.Println(car.Engine.Horsepower) // 200 — must specify Engine

// Embedding: promoted fields and methods
type Truck struct {
    Engine // embedded — no field name
    Brand  string
}

truck := Truck{Engine: Engine{350}, Brand: "Ford"}
fmt.Println(truck.Horsepower) // 350 — accessed directly!
```

---

## 26. Mermaid Diagram: Struct Memory Layout

```mermaid
block-beta
  columns 4
  block:header["Person struct"]:4
    Name["Name (string)\n24 bytes"]
    Age["Age (int)\n8 bytes"]
  end
  block:note["In memory: pointer to name string data, len, cap, then int value"]:4
  end
```

More accurate for a simple struct:

```mermaid
block-beta
  columns 1
  block:struct["Person{Name: \"Alice\", Age: 30}"]
    f1["Name ptr → [5]byte 'Alice'"]
    f2["Name len = 5"]
    f3["Name cap = 5"]
    f4["Age = 30"]
  end
```

---

## 27. Quick Reference

```go
// Define
type MyStruct struct {
    Field1 Type1
    Field2 Type2
}

// Create
s := MyStruct{Field1: val1, Field2: val2}
s := MyStruct{val1, val2} // positional (avoid)
var s MyStruct            // zero value
s := new(MyStruct)        // pointer, zero value

// Access
s.Field1
s.Field2 = newValue

// Method
func (s MyStruct) ReadMethod() ReturnType { ... }   // value receiver
func (s *MyStruct) WriteMethod(v Type) { ... }      // pointer receiver

// Pass by pointer
func f(s *MyStruct) { s.Field1 = v }
f(&s)
```

---

## 28. Test Your Knowledge

1. What is the zero value of a struct field of type `string`? Of type `int`? Of type `bool`?
2. If you assign `b := a` for struct values, does modifying `b.X` change `a.X`?
3. What is the difference between a value receiver and a pointer receiver on a method?
4. When should you use a `New...()` constructor function?
5. How do you embed one struct type inside another?

---

## 29. Common Mistakes

```go
// MISTAKE 1: Forgetting to initialize a slice field
type Queue struct {
    items []int
}
q := Queue{}
// q.items is nil — this is OK for append, but risky if you check len(q.items)

// MISTAKE 2: Modifying struct in range loop (modifies copy)
people := []Person{{Name: "Alice"}, {Name: "Bob"}}
for _, p := range people {
    p.Name = "Updated" // WRONG: p is a copy
}
// Fix:
for i := range people {
    people[i].Name = "Updated" // correct
}

// MISTAKE 3: Comparing structs with slice fields
type Data struct{ Items []int }
d1 := Data{Items: []int{1}}
d2 := Data{Items: []int{1}}
// d1 == d2 // compile error
```

---

## 30. Cheat Sheet

| Operation | Syntax |
|-----------|--------|
| Define struct | `type Name struct { ... }` |
| Create value | `Name{Field: val}` |
| Create pointer | `&Name{Field: val}` |
| Access field | `s.Field` |
| Method (value) | `func (s Name) Method() {}` |
| Method (pointer) | `func (s *Name) Method() {}` |
| Embed struct | `type Outer struct { Inner }` |
| Anonymous struct | `struct{ F Type }{val}` |
| Zero value | `var s Name` |
| Size | `unsafe.Sizeof(Name{})` |
